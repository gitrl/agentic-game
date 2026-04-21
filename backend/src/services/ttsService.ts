import { readLlmConfig } from "../config/llmConfig.js";
import { AppError } from "../core/errors.js";

const DASHSCOPE_TTS_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation";

export class TtsService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor() {
    const config = readLlmConfig();
    this.apiKey = config.apiKey;
    this.model = process.env.TTS_MODEL?.trim() || "cosyvoice-v1";
    this.voice = process.env.TTS_VOICE?.trim() || "longxiaochun";
  }

  async synthesize(text: string): Promise<Buffer> {
    const res = await fetch(DASHSCOPE_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: { text },
        parameters: { voice: this.voice, format: "mp3", sample_rate: 22050 }
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[TTS] DashScope 返回 ${res.status}: ${body}`);
      throw new AppError(502, `语音合成失败 (HTTP ${res.status})`, "TTS_ERROR");
    }

    const contentType = res.headers.get("content-type") ?? "";

    // DashScope 直接返回音频二进制
    if (contentType.includes("audio")) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // DashScope 返回 JSON 包装（含 base64 或 URL）
    const json = (await res.json()) as {
      output?: { audio?: string; audio_url?: string };
    };

    if (json.output?.audio) {
      return Buffer.from(json.output.audio, "base64");
    }

    if (json.output?.audio_url) {
      const audioRes = await fetch(json.output.audio_url, {
        signal: AbortSignal.timeout(15_000)
      });
      const arrayBuffer = await audioRes.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    console.error("[TTS] 未知响应格式:", JSON.stringify(json).slice(0, 300));
    throw new AppError(502, "语音合成返回格式异常", "TTS_ERROR");
  }
}
