import { spawn, ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Vitest globalSetup: make an Azurite table emulator available on :10002 for
 * every Azurite-backed suite (unit stores/repositories and the integration
 * endpoint tests). If something is already listening — a developer's
 * `npm run azurite` — it is used as-is; otherwise a child process is spawned
 * and torn down with the run. Suites connect via
 * `TABLES_CONNECTION_STRING=UseDevelopmentStorage=true` (injected in
 * vitest.config.ts) and isolate from each other by using unique
 * emails/subs per test, so no cross-suite table cleaning is needed.
 */

const TABLE_PORT = 10002;
const STARTUP_TIMEOUT_MS = 20_000;

let azurite: ChildProcess | null = null;

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Azurite table emulator did not start listening on :${port} within ${timeoutMs} ms`
  );
}

export default async function setup(): Promise<() => Promise<void>> {
  if (!(await isPortListening(TABLE_PORT))) {
    const workspace = path.join(__dirname, "..", "..", ".azurite");
    mkdirSync(workspace, { recursive: true });
    const bin = path.join(
      __dirname,
      "..",
      "..",
      "node_modules",
      ".bin",
      "azurite-table"
    );
    azurite = spawn(bin, ["--location", workspace, "--silent"], {
      stdio: "ignore",
      // Detached process group so teardown can kill the whole tree.
      detached: true,
    });
    azurite.unref();
    await waitForPort(TABLE_PORT, STARTUP_TIMEOUT_MS);
  }

  return () => {
    if (azurite?.pid) {
      try {
        process.kill(-azurite.pid, "SIGTERM");
      } catch {
        // Already exited.
      }
    }
    return Promise.resolve();
  };
}
