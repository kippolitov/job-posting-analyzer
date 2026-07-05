import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  orchestrateJobAnalysis,
  JobSchemaError,
} from "../../src/services/jobExtractionOrchestrator";
import type { AnalyzeJobRequest } from "../../src/models/job";

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

describe("jobExtractionOrchestrator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.AZURE_OPENAI_ENDPOINT = "https://fake.openai.azure.com/";
    process.env.AZURE_OPENAI_API_KEY = "fake-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";
    delete process.env.AZURE_OPENAI_JOB_DEPLOYMENT;
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
    expect(result.fit).toEqual({
      score: 88,
      rationale: expect.stringContaining(".NET") as unknown as string,
    });
  });

  it("includes the profile and dealbreaker cap rule in the prompt when present", async () => {
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
    expect(all).toMatch(/20/); // dealbreaker cap value present in instructions
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
});
