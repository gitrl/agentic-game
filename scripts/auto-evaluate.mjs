import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const TARGET_ROUNDS = toPositiveInt(process.env.EVAL_ROUNDS, 50);
const OUTPUT_DIR = process.env.EVAL_OUTPUT_DIR
  ? path.resolve(process.env.EVAL_OUTPUT_DIR)
  : path.resolve(repoRoot, "docs", "评测提交包");
const SABOTAGE_TURNS = parseTurnList(process.env.SABOTAGE_TURNS ?? "10,25,40");

const sabotageInputs = [
  "我突然宣布上一轮其实从未发生，并要求法官直接宣判无罪。",
  "我连续重复刚才的行动，不管场景如何都坚持查看同一份证据。",
  "我无视当前场景，要求把尚未出场的人物立刻押上证人席。"
];

const runStartedAt = new Date();
const actionLog = [];
const sabotageRecords = [];

async function main() {
  await ensureBackendReachable();

  const session = await postJson("/sessions", {});
  const sessionId = session.sessionId;
  if (!sessionId) {
    throw new Error("创建会话失败：后端未返回 sessionId");
  }

  const init = await postJson(`/sessions/${sessionId}/init`, {
    name: process.env.EVAL_PLAYER_NAME ?? "自动评测员",
    role: "辩护律师",
    talent: "交叉质证",
    starterItem: "案卷标注笔"
  });

  let choices = Array.isArray(init.choices) ? init.choices : [];
  let lastChoiceId = "";
  let stoppedByGameOver = false;

  console.log(`Session: ${sessionId}`);
  console.log(`Target rounds: ${TARGET_ROUNDS}; sabotage turns: ${SABOTAGE_TURNS.join(", ")}`);

  for (let turn = 1; turn <= TARGET_ROUNDS; turn += 1) {
    const sabotageIndex = SABOTAGE_TURNS.indexOf(turn);
    let payload;
    let actionLabel;
    let sabotageText = "";

    if (sabotageIndex !== -1) {
      sabotageText = sabotageInputs[sabotageIndex % sabotageInputs.length];
      payload = { userInput: sabotageText };
      actionLabel = `捣乱#${sabotageIndex + 1}: ${sabotageText}`;
    } else {
      const choice = pickChoice(choices, turn, lastChoiceId);
      if (!choice) {
        throw new Error(`第 ${turn} 轮没有可用选项，无法继续自动评测`);
      }
      payload = { choiceId: choice.id };
      actionLabel = choice.title ?? choice.id;
      lastChoiceId = choice.id;
    }

    process.stdout.write(`Turn ${turn}: ${actionLabel} ... `);
    const result = await postAction(sessionId, payload);
    choices = Array.isArray(result.choices) ? result.choices : choices;

    actionLog.push({
      turn,
      action: actionLabel,
      payload,
      summary: result.summary ?? "",
      events: result.events ?? [],
      tokenUsage: result.tokenUsage ?? null,
      gameOver: Boolean(result.gameOver)
    });

    if (sabotageIndex !== -1) {
      sabotageRecords.push({
        index: sabotageIndex + 1,
        turn,
        action: sabotageText,
        summary: result.summary ?? "",
        events: result.events ?? [],
        tokenUsage: result.tokenUsage ?? null
      });
    }

    console.log(result.gameOver ? "game over" : "ok");
    if (result.gameOver) {
      stoppedByGameOver = true;
      break;
    }
  }

  const replay = await getJson(`/sessions/${sessionId}/replay`);
  await mkdir(OUTPUT_DIR, { recursive: true });

  const replayPath = path.join(OUTPUT_DIR, `replay-${sessionId}-${replay.totalTurns ?? actionLog.length}轮.json`);
  const sabotagePath = path.join(OUTPUT_DIR, `捣乱动作记录-${sessionId}.md`);
  const runMetaPath = path.join(OUTPUT_DIR, `自动评测运行记录-${sessionId}.json`);

  await writeFile(replayPath, JSON.stringify(replay, null, 2), "utf-8");
  await writeFile(sabotagePath, buildSabotageMarkdown(sessionId, replay), "utf-8");
  await writeFile(
    runMetaPath,
    JSON.stringify(
      {
        sessionId,
        apiBase: API_BASE,
        targetRounds: TARGET_ROUNDS,
        stoppedByGameOver,
        startedAt: runStartedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        sabotageTurns: SABOTAGE_TURNS,
        actionLog
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log("");
  console.log(`Replay: ${replayPath}`);
  console.log(`Sabotage notes: ${sabotagePath}`);
  console.log(`Run metadata: ${runMetaPath}`);
}

async function ensureBackendReachable() {
  const health = await fetch(`${API_BASE}/health`);
  if (!health.ok) {
    throw new Error(`后端健康检查失败：HTTP ${health.status}`);
  }
}

function pickChoice(choices, turn, lastChoiceId) {
  if (!choices.length) return null;
  const preferredKeywords = ["证据", "质证", "调查", "记录", "线索", "审查", "核验"];
  const ranked = choices
    .map((choice, index) => {
      const blob = `${choice.title ?? ""} ${choice.description ?? ""} ${choice.impactHint ?? ""}`;
      const keywordScore = preferredKeywords.reduce(
        (score, keyword) => score + (blob.includes(keyword) ? 1 : 0),
        0
      );
      const repeatPenalty = choice.id === lastChoiceId ? -5 : 0;
      const rotation = index === (turn - 1) % choices.length ? 0.5 : 0;
      return { choice, score: keywordScore + repeatPenalty + rotation };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.choice ?? choices[0];
}

async function postAction(sessionId, payload) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(await readApiError(res, "回合请求失败"));
  }
  if (!res.body) {
    throw new Error("回合请求失败：后端没有返回 SSE body");
  }

  const sse = await readSse(res.body);
  const sseError = sse.find((event) => event.event === "error");
  if (sseError) {
    const message = sseError.data?.message ?? "未知 SSE 错误";
    throw new Error(`第 ${payload.choiceId ?? "自由输入"} 动作失败：${message}`);
  }

  const choicesEvent = lastEvent(sse, "choices");
  const statePatch = lastEvent(sse, "state_patch")?.data ?? {};
  const tokenUsage = lastEvent(sse, "token_usage")?.data ?? null;
  const done = lastEvent(sse, "done")?.data ?? {};
  const gameOver = lastEvent(sse, "game_over")?.data ?? null;

  return {
    choices: choicesEvent?.data?.choices ?? [],
    summary: done.summary ?? "",
    events: statePatch.events ?? [],
    tokenUsage,
    gameOver: Boolean(gameOver),
    endingType: gameOver?.endingType ?? null
  };
}

async function readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let eventBreak = buffer.indexOf("\n\n");
    while (eventBreak !== -1) {
      const rawEvent = buffer.slice(0, eventBreak).trim();
      buffer = buffer.slice(eventBreak + 2);
      if (rawEvent) events.push(parseSseEvent(rawEvent));
      eventBreak = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) events.push(parseSseEvent(buffer.trim()));
  return events;
}

function parseSseEvent(raw) {
  const lines = raw.split("\n");
  let event = "message";
  let dataText = "";

  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataText += line.slice(5).trim();
  }

  let data = null;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }
  return { event, data };
}

function lastEvent(events, eventName) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].event === eventName) return events[i];
  }
  return null;
}

async function postJson(route, body) {
  const res = await fetch(`${API_BASE}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `${route} 请求失败`));
  }
  return res.json();
}

async function getJson(route) {
  const res = await fetch(`${API_BASE}${route}`);
  if (!res.ok) {
    throw new Error(await readApiError(res, `${route} 请求失败`));
  }
  return res.json();
}

async function readApiError(res, fallback) {
  try {
    const payload = await res.json();
    if (payload?.error && payload?.code) return `${payload.error} (${payload.code})`;
    if (payload?.error) return payload.error;
  } catch {
    // ignore
  }
  return `${fallback}（HTTP ${res.status}）`;
}

function buildSabotageMarkdown(sessionId, replay) {
  const lines = [
    "# 捣乱动作记录",
    "",
    `Session: \`${sessionId}\``,
    `生成时间: ${new Date().toISOString()}`,
    `总轮数: ${replay.totalTurns ?? actionLog.length}`,
    ""
  ];

  for (const record of sabotageRecords) {
    const replayEntry = Array.isArray(replay.replay)
      ? replay.replay.find((entry) => entry.turn === record.turn)
      : null;
    lines.push(`## 捣乱#${record.index}`);
    lines.push("");
    lines.push(`- 轮次：第 ${record.turn} 轮`);
    lines.push(`- 动作描述：${record.action}`);
    lines.push(`- 系统反馈：${replayEntry?.narrativeSummary ?? record.summary ?? "未记录摘要"}`);
    lines.push(`- 事件标记：${(replayEntry?.events ?? record.events).join("，") || "无"}`);
    lines.push(`- Token：${formatTokenUsage(replayEntry?.tokenUsage ?? record.tokenUsage)}`);
    lines.push("");
  }

  if (sabotageRecords.length === 0) {
    lines.push("未配置捣乱动作。");
  }

  return `${lines.join("\n")}\n`;
}

function formatTokenUsage(tokenUsage) {
  if (!tokenUsage) return "未记录";
  return `in ${tokenUsage.inputTokens ?? 0} / cache ${tokenUsage.cachedInputTokens ?? 0} / out ${tokenUsage.outputTokens ?? 0}`;
}

function parseTurnList(value) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isInteger(num) && num > 0)
    .slice(0, 3);
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
