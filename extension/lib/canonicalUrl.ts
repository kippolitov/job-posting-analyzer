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
  hostSuffix: string;
  normalize: (url: URL) => string | null;
}

// Table-driven per-board rules; a null result falls through to the generic path.
const BOARD_NORMALIZERS: BoardNormalizer[] = [
  {
    hostSuffix: "linkedin.com",
    normalize: (url) => {
      const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
      return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : null;
    },
  },
  {
    hostSuffix: "indeed.com",
    normalize: (url) => {
      if (!url.pathname.startsWith("/viewjob")) return null;
      const jk = url.searchParams.get("jk");
      return jk ? `https://${url.host}/viewjob?jk=${jk}` : null;
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

  url.hash = "";

  for (const board of BOARD_NORMALIZERS) {
    if (
      url.host === board.hostSuffix ||
      url.host.endsWith(`.${board.hostSuffix}`)
    ) {
      const normalized = board.normalize(url);
      if (normalized) return normalized;
    }
  }

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
