import { TableClient } from "@azure/data-tables";

/**
 * Single access point for Azure Table Storage (research.md R2).
 *
 * Clients are created lazily per table and cached for the process lifetime;
 * the first `ensureTable` call auto-creates the table (createTable swallows
 * TableAlreadyExists). Connection string resolution: TABLES_CONNECTION_STRING
 * (tests/local Azurite override) then AzureWebJobsStorage (the Function App's
 * existing storage account). `UseDevelopmentStorage=true` is translated by
 * the SDK itself, including allowInsecureConnection for Azurite's http
 * endpoint.
 */

const clients = new Map<string, TableClient>();
const creations = new Map<string, Promise<void>>();

export function resolveTablesConnectionString(): string {
  const connectionString =
    process.env.TABLES_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error(
      "Table Storage is not configured: set TABLES_CONNECTION_STRING or AzureWebJobsStorage."
    );
  }
  return connectionString;
}

export function getTableClient(tableName: string): TableClient {
  let client = clients.get(tableName);
  if (!client) {
    client = TableClient.fromConnectionString(
      resolveTablesConnectionString(),
      tableName,
      { allowInsecureConnection: true }
    );
    clients.set(tableName, client);
  }
  return client;
}

/** Returns the table's client, creating the table on first use. */
export async function ensureTable(tableName: string): Promise<TableClient> {
  const client = getTableClient(tableName);
  let creation = creations.get(tableName);
  if (!creation) {
    creation = client.createTable().catch((err) => {
      // Let the next caller retry instead of caching the failure forever.
      creations.delete(tableName);
      throw err;
    });
    creations.set(tableName, creation);
  }
  await creation;
  return client;
}

/** Drops cached clients/creation state so tests can re-resolve env config. */
export function resetTablesServiceForTests(): void {
  clients.clear();
  creations.clear();
}

/** Encodes a structured value into a Table string property. */
export function encodeJsonProperty(value: unknown): string {
  return JSON.stringify(value);
}

/** Decodes a JSON-string property; corrupt or absent values yield the fallback. */
export function decodeJsonProperty<T>(raw: string | undefined | null, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
