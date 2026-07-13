const TRACKING_PARAMS = new Set([
  "ref",
  "refid",
  "trk",
  "trackingid",
  "gh_src",
  "lever-origin",
  "src",
  "source",
  "mkt_tok",
  "fbclid",
  "gclid",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

interface BoardNormalizer {
  matchesHost: (host: string) => boolean;
  normalize: (url: URL) => string | null;
}

function hostSuffix(suffix: string): (host: string) => boolean {
  return (host) => host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * The job selected in Google's SERP detail overlay is identified only by the
 * URL fragment: modern UI packs a "docid=<id>" into the base64 `#sv=` blob,
 * the classic jobs UI uses `#…&htidocid=<id>`. Without it every job opened
 * from one results page would collapse onto the same canonical URL.
 */
function googleJobDocId(hash: string): string | null {
  const hti = hash.match(/[#&]htidocid=([^&]+)/);
  if (hti) return decodeURIComponent(hti[1]);
  const sv = hash.match(/[#&]sv=([^&]+)/);
  if (!sv) return null;
  try {
    const b64 = decodeURIComponent(sv[1]).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/docid=([A-Za-z0-9_-]+={0,2})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Table-driven per-board rules; a null result falls through to the generic path.
const BOARD_NORMALIZERS: BoardNormalizer[] = [
  {
    matchesHost: hostSuffix("linkedin.com"),
    normalize: (url) => {
      const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
      return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : null;
    },
  },
  {
    matchesHost: hostSuffix("indeed.com"),
    normalize: (url) => {
      if (!url.pathname.startsWith("/viewjob")) return null;
      const jk = url.searchParams.get("jk");
      return jk ? `https://${url.host}/viewjob?jk=${jk}` : null;
    },
  },
  {
    matchesHost: (host) => /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host),
    normalize: (url) => {
      if (url.pathname !== "/search") return null;
      const docid = googleJobDocId(url.hash);
      return docid
        ? `https://www.google.com/search?jobdocid=${encodeURIComponent(docid)}`
        : null;
    },
  },
];

export function canonicalize(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  // Normalizers run before the hash is dropped — Google's job id lives there.
  for (const board of BOARD_NORMALIZERS) {
    if (board.matchesHost(url.host)) {
      const normalized = board.normalize(url);
      if (normalized) return normalized;
    }
  }

  url.hash = "";

  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }

  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname === "/") pathname = "";

  const search = url.searchParams.toString();
  return `${url.protocol}//${url.host}${pathname}${search ? `?${search}` : ""}`;
}

export async function canonicalKey(rawUrl: string): Promise<string> {
  const canonical = canonicalize(rawUrl);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
