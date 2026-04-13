export type LlmConfig = {
  enabled: boolean;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  softTimeoutMs: number;
  maxConsecutiveFailures: number;
  cooldownMs: number;
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readLlmConfig = (): LlmConfig => {
  return {
    enabled: process.env.LLM_ENABLED === "true",
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    baseURL:
      process.env.OPENAI_BASE_URL?.trim() ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.OPENAI_MODEL?.trim() || "qwen3.5-plus",
    temperature: toNumber(process.env.OPENAI_TEMPERATURE, 0.7),
    timeoutMs: toNumber(process.env.OPENAI_TIMEOUT_MS, 30000),
    softTimeoutMs: toNumber(process.env.LLM_SOFT_TIMEOUT_MS, 4000),
    maxConsecutiveFailures: Math.max(
      1,
      Math.floor(toNumber(process.env.LLM_MAX_CONSECUTIVE_FAILURES, 2))
    ),
    cooldownMs: Math.max(1000, Math.floor(toNumber(process.env.LLM_COOLDOWN_MS, 180000)))
  };
};
