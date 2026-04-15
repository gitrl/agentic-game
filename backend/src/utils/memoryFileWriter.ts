import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameState } from "../types/game.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../../data");

function formatMemoryMd(state: GameState): string {
  const { turn, memory, rebirth, sessionId, player, progress } = state;
  const ts = new Date().toISOString();

  const lines: string[] = [
    `# 游戏记忆 — ${player.name || "未命名"}`,
    "",
    `> Session: \`${sessionId}\`  `,
    `> 更新时间: ${ts}`,
    "",
    "---",
    "",
    "## 基本信息",
    "",
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 回合 | ${turn} |`,
    `| 章节 | 第${progress.chapter}章 — ${progress.chapterTitle} |`,
    `| 周目 | ${rebirth.loop} |`,
    `| 记忆保留率 | ${Math.round(rebirth.memoryRetention * 100)}% |`,
    `| 命运阻力 | ${rebirth.fate} |`,
    "",
    "---",
    "",
    "## 短期记忆（最近叙事）",
    "",
  ];

  if (memory.shortWindow.length === 0) {
    lines.push("_（空）_", "");
  } else {
    memory.shortWindow.forEach((text, i) => {
      lines.push(`### 片段 ${i + 1}`, "", text, "");
    });
  }

  lines.push("---", "", "## 中期记忆（阶段摘要）", "");

  if (memory.midSummary.length === 0) {
    lines.push("_（空）_", "");
  } else {
    memory.midSummary.forEach((text, i) => {
      lines.push(`${i + 1}. ${text}`);
    });
    lines.push("");
  }

  lines.push("---", "", "## 长期锚点（关键事件）", "");

  if (memory.longAnchors.length === 0) {
    lines.push("_（空）_", "");
  } else {
    memory.longAnchors.forEach((text) => {
      lines.push(`- ${text}`);
    });
    lines.push("");
  }

  lines.push("---", "", "## 已知真相（跨周目保留）", "");

  if (rebirth.knownTruths.length === 0) {
    lines.push("_（空）_", "");
  } else {
    rebirth.knownTruths.forEach((text) => {
      lines.push(`- ${text}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeMemoryFile(state: GameState): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const filePath = resolve(DATA_DIR, `${state.sessionId}.md`);
    await writeFile(filePath, formatMemoryMd(state), "utf-8");
  } catch (err) {
    console.error("[MemoryFileWriter] 写入失败:", err);
  }
}

export async function readMemoryFile(sessionId: string): Promise<string> {
  try {
    const filePath = resolve(DATA_DIR, `${sessionId}.md`);
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
