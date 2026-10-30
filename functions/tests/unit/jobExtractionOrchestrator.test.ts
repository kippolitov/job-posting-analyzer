import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  fitCallMessages,
  orchestrateJobAnalysis,
  JobSchemaError,
  type ModelUsage,
} from "../../src/services/jobExtractionOrchestrator";
import { ModelConfigError } from "../../src/services/modelConfig";
import type { AnalyzeJobRequest } from "../../src/models/job";
import { fingerprintForRequest } from "../../src/services/profileFingerprint";

vi.mock("openai", () => ({
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, "..", "fixtures", "jobAnalysis", `${name}.json`),
    "utf-8"
  );
}

const hybridText =
  "About the role. We offer a hybrid, 3 days per week in our Austin office schedule. " +
  "You will build backend services in C# and .NET 8 on Azure and Kubernetes.";

const baseRequest: AnalyzeJobRequest = {
  extract: {
    url: "https://boards.greenhouse.io/acme/jobs/123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    title: "Senior Backend Engineer - Acme",
    jsonLd: [
      {
        "@type": "JobPosting",
        title: "Senior Backend Engineer",
        hiringOrganization: { name: "Acme" },
      },
    ],
    mainText: hybridText,
    extractedAt: "2026-07-04T12:00:00Z",
  },
};

async function mockCreateWith(
  ...contents: (string | Error)[]
): Promise<ReturnType<typeof vi.fn>> {
  const { AzureOpenAI } = await import("openai");
  const mockCreate = vi.fn();
  for (const content of contents) {
    if (content instanceof Error) {
      mockCreate.mockRejectedValueOnce(content);
    } else {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content } }],
      });
    }
  }
  (AzureOpenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () => ({ chat: { completions: { create: mockCreate } } })
  );
  return mockCreate;
}

/** Like mockCreateWith, but each completion carries `usage` and `finish_reason`. */
async function mockCreateWithCompletions(
  ...completions: { content: string; usage?: unknown; finishReason?: string }[]
): Promise<ReturnType<typeof vi.fn>> {
  const { AzureOpenAI } = await import("openai");
  const mockCreate = vi.fn();
  for (const { content, usage, finishReason } of completions) {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage,
    });
  }
  (AzureOpenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () => ({ chat: { completions: { create: mockCreate } } })
  );
  return mockCreate;
}

describe("jobExtractionOrchestrator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.AZURE_OPENAI_ENDPOINT = "https://fake.openai.azure.com/";
    process.env.AZURE_OPENAI_API_KEY = "fake-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";
    delete process.env.AZURE_OPENAI_JOB_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM;
    delete process.env.AZURE_OPENAI_JOB_TEMPERATURE;
    delete process.env.AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM;
    delete process.env.AZURE_OPENAI_JOB_REASONING_EFFORT;
    delete process.env.AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM;
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  it("sends mainText and serialized JSON-LD in the user message", async () => {
    const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
    await orchestrateJobAnalysis(baseRequest);

    const [params] = mockCreate.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const userMsg = params.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain(hybridText);
    expect(userMsg).toContain("Senior Backend Engineer");
    expect(userMsg).toContain("hiringOrganization");
  });

  it("system prompt encodes the extraction rules (never invent, TELECOMMUTE, verbatim evidence)", async () => {
    const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
    await orchestrateJobAnalysis(baseRequest);

    const [params] = mockCreate.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const systemMsg = params.messages.find((m) => m.role === "system")!.content;
    expect(systemMsg).toMatch(/never invent/i);
    expect(systemMsg).toContain("TELECOMMUTE");
    expect(systemMsg).toMatch(/verbatim/i);
    expect(systemMsg).toMatch(/unspecified/);
    // JSON-LD trusted unless the body contradicts it
    expect(systemMsg).toMatch(/contradict/i);
  });

  it("requests strict json_schema structured output", async () => {
    const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
    await orchestrateJobAnalysis(baseRequest);

    const [params] = mockCreate.mock.calls[0] as [
      { response_format: { type: string; json_schema: { strict: boolean } } },
    ];
    expect(params.response_format.type).toBe("json_schema");
    expect(params.response_format.json_schema.strict).toBe(true);
  });

  it("returns the parsed analysis with model and analyzedAt appended", async () => {
    await mockCreateWith(fixture("explicit-hybrid"));
    const result = await orchestrateJobAnalysis(baseRequest);

    expect(result.arrangement).toBe("hybrid");
    expect(result.daysInOffice).toBe(3);
    expect(result.arrangementEvidence).toBe(
      "hybrid, 3 days per week in our Austin office"
    );
    expect(result.model).toBe("gpt-4o-mini");
    expect(new Date(result.analyzedAt).toString()).not.toBe("Invalid Date");
  });

  it("downgrades to unspecified when the evidence is not a substring of the input", async () => {
    await mockCreateWith(fixture("hallucinated-evidence"));
    const result = await orchestrateJobAnalysis(baseRequest);

    expect(result.arrangement).toBe("unspecified");
    expect(result.arrangementConfidence).toBe("none");
    expect(result.arrangementEvidence).toBeNull();
    expect(result.daysInOffice).toBeNull();
    expect(result.daysRemote).toBeNull();
  });

  it("accepts evidence found only in structuredSources, not in jsonLd/title/mainText (T032, FR-015)", async () => {
    // The evidence phrase below appears nowhere in baseRequest's jsonLd, title,
    // or mainText — only inside a harvested structuredSources entry. Without
    // FR-015's haystack fix this downgrades to unspecified, which is exactly
    // the silent regression Story 2 must not ship (plan.md Risks).
    const structuredOnlyRequest = {
      ...baseRequest,
      extract: {
        ...baseRequest.extract,
        mainText: "Join our team building great products. Benefits included.",
        structuredSources: [
          {
            kind: "microdata" as const,
            data: {
              description:
                "This is a hybrid, 3 days per week in our Austin office arrangement.",
            },
          },
        ],
      },
    };
    await mockCreateWith(fixture("explicit-hybrid"));
    const result = await orchestrateJobAnalysis(structuredOnlyRequest);

    expect(result.arrangement).toBe("hybrid");
    expect(result.arrangementConfidence).toBe("explicit");
    expect(result.arrangementEvidence).toBe(
      "hybrid, 3 days per week in our Austin office"
    );
  });

  it("evidence check is whitespace-normalized, not exact-match", async () => {
    // Fixture evidence: "hybrid, 3 days per week in our Austin office";
    // input contains the same words with a line break and double spaces.
    const spaced = {
      ...baseRequest,
      extract: {
        ...baseRequest.extract,
        mainText:
          "Perks. We offer a hybrid,  3 days\nper week in   our Austin office schedule.",
      },
    };
    await mockCreateWith(fixture("explicit-hybrid"));
    const result = await orchestrateJobAnalysis(spaced);
    expect(result.arrangement).toBe("hybrid");
  });

  it("nulls hybrid day counts when arrangement is not hybrid", async () => {
    const onsiteRequest = {
      ...baseRequest,
      extract: {
        ...baseRequest.extract,
        mainText:
          "This position is fully on-site at our Columbus plant. Manufacturing role.",
      },
    };
    await mockCreateWith(fixture("onsite-with-days"));
    const result = await orchestrateJobAnalysis(onsiteRequest);

    expect(result.arrangement).toBe("onsite");
    expect(result.daysInOffice).toBeNull();
    expect(result.daysRemote).toBeNull();
  });

  it("forces fit to null when the request carries no profile", async () => {
    const remoteRequest = {
      ...baseRequest,
      extract: {
        ...baseRequest.extract,
        mainText: "Staff engineer role. Fully remote within the United States.",
      },
    };
    await mockCreateWith(fixture("with-fit"));
    const result = await orchestrateJobAnalysis(remoteRequest);
    expect(result.fit).toBeNull();
  });

  it("preserves fit when a profile is supplied", async () => {
    const withProfile: AnalyzeJobRequest = {
      ...baseRequest,
      extract: {
        ...baseRequest.extract,
        mainText: "Staff engineer role. Fully remote within the United States.",
      },
      profile: "Staff-level .NET engineer; dealbreakers: no on-site roles",
    };
    await mockCreateWith(fixture("with-fit"));
    const result = await orchestrateJobAnalysis(withProfile);
    expect(result.fit).toMatchObject({
      score: 88,
      rationale: expect.stringContaining(".NET") as unknown as string,
      matching: expect.arrayContaining([
        expect.stringContaining(".NET"),
      ]) as unknown as string[],
      missing: ["Kubernetes operations"],
      desired: ["Terraform"],
      strengths: expect.any(Array) as unknown as string[],
      weaknesses: expect.any(Array) as unknown as string[],
    });
  });

  it("includes the profile in the prompt when present", async () => {
    const withProfile: AnalyzeJobRequest = {
      ...baseRequest,
      profile: "Principal .NET engineer; dealbreakers: no fully on-site roles",
    };
    const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
    await orchestrateJobAnalysis(withProfile);

    const [params] = mockCreate.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const all = params.messages.map((m) => m.content).join("\n");
    expect(all).toContain("Principal .NET engineer");
  });

  it("retries once with a repair instruction on unparseable output, then succeeds", async () => {
    const mockCreate = await mockCreateWith(
      "{{{ not json",
      fixture("explicit-hybrid")
    );
    const result = await orchestrateJobAnalysis(baseRequest);

    expect(result.arrangement).toBe("hybrid");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const [secondParams] = mockCreate.mock.calls[1] as [
      { messages: { role: string; content: string }[] },
    ];
    const combined = secondParams.messages.map((m) => m.content).join("\n");
    expect(combined).toMatch(/valid JSON|schema/i);
  });

  it("throws JobSchemaError after the repair retry also fails", async () => {
    await mockCreateWith("{{{ not json", "also {{{ not json");
    await expect(orchestrateJobAnalysis(baseRequest)).rejects.toBeInstanceOf(
      JobSchemaError
    );
  });

  it("rejects structurally invalid payloads (missing arrangement) via JobSchemaError", async () => {
    await mockCreateWith(
      JSON.stringify({ isJobPosting: true }),
      JSON.stringify({ isJobPosting: true })
    );
    await expect(orchestrateJobAnalysis(baseRequest)).rejects.toBeInstanceOf(
      JobSchemaError
    );
  });

  it("labels non-job pages without downgrade side effects", async () => {
    const newsRequest = {
      ...baseRequest,
      extract: { ...baseRequest.extract, jsonLd: [], mainText: "Some news article text about markets." },
    };
    await mockCreateWith(fixture("non-job"));
    const result = await orchestrateJobAnalysis(newsRequest);
    expect(result.isJobPosting).toBe(false);
    expect(result.arrangement).toBe("unspecified");
  });

  it("uses AZURE_OPENAI_JOB_DEPLOYMENT when set", async () => {
    process.env.AZURE_OPENAI_JOB_DEPLOYMENT = "gpt-4o";
    const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
    const result = await orchestrateJobAnalysis(baseRequest);

    const [params] = mockCreate.mock.calls[0] as [{ model: string }];
    expect(params.model).toBe("gpt-4o");
    expect(result.model).toBe("gpt-4o");
  });

  describe("scoring rubric and tier stamp (006 FR-008)", () => {
    const withProfile: AnalyzeJobRequest = {
      ...baseRequest,
      profile: "Principal .NET engineer",
    };

    it("the system prompt carries the four rubric bands with exact ranges and descriptions", async () => {
      const mockCreate = await mockCreateWith(fixture("with-fit"));
      await orchestrateJobAnalysis(withProfile);
      const [params] = mockCreate.mock.calls[0] as [
        { messages: { role: string; content: string }[] },
      ];
      const system = params.messages.find((m) => m.role === "system")!.content;
      expect(system).toContain("85-100: all required skills covered and seniority aligned");
      expect(system).toContain("65-84: minor gaps");
      expect(system).toContain("40-64: significant gaps or a level mismatch");
      expect(system).toContain("0-39: major mismatch");
    });

    it("tells the model to treat the Confirmed skills section as evidence (006 US5)", async () => {
      const mockCreate = await mockCreateWith(fixture("with-fit"));
      await orchestrateJobAnalysis(withProfile);
      const [params] = mockCreate.mock.calls[0] as [
        { messages: { role: string; content: string }[] },
      ];
      const system = params.messages.find((m) => m.role === "system")!.content;
      expect(system).toContain('"Confirmed skills:" section');
      expect(system).toContain("goes in fit.matching, never fit.missing");
    });

    it("omits the rubric when no profile was provided", async () => {
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [
        { messages: { role: string; content: string }[] },
      ];
      const system = params.messages.find((m) => m.role === "system")!.content;
      expect(system).not.toContain("major mismatch");
    });

    it.each(["free", "premium"] as const)("stamps tier %s on the response", async (tier) => {
      await mockCreateWith(fixture("with-fit"));
      const result = await orchestrateJobAnalysis(withProfile, tier);
      expect(result.tier).toBe(tier);
    });

    it("stamps tier even when there is no profile", async () => {
      await mockCreateWith(fixture("explicit-hybrid"));
      const result = await orchestrateJobAnalysis(baseRequest, "premium");
      expect(result.tier).toBe("premium");
    });
  });

  describe("tier-aware deployment selection (data-model.md)", () => {
    it("free tier uses the free deployment", async () => {
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      const result = await orchestrateJobAnalysis(baseRequest, "free");
      const [params] = mockCreate.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe("gpt-4o-mini");
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("premium tier uses AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM when set", async () => {
      process.env.AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM = "gpt-4.1-mini";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      const result = await orchestrateJobAnalysis(baseRequest, "premium");
      const [params] = mockCreate.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe("gpt-4.1-mini");
      expect(result.model).toBe("gpt-4.1-mini");
    });

    it("premium tier falls back to the free deployment when the premium deployment is unset", async () => {
      delete process.env.AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM;
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      const result = await orchestrateJobAnalysis(baseRequest, "premium");
      const [params] = mockCreate.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe("gpt-4o-mini");
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("premium tier falls back to the free deployment when the premium deployment is an empty-string placeholder", async () => {
      // local.settings.json ships AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "" until
      // the deployment is provisioned — must not be treated as a real value.
      process.env.AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM = "";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      const result = await orchestrateJobAnalysis(baseRequest, "premium");
      const [params] = mockCreate.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe("gpt-4o-mini");
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("defaults to the free deployment when no tier is passed", async () => {
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [{ model: string }];
      expect(params.model).toBe("gpt-4o-mini");
    });
  });
  describe("per-deployment request settings (contracts/model-config.md)", () => {
    type CreateParams = Record<string, unknown>;

    it("sends no temperature key when no temperature is set", async () => {
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [CreateParams];
      expect(params).not.toHaveProperty("temperature");
      expect(params).not.toHaveProperty("reasoning_effort");
    });

    it("sends temperature: 0 when it is set to 0", async () => {
      process.env.AZURE_OPENAI_JOB_TEMPERATURE = "0";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [CreateParams];
      expect(params.temperature).toBe(0);
    });

    it('sends reasoning_effort: "none" and no temperature when only the effort is set', async () => {
      process.env.AZURE_OPENAI_JOB_REASONING_EFFORT = "none";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [CreateParams];
      expect(params.reasoning_effort).toBe("none");
      expect(params).not.toHaveProperty("temperature");
    });

    it("uses identical settings on the repair retry", async () => {
      process.env.AZURE_OPENAI_JOB_TEMPERATURE = "0";
      process.env.AZURE_OPENAI_JOB_REASONING_EFFORT = "low";
      const mockCreate = await mockCreateWith("{{{ not json", fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [first, second] = mockCreate.mock.calls.map(([p]) => p as CreateParams);
      for (const key of ["model", "temperature", "reasoning_effort", "max_completion_tokens"]) {
        expect(second[key]).toEqual(first[key]);
      }
      expect(second.temperature).toBe(0);
      expect(second.reasoning_effort).toBe("low");
    });

    it("keeps max_completion_tokens at 3000", async () => {
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const [params] = mockCreate.mock.calls[0] as [CreateParams];
      expect(params.max_completion_tokens).toBe(3000);
    });

    it("passes the resolved apiVersion to new AzureOpenAI", async () => {
      process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
      await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest);
      const { AzureOpenAI } = await import("openai");
      expect(AzureOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiVersion: "2025-04-01-preview" })
      );
    });

    it("uses the premium settings for a premium request", async () => {
      process.env.AZURE_OPENAI_JOB_REASONING_EFFORT = "none";
      process.env.AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM = "gpt-5.4-mini";
      process.env.AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM = "0";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await orchestrateJobAnalysis(baseRequest, "premium");
      const [params] = mockCreate.mock.calls[0] as [CreateParams];
      expect(params.model).toBe("gpt-5.4-mini");
      expect(params.temperature).toBe(0);
      expect(params).not.toHaveProperty("reasoning_effort");
    });

    it("rejects with ModelConfigError before calling the model when a setting is invalid", async () => {
      process.env.AZURE_OPENAI_JOB_REASONING_EFFORT = "minimal";
      const mockCreate = await mockCreateWith(fixture("explicit-hybrid"));
      await expect(orchestrateJobAnalysis(baseRequest)).rejects.toBeInstanceOf(ModelConfigError);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("observe callback (contracts/model-config.md § Observability)", () => {
    const fullUsage = {
      prompt_tokens: 1800,
      completion_tokens: 420,
      completion_tokens_details: { reasoning_tokens: 64 },
      prompt_tokens_details: { cached_tokens: 1024 },
    };

    it("is called once per completion with token counts, deployment and finish reason", async () => {
      await mockCreateWithCompletions({
        content: fixture("explicit-hybrid"),
        usage: fullUsage,
        finishReason: "stop",
      });
      const observe = vi.fn<[ModelUsage], void>();
      await orchestrateJobAnalysis(baseRequest, "free", () => {}, observe);

      expect(observe).toHaveBeenCalledTimes(1);
      const [usage] = observe.mock.calls[0];
      expect(usage).toMatchObject({
        deployment: "gpt-4o-mini",
        promptTokens: 1800,
        completionTokens: 420,
        reasoningTokens: 64,
        cachedTokens: 1024,
        attempt: 1,
        finishReason: "stop",
      });
      expect(typeof usage.latencyMs).toBe("number");
      expect(usage.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports attempt 1 and then 2 when the repair retry runs", async () => {
      await mockCreateWithCompletions(
        { content: "{{{ not json", usage: fullUsage, finishReason: "length" },
        { content: fixture("explicit-hybrid"), usage: fullUsage, finishReason: "stop" }
      );
      const observe = vi.fn<[ModelUsage], void>();
      await orchestrateJobAnalysis(baseRequest, "free", () => {}, observe);

      expect(observe).toHaveBeenCalledTimes(2);
      const attempts = observe.mock.calls.map(([u]) => u.attempt);
      expect(attempts).toEqual([1, 2]);
      expect(observe.mock.calls[0][0].finishReason).toBe("length");
    });

    it("defaults token fields to 0 when usage or its details are absent", async () => {
      await mockCreateWithCompletions(
        { content: "{{{ not json" },
        {
          content: fixture("explicit-hybrid"),
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          finishReason: "stop",
        }
      );
      const observe = vi.fn<[ModelUsage], void>();
      await orchestrateJobAnalysis(baseRequest, "free", () => {}, observe);

      expect(observe.mock.calls[0][0]).toMatchObject({
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        finishReason: null,
      });
      expect(observe.mock.calls[1][0]).toMatchObject({
        promptTokens: 10,
        completionTokens: 5,
        reasoningTokens: 0,
        cachedTokens: 0,
      });
    });

    it("is still called for a completion whose output then fails the schema", async () => {
      await mockCreateWithCompletions(
        { content: "{{{ not json", usage: fullUsage },
        { content: "also {{{ not json", usage: fullUsage }
      );
      const observe = vi.fn<[ModelUsage], void>();
      await expect(
        orchestrateJobAnalysis(baseRequest, "free", () => {}, observe)
      ).rejects.toBeInstanceOf(JobSchemaError);
      expect(observe).toHaveBeenCalledTimes(2);
    });

    it("changes nothing when omitted", async () => {
      await mockCreateWithCompletions({
        content: fixture("explicit-hybrid"),
        usage: fullUsage,
        finishReason: "stop",
      });
      const result = await orchestrateJobAnalysis(baseRequest);
      expect(result.arrangement).toBe("hybrid");
      expect(result).not.toHaveProperty("usage");
    });
  });

  describe("dealbreakers (006 research R8, FR-005)", () => {
    const onsiteText =
      "Senior Backend Engineer at Initech. This role is fully on-site at our Dallas office, five days a week. " +
      "You will build C# and .NET services on Azure.";
    const onsiteRequest = (extra: Partial<AnalyzeJobRequest>): AnalyzeJobRequest => ({
      ...baseRequest,
      extract: { ...baseRequest.extract, mainText: onsiteText },
      ...extra,
    });
    const profileData = {
      text: "Senior .NET engineer, ten years of C# and Azure.",
      dealbreakers: ["No fully on-site roles"],
    };

    type Check = { number: number; postingSays: string; verdict: string };
    const judged = (checks: Check[]): string => JSON.stringify({ checks });
    const onsiteQuote = "This role is fully on-site at our Dallas office";
    const violated = (number: number, postingSays = onsiteQuote): Check => ({
      number,
      postingSays,
      verdict: "violated",
    });

    async function calls(req: AnalyzeJobRequest, judge: string) {
      const mockCreate = await mockCreateWith(fixture("dealbreaker-onsite"), judge);
      const result = await orchestrateJobAnalysis(req);
      type Params = {
        messages: { role: string; content: string }[];
        response_format: { json_schema: { name: string; schema: unknown } };
      };
      return {
        result,
        fit: mockCreate.mock.calls[0][0] as Params,
        check: mockCreate.mock.calls[1]?.[0] as Params | undefined,
        count: mockCreate.mock.calls.length,
      };
    }

    it("keeps the user's exact wording and leaves the score at 72", async () => {
      await mockCreateWith(fixture("dealbreaker-onsite"), judged([violated(1)]));
      const result = await orchestrateJobAnalysis(onsiteRequest({ profileData }));
      expect(result.fit?.dealbreakersViolated).toEqual(["No fully on-site roles"]);
      expect(result.fit?.score).toBe(72);
    });

    it("drops a violation whose quote is not in the posting", async () => {
      const { result } = await calls(
        onsiteRequest({ profileData }),
        judged([violated(1, "Five days in Paris")])
      );
      expect(result.fit?.dealbreakersViolated).toEqual([]);
      expect(result.fit?.score).toBe(72);
    });

    it("reports only violated checks, by number, and warns about an unknown number", async () => {
      await mockCreateWith(
        fixture("dealbreaker-onsite"),
        judged([
          violated(1),
          { number: 2, postingSays: "", verdict: "not stated" },
          { number: 3, postingSays: "build C# and .NET services", verdict: "compatible" },
          violated(7),
        ])
      );
      const warn = vi.fn();
      const result = await orchestrateJobAnalysis(
        onsiteRequest({
          profileData: {
            ...profileData,
            dealbreakers: ["No on-site roles", "Remote only", "Must use .NET"],
          },
        }),
        "free",
        warn
      );
      expect(result.fit?.dealbreakersViolated).toEqual(["No on-site roles"]);
      const unknown = warn.mock.calls.filter(([m]) => String(m).includes("dealbreaker 7"));
      expect(unknown).toHaveLength(1);
    });

    it("recovers dealbreaker lines from a legacy profile string and hides them from the fit call", async () => {
      const { result, fit, check } = await calls(
        onsiteRequest({ profile: "Senior .NET engineer\n\nDealbreakers:\n- No on-site work" }),
        judged([violated(1)])
      );
      expect(result.fit?.dealbreakersViolated).toEqual(["No on-site work"]);
      expect(fit.messages[1].content).toContain("Senior .NET engineer");
      expect(fit.messages[1].content).not.toContain("No on-site work");
      expect(check?.messages[1].content).toContain("1. No on-site work");
    });

    it("keeps dealbreakers out of the fit call and sends them to a separate check", async () => {
      const { fit, check, count } = await calls(
        onsiteRequest({ profileData, profile: "stale string" }),
        judged([])
      );
      expect(count).toBe(2);
      const user = fit.messages[1].content;
      expect(user).toContain("Senior .NET engineer, ten years");
      expect(user).not.toContain("Dealbreakers:");
      expect(user).not.toContain("stale string");
      expect(fit.messages[0].content).not.toContain("cap fit.score at 20");
      expect(fit.messages[0].content).toContain("never change the score");
      expect(check?.response_format.json_schema.name).toBe("dealbreaker_check");
      expect(check?.messages[0].content).toContain("VERBATIM substring of the posting");
      expect(check?.messages[0].content).toContain("Silence is never a violation");
      const checkUser = check?.messages[1].content ?? "";
      expect(checkUser).toContain("1. No fully on-site roles");
      expect(checkUser).not.toContain("Candidate profile");
      // The list follows the posting, so a long posting doesn't bury it.
      expect(checkUser.indexOf("Page content:")).toBeLessThan(
        checkUser.indexOf("1. No fully on-site roles")
      );
    });

    describe("preferences (PR4, research R11)", () => {
      it("sends location and sponsorship to the judge as numbered lines, never to the fit call", async () => {
        const { result, fit, check } = await calls(
          onsiteRequest({
            profileData: {
              ...profileData,
              preferences: { locations: ["EU timezones only"], needsSponsorship: true },
            },
          }),
          judged([
            { number: 3, postingSays: onsiteQuote, verdict: "violated" },
          ])
        );
        const checkUser = check?.messages[1].content ?? "";
        expect(checkUser).toContain("2. Locations or timezones: EU timezones only");
        expect(checkUser).toContain("3. Work authorization: needs visa sponsorship");
        expect(fit.messages[1].content).not.toContain("EU timezones");
        expect(fit.messages[1].content).not.toContain("Preferences:");
        expect(result.fit?.dealbreakersViolated).toEqual([
          "Work authorization: needs visa sponsorship",
        ]);
      });

      it("adds code-checked violations without changing the score, and no judge line for them", async () => {
        const { result, check } = await calls(
          onsiteRequest({
            profileData: { ...profileData, preferences: { arrangements: ["remote"] } },
          }),
          judged([])
        );
        expect(check?.messages[1].content ?? "").not.toContain("2.");
        expect(result.fit?.dealbreakersViolated).toEqual(["Arrangement: remote only"]);
        expect(result.fit?.score).toBe(72);
      });

      it("changes the profile fingerprint", async () => {
        const { result: plain } = await calls(onsiteRequest({ profileData }), judged([]));
        const { result: withPrefs } = await calls(
          onsiteRequest({
            profileData: { ...profileData, preferences: { arrangements: ["remote"] } },
          }),
          judged([])
        );
        expect(withPrefs.fit?.profileFingerprint).not.toBe(plain.fit?.profileFingerprint);
      });
    });

    describe("rationale note for pre-PR2 extensions (no profileData)", () => {
      const fixtureRationale = (
        JSON.parse(fixture("dealbreaker-onsite")) as { fit: { rationale: string } }
      ).fit.rationale;
      const legacy = "Senior .NET engineer\n\nDealbreakers:\n- No on-site work\n- Remote only";

      it("appends the violated lines to the rationale and leaves the score alone", async () => {
        const { result } = await calls(
          onsiteRequest({ profile: legacy }),
          judged([violated(1), violated(2)])
        );
        expect(result.fit?.rationale).toBe(
          `${fixtureRationale} Violates your dealbreakers: No on-site work; Remote only.`
        );
        expect(result.fit?.score).toBe(72);
        expect(result.fit?.dealbreakersViolated).toEqual(["No on-site work", "Remote only"]);
      });

      it("uses the singular for one violation", async () => {
        const { result } = await calls(onsiteRequest({ profile: legacy }), judged([violated(1)]));
        expect(result.fit?.rationale).toBe(
          `${fixtureRationale} Violates your dealbreaker: No on-site work.`
        );
      });

      it("adds nothing without a violation", async () => {
        const { result } = await calls(onsiteRequest({ profile: legacy }), judged([]));
        expect(result.fit?.rationale).toBe(fixtureRationale);
      });

      it("adds nothing for a client that sends profileData, which shows the banner", async () => {
        const { result } = await calls(onsiteRequest({ profileData }), judged([violated(1)]));
        expect(result.fit?.rationale).toBe(fixtureRationale);
      });
    });

    it("builds the same fit-call messages with and without dealbreakers (SC-002)", () => {
      const without = fitCallMessages(onsiteRequest({ profile: "Senior .NET engineer" }));
      expect(
        fitCallMessages(
          onsiteRequest({ profile: "Senior .NET engineer\n\nDealbreakers:\n- No on-site work" })
        )
      ).toEqual(without);
      expect(
        fitCallMessages(
          onsiteRequest({ profileData: { text: "Senior .NET engineer", dealbreakers: ["Remote only"] } })
        )
      ).toEqual(without);
    });

    it("makes one call when the profile has no dealbreakers", async () => {
      const mockCreate = await mockCreateWith(fixture("with-fit"));
      const result = await orchestrateJobAnalysis({
        ...baseRequest,
        profileData: { text: "Staff engineer", dealbreakers: [] },
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.fit?.dealbreakersViolated).toEqual([]);
    });

    it("reports none and warns when the check call fails, keeping the fit", async () => {
      await mockCreateWith(fixture("dealbreaker-onsite"), new Error("boom"));
      const warn = vi.fn();
      const result = await orchestrateJobAnalysis(onsiteRequest({ profileData }), "free", warn);
      expect(result.fit?.dealbreakersViolated).toEqual([]);
      expect(result.fit?.score).toBe(72);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("dealbreaker check failed"));
    });

    it("gives fit: null and no check call when no profile is sent", async () => {
      const mockCreate = await mockCreateWith(fixture("dealbreaker-onsite"));
      const result = await orchestrateJobAnalysis(onsiteRequest({}));
      expect(result.fit).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("stamps fit.profileFingerprint with the full profile's fingerprint", async () => {
      const req = onsiteRequest({ profileData });
      const { result } = await calls(req, judged([]));
      expect(result.fit?.profileFingerprint).toBe(fingerprintForRequest(req));
      expect(result.fit?.profileFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("evidence quotes (006 research R9, FR-011/FR-012)", () => {
    const profileData = {
      text: "Senior .NET engineer. Ten years of C# on Azure. Led a platform team.",
      dealbreakers: [],
    };
    const longQuote = (
      JSON.parse(fixture("fabricated-quote")) as {
        fit: { matching: { label: string; postingQuote: string }[] };
      }
    ).fit.matching.find((m) => m.label === "Long quote")!.postingQuote;
    const evidenceRequest = (mainText = hybridText): AnalyzeJobRequest => ({
      ...baseRequest,
      extract: { ...baseRequest.extract, mainText },
      profileData,
    });

    it("keeps label arrays on the wire and splits quotes into fit.evidence", async () => {
      await mockCreateWith(fixture("with-evidence"));
      const result = await orchestrateJobAnalysis(evidenceRequest());
      expect(result.fit?.matching).toEqual(["C# and .NET", "Azure"]);
      expect(result.fit?.missing).toEqual(["Kubernetes"]);
      expect(result.fit?.desired).toEqual(["Austin office"]);
      expect(result.fit?.evidence?.matching?.[0]).toEqual({
        label: "C# and .NET",
        postingQuote: "build backend services in C# and .NET 8",
        profileQuote: "Ten years of C# on Azure",
      });
      expect(result.fit?.evidence?.missing).toEqual([
        { label: "Kubernetes", postingQuote: "Azure and Kubernetes", profileQuote: null },
      ]);
      expect(result.fit?.evidence?.desired?.[0].profileQuote).toBeNull();
    });

    it("keeps every verbatim quote and logs no quote warning", async () => {
      await mockCreateWith(fixture("with-evidence"));
      const warn = vi.fn();
      const result = await orchestrateJobAnalysis(evidenceRequest(), "free", warn);
      expect(result.fit?.evidence?.matching?.every((e) => e.postingQuote && e.profileQuote)).toBe(true);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("quote"));
    });

    it("nulls a fabricated quote, keeps the item and label, and warns once per dropped quote", async () => {
      await mockCreateWith(fixture("fabricated-quote"));
      const warn = vi.fn();
      const result = await orchestrateJobAnalysis(
        evidenceRequest(`${hybridText} ${longQuote}`),
        "free",
        warn
      );
      const matching = result.fit?.evidence?.matching ?? [];
      expect(result.fit?.matching).toEqual(["C# and .NET", "Azure", "Long quote"]);
      expect(matching[0]).toEqual({
        label: "C# and .NET",
        postingQuote: null,
        profileQuote: "Ten years of C# on Azure",
      });
      expect(matching[1]).toEqual({
        label: "Azure",
        postingQuote: "on Azure and Kubernetes",
        profileQuote: null,
      });
      const quoteWarnings = warn.mock.calls.filter(([m]) => /quote/.test(String(m)));
      expect(quoteWarnings).toHaveLength(3);
    });

    it("truncates a valid 260-character quote to 200 after validation", async () => {
      await mockCreateWith(fixture("fabricated-quote"));
      const result = await orchestrateJobAnalysis(evidenceRequest(`${hybridText} ${longQuote}`));
      expect(longQuote).toHaveLength(260);
      const truncated = result.fit?.evidence?.matching?.[2].postingQuote;
      expect(truncated).toHaveLength(200);
      expect(longQuote.startsWith(truncated!)).toBe(true);
    });

    it("always has a null profileQuote for missing and desired items", async () => {
      await mockCreateWith(fixture("fabricated-quote"));
      const result = await orchestrateJobAnalysis(evidenceRequest(`${hybridText} ${longQuote}`));
      expect(result.fit?.evidence?.missing?.[0].profileQuote).toBeNull();
    });

    it("drops an item with a blank label from the lists and the evidence", async () => {
      const raw = JSON.parse(fixture("with-evidence")) as {
        fit: { matching: { label: string; postingQuote: string | null; profileQuote: string | null }[] };
      };
      raw.fit.matching.push({ label: "  ", postingQuote: "build backend services", profileQuote: null });
      await mockCreateWith(JSON.stringify(raw));
      const result = await orchestrateJobAnalysis(evidenceRequest());
      expect(result.fit?.matching).toEqual(["C# and .NET", "Azure"]);
      expect(result.fit?.evidence?.matching).toHaveLength(2);
    });

    it("matches quotes after whitespace normalization", async () => {
      await mockCreateWith(fixture("with-evidence"));
      const result = await orchestrateJobAnalysis(
        evidenceRequest("About the role.\n  We offer a hybrid, 3 days per week in our Austin office schedule.\n\nYou will build backend services in C#   and .NET 8 on Azure and Kubernetes.")
      );
      expect(result.fit?.evidence?.matching?.[0].postingQuote).toBe(
        "build backend services in C# and .NET 8"
      );
    });

    it("asks for the shortest verbatim span and sends item objects in the schema", async () => {
      const mockCreate = await mockCreateWith(fixture("with-evidence"));
      await orchestrateJobAnalysis(evidenceRequest());
      const [params] = mockCreate.mock.calls[0] as [
        {
          messages: { role: string; content: string }[];
          response_format: { json_schema: { schema: { properties: { fit: { properties: { matching: { items: { required: string[] } } } } } } } };
        },
      ];
      const system = params.messages.find((m) => m.role === "system")!.content;
      expect(system).toContain("shortest verbatim");
      expect(system).toContain("profileQuote");
      const item = params.response_format.json_schema.schema.properties.fit.properties.matching.items;
      expect(item.required).toEqual(["label", "postingQuote", "profileQuote"]);
    });

    it("leaves fit null, with no evidence, when no profile is sent", async () => {
      await mockCreateWith(fixture("with-evidence"));
      const result = await orchestrateJobAnalysis(baseRequest);
      expect(result.fit).toBeNull();
    });

    it("leaves arrangement evidence behaviour unchanged", async () => {
      await mockCreateWith(fixture("with-evidence"));
      const result = await orchestrateJobAnalysis(evidenceRequest("Different text with no arrangement words."));
      expect(result.arrangement).toBe("unspecified");
      expect(result.fit?.evidence?.matching?.every((e) => e.postingQuote === null)).toBe(true);
    });
  });
});
