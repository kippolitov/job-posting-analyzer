import { RestError, TableClient } from "@azure/data-tables";

/**
 * One-time idempotent fold of AllowedUsers into Users (research.md R10):
 *
 *   npm run migrate-allowlist -- [--dry-run]
 *   (accepts --connection-string <conn>)
 *
 * Each row becomes a Users row (RK = same lowercased email, tier: "free",
 * carrying over sub/addedAt, migratedFromAllowlist: true); createEntity
 * 409 ⇒ already migrated (or a self-serve signup beat the script to it) ⇒
 * skip, that row's real state stands. Profiles/SavedJobs need no migration
 * — they're already keyed by sub. Local-only, like manage-users.ts: no HTTP
 * admin surface.
 */

const ALLOWED_USERS_TABLE = "AllowedUsers";
const ALLOWED_USERS_PARTITION = "AllowedUser";
const USERS_TABLE = "Users";
const USERS_PARTITION = "User";

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
  dryRun: boolean;
  connectionString: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let connectionString: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--connection-string") connectionString = argv[++i];
  }
  return { dryRun, connectionString };
}

interface AllowedUserRow {
  rowKey?: string;
  sub?: string;
  addedAt?: string;
}

async function getClient(connectionString: string, table: string): Promise<TableClient> {
  const client = TableClient.fromConnectionString(connectionString, table, {
    allowInsecureConnection: true,
  });
  await client.createTable();
  return client;
}

const USAGE = `Usage:
  migrate-allowlist [--dry-run]
Options:
  --dry-run                    Print the migration plan; write nothing
  --connection-string <conn>   Table Storage connection (default: TABLES_CONNECTION_STRING, then AzureWebJobsStorage)`;

export async function runCli(argv: string[], io: CliIo = console): Promise<number> {
  const args = parseArgs(argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    io.log(USAGE);
    return 0;
  }

  let connectionString: string;
  try {
    connectionString = resolveCliConnectionString(args.connectionString);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    const allowedUsers = await getClient(connectionString, ALLOWED_USERS_TABLE);
    const users = await getClient(connectionString, USERS_TABLE);

    const rows = allowedUsers.listEntities<AllowedUserRow>({
      queryOptions: { filter: `PartitionKey eq '${ALLOWED_USERS_PARTITION}'` },
    });

    let migrated = 0;
    let skipped = 0;
    for await (const row of rows) {
      const email = row.rowKey ?? "";
      if (args.dryRun) {
        io.log(
          `[dry-run] would migrate ${email}${row.sub ? ` (sub ${row.sub})` : " (no sub recorded)"}`
        );
        continue;
      }
      try {
        await users.createEntity({
          partitionKey: USERS_PARTITION,
          rowKey: email,
          tier: "free",
          createdAt: row.addedAt ?? new Date().toISOString(),
          migratedFromAllowlist: true,
          ...(row.sub ? { sub: row.sub } : {}),
        });
        migrated++;
        io.log(`Migrated ${email}${row.sub ? ` (sub ${row.sub})` : " (no sub recorded)"}`);
      } catch (err) {
        if (err instanceof RestError && err.statusCode === 409) {
          skipped++;
          io.log(`Skipped ${email} — already has a Users row`);
          continue;
        }
        throw err;
      }
    }

    if (args.dryRun) {
      io.log("Dry run complete — nothing written.");
    } else {
      io.log(`${migrated + skipped} accounts processed: ${migrated} migrated, ${skipped} skipped.`);
    }
    return 0;
  } catch (err) {
    io.error(`Command failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/* istanbul ignore next -- CLI entry, exercised manually */
if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
