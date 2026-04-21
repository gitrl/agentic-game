export type LlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  timeoutMs: number;
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const readLlmConfig = (): LlmConfig => {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    baseURL:
      process.env.OPENAI_BASE_URL?.trim() ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.OPENAI_MODEL?.trim() || "qwen3.5-plus",
    temperature: toNumber(process.env.OPENAI_TEMPERATURE, 0.7),
    thinkingEnabled: toBoolean(process.env.OPENAI_ENABLE_THINKING, false),
    thinkingBudget: toNumber(process.env.OPENAI_THINKING_BUDGET, 64),
    timeoutMs: toNumber(process.env.OPENAI_TIMEOUT_MS, 30000)
  };
};
