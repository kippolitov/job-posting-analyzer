import { describe, it, expect } from "vitest";
import {
  resolveModelConfig,
  ModelConfigError,
} from "../../src/services/modelConfig";

// specs/006-profile-match-ux/contracts/model-config.md
const DEFAULT_API_VERSION = "2024-12-01-preview";

describe("resolveModelConfig", () => {
  describe("free deployment fallback chain", () => {
    it("uses AZURE_OPENAI_JOB_DEPLOYMENT first", () => {
      const config = resolveModelConfig("free", {
        AZURE_OPENAI_JOB_DEPLOYMENT: "gpt-6-luna",
        AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
      });
      expect(config.deployment).toBe("gpt-6-luna");
    });

    it("falls back to AZURE_OPENAI_DEPLOYMENT", () => {
      const config = resolveModelConfig("free", { AZURE_OPENAI_DEPLOYMENT: "gpt-4o" });
      expect(config.deployment).toBe("gpt-4o");
    });

    it('falls back to "gpt-4o-mini" when neither is set', () => {
      expect(resolveModelConfig("free", {}).deployment).toBe("gpt-4o-mini");
    });

    it("treats empty strings as unset", () => {
      const config = resolveModelConfig("free", {
        AZURE_OPENAI_JOB_DEPLOYMENT: "",
        AZURE_OPENAI_DEPLOYMENT: "",
      });
      expect(config.deployment).toBe("gpt-4o-mini");
    });
  });

  describe("free settings", () => {
    it("omits temperature and reasoning effort when unset", () => {
      const config = resolveModelConfig("free", {});
      expect(config).not.toHaveProperty("temperature");
      expect(config).not.toHaveProperty("reasoningEffort");
    });

    it("reads AZURE_OPENAI_JOB_TEMPERATURE and AZURE_OPENAI_JOB_REASONING_EFFORT", () => {
      const config = resolveModelConfig("free", {
        AZURE_OPENAI_JOB_TEMPERATURE: "0",
        AZURE_OPENAI_JOB_REASONING_EFFORT: "none",
      });
      expect(config.temperature).toBe(0);
      expect(config.reasoningEffort).toBe("none");
    });

    it("ignores the _PREMIUM settings", () => {
      const config = resolveModelConfig("free", {
        AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "gpt-5.4-mini",
        AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM: "0",
        AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM: "low",
      });
      expect(config.deployment).toBe("gpt-4o-mini");
      expect(config).not.toHaveProperty("temperature");
      expect(config).not.toHaveProperty("reasoningEffort");
    });
  });

  describe("premium", () => {
    it("uses its own deployment and its own _PREMIUM settings when the premium deployment is set", () => {
      const config = resolveModelConfig("premium", {
        AZURE_OPENAI_JOB_DEPLOYMENT: "gpt-6-luna",
        AZURE_OPENAI_JOB_REASONING_EFFORT: "none",
        AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "gpt-5.4-mini",
        AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM: "0",
      });
      expect(config.deployment).toBe("gpt-5.4-mini");
      expect(config.temperature).toBe(0);
      // A Premium setting never falls back to the free one (research R1).
      expect(config).not.toHaveProperty("reasoningEffort");
    });

    it.each([
      ["unset", undefined],
      ["empty", ""],
    ])(
      "uses the free deployment and the free settings when the premium deployment is %s",
      (_label, premiumDeployment) => {
        const config = resolveModelConfig("premium", {
          AZURE_OPENAI_JOB_DEPLOYMENT: "gpt-6-luna",
          AZURE_OPENAI_JOB_REASONING_EFFORT: "none",
          AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: premiumDeployment,
          AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM: "0",
          AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM: "high",
        });
        expect(config.deployment).toBe("gpt-6-luna");
        expect(config.reasoningEffort).toBe("none");
        expect(config).not.toHaveProperty("temperature");
      }
    );

    it("treats an empty _PREMIUM setting as unset", () => {
      const config = resolveModelConfig("premium", {
        AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "gpt-5.4-mini",
        AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM: "",
        AZURE_OPENAI_JOB_REASONING_EFFORT_PREMIUM: "",
      });
      expect(config).not.toHaveProperty("temperature");
      expect(config).not.toHaveProperty("reasoningEffort");
    });
  });

  describe("temperature parsing", () => {
    it.each([
      ["0", 0],
      ["0.7", 0.7],
      ["2", 2],
    ])("accepts %s", (raw, expected) => {
      expect(resolveModelConfig("free", { AZURE_OPENAI_JOB_TEMPERATURE: raw }).temperature).toBe(
        expected
      );
    });

    it.each(["abc", "-1", "2.5", "NaN", "Infinity"])("rejects %s", (raw) => {
      expect(() => resolveModelConfig("free", { AZURE_OPENAI_JOB_TEMPERATURE: raw })).toThrow(
        ModelConfigError
      );
    });

    it("names the premium variable when the premium value is invalid", () => {
      expect(() =>
        resolveModelConfig("premium", {
          AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "gpt-5.4-mini",
          AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM: "hot",
        })
      ).toThrow(/AZURE_OPENAI_JOB_TEMPERATURE_PREMIUM/);
    });
  });

  describe("reasoning effort", () => {
    it.each(["none", "low", "medium", "high", "xhigh"])("accepts %s", (effort) => {
      expect(
        resolveModelConfig("free", { AZURE_OPENAI_JOB_REASONING_EFFORT: effort }).reasoningEffort
      ).toBe(effort);
    });

    it.each(["minimal", "max", "NONE", "fast"])("rejects %s", (effort) => {
      expect(() =>
        resolveModelConfig("free", { AZURE_OPENAI_JOB_REASONING_EFFORT: effort })
      ).toThrow(ModelConfigError);
    });

    it("names the variable in the error message", () => {
      expect(() =>
        resolveModelConfig("free", { AZURE_OPENAI_JOB_REASONING_EFFORT: "minimal" })
      ).toThrow(/AZURE_OPENAI_JOB_REASONING_EFFORT/);
    });
  });

  describe("apiVersion", () => {
    it("defaults when unset or empty", () => {
      expect(resolveModelConfig("free", {}).apiVersion).toBe(DEFAULT_API_VERSION);
      expect(resolveModelConfig("free", { AZURE_OPENAI_API_VERSION: "" }).apiVersion).toBe(
        DEFAULT_API_VERSION
      );
    });

    it("is overridden by AZURE_OPENAI_API_VERSION for both tiers", () => {
      const env = {
        AZURE_OPENAI_API_VERSION: "2025-04-01-preview",
        AZURE_OPENAI_JOB_DEPLOYMENT_PREMIUM: "gpt-5.4-mini",
      };
      expect(resolveModelConfig("free", env).apiVersion).toBe("2025-04-01-preview");
      expect(resolveModelConfig("premium", env).apiVersion).toBe("2025-04-01-preview");
    });
  });

  it("is pure: it reads only the env argument", () => {
    process.env.AZURE_OPENAI_JOB_TEMPERATURE = "abc";
    try {
      expect(() => resolveModelConfig("free", {})).not.toThrow();
    } finally {
      delete process.env.AZURE_OPENAI_JOB_TEMPERATURE;
    }
  });
});
