import { RestError, TableClient } from "@azure/data-tables";
import { isTier } from "../src/models/user";

/**
 * Admin override CLI (plan.md — replaces manage-allowed-users.ts now that
 * signup is self-serve, no allowlist):
 *
 *   npm run users -- list
 *   npm run users -- set-tier <email> free|premium
 *   npm run users -- block <email>
 *   npm run users -- unblock <email>
 *   (any command accepts --connection-string <conn>)
 *
 * Writes the Users table directly, so changes take effect on the target
 * account's next request — no extension build, no backend deploy. Lives in
 * scripts/, which is not part of the deployed package: there is
 * deliberately no HTTP admin surface.
 */

const TABLE = "Users";
const PARTITION = "User";

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
  tier: string | undefined;
  connectionString: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let connectionString: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--connection-string") connectionString = argv[++i];
    else positional.push(arg);
  }
  return {
    command: positional[0],
    email: positional[1],
    tier: positional[2],
    connectionString,
  };
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

async function setTier(
  client: TableClient,
  email: string,
  tier: string,
  io: CliIo
): Promise<number> {
  if (!isTier(tier)) {
    io.error(`"${tier}" is not a valid tier. Use free or premium.`);
    return 1;
  }
  try {
    await client.getEntity(PARTITION, email);
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) {
      io.error(`No such account: ${email} has never signed up.`);
      return 1;
    }
    throw err;
  }
  await client.updateEntity({ partitionKey: PARTITION, rowKey: email, tier }, "Merge");
  io.log(`Set ${email} to ${tier}. Effective on their next request.`);
  return 0;
}

async function setBlocked(
  client: TableClient,
  email: string,
  blocked: boolean,
  io: CliIo
): Promise<number> {
  try {
    await client.getEntity(PARTITION, email);
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) {
      io.error(`No such account: ${email} has never signed up.`);
      return 1;
    }
    throw err;
  }
  await client.updateEntity({ partitionKey: PARTITION, rowKey: email, blocked }, "Merge");
  io.log(
    blocked
      ? `Blocked ${email}. Their next request will be refused; stored data is retained.`
      : `Unblocked ${email}. Effective on their next request.`
  );
  return 0;
}

async function listUsers(client: TableClient, io: CliIo): Promise<void> {
  const rows = client.listEntities<{
    rowKey?: string;
    sub?: string;
    tier?: string;
    blocked?: boolean;
    createdAt?: string;
  }>({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
  });
  let count = 0;
  for await (const row of rows) {
    count++;
    const parts = [
      row.rowKey ?? "",
      row.tier ?? "free",
      row.blocked ? "blocked" : "active",
      `created ${row.createdAt ?? "?"}`,
      row.sub ? `sub ${row.sub}` : "never signed in",
    ];
    io.log(parts.join("  |  "));
  }
  io.log(`${count} account${count === 1 ? "" : "s"}.`);
}

const USAGE = `Usage:
  users list
  users set-tier <email> free|premium
  users block <email>
  users unblock <email>
Options:
  --connection-string <conn>   Table Storage connection (default: TABLES_CONNECTION_STRING, then AzureWebJobsStorage)`;

export async function runCli(argv: string[], io: CliIo = console): Promise<number> {
  const args = parseArgs(argv);
  const commands = ["list", "set-tier", "block", "unblock"];

  if (!args.command || !commands.includes(args.command)) {
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
  if (args.command === "set-tier" && !args.tier) {
    io.error(`Missing tier (free|premium).\n${USAGE}`);
    return 1;
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
    const email = args.email ? normalizeEmail(args.email) : "";
    if (args.command === "set-tier") {
      return await setTier(client, email, args.tier!, io);
    } else if (args.command === "block") {
      return await setBlocked(client, email, true, io);
    } else if (args.command === "unblock") {
      return await setBlocked(client, email, false, io);
    } else {
      await listUsers(client, io);
      return 0;
    }
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
