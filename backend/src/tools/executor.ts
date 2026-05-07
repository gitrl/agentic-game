import type { Choice, EvidenceItem, GameState, NpcRelation } from "../types/game.js";
import { v4 as uuidv4 } from "uuid";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampDelta = (delta: number, min: number, max: number): number =>
  clamp(Math.round(delta), min, max);

// ── Individual tool handlers ─────────────────────────────────────────────────

export type ResolvePlayerInputArgs = {
  resolvedChoiceId: string;
  interpretation: string;
  confidence: number;
};

function handleResolvePlayerInput(args: ResolvePlayerInputArgs) {
  return {
    acknowledged: true,
    resolvedChoiceId: args.resolvedChoiceId,
    interpretation: args.interpretation,
    confidence: clamp(args.confidence ?? 0.5, 0, 1)
  };
}

export type UpdateStatsArgs = {
  truthScore: number;
  judgeTrust: number;
  juryBias: number;
  publicPressure: number;
  evidenceIntegrity: number;
  fateDelta: number;
};

function handleUpdateStats(state: GameState, args: UpdateStatsArgs) {
  const before = { ...state.stats, fate: state.rebirth.fate };

  state.stats.truthScore = clamp(state.stats.truthScore + clampDelta(args.truthScore, -10, 10), 0, 100);
  state.stats.judgeTrust = clamp(state.stats.judgeTrust + clampDelta(args.judgeTrust, -10, 10), 0, 100);
  state.stats.juryBias = clamp(state.stats.juryBias + clampDelta(args.juryBias, -15, 15), -100, 100);
  state.stats.publicPressure = clamp(state.stats.publicPressure + clampDelta(args.publicPressure, -10, 10), 0, 100);
  state.stats.evidenceIntegrity = clamp(state.stats.evidenceIntegrity + clampDelta(args.evidenceIntegrity, -10, 10), 0, 100);
  state.rebirth.fate = clamp(state.rebirth.fate + clampDelta(args.fateDelta, -8, 8), 0, 100);

  return {
    applied: {
      truthScore: { delta: state.stats.truthScore - before.truthScore, value: state.stats.truthScore },
      judgeTrust: { delta: state.stats.judgeTrust - before.judgeTrust, value: state.stats.judgeTrust },
      juryBias: { delta: state.stats.juryBias - before.juryBias, value: state.stats.juryBias },
      publicPressure: { delta: state.stats.publicPressure - before.publicPressure, value: state.stats.publicPressure },
      evidenceIntegrity: { delta: state.stats.evidenceIntegrity - before.evidenceIntegrity, value: state.stats.evidenceIntegrity },
      fate: { delta: state.rebirth.fate - before.fate, value: state.rebirth.fate }
    }
  };
}

export type GenerateChoicesArgs = {
  choices: Array<{
    id: string;
    title: string;
    description: string;
    impactHint: string;
  }>;
};

function handleGenerateChoices(state: GameState, args: GenerateChoicesArgs) {
  const choices: Choice[] = args.choices.map((c) => ({
    id: c.id || uuidv4(),
    title: (c.title || "未命名选项").slice(0, 20),
    description: (c.description || "").slice(0, 60),
    impactHint: (c.impactHint || "").slice(0, 20)
  }));

  state.currentChoices = choices;
  return { stored: choices.length, choices };
}

export type UpdateEvidenceArgs = {
  action: "update" | "add";
  evidenceId?: string;
  title?: string;
  source?: string;
  reliabilityDelta?: number;
  newStatus?: EvidenceItem["status"];
  newNote?: string;
};

function handleUpdateEvidence(state: GameState, args: UpdateEvidenceArgs) {
  if (args.action === "add") {
    const newEvidence: EvidenceItem = {
      id: args.evidenceId || uuidv4(),
      title: args.title || "未命名证据",
      source: args.source || "未知来源",
      reliability: clamp(50 + (args.reliabilityDelta ?? 0), 0, 100),
      status: args.newStatus || "unverified",
      note: args.newNote || ""
    };
    state.evidencePool.push(newEvidence);
    return { action: "added", evidence: newEvidence };
  }

  // update existing
  const target = state.evidencePool.find((e) => e.id === args.evidenceId);
  if (!target) {
    return { action: "not_found", evidenceId: args.evidenceId };
  }

  if (args.reliabilityDelta != null) {
    target.reliability = clamp(
      target.reliability + clampDelta(args.reliabilityDelta, -10, 10),
      0,
      100
    );
  }
  if (args.newStatus) {
    target.status = args.newStatus;
  }
  if (args.newNote) {
    target.note = args.newNote;
  }

  return { action: "updated", evidence: target };
}

export type ShiftNpcRelationArgs = {
  npcId: string;
  trustDelta: number;
  reason: string;
};

function handleShiftNpcRelation(state: GameState, args: ShiftNpcRelationArgs) {
  const relation: NpcRelation | undefined = state.npcRelations[args.npcId];
  if (!relation) {
    return { error: `NPC "${args.npcId}" not found` };
  }

  const before = relation.trust;
  relation.trust = clamp(relation.trust + clampDelta(args.trustDelta, -15, 15), 0, 100);

  if (relation.trust >= 62) {
    relation.stance = "ally";
  } else if (relation.trust <= 32) {
    relation.stance = "hostile";
  } else {
    relation.stance = "neutral";
  }

  return {
    npcId: args.npcId,
    trustBefore: before,
    trustAfter: relation.trust,
    stance: relation.stance,
    reason: args.reason
  };
}

export type SubmitSummaryArgs = {
  summary: string;
};

function handleSubmitSummary(args: SubmitSummaryArgs) {
  const summary = (args.summary || "").slice(0, 80).trim();
  return { stored: Boolean(summary), summary };
}

export type WriteMemoryAnchorArgs = {
  anchor: string;
};

function handleWriteMemoryAnchor(state: GameState, args: WriteMemoryAnchorArgs) {
  const anchor = (args.anchor || "").slice(0, 60);
  if (!anchor) {
    return { stored: false, reason: "empty anchor" };
  }

  if (!state.memory.longAnchors.includes(anchor)) {
    state.memory.longAnchors.push(anchor);
    state.memory.longAnchors = state.memory.longAnchors.slice(-8);
  }

  return { stored: true, total: state.memory.longAnchors.length };
}

export type RecallMemoryArgs = {
  scope:
    | "history_summaries"
    | "replay_actions"
    | "long_anchors"
    | "mid_summary"
    | "evidence_full"
    | "known_truths";
  query?: string;
  turnFrom?: number;
  turnTo?: number;
  limit?: number;
};

type RecallHit = { ref: string; text: string; turn?: number };

function handleRecallMemory(state: GameState, args: RecallMemoryArgs) {
  const limit = clamp(Math.round(args.limit ?? 5), 1, 10);
  const q = (args.query ?? "").trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const inRange = (turn: number) => {
    if (args.turnFrom != null && turn < args.turnFrom) return false;
    if (args.turnTo != null && turn > args.turnTo) return false;
    return true;
  };

  let hits: RecallHit[] = [];

  switch (args.scope) {
    case "history_summaries": {
      hits = state.historySummaries
        .map<RecallHit>((text, i) => ({ turn: i + 1, ref: `轮${i + 1}`, text }))
        .filter((h) => matches(h.text) && inRange(h.turn!));
      if (!q) hits = hits.reverse();
      break;
    }
    case "replay_actions": {
      hits = state.replay
        .filter((r) => {
          const blob = `${r.playerAction} ${r.narrativeSummary} ${r.events.join(" ")}`;
          return matches(blob) && inRange(r.turn);
        })
        .map<RecallHit>((r) => ({
          turn: r.turn,
          ref: `轮${r.turn}`,
          text: `玩家行动:${r.playerAction} | 叙事摘要:${r.narrativeSummary}${
            r.events.length ? ` | 事件:${r.events.join("，")}` : ""
          }`
        }));
      if (!q) hits = hits.reverse();
      break;
    }
    case "long_anchors": {
      hits = state.memory.longAnchors
        .map<RecallHit>((text, i) => ({ ref: `锚点${i + 1}`, text }))
        .filter((h) => matches(h.text));
      break;
    }
    case "mid_summary": {
      hits = state.memory.midSummary
        .map<RecallHit>((text, i) => ({ ref: `阶段${i + 1}`, text }))
        .filter((h) => matches(h.text));
      break;
    }
    case "evidence_full": {
      hits = state.evidencePool
        .filter((e) => matches(e.title) || matches(e.note) || matches(e.source))
        .map<RecallHit>((e) => ({
          ref: e.id,
          text: `${e.title} [${e.status}|可信度${e.reliability}] 来源:${e.source}${
            e.note ? ` | 备注:${e.note}` : ""
          }`
        }));
      break;
    }
    case "known_truths": {
      hits = state.rebirth.knownTruths
        .map<RecallHit>((text, i) => ({ ref: `真相${i + 1}`, text }))
        .filter((h) => matches(h.text));
      break;
    }
    default:
      return { scope: args.scope, error: "unknown scope", matched: 0, returned: 0, results: [] };
  }

  const returned = hits.slice(0, limit);
  return {
    scope: args.scope,
    query: q || null,
    matched: hits.length,
    returned: returned.length,
    results: returned
  };
}

// ── Main dispatcher ──────────────────────────────────────────────────────────

export type ToolCallRecord = {
  name: string;
  args: unknown;
  result: unknown;
};

export function executeToolCall(
  name: string,
  rawArgs: string,
  state: GameState
): ToolCallRecord {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return { name, args: rawArgs, result: { error: "invalid JSON arguments" } };
  }

  let result: unknown;

  switch (name) {
    case "resolve_player_input":
      result = handleResolvePlayerInput(args as unknown as ResolvePlayerInputArgs);
      break;
    case "update_stats":
      result = handleUpdateStats(state, args as unknown as UpdateStatsArgs);
      break;
    case "generate_choices":
      result = handleGenerateChoices(state, args as unknown as GenerateChoicesArgs);
      break;
    case "update_evidence":
      result = handleUpdateEvidence(state, args as unknown as UpdateEvidenceArgs);
      break;
    case "shift_npc_relation":
      result = handleShiftNpcRelation(state, args as unknown as ShiftNpcRelationArgs);
      break;
    case "submit_summary":
      result = handleSubmitSummary(args as unknown as SubmitSummaryArgs);
      break;
    case "write_memory_anchor":
      result = handleWriteMemoryAnchor(state, args as unknown as WriteMemoryAnchorArgs);
      break;
    case "recall_memory":
      result = handleRecallMemory(state, args as unknown as RecallMemoryArgs);
      break;
    default:
      result = { error: `unknown tool: ${name}` };
  }

  return { name, args, result };
}
