import { app, InvocationContext, Timer } from "@azure/functions";

/**
 * No-op timer that keeps the Consumption-plan worker loaded. Paddle drops a
 * webhook delivery that doesn't respond within 5 seconds, and a cold start
 * here reliably exceeds that (observed 7–12s), so the first delivery attempt
 * of every tier-flip event failed until Paddle retried against a warm
 * instance — pushing upgrades past the ≤1-minute target (SC-004). A 4-minute
 * heartbeat keeps the instance resident (idle unload is ~5–20 min).
 */
export function keepWarmHandler(
  _timer: Timer,
  context: InvocationContext
): Promise<void> {
  context.debug("keep-warm: heartbeat");
  return Promise.resolve();
}

app.timer("keep-warm", {
  schedule: "0 */4 * * * *",
  runOnStartup: false,
  handler: keepWarmHandler,
});
