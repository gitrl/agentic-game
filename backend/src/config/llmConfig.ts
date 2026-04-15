export type LlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  timeoutMs: number;
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readLlmConfig = (): LlmConfig => {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    baseURL:
      process.env.OPENAI_BASE_URL?.trim() ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.OPENAI_MODEL?.trim() || "qwen3.5-plus",
    temperature: toNumber(process.env.OPENAI_TEMPERATURE, 0.7),
    timeoutMs: toNumber(process.env.OPENAI_TIMEOUT_MS, 30000)
  };
};
