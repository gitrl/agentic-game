import type { Choice, InputFeedback, InputFeedbackStatus } from "../types/game.js";

type ResolveInput = {
  choiceId?: string;
  userInput?: string;
  currentChoices: Choice[];
};

type ResolveOutput = {
  resolvedChoiceId: string;
  feedback: InputFeedback;
};

const MAX_INPUT_LEN = 200;

const KEYWORD_MAP: Record<string, string[]> = {
  examine_evidence: ["证据", "证据链", "核验", "复核", "取证", "鉴定", "材料", "链条"],
  cross_examine: ["交叉", "质证", "询问", "盘问", "证人", "逼问", "发问"],
  timeline_rebuild: ["时间线", "重演", "还原", "案发", "轨迹", "路径", "十分钟"],
  file_motion: ["程序", "异议", "申请", "动议", "排除", "法庭申请", "法律程序"],
  private_probe: ["暗线", "私下", "线人", "卧底", "追查", "真凶", "外调查"],
  media_guidance: ["舆情", "媒体", "声明", "公开", "发布", "澄清", "记者"],
  stabilize_court: ["庭休", "暂停", "冷静", "缓一缓", "稳住", "休庭"],
  challenge_forensics: ["二次鉴定", "法医", "反证", "复检", "鉴定意见", "鉴定报告"]
};

const SAFE_FALLBACK_ORDER = ["file_motion", "timeline_rebuild", "examine_evidence"];

export const resolveTurnInput = ({ choiceId, userInput, currentChoices }: ResolveInput): ResolveOutput => {
  if (currentChoices.length === 0) {
    const fallback = {
      id: "strategic_pause",
      title: "临场稳控",
      description: "短暂停顿并重新组织发问路径",
      impactHint: "稳定局势"
    };
    return {
      resolvedChoiceId: fallback.id,
      feedback: buildFeedback({
        mode: choiceId ? "choice_id" : "user_input",
        status: "fallback",
        rawInput: choiceId ?? userInput ?? "",
        normalizedInput: normalizeText(choiceId ?? userInput ?? ""),
        resolvedChoiceId: fallback.id,
        resolvedChoiceTitle: fallback.title,
        confidence: 0,
        fallbackUsed: true,
        reason: "当前回合无可用选项，已自动进入保底策略。"
      })
    };
  }

  if (choiceId?.trim()) {
    const picked = currentChoices.find((item) => item.id === choiceId.trim());
    if (picked) {
      return {
        resolvedChoiceId: picked.id,
        feedback: buildFeedback({
          mode: "choice_id",
          status: "resolved",
          rawInput: choiceId,
          normalizedInput: choiceId.trim(),
          resolvedChoiceId: picked.id,
          resolvedChoiceTitle: picked.title,
          confidence: 1,
          fallbackUsed: false,
          reason: "已按快捷策略执行。"
        })
      };
    }

    const fallback = pickFallbackChoice(currentChoices);
    return {
      resolvedChoiceId: fallback.id,
      feedback: buildFeedback({
        mode: "choice_id",
        status: "fallback",
        rawInput: choiceId,
        normalizedInput: choiceId.trim(),
        resolvedChoiceId: fallback.id,
        resolvedChoiceTitle: fallback.title,
        confidence: 0.2,
        fallbackUsed: true,
        reason: "策略编号无效，已切换到保底可执行策略。"
      })
    };
  }

  const rawInput = userInput ?? "";
  const normalized = normalizeText(rawInput);

  if (!normalized) {
    const fallback = pickFallbackChoice(currentChoices);
    return {
      resolvedChoiceId: fallback.id,
      feedback: buildFeedback({
        mode: "user_input",
        status: "invalid",
        rawInput,
        normalizedInput: normalized,
        resolvedChoiceId: fallback.id,
        resolvedChoiceTitle: fallback.title,
        confidence: 0,
        fallbackUsed: true,
        reason: "输入为空，已自动执行保底策略。"
      })
    };
  }

  const clipped = normalized.length > MAX_INPUT_LEN ? normalized.slice(0, MAX_INPUT_LEN) : normalized;

  if (!hasEnoughSemanticContent(clipped)) {
    const fallback = pickFallbackChoice(currentChoices);
    return {
      resolvedChoiceId: fallback.id,
      feedback: buildFeedback({
        mode: "user_input",
        status: "invalid",
        rawInput,
        normalizedInput: clipped,
        resolvedChoiceId: fallback.id,
        resolvedChoiceTitle: fallback.title,
        confidence: 0.1,
        fallbackUsed: true,
        reason: "输入语义不足（可能是乱码或纯符号），已执行保底策略。"
      })
    };
  }

  const scored = currentChoices
    .map((choice) => ({ choice, score: scoreChoice(clipped, choice) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const hasClearWinner = best && best.score >= 0.55 && (!second || best.score - second.score >= 0.12);

  if (hasClearWinner) {
    return {
      resolvedChoiceId: best.choice.id,
      feedback: buildFeedback({
        mode: "user_input",
        status: "resolved",
        rawInput,
        normalizedInput: clipped,
        resolvedChoiceId: best.choice.id,
        resolvedChoiceTitle: best.choice.title,
        confidence: clamp01(best.score),
        fallbackUsed: false,
        reason: "系统已将自然语言输入归并为最接近的策略。"
      })
    };
  }

  const fallback = pickFallbackChoice(currentChoices);
  return {
    resolvedChoiceId: fallback.id,
    feedback: buildFeedback({
      mode: "user_input",
      status: "fallback",
      rawInput,
      normalizedInput: clipped,
      resolvedChoiceId: fallback.id,
      resolvedChoiceTitle: fallback.title,
      confidence: best ? clamp01(best.score) : 0,
      fallbackUsed: true,
      reason: "输入意图不明确，已自动回退到低风险策略。"
    })
  };
};

const scoreChoice = (normalizedInput: string, choice: Choice): number => {
  const text = normalizedInput.toLowerCase();
  const title = choice.title.toLowerCase();
  const description = choice.description.toLowerCase();
  const impact = choice.impactHint.toLowerCase();

  let score = 0;

  if (text.includes(choice.id.toLowerCase())) {
    score += 1;
  }
  if (text.includes(title)) {
    score += 1;
  }

  const titleTokens = title.split(/[\s、，。；：:]+/).filter(Boolean);
  for (const token of titleTokens) {
    if (token.length >= 2 && text.includes(token)) {
      score += 0.2;
    }
  }

  const descriptionTokens = description.split(/[\s、，。；：:]+/).filter(Boolean);
  for (const token of descriptionTokens) {
    if (token.length >= 2 && text.includes(token)) {
      score += 0.08;
    }
  }

  if (text.includes(impact)) {
    score += 0.2;
  }

  const keywords = KEYWORD_MAP[choice.id] ?? [];
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 0.28;
    }
  }

  return clamp01(score);
};

const normalizeText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const hasEnoughSemanticContent = (value: string): boolean => {
  if (value.length < 2) {
    return false;
  }
  const semanticChars = value.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) ?? [];
  return semanticChars.length >= 2;
};

const pickFallbackChoice = (currentChoices: Choice[]): Choice => {
  for (const id of SAFE_FALLBACK_ORDER) {
    const matched = currentChoices.find((choice) => choice.id === id);
    if (matched) {
      return matched;
    }
  }
  return currentChoices[0];
};

const buildFeedback = (feedback: InputFeedback): InputFeedback => {
  return {
    ...feedback,
    confidence: Number(clamp01(feedback.confidence).toFixed(2))
  };
};

const clamp01 = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

export const isValidInputFeedbackStatus = (status: string): status is InputFeedbackStatus => {
  return status === "resolved" || status === "fallback" || status === "invalid";
};
