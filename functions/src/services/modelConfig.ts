import type { Tier } from "../models/user";

/** Invalid model setting → the handler returns 500 SERVICE_ERROR (contracts/model-config.md). */
export class ModelConfigError extends Error {}

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ModelConfig {
  deployment: string;
  apiVersion: string;
  /** Omitted from the request when undefined. */
  temperature?: number;
  /** Omitted from the request when undefined. */
  reasoningEffort?: ReasoningEffort;
}

// Fixed by the PR1 live probe (specs/006-profile-match-ux/eval-models.md).
export const DEFAULT_API_VERSION = "2024-12-01-preview";

/** Empty strings count as unset, matching the Premium-deployment convention. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function parseTemperature(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = setting(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new ModelConfigError(`${name} must be a number in [0, 2], got "${raw}".`);
  }
  return value;
}

function parseReasoningEffort(env: NodeJS.ProcessEnv, name: string): ReasoningEffort | undefined {
  const raw = setting(env, name);
  if (raw === undefined) return undefined;
  if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
    throw new ModelConfigError(
      `${name} must be one of ${REASONING_EFFORTS.join("|")}, got "${raw}".`
    );
  }
  return raw as ReasoningEffort;
}

/**
 * Per-deployment request settings (research R1). Pure: reads only `env`.
 * Premium uses its own `_PREMIUM` settings only when its own deployment is
 * set; otherwise it falls back to the free deployment AND the free settings,
 * because settings belong to the deployment, not the tier.
 */
export function resolveModelConfig(tier: Tier, env: NodeJS.ProcessEnv): ModelConfig {
  const premiumDeployment = setting(env, "AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM");
  const usePremium = tier === "premium" && premiumDeployment !== undefined;
  const suffix = usePremium ? "_PREMIUM" : "";

  const deployment = usePremium
    ? premiumDeployment
    : setting(env, "AZURE_OPENAI_JOB_DEPLOYMENT") ??
      setting(env, "AZURE_OPENAI_DEPLOYMENT") ??
      "gpt-4o-mini";
  const temperature = parseTemperature(env, `AZURE_OPENAI_JOB_TEMPERATURE${suffix}`);
  const reasoningEffort = parseReasoningEffort(env, `AZURE_OPENAI_JOB_REASONING_EFFORT${suffix}`);

  return {
    deployment,
    apiVersion: setting(env, "AZURE_OPENAI_API_VERSION") ?? DEFAULT_API_VERSION,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}
