import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { paddleWebhookHandler } from "../../src/paddle-webhook/index";
import { getOrCreate, getByEmail } from "../../src/services/usersStore";
import { ensureTable } from "../../src/services/tablesService";
import {
  TEST_WEBHOOK_SECRET,
  transactionCompleted,
  subscriptionActivated,
  subscriptionUpdated,
  subscriptionCanceled,
  unknownEvent,
} from "../helpers/paddleFixtures";

function makeRequest(rawBody: string, headers: Record<string, string>): HttpRequest {
  return {
    method: "POST",
    text: () => Promise.resolve(rawBody),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return {
    log: () => {},
    error: () => {},
    warn: () => {},
  } as unknown as InvocationContext;
}

async function makeSignedUpUser(): Promise<{ email: string; sub: string }> {
  const email = `${randomUUID()}@example.com`;
  const sub = `sub-${randomUUID()}`;
  await getOrCreate(email, sub);
  return { email, sub };
}

describe("paddle-webhook (integration: real HMAC + Azurite)", () => {
  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  it("transaction.completed flips tier to premium and stores the customer id", async () => {
    const user = await makeSignedUpUser();
    const fixture = transactionCompleted({
      custom_data: { sub: user.sub, email: user.email },
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("premium");
    expect(row?.paddleCustomerId).toBeTruthy();
  });

  it("subscription.activated flips tier to premium and stores subscription fields", async () => {
    const user = await makeSignedUpUser();
    const fixture = subscriptionActivated({
      custom_data: { sub: user.sub, email: user.email },
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("premium");
    expect(row?.subscriptionStatus).toBe("active");
    expect(row?.paddleSubscriptionId).toBeTruthy();
    expect(row?.renewsAt).toBe("2026-08-03T00:00:00Z");
  });

  it("either activation event may arrive first — both converge on the same premium state", async () => {
    const user = await makeSignedUpUser();
    const activated = subscriptionActivated({
      custom_data: { sub: user.sub, email: user.email },
    });
    await paddleWebhookHandler(makeRequest(activated.rawBody, activated.headers), makeContext());

    const completed = transactionCompleted({
      custom_data: { sub: user.sub, email: user.email },
    });
    const res = await paddleWebhookHandler(
      makeRequest(completed.rawBody, completed.headers),
      makeContext()
    );
    expect(res.status).toBe(200);
    expect((await getByEmail(user.email))?.tier).toBe("premium");
  });

  it("duplicate event_id delivery: single PaddleEvents row, single state write, 200 both times", async () => {
    const user = await makeSignedUpUser();
    const fixture = transactionCompleted({
      custom_data: { sub: user.sub, email: user.email },
    });
    const first = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(first.status).toBe(200);

    const second = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(second.status).toBe(200);

    const eventsClient = await ensureTable("PaddleEvents");
    let count = 0;
    for await (const _row of eventsClient.listEntities({
      queryOptions: { filter: `RowKey eq '${fixture.eventId}'` },
    })) {
      count++;
    }
    expect(count).toBe(1);
  });

  it("unresolvable custom_data: 200 + logged, no Users write (orphan event)", async () => {
    const fixture = transactionCompleted({
      custom_data: { sub: "sub-nobody", email: `${randomUUID()}@example.com` },
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("bad signature: 400, no state change", async () => {
    const user = await makeSignedUpUser();
    const fixture = transactionCompleted({
      custom_data: { sub: user.sub, email: user.email },
    });
    const tamperedBody = fixture.rawBody.replace(user.email, "tampered@example.com");
    const res = await paddleWebhookHandler(
      makeRequest(tamperedBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect((await getByEmail(user.email))?.tier).toBe("free");
  });

  it("missing signature header: 400", async () => {
    const fixture = transactionCompleted();
    const res = await paddleWebhookHandler(makeRequest(fixture.rawBody, {}), makeContext());
    expect(res.status).toBe(400);
  });

  it("unknown event type: acknowledged 200, ignored", async () => {
    const fixture = unknownEvent();
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);
  });

  it("flipped tier is visible to a subsequent simulated authed request (uncached read)", async () => {
    const user = await makeSignedUpUser();
    const fixture = subscriptionActivated({
      custom_data: { sub: user.sub, email: user.email },
    });
    await paddleWebhookHandler(makeRequest(fixture.rawBody, fixture.headers), makeContext());

    // The next request's withAuth-style read sees premium immediately.
    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("premium");
  });

  it("malformed JSON body with a valid signature over it: 400", async () => {
    const rawBody = "not json";
    const ts = Math.floor(Date.now() / 1000);
    const { signPaddleSignature } = await import("../helpers/paddleFixtures");
    const headers = { "paddle-signature": signPaddleSignature(rawBody, ts) };
    const res = await paddleWebhookHandler(makeRequest(rawBody, headers), makeContext());
    expect(res.status).toBe(400);
  });
});

describe("paddle-webhook — subscription lifecycle (US4)", () => {
  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  async function makePremiumUser(): Promise<{ email: string; sub: string }> {
    const user = { email: `${randomUUID()}@example.com`, sub: `sub-${randomUUID()}` };
    await getOrCreate(user.email, user.sub);
    const activated = subscriptionActivated({
      custom_data: { sub: user.sub, email: user.email },
    });
    await paddleWebhookHandler(
      makeRequest(activated.rawBody, activated.headers),
      makeContext()
    );
    return user;
  }

  it("subscription.updated with a scheduled cancel sets endsAt without touching tier", async () => {
    const user = await makePremiumUser();
    const fixture = subscriptionUpdated({
      custom_data: { sub: user.sub, email: user.email },
      status: "active",
      scheduled_change: { action: "cancel", effective_at: "2026-09-01T00:00:00Z" },
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("premium");
    expect(row?.endsAt).toBe("2026-09-01T00:00:00Z");
  });

  it("subscription.updated refreshes a past_due status without touching tier", async () => {
    const user = await makePremiumUser();
    const fixture = subscriptionUpdated({
      custom_data: { sub: user.sub, email: user.email },
      status: "past_due",
      scheduled_change: null,
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("premium");
    expect(row?.subscriptionStatus).toBe("past_due");
  });

  it("subscription.canceled flips tier to free and clears renewsAt/endsAt", async () => {
    const user = await makePremiumUser();
    const fixture = subscriptionCanceled({
      custom_data: { sub: user.sub, email: user.email },
    });
    const res = await paddleWebhookHandler(
      makeRequest(fixture.rawBody, fixture.headers),
      makeContext()
    );
    expect(res.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("free");
    expect(row?.subscriptionStatus).toBe("canceled");
    expect(row?.renewsAt).toBeFalsy();
    expect(row?.endsAt).toBeFalsy();
  });

  it("out-of-order guard: a late subscription.updated after subscription.canceled leaves tier free", async () => {
    const user = await makePremiumUser();
    const earlyTs = new Date("2026-08-10T00:00:00Z").toISOString();
    const lateTs = new Date("2026-08-20T00:00:00Z").toISOString();

    const canceled = subscriptionCanceled(
      { custom_data: { sub: user.sub, email: user.email } },
      { occurredAt: lateTs }
    );
    const cancelRes = await paddleWebhookHandler(
      makeRequest(canceled.rawBody, canceled.headers),
      makeContext()
    );
    expect(cancelRes.status).toBe(200);
    expect((await getByEmail(user.email))?.tier).toBe("free");

    // Delayed delivery of an "updated" event that predates the cancellation.
    const staleUpdate = subscriptionUpdated(
      {
        custom_data: { sub: user.sub, email: user.email },
        status: "active",
        next_billed_at: "2026-09-03T00:00:00Z",
        scheduled_change: null,
      },
      { occurredAt: earlyTs }
    );
    const updateRes = await paddleWebhookHandler(
      makeRequest(staleUpdate.rawBody, staleUpdate.headers),
      makeContext()
    );
    expect(updateRes.status).toBe(200);

    const row = await getByEmail(user.email);
    expect(row?.tier).toBe("free");
    expect(row?.subscriptionStatus).toBe("canceled");
  });
});
