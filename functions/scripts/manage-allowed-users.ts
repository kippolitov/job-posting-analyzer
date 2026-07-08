import { RestError, TableClient } from "@azure/data-tables";

/**
 * Developer allowlist CLI (research.md R8):
 *
 *   npm run allowed-users -- add <email> [--note "who this is"]
 *   npm run allowed-users -- remove <email>
 *   npm run allowed-users -- list
 *   (any command accepts --connection-string <conn>)
 *
 * Writes the AllowedUsers table directly, so changes take effect on the
 * target account's next request — no extension build, no backend deploy
 * (SC-005). Lives in scripts/, which is not part of the deployed package:
 * there is deliberately no HTTP admin surface.
 */

const TABLE = "AllowedUsers";
const PARTITION = "AllowedUser";

export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

export function resolveCliConnectionString(flag: string | undefined): string {
  const connectionString =
    flag ||
    process.env.TABLES_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error(
      "No Table Storage connection string. Pass --connection-string <conn> or set TABLES_CONNECTION_STRING / AzureWebJobsStorage."
    );
  }
  return connectionString;
}

interface ParsedArgs {
  command: string | undefined;
  email: string | undefined;
  note: string | undefined;
  connectionString: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let note: string | undefined;
  let connectionString: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--note") note = argv[++i];
    else if (arg === "--connection-string") connectionString = argv[++i];
    else positional.push(arg);
  }
  return { command: positional[0], email: positional[1], note, connectionString };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getClient(connectionString: string): Promise<TableClient> {
  const client = TableClient.fromConnectionString(connectionString, TABLE, {
    allowInsecureConnection: true,
  });
  await client.createTable();
  return client;
}

async function addUser(
  client: TableClient,
  email: string,
  note: string | undefined,
  io: CliIo
): Promise<void> {
  try {
    await client.getEntity(PARTITION, email);
    io.log(`${email} is already allowlisted — nothing to do.`);
    return;
  } catch (err) {
    if (!(err instanceof RestError && err.statusCode === 404)) throw err;
  }
  await client.createEntity({
    partitionKey: PARTITION,
    rowKey: email,
    addedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
  io.log(`Added ${email}. Effective on their next sign-in — no deploy needed.`);
}

async function removeUser(
  client: TableClient,
  email: string,
  io: CliIo
): Promise<void> {
  try {
    await client.deleteEntity(PARTITION, email);
    io.log(
      `Removed ${email}. Their next request will be refused; stored data is retained (FR-013).`
    );
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) {
      io.log(`${email} was not on the allowlist — nothing to do.`);
      return;
    }
    throw err;
  }
}

async function listUsers(client: TableClient, io: CliIo): Promise<void> {
  const rows = client.listEntities<{
    rowKey?: string;
    sub?: string;
    addedAt?: string;
    note?: string;
  }>({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
  });
  let count = 0;
  for await (const row of rows) {
    count++;
    const parts = [
      row.rowKey ?? "",
      `added ${row.addedAt ?? "?"}`,
      row.sub ? `sub ${row.sub}` : "never signed in",
    ];
    if (row.note) parts.push(`note: ${row.note}`);
    io.log(parts.join("  |  "));
  }
  io.log(`${count} allowlisted account${count === 1 ? "" : "s"}.`);
}

const USAGE = `Usage:
  allowed-users add <email> [--note "text"]
  allowed-users remove <email>
  allowed-users list
Options:
  --connection-string <conn>   Table Storage connection (default: TABLES_CONNECTION_STRING, then AzureWebJobsStorage)`;

export async function runCli(argv: string[], io: CliIo = console): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command || !["add", "remove", "list"].includes(args.command)) {
    io.error(USAGE);
    return 1;
  }
  if (args.command !== "list") {
    if (!args.email) {
      io.error(`Missing <email>.\n${USAGE}`);
      return 1;
    }
    if (!isEmail(args.email.trim())) {
      io.error(`"${args.email.trim()}" does not look like an email address.`);
      return 1;
    }
  }

  let connectionString: string;
  try {
    connectionString = resolveCliConnectionString(args.connectionString);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    const client = await getClient(connectionString);
    if (args.command === "add") {
      await addUser(client, normalizeEmail(args.email!), args.note, io);
    } else if (args.command === "remove") {
      await removeUser(client, normalizeEmail(args.email!), io);
    } else {
      await listUsers(client, io);
    }
    return 0;
  } catch (err) {
    io.error(
      `Command failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return 1;
  }
}

/* istanbul ignore next -- CLI entry, exercised manually */
if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
