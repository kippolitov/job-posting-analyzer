import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { runCli, resolveCliConnectionString } from "../../scripts/manage-users";
import { ensureTable } from "../../src/services/tablesService";

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

async function readRow(email: string): Promise<Record<string, unknown> | null> {
  const client = await ensureTable("Users");
  try {
    return await client.getEntity("User", email.toLowerCase());
  } catch {
    return null;
  }
}

async function seedUser(
  email: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const client = await ensureTable("Users");
  await client.createEntity({
    partitionKey: "User",
    rowKey: email.toLowerCase(),
    tier: "free",
    createdAt: new Date().toISOString(),
    ...extra,
  });
}

describe("manage-users connection-string resolution", () => {
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

  it("prefers --connection-string, then TABLES_CONNECTION_STRING, then AzureWebJobsStorage", () => {
    process.env.TABLES_CONNECTION_STRING = "env-tables";
    process.env.AzureWebJobsStorage = "env-jobs";
    expect(resolveCliConnectionString("flag-value")).toBe("flag-value");
    expect(resolveCliConnectionString(undefined)).toBe("env-tables");
    delete process.env.TABLES_CONNECTION_STRING;
    expect(resolveCliConnectionString(undefined)).toBe("env-jobs");
  });

  it("fails with a clear error when nothing is configured", async () => {
    delete process.env.TABLES_CONNECTION_STRING;
    delete process.env.AzureWebJobsStorage;
    expect(() => resolveCliConnectionString(undefined)).toThrow(
      /--connection-string|TABLES_CONNECTION_STRING|AzureWebJobsStorage/
    );
    const { io, errors } = makeOutput();
    const code = await runCli(["list"], io);
    expect(code).not.toBe(0);
    expect(errors.join("\n")).toMatch(/connection string/i);
  });
});

describe("manage-users subcommands (Azurite-backed)", () => {
  beforeEach(() => {
    process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true";
  });

  it("set-tier flips an existing user's tier", async () => {
    const email = uniqueEmail();
    await seedUser(email);
    const { io } = makeOutput();
    const code = await runCli(["set-tier", email, "premium"], io);
    expect(code).toBe(0);
    expect((await readRow(email))?.tier).toBe("premium");
  });

  it("set-tier rejects an unknown tier value", async () => {
    const email = uniqueEmail();
    await seedUser(email);
    const { io, errors } = makeOutput();
    const code = await runCli(["set-tier", email, "gold"], io);
    expect(code).not.toBe(0);
    expect(errors.join("\n")).toMatch(/free|premium/i);
  });

  it("set-tier fails clearly when the account has never signed up", async () => {
    const email = uniqueEmail();
    const { io, errors } = makeOutput();
    const code = await runCli(["set-tier", email, "premium"], io);
    expect(code).not.toBe(0);
    expect(errors.join("\n")).toMatch(/no such|not found/i);
  });

  it("block sets blocked:true; unblock clears it", async () => {
    const email = uniqueEmail();
    await seedUser(email);

    const blockCode = await runCli(["block", email], makeOutput().io);
    expect(blockCode).toBe(0);
    expect((await readRow(email))?.blocked).toBe(true);

    const unblockCode = await runCli(["unblock", email], makeOutput().io);
    expect(unblockCode).toBe(0);
    expect((await readRow(email))?.blocked).toBe(false);
  });

  it("list prints tier, blocked state, and sub for every account", async () => {
    const email = uniqueEmail();
    await seedUser(email, { sub: "sub-listed-123", tier: "premium" });

    const { io, lines } = makeOutput();
    const code = await runCli(["list"], io);
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain(email);
    expect(output).toContain("premium");
    expect(output).toContain("sub-listed-123");
  });

  it("exits non-zero on bad usage", async () => {
    const noCommand = await runCli([], makeOutput().io);
    expect(noCommand).not.toBe(0);

    const unknown = await runCli(["frobnicate"], makeOutput().io);
    expect(unknown).not.toBe(0);

    const setTierWithoutTier = await runCli(
      ["set-tier", uniqueEmail()],
      makeOutput().io
    );
    expect(setTierWithoutTier).not.toBe(0);

    const blockWithoutEmail = await runCli(["block"], makeOutput().io);
    expect(blockWithoutEmail).not.toBe(0);

    const invalidEmail = await runCli(
      ["block", "not-an-email"],
      makeOutput().io
    );
    expect(invalidEmail).not.toBe(0);
  });
});
