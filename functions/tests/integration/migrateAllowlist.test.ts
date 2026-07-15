import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { runCli } from "../../scripts/migrate-allowlist";
import { ensureTable } from "../../src/services/tablesService";
import { getByEmail } from "../../src/services/usersStore";

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    io: {
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => errors.push(msg),
    },
  };
}

async function seedAllowedUser(
  email: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const client = await ensureTable("AllowedUsers");
  await client.createEntity({
    partitionKey: "AllowedUser",
    rowKey: email.toLowerCase(),
    addedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
}

describe("migrate-allowlist connection-string resolution", () => {
  const saved = {
    tables: process.env.TABLES_CONNECTION_STRING,
    jobs: process.env.AzureWebJobsStorage,
  };

  afterEach(() => {
    if (saved.tables === undefined) delete process.env.TABLES_CONNECTION_STRING;
    else process.env.TABLES_CONNECTION_STRING = saved.tables;
    if (saved.jobs === undefined) delete process.env.AzureWebJobsStorage;
    else process.env.AzureWebJobsStorage = saved.jobs;
  });

  it("fails with a clear error when nothing is configured", async () => {
    delete process.env.TABLES_CONNECTION_STRING;
    delete process.env.AzureWebJobsStorage;
    const { io, errors } = makeOutput();
    const code = await runCli([], io);
    expect(code).not.toBe(0);
    expect(errors.join("\n")).toMatch(/connection string/i);
  });
});

describe("migrate-allowlist (Azurite-backed)", () => {
  beforeEach(() => {
    process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true";
  });

  it("folds a row with a recorded sub into Users: tier free, migratedFromAllowlist true, sub/addedAt carried", async () => {
    const email = uniqueEmail();
    await seedAllowedUser(email, { sub: "sub-original", addedAt: "2026-02-01T00:00:00Z" });

    const { io } = makeOutput();
    const code = await runCli([], io);
    expect(code).toBe(0);

    const row = await getByEmail(email);
    expect(row).not.toBeNull();
    expect(row?.tier).toBe("free");
    expect(row?.migratedFromAllowlist).toBe(true);
    expect(row?.sub).toBe("sub-original");
    expect(row?.createdAt).toBe("2026-02-01T00:00:00Z");
  });

  it("tolerates a row with no recorded sub — getOrCreate records it later", async () => {
    const email = uniqueEmail();
    await seedAllowedUser(email); // no sub: added but never signed in

    const { io } = makeOutput();
    const code = await runCli([], io);
    expect(code).toBe(0);

    const row = await getByEmail(email);
    expect(row).not.toBeNull();
    expect(row?.sub).toBeUndefined();
    expect(row?.migratedFromAllowlist).toBe(true);

    const { getOrCreate } = await import("../../src/services/usersStore");
    const signedIn = await getOrCreate(email, "sub-first-signin");
    expect(signedIn.sub).toBe("sub-first-signin");
    expect(signedIn.migratedFromAllowlist).toBe(true);
  });

  it("skips a row that already has a Users entry (409 path)", async () => {
    const email = uniqueEmail();
    await seedAllowedUser(email, { sub: "sub-legacy" });
    const { getOrCreate, setTier } = await import("../../src/services/usersStore");
    await getOrCreate(email, "sub-already-signed-up");
    await setTier(email, "premium");

    const { io } = makeOutput();
    const code = await runCli([], io);
    expect(code).toBe(0);

    // The pre-existing (self-serve) row is untouched — premium tier stands.
    const row = await getByEmail(email);
    expect(row?.tier).toBe("premium");
    expect(row?.sub).toBe("sub-already-signed-up");
  });

  it("is idempotent: re-running after a successful migration changes nothing", async () => {
    const email = uniqueEmail();
    await seedAllowedUser(email, { sub: "sub-original" });

    await runCli([], makeOutput().io);
    const first = await getByEmail(email);

    const second = await runCli([], makeOutput().io);
    expect(second).toBe(0);
    const after = await getByEmail(email);
    expect(after).toEqual(first);
  });

  it("--dry-run writes nothing and prints the plan", async () => {
    const email = uniqueEmail();
    await seedAllowedUser(email, { sub: "sub-original" });

    const { io, lines } = makeOutput();
    const code = await runCli(["--dry-run"], io);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain(email);
    expect(lines.join("\n")).toMatch(/dry.run/i);

    await expect(getByEmail(email)).resolves.toBeNull();
  });

  it("prints a per-row summary and a final count", async () => {
    // The AllowedUsers table is shared, real, file-backed Azurite state
    // across this whole suite (no per-test reset) — assert this run's two
    // rows appear and a numeric summary is printed, not an exact table total.
    const emailA = uniqueEmail();
    const emailB = uniqueEmail();
    await seedAllowedUser(emailA, { sub: "sub-a" });
    await seedAllowedUser(emailB);

    const { io, lines } = makeOutput();
    const code = await runCli([], io);
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain(emailA);
    expect(output).toContain(emailB);
    expect(output).toMatch(/\d+ accounts? processed: \d+ migrated, \d+ skipped/i);
  });
});
