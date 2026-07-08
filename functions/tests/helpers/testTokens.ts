import { createSign, generateKeyPairSync, KeyObject } from "node:crypto";
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Really-signed Google-shaped ID tokens for middleware tests (research.md R9).
 *
 * A process-wide RSA keypair signs test JWTs; a local HTTP stub serves the
 * public key in Google's certs format ({ kid: pem }). Point the middleware at
 * it via the `GOOGLE_OAUTH_CERTS_URL` env override so signature verification
 * runs real crypto — expired/foreign-audience/tampered cases are actual
 * cryptographic failures, not mock returns.
 */

const KID = "test-key-1";

export const TEST_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
export const GOOGLE_ISSUER = "https://accounts.google.com";

const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
// A second keypair whose signatures must NOT verify against the stub certs.
const foreignKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

let server: Server | null = null;
let certsUrl = "";

/** Starts (or reuses) the local certs stub; returns its URL. */
export async function startCertsStub(): Promise<string> {
  if (server) return certsUrl;
  const publicPem = signingKeys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    // google-auth-library reads cache headers when caching certs in-process.
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(JSON.stringify({ [KID]: publicPem }));
  });
  await new Promise<void>((resolve) =>
    server!.listen(0, "127.0.0.1", () => resolve())
  );
  const { port } = server.address() as AddressInfo;
  certsUrl = `http://127.0.0.1:${port}/oauth2/v1/certs`;
  return certsUrl;
}

export async function stopCertsStub(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  certsUrl = "";
}

export interface TestTokenClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  aud?: string;
  iss?: string;
  /** Epoch seconds. */
  exp?: number;
  /** Epoch seconds. */
  iat?: number;
  nonce?: string;
}

export interface SignTestIdTokenOptions {
  /** Sign with a key the stub does not serve — signature must fail. */
  badSignature?: boolean;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signTestIdToken(
  claims: TestTokenClaims = {},
  options: SignTestIdTokenOptions = {}
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: GOOGLE_ISSUER,
    aud: TEST_CLIENT_ID,
    sub: "test-sub-1234567890",
    email: "user@example.com",
    email_verified: true,
    iat: nowSeconds - 60,
    exp: nowSeconds + 3600,
    ...claims,
  };
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload)
  )}`;
  const key: KeyObject = options.badSignature
    ? foreignKeys.privateKey
    : signingKeys.privateKey;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(key)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}
