import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(dirname, "..", "..", "..");

const CORPUS_DIR = path.join(extensionRoot, "tests", "fixtures", "pages");
const HYDRATION_DIR = path.join(extensionRoot, "tests", "e2e", "hydration");

export interface FixtureServer {
  /** `http://127.0.0.1:<port>` — no trailing slash. */
  origin: string;
  /** A captured corpus fixture's settled DOM, e.g. corpus("lever-palantir"). */
  corpus(id: string): string;
  /** A synthetic hydration page, e.g. hydration("jsonld-early"). */
  hydration(name: string): string;
  close(): Promise<void>;
}

/**
 * Static server over 127.0.0.1:0 for both fixture families — the captured
 * corpus (`settled.html`) and the synthetic hydration pages. Ephemeral port so
 * parallel runs never collide; same pattern as tests/e2e/jobAnalyzer.spec.ts.
 *
 * Fixtures are served over http rather than file:// because the corpus pages
 * carry absolute-path subresources and inline scripts that behave differently
 * under the file: origin's opaque security context.
 */
export async function serveFixtures(): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const file = resolveFile(url.pathname);

    if (!file.path || !fs.existsSync(file.path)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`No fixture for ${url.pathname}`);
      return;
    }

    const headers: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
    };

    // Corpus snapshots are served with scripts blocked. A captured settled.html
    // still carries the board's own JavaScript, which re-runs on replay, fails
    // its network calls offline, and tears the captured DOM down — ashby-linear
    // rewrites itself to "There was a problem with the network connection"
    // (53 chars, down from 4249) and workday-nvidia empties entirely. The
    // snapshot is meant to be a settled DOM, so freeze it.
    //
    // JSON-LD survives this: `script[type="application/ld+json"]` is data, not
    // executable, so it is still parsed into the DOM and still readable.
    //
    // Hydration fixtures are the opposite case — their whole purpose is to run
    // script on a timer — so they are served unrestricted.
    if (file.kind === "corpus") {
      headers["content-security-policy"] = "script-src 'none'";
    }

    res.writeHead(200, headers);
    res.end(fs.readFileSync(file.path));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    corpus: (id) => `${origin}/corpus/${id}`,
    hydration: (name) => `${origin}/hydration/${name}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

interface ResolvedFile {
  path: string | null;
  kind: "corpus" | "hydration" | null;
}

/** Maps a request path onto a fixture file, refusing anything that escapes the roots. */
function resolveFile(pathname: string): ResolvedFile {
  const corpus = pathname.match(/^\/corpus\/([\w-]+)\/?$/);
  if (corpus) {
    return { path: path.join(CORPUS_DIR, corpus[1], "settled.html"), kind: "corpus" };
  }

  const hydration = pathname.match(/^\/hydration\/([\w-]+)(?:\.html)?\/?$/);
  if (hydration) {
    return { path: path.join(HYDRATION_DIR, `${hydration[1]}.html`), kind: "hydration" };
  }

  return { path: null, kind: null };
}
