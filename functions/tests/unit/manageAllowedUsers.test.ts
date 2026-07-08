import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  runCli,
  resolveCliConnectionString,
} from "../../scripts/manage-allowed-users";
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
  const client = await ensureTable("AllowedUsers");
  try {
    return await client.getEntity("AllowedUser", email.toLowerCase());
  } catch {
    return null;
  }
}

describe("manage-allowed-users connection-string resolution", () => {
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

describe("manage-allowed-users subcommands (Azurite-backed)", () => {
  beforeEach(() => {
    process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true";
  });

  it("add normalizes the email, sets addedAt, and stores an optional note", async () => {
    const email = uniqueEmail();
    const { io } = makeOutput();
    const code = await runCli(
      ["add", `  ${email.toUpperCase()}  `, "--note", "college friend"],
      io
    );
    expect(code).toBe(0);

    const row = await readRow(email);
    expect(row).not.toBeNull();
    expect(Date.parse(row!.addedAt as string)).not.toBeNaN();
    expect(row!.note).toBe("college friend");
  });

  it("add is idempotent and preserves the original addedAt", async () => {
    const email = uniqueEmail();
    const first = makeOutput();
    await runCli(["add", email], first.io);
    const original = (await readRow(email))!.addedAt;

    const second = makeOutput();
    const code = await runCli(["add", email], second.io);
    expect(code).toBe(0);
    expect((await readRow(email))!.addedAt).toBe(original);
  });

  it("remove deletes the row and is idempotent on missing", async () => {
    const email = uniqueEmail();
    await runCli(["add", email], makeOutput().io);
    expect(await readRow(email)).not.toBeNull();

    const removal = await runCli(["remove", email], makeOutput().io);
    expect(removal).toBe(0);
    expect(await readRow(email)).toBeNull();

    const again = await runCli(["remove", email], makeOutput().io);
    expect(again).toBe(0);
  });

  it("list prints rows including the sub once recorded", async () => {
    const email = uniqueEmail();
    await runCli(["add", email], makeOutput().io);
    const client = await ensureTable("AllowedUsers");
    await client.updateEntity(
      { partitionKey: "AllowedUser", rowKey: email, sub: "sub-recorded-123" },
      "Merge"
    );

    const { io, lines } = makeOutput();
    const code = await runCli(["list"], io);
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain(email);
    expect(output).toContain("sub-recorded-123");
  });

  it("exits non-zero on bad usage", async () => {
    const noCommand = await runCli([], makeOutput().io);
    expect(noCommand).not.toBe(0);

    const unknown = await runCli(["frobnicate"], makeOutput().io);
    expect(unknown).not.toBe(0);

    const addWithoutEmail = await runCli(["add"], makeOutput().io);
    expect(addWithoutEmail).not.toBe(0);

    const invalidEmail = await runCli(["add", "not-an-email"], makeOutput().io);
    expect(invalidEmail).not.toBe(0);
  });
});
