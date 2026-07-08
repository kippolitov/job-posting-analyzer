import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  decodeJsonProperty,
  encodeJsonProperty,
  ensureTable,
  getTableClient,
  resetTablesServiceForTests,
} from "../../src/services/tablesService";

const DEV_STORAGE = "UseDevelopmentStorage=true";
const FAKE_ACCOUNT =
  "DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=ZmFrZWtleWZha2VrZXlmYWtla2V5ZmFrZWtleQ==;EndpointSuffix=core.windows.net";

const savedEnv = {
  tables: process.env.TABLES_CONNECTION_STRING,
  jobs: process.env.AzureWebJobsStorage,
};

function restoreEnv(): void {
  if (savedEnv.tables === undefined) delete process.env.TABLES_CONNECTION_STRING;
  else process.env.TABLES_CONNECTION_STRING = savedEnv.tables;
  if (savedEnv.jobs === undefined) delete process.env.AzureWebJobsStorage;
  else process.env.AzureWebJobsStorage = savedEnv.jobs;
}

describe("tablesService connection-string resolution", () => {
  beforeEach(() => resetTablesServiceForTests());
  afterEach(() => {
    restoreEnv();
    resetTablesServiceForTests();
  });

  it("prefers TABLES_CONNECTION_STRING over AzureWebJobsStorage", () => {
    process.env.TABLES_CONNECTION_STRING = DEV_STORAGE;
    process.env.AzureWebJobsStorage = FAKE_ACCOUNT;
    const client = getTableClient("ResolutionTest");
    expect(client.url).toContain("127.0.0.1:10002");
  });

  it("falls back to AzureWebJobsStorage when the override is absent", () => {
    delete process.env.TABLES_CONNECTION_STRING;
    process.env.AzureWebJobsStorage = FAKE_ACCOUNT;
    const client = getTableClient("ResolutionTest");
    expect(client.url).toContain("fakeacct.table.core.windows.net");
  });

  it("throws a clear error when no connection string is configured", () => {
    delete process.env.TABLES_CONNECTION_STRING;
    delete process.env.AzureWebJobsStorage;
    expect(() => getTableClient("ResolutionTest")).toThrow(
      /TABLES_CONNECTION_STRING|AzureWebJobsStorage/
    );
  });
});

describe("tablesService lazy clients and auto-create", () => {
  beforeEach(() => {
    resetTablesServiceForTests();
    process.env.TABLES_CONNECTION_STRING = DEV_STORAGE;
  });
  afterEach(() => {
    restoreEnv();
    resetTablesServiceForTests();
  });

  it("creates one client per table and reuses it", () => {
    const first = getTableClient("LazyClientTest");
    const second = getTableClient("LazyClientTest");
    const other = getTableClient("LazyClientTestOther");
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("auto-creates the table on first ensureTable and round-trips an entity", async () => {
    const client = await ensureTable("AutoCreateTest");
    const rowKey = `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await client.createEntity({
      partitionKey: "AutoCreateTest",
      rowKey,
      payload: "hello",
    });
    const entity = await client.getEntity("AutoCreateTest", rowKey);
    expect(entity.payload).toBe("hello");
  });

  it("is idempotent when the table already exists", async () => {
    await ensureTable("AutoCreateIdempotentTest");
    await expect(ensureTable("AutoCreateIdempotentTest")).resolves.toBeDefined();
    // A fresh service state must also tolerate the table already existing.
    resetTablesServiceForTests();
    process.env.TABLES_CONNECTION_STRING = DEV_STORAGE;
    await expect(ensureTable("AutoCreateIdempotentTest")).resolves.toBeDefined();
  });
});

describe("tablesService entity codecs", () => {
  it("round-trips JSON-string properties", () => {
    const value = { list: ["a", "b"], nested: { n: 1 }, s: "x" };
    expect(decodeJsonProperty(encodeJsonProperty(value), null)).toEqual(value);
  });

  it("returns the fallback for missing or corrupt raw values", () => {
    expect(decodeJsonProperty(undefined, [])).toEqual([]);
    expect(decodeJsonProperty("not-json{", { d: true })).toEqual({ d: true });
  });
});
