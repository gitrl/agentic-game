import { randomUUID } from "crypto";
import { AppError } from "../core/errors.js";

const VOLC_TTS_URL = "https://openspeech.bytedance.com/api/v1/tts";

type VolcTtsResponse = {
  code: number;
  message?: string;
  reqid?: string;
  data?: string;
};

export class TtsService {
  private readonly appid: string;
  private readonly apiKey: string;
  private readonly cluster: string;
  private readonly voiceType: string;
  private readonly encoding: string;
  private readonly speedRatio: number;

  constructor() {
    this.appid = process.env.VOLC_TTS_APPID?.trim() ?? "";
    this.apiKey = process.env.VOLC_TTS_API_KEY?.trim() ?? "";
    this.cluster = process.env.VOLC_TTS_CLUSTER?.trim() || "volcano_tts";
    this.voiceType = process.env.VOLC_TTS_VOICE_TYPE?.trim() || "BV001_streaming";
    this.encoding = process.env.VOLC_TTS_ENCODING?.trim() || "mp3";
    const speed = Number(process.env.VOLC_TTS_SPEED_RATIO);
    this.speedRatio = Number.isFinite(speed) && speed > 0 ? speed : 1.0;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.appid || !this.apiKey) {
      throw new AppError(
        503,
        "TTS 未配置：请在 backend/.env 设置 VOLC_TTS_APPID 与 VOLC_TTS_API_KEY",
        "TTS_NOT_CONFIGURED"
      );
    }

    const payload = {
      app: {
        appid: this.appid,
        token: this.apiKey,
        cluster: this.cluster
      },
      user: {
        uid: "agentic-game"
      },
      audio: {
        voice_type: this.voiceType,
        encoding: this.encoding,
        speed_ratio: this.speedRatio
      },
      request: {
        reqid: randomUUID(),
        text,
        text_type: "plain",
        operation: "query"
      }
    };

    let res: Response;
    try {
      res = await fetch(VOLC_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer;${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "网络错误";
      console.error(`[TTS] 火山请求失败: ${message}`);
      throw new AppError(502, "语音合成网络失败", "TTS_NETWORK_ERROR");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[TTS] 火山返回 ${res.status}: ${body}`);
      throw new AppError(502, `语音合成失败 (HTTP ${res.status})`, "TTS_ERROR");
    }

    const json = (await res.json()) as VolcTtsResponse;

    // 火山返回 code=3000 表示成功，其他都是错误
    if (json.code !== 3000 || !json.data) {
      console.error(`[TTS] 火山业务错误 code=${json.code} message=${json.message}`);
      throw new AppError(
        502,
        `语音合成失败：${json.message ?? "未知错误"} (code=${json.code})`,
        "TTS_ERROR"
      );
    }

    return Buffer.from(json.data, "base64");
  }
}
