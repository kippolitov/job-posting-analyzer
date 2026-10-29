# Contract: Per-deployment model request settings (PR1)

**Requirements**: FR-M01, FR-M04, FR-M05 | **Research**: R1, R2

## Resolution

`resolveModelConfig(tier: Tier, env: NodeJS.ProcessEnv): ModelConfig` is a pure
function that reads only `env`.

```text
ModelConfig = {
  deployment: string
  apiVersion: string
  temperature?: number              // omitted from the request when undefined
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh"
}
```

| Tier | Premium deployment set? | deployment | temperature / reasoningEffort read from |
|---|---|---|---|
| free | n/a | `AZURE_OPENAI_JOB_DEPLOYMENT` ?? `AZURE_OPENAI_DEPLOYMENT` ?? `"gpt-4o-mini"` | `AZURE_OPENAI_JOB_TEMPERATURE`, `AZURE_OPENAI_JOB_REASONING_EFFORT` |
| premium | yes (non-empty) | `AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM` | `…_TEMPERATURE_PREMIUM`, `…_REASONING_EFFORT_PREMIUM` |
| premium | no | the free deployment | the **free** variables, because the settings follow the deployment |

- An empty string counts as unset for every variable. This matches the existing
  Premium-deployment convention.
- An invalid value throws `ModelConfigError` naming the variable. The handler
  returns `500 SERVICE_ERROR`, which is logged, and the request is refunded
  through the existing 5xx path. A unit test covers every invalid form.

## Request shape

```text
chat.completions.create({
  model, messages, response_format (unchanged),
  max_completion_tokens: 3000,                  // unchanged
  ...(temperature !== undefined ? { temperature } : {}),
  ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
})
```

The repair retry uses the same settings.

## Observability

`orchestrateJobAnalysis(req, tier, warn, observe?)` calls `observe` once per
completion call with:

```text
{ deployment, promptTokens, completionTokens, reasoningTokens, cachedTokens,
  latencyMs, attempt: 1 | 2, finishReason }
```

The HTTP handlers log this with `context.log` as `model.usage`. It contains
token counts only, never content. The wire response is unchanged.

## Compatibility

| Change | Old clients | Prod before settings change |
|---|---|---|
| Optional temperature and reasoning effort | No wire change | Behaviour preserved only when `AZURE_OPENAI_JOB_TEMPERATURE[_PREMIUM]=0` are set **before** the deploy (R1 ordering) |
| Configurable API version | No wire change | The default must pass the live probe on all three deployments before merge |
