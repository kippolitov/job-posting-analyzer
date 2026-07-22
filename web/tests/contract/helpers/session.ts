import { setSession } from "@/auth/authStore";

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeIdToken(
  claims: { sub?: string; email?: string; exp?: number } = {}
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "user-1",
      email: "user@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
  );
  return `${header}.${payload}.fake-signature`;
}

/** Seeds an in-memory session as if GIS had already signed the user in. */
export function seedSession(claims: { sub?: string; email?: string; exp?: number } = {}) {
  return setSession(makeIdToken(claims));
}
