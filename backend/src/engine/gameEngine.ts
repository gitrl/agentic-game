import type {
  ActionResult,
  Choice,
  EvidenceItem,
  Flags,
  GameState,
  InitPayload,
  NpcRelation,
  Progress,
  Stats,
  TokenUsage
} from "../types/game.js";

const SCENES_PER_CHAPTER = 8;
const CHAPTER_TITLES = ["回溯醒来", "前案重演", "证链反噬", "终局对证", "改判黎明"];
const COURTROOM_LOCALES = ["青禾中院第一庭", "刑侦证据保全室", "陪审员评议室", "司法鉴定中心", "审判长合议庭"];

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const buildDefaultStats = (): Stats => ({
  truthScore: 46,
  judgeTrust: 50,
  juryBias: 0,
  publicPressure: 42,
  evidenceIntegrity: 48
});

const buildDefaultFlags = (): Flags => ({
  keyWitnessFlipped: false,
  forgedEvidenceAdmitted: false,
  interferenceDetected: false
});

const buildDefaultRelations = (): Record<string, NpcRelation> => ({
  chiefProsecutor: { trust: 30, stance: "hostile" },
  presidingJudge: { trust: 50, stance: "neutral" },
  keyWitness: { trust: 35, stance: "neutral" },
  investigatorXu: { trust: 55, stance: "ally" }
});

const buildInitialEvidence = (): EvidenceItem[] => {
  return [
    {
      id: "ev-river-cam-raw",
      title: "江堤监控原始码流",
      source: "市政天网备份磁带",
      reliability: 56,
      status: "unverified",
      note: "案发前 14 分钟出现 43 秒黑屏，帧序列存在跳变"
    },
    {
      id: "ev-emergency-call",
      title: "120 接警与调度录音",
      source: "急救中心调度台",
      reliability: 52,
      status: "unverified",
      note: "首通报警时间与警方到场记录存在 7 分钟错位"
    },
    {
      id: "ev-forensic-opinion",
      title: "首轮法医鉴定意见",
      source: "司法鉴定所",
      reliability: 44,
      status: "challenged",
      note: "死亡时刻区间过宽，且关键体征推断缺乏原始样本附录"
    }
  ];
};

export const createEmptyState = (sessionId: string): GameState => ({
  sessionId,
  initialized: false,
  turn: 0,
  progress: {
    chapter: 1,
    chapterTitle: CHAPTER_TITLES[0],
    sceneInChapter: 1,
    maxScenesInChapter: SCENES_PER_CHAPTER
  },
  player: {
    name: "",
    role: "",
    talent: "",
    starterItem: ""
  },
  stats: buildDefaultStats(),
  flags: buildDefaultFlags(),
  evidencePool: buildInitialEvidence(),
  npcRelations: buildDefaultRelations(),
  verdictOutlook: "undetermined",
  currentNarrative: "",
  currentChoices: [],
  historySummaries: [],
  memory: {
    shortWindow: [],
    midSummary: [],
    longAnchors: []
  },
  replay: []
});

export const initializeGame = (
  state: GameState,
  payload: InitPayload
): {
  narrative: string;
  choices: Choice[];
  progress: Progress;
  stats: Stats;
  flags: Flags;
  evidencePool: EvidenceItem[];
  npcRelations: Record<string, NpcRelation>;
  verdictOutlook: GameState["verdictOutlook"];
} => {
  state.player = {
    name: payload.name.trim() || "沈言",
    role: payload.role.trim() || "辩护律师",
    talent: payload.talent.trim() || "交叉质证",
    starterItem: payload.starterItem.trim() || "案卷标注笔"
  };
  state.initialized = true;
  state.turn = 0;
  state.progress = deriveProgress(0);
  state.stats = buildDefaultStats();
  state.flags = buildDefaultFlags();
  state.evidencePool = buildInitialEvidence();
  state.npcRelations = buildDefaultRelations();
  state.verdictOutlook = "undetermined";

  const prologue = [
    `第${state.progress.chapter}章《${state.progress.chapterTitle}》第${state.progress.sceneInChapter}/${state.progress.maxScenesInChapter}幕。`,
    `${state.player.name}以${state.player.role}身份进入${COURTROOM_LOCALES[0]}，你把${state.player.starterItem}放在桌角。`,
    "【案件名称】青禾江堤坠亡案",
    "【被告身份】林策，27岁，网约车司机；上一世被以“故意杀人”判处死刑。",
    "【死者身份】梁蔚，市重点项目审计员，案发前一周刚提交一份牵涉多方利益的审计复核意见。",
    "【检方核心主张】林策在 23:34 于江堤冲突中将梁蔚推落护栏，随后伪造报警时间并清理车内痕迹。",
    "【你记忆中的真相】真正作案者并非林策，但你不能直接说出“你来自未来”。",
    "【当前异常点】监控黑屏 43 秒、120 接警时间错位 7 分钟、首轮法医鉴定缺失原始样本附录。",
    "【规则约束】任何超前信息都会被认定为诱导证词，你必须让证据自己说话。",
    `【本局目标】利用“${state.player.talent}”推进证据链与程序战，在终审前扭转冤案判决。`
  ].join("\n");

  state.currentNarrative = prologue;
  state.currentChoices = buildChoices(state.turn, state.stats, state.flags, []);
  state.historySummaries = ["序章：你回到冤案宣判前，案件进入实质审理阶段。"];
  state.memory = {
    shortWindow: [prologue],
    midSummary: ["前置背景建立完成：你掌握真相但必须隐藏重生信息。"],
    longAnchors: ["核心目标：不暴露重生记忆，靠证据链改写判决结果"]
  };
  state.replay = [];

  return {
    narrative: state.currentNarrative,
    choices: state.currentChoices,
    progress: state.progress,
    stats: state.stats,
    flags: state.flags,
    evidencePool: state.evidencePool,
    npcRelations: state.npcRelations,
    verdictOutlook: state.verdictOutlook
  };
};

export const processAction = (state: GameState, choiceId: string): ActionResult => {
  const chosen = state.currentChoices.find((item) => item.id === choiceId) ?? {
    id: "strategic_pause",
    title: "临场稳控",
    description: "短暂停顿并重新组织发问路径",
    impactHint: "稳定局势"
  };

  const before = snapshotState(state);

  state.turn += 1;
  state.progress = deriveProgress(state.turn);

  const effects = applyChoiceEffects(state, chosen.id);
  applyMilestoneEvents(state, effects.events, effects.statChanges);
  state.verdictOutlook = evaluateVerdictOutlook(state);

  const narrative = composeNarrative(state, chosen, effects.beat, effects.events);
  const summary = summarizeTurn(state, chosen, effects.events);
  const tokenUsage = estimateTokenUsage(state, chosen.title, narrative);

  state.currentNarrative = narrative;
  state.currentChoices = buildChoices(state.turn, state.stats, state.flags, effects.events);
  state.historySummaries.push(summary);
  state.historySummaries = state.historySummaries.slice(-20);
  updateMemoryBundles(state, narrative, summary);

  const normalizedChanges = normalizeChanges(before, state, effects.statChanges);

  state.replay.push({
    turn: state.turn,
    playerAction: chosen.title,
    narrativeSummary: summary,
    statChanges: normalizedChanges,
    events: effects.events,
    tokenUsage,
    timestamp: new Date().toISOString()
  });

  return {
    narrative,
    summary,
    choices: state.currentChoices,
    progress: state.progress,
    statChanges: normalizedChanges,
    events: effects.events,
    tokenUsage,
    turn: state.turn,
    stats: state.stats,
    flags: state.flags,
    evidencePool: state.evidencePool,
    npcRelations: state.npcRelations,
    verdictOutlook: state.verdictOutlook
  };
};

const deriveProgress = (turn: number): Progress => {
  const chapter = Math.floor(turn / SCENES_PER_CHAPTER) + 1;
  const chapterTitle = CHAPTER_TITLES[(chapter - 1) % CHAPTER_TITLES.length];
  const sceneInChapter = (turn % SCENES_PER_CHAPTER) + 1;
  return {
    chapter,
    chapterTitle,
    sceneInChapter,
    maxScenesInChapter: SCENES_PER_CHAPTER
  };
};

const buildChoices = (
  turn: number,
  stats: Stats,
  flags: Flags,
  events: string[]
): Choice[] => {
  const base: Choice[] = [
    {
      id: "examine_evidence",
      title: "补全证据链断点",
      description: "逐项核对证据来源、封存记录与调取流程，修复关键缺口",
      impactHint: "提升真相分与证据完整度"
    },
    {
      id: "cross_examine",
      title: "诱导式交叉质证",
      description: "不暴露先验信息，通过细节追问逼出证词矛盾",
      impactHint: "可能提升法官信任，也可能触发对抗"
    },
    {
      id: "timeline_rebuild",
      title: "重演案发十分钟",
      description: "拼接监控、接警与法医记录，重建案发关键路径",
      impactHint: "稳步提升证据可信度"
    },
    {
      id: "file_motion",
      title: "提出程序排异申请",
      description: "申请排除瑕疵证据并要求检方补全原始链条",
      impactHint: "改变法庭态势与陪审倾向"
    },
    {
      id: "private_probe",
      title: "追查真凶暗线",
      description: "通过庭外线索反推利益链，寻找可入卷的新证据",
      impactHint: "高收益高风险"
    },
    {
      id: "media_guidance",
      title: "发布庭审澄清纪要",
      description: "公开已核验事实，抑制“被告已定罪”的先入叙事",
      impactHint: "影响公众压力与陪审偏置"
    }
  ];

  if (events.includes("conflict_spike") || stats.publicPressure >= 70) {
    base.push({
      id: "stabilize_court",
      title: "申请校验证据庭休",
      description: "争取短暂停庭，重排证据出示节奏并校验关键材料",
      impactHint: "降低失控风险"
    });
  }

  if (flags.forgedEvidenceAdmitted) {
    base.push({
      id: "challenge_forensics",
      title: "提交二次鉴定意见",
      description: "对争议鉴定结果提出反证，申请重新质证",
      impactHint: "有机会扭转误导线"
    });
  }

  const offset = turn % base.length;
  const picks = [
    base[offset],
    base[(offset + 2) % base.length],
    base[(offset + 4) % base.length]
  ];

  return dedupeChoices(picks);
};

const dedupeChoices = (choices: Choice[]): Choice[] => {
  const seen = new Set<string>();
  const output: Choice[] = [];
  for (const choice of choices) {
    if (!seen.has(choice.id)) {
      seen.add(choice.id);
      output.push(choice);
    }
  }
  return output;
};

const applyChoiceEffects = (
  state: GameState,
  choiceId: string
): { statChanges: string[]; events: string[]; beat: string } => {
  const statChanges: string[] = [];
  const events: string[] = ["turn_advanced"];
  let beat = "你暂时稳住了局势，没有暴露那段不可言说的记忆";

  switch (choiceId) {
    case "examine_evidence": {
      state.stats.truthScore = clamp(state.stats.truthScore + 6, 0, 100);
      state.stats.evidenceIntegrity = clamp(state.stats.evidenceIntegrity + 8, 0, 100);
      state.stats.publicPressure = clamp(state.stats.publicPressure - 2, 0, 100);
      tuneEvidence(state.evidencePool, "verified", 7, "证据链校验完成，封存与调取逻辑更完整");
      statChanges.push("truth_score +6", "evidence_integrity +8", "public_pressure -2");
      events.push("clue_confirmed");
      beat = "你把支离破碎的证据重新钉回可验证事实";
      break;
    }
    case "cross_examine": {
      state.stats.judgeTrust = clamp(state.stats.judgeTrust + 5, 0, 100);
      state.stats.truthScore = clamp(state.stats.truthScore + 4, 0, 100);
      state.stats.publicPressure = clamp(state.stats.publicPressure + 3, 0, 100);
      shiftRelation(state.npcRelations.keyWitness, 6);
      statChanges.push("judge_trust +5", "truth_score +4", "public_pressure +3");
      events.push("testimony_pressure", "conflict_spike");
      beat = "你绕开“我早就知道”的危险表述，逼证人自行说出破绽";
      break;
    }
    case "timeline_rebuild": {
      state.stats.evidenceIntegrity = clamp(state.stats.evidenceIntegrity + 6, 0, 100);
      state.stats.truthScore = clamp(state.stats.truthScore +5, 0, 100);
      state.stats.juryBias = clamp(state.stats.juryBias - 4, -100, 100);
      tuneEvidence(state.evidencePool, "verified", 5, "案发十分钟时间线重建完成，关键空档缩小");
      statChanges.push("evidence_integrity +6", "truth_score +5", "jury_bias -4");
      events.push("timeline_fixed");
      beat = "你用客观记录重放案发过程，检方叙事开始松动";
      break;
    }
    case "file_motion": {
      state.stats.judgeTrust = clamp(state.stats.judgeTrust + 7, 0, 100);
      state.stats.juryBias = clamp(state.stats.juryBias - 6, -100, 100);
      state.stats.publicPressure = clamp(state.stats.publicPressure + 2, 0, 100);
      statChanges.push("judge_trust +7", "jury_bias -6", "public_pressure +2");
      events.push("procedure_advantage");
      beat = "程序申请获准，庭审节奏重新落入你的掌控";
      break;
    }
    case "private_probe": {
      state.stats.truthScore = clamp(state.stats.truthScore + 8, 0, 100);
      state.stats.publicPressure = clamp(state.stats.publicPressure + 6, 0, 100);
      state.stats.judgeTrust = clamp(state.stats.judgeTrust - 2, 0, 100);
      shiftRelation(state.npcRelations.investigatorXu, 4);
      tuneEvidence(state.evidencePool, "challenged", 4, "暗线拿到新线索，但其合法性仍需补强");
      statChanges.push("truth_score +8", "public_pressure +6", "judge_trust -2");
      events.push("shadow_lead", "risk_taken");
      beat = "你撬开了通往真凶的裂缝，也把自己推向高风险地带";
      break;
    }
    case "media_guidance": {
      state.stats.publicPressure = clamp(state.stats.publicPressure - 7, 0, 100);
      state.stats.juryBias = clamp(state.stats.juryBias - 3, -100, 100);
      state.stats.truthScore = clamp(state.stats.truthScore + 2, 0, 100);
      statChanges.push("public_pressure -7", "jury_bias -3", "truth_score +2");
      events.push("narrative_control");
      beat = "你把舆论焦点拉回证据，而不是让“宿命论”主导法庭";
      break;
    }
    case "stabilize_court": {
      state.stats.publicPressure = clamp(state.stats.publicPressure - 5, 0, 100);
      state.stats.judgeTrust = clamp(state.stats.judgeTrust + 3, 0, 100);
      state.stats.evidenceIntegrity = clamp(state.stats.evidenceIntegrity + 2, 0, 100);
      statChanges.push("public_pressure -5", "judge_trust +3", "evidence_integrity +2");
      events.push("recovery_window");
      beat = "你争取到缓冲窗口，危险的庭审节奏暂时降温";
      break;
    }
    case "challenge_forensics": {
      state.stats.evidenceIntegrity = clamp(state.stats.evidenceIntegrity + 9, 0, 100);
      state.stats.judgeTrust = clamp(state.stats.judgeTrust + 4, 0, 100);
      state.flags.forgedEvidenceAdmitted = false;
      tuneEvidence(state.evidencePool, "verified", 8, "二次鉴定意见被采信，伪证风险下降");
      statChanges.push("evidence_integrity +9", "judge_trust +4", "forged_evidence_admitted -> false");
      events.push("forensics_rebuttal");
      beat = "你用二次鉴定完成反击，误导证据链开始崩解";
      break;
    }
    default: {
      state.stats.judgeTrust = clamp(state.stats.judgeTrust + 2, 0, 100);
      state.stats.publicPressure = clamp(state.stats.publicPressure - 1, 0, 100);
      statChanges.push("judge_trust +2", "public_pressure -1");
      events.push("stabilized");
      beat = "你稳住发问节奏，避免局势进一步失控";
      break;
    }
  }

  if (state.stats.publicPressure >= 78) {
    state.flags.interferenceDetected = true;
    events.push("interference_risk");
  }

  return { statChanges, events, beat };
};

const applyMilestoneEvents = (state: GameState, events: string[], statChanges: string[]): void => {
  if (state.turn === 4) {
    state.evidencePool.push({
      id: "ev-bridge-toll",
      title: "跨江收费站过闸记录",
      source: "交警指挥中心",
      reliability: 63,
      status: "verified",
      note: "可锁定关键车辆在案发窗口的行驶轨迹，与口供存在冲突"
    });
    statChanges.push("新增证据：跨江收费站过闸记录");
    events.push("new_evidence");
  }

  if (state.turn >= 7 && state.stats.truthScore >= 62 && !state.flags.keyWitnessFlipped) {
    state.flags.keyWitnessFlipped = true;
    shiftRelation(state.npcRelations.keyWitness, 12);
    statChanges.push("key_witness_flipped -> true");
    events.push("witness_flip");
  }

  if (state.turn >= 10 && state.stats.evidenceIntegrity <= 50 && !state.flags.forgedEvidenceAdmitted) {
    state.flags.forgedEvidenceAdmitted = true;
    statChanges.push("forged_evidence_admitted -> true");
    events.push("forged_evidence");
  }

  if (state.turn >= 16 && state.stats.publicPressure >= 74) {
    state.flags.interferenceDetected = true;
    statChanges.push("interference_detected -> true");
    events.push("interference_confirmed");
  }

};

const tuneEvidence = (
  evidencePool: EvidenceItem[],
  nextStatus: EvidenceItem["status"],
  reliabilityBoost: number,
  note: string
): void => {
  if (evidencePool.length === 0) {
    return;
  }
  const target = evidencePool[(evidencePool.length - 1) % 3];
  target.reliability = clamp(target.reliability + reliabilityBoost, 0, 100);
  target.status = nextStatus;
  target.note = note;
};

const shiftRelation = (relation: NpcRelation | undefined, deltaTrust: number): void => {
  if (!relation) {
    return;
  }
  relation.trust = clamp(relation.trust + deltaTrust, 0, 100);
  if (relation.trust >= 62) {
    relation.stance = "ally";
  } else if (relation.trust <= 32) {
    relation.stance = "hostile";
  } else {
    relation.stance = "neutral";
  }
};

const evaluateVerdictOutlook = (state: GameState): GameState["verdictOutlook"] => {
  const { stats, flags } = state;

  if (flags.interferenceDetected || stats.publicPressure >= 85) {
    return "interference";
  }
  if (stats.truthScore >= 78 && stats.evidenceIntegrity >= 72 && !flags.forgedEvidenceAdmitted) {
    return "truth";
  }
  if (flags.forgedEvidenceAdmitted || (stats.truthScore < 60 && stats.juryBias > 18)) {
    return "misled";
  }
  if (stats.truthScore <= 45 || stats.evidenceIntegrity <= 40 || stats.judgeTrust <= 35) {
    return "wrongful";
  }
  return "undetermined";
};

const composeNarrative = (
  state: GameState,
  choice: Choice,
  beat: string,
  events: string[]
): string => {
  const courtroom = COURTROOM_LOCALES[(state.turn + state.progress.chapter) % COURTROOM_LOCALES.length];
  const eventLine = buildEventLine(events);
  const outlook = outlookText(state.verdictOutlook);

  return [
    `第${state.progress.chapter}章《${state.progress.chapterTitle}》第${state.progress.sceneInChapter}/${state.progress.maxScenesInChapter}幕。`,
    `${state.player.name}在${courtroom}选择“${choice.title}”，${beat}。`,
    `${eventLine}当前判决走向评估：${outlook}。`,
    `法官信任 ${state.stats.judgeTrust}，真相分 ${state.stats.truthScore}，证据完整度 ${state.stats.evidenceIntegrity}。`,
    "你知道真相，但此刻必须让证据先开口，判决才会真正被改写。"
  ].join("");
};

const summarizeTurn = (state: GameState, choice: Choice, events: string[]): string => {
  const eventTag = events[events.length - 1] ?? "normal_progress";
  return `第${state.turn}轮选择“${choice.title}”，事件标签：${eventTag}，判决倾向：${state.verdictOutlook}。`;
};

const estimateTokenUsage = (
  state: GameState,
  actionTitle: string,
  narrative: string
): TokenUsage => {
  const memoryChars =
    state.memory.shortWindow.join("").length +
    state.memory.midSummary.join("").length +
    state.memory.longAnchors.join("").length;

  const inputTokens = Math.max(80, Math.ceil((memoryChars + actionTitle.length * 4) / 3.6));
  const cachedInputTokens = Math.max(40, Math.ceil(state.turn * 22));
  const outputTokens = Math.max(75, Math.ceil(narrative.length / 3));

  return { inputTokens, cachedInputTokens, outputTokens };
};

const updateMemoryBundles = (state: GameState, narrative: string, summary: string): void => {
  state.memory.shortWindow.push(narrative);
  state.memory.shortWindow = state.memory.shortWindow.slice(-6);

  if (state.turn % 5 === 0) {
    state.memory.midSummary.push(summary);
    state.memory.midSummary = state.memory.midSummary.slice(-10);
  }

  if (state.flags.keyWitnessFlipped && !state.memory.longAnchors.includes("关键证人立场已反转")) {
    state.memory.longAnchors.push("关键证人立场已反转");
  }
  if (
    state.flags.interferenceDetected &&
    !state.memory.longAnchors.includes("疑似外部权力干预已出现")
  ) {
    state.memory.longAnchors.push("疑似外部权力干预已出现");
  }

  state.memory.longAnchors = state.memory.longAnchors.slice(-8);
};

const buildEventLine = (events: string[]): string => {
  if (events.includes("interference_confirmed")) {
    return "你确认有场外力量在持续干预证据链，审判程序受到实质冲击。";
  }
  if (events.includes("witness_flip")) {
    return "关键证人突然改口，原本稳固的控方叙事出现裂口。";
  }
  if (events.includes("forged_evidence")) {
    return "争议证据被暂时采纳，案件走向再次滑向冤案轨道。";
  }
  if (events.includes("clue_confirmed")) {
    return "关键证据缺口被补齐，真实作案路径逐步浮现。";
  }
  if (events.includes("conflict_spike")) {
    return "庭上攻防节奏骤增，任何一句话都可能触发连锁反应。";
  }
  return "表面平静之下，证词、程序与利益三条线仍在暗中角力。";
};

const outlookText = (outlook: GameState["verdictOutlook"]): string => {
  switch (outlook) {
    case "truth":
      return "真相大白倾向";
    case "wrongful":
      return "冤案风险升高";
    case "misled":
      return "被误导风险升高";
    case "interference":
      return "权力干预风险升高";
    default:
      return "尚不明确";
  }
};

const normalizeChanges = (
  before: ReturnType<typeof snapshotState>,
  after: GameState,
  fallback: string[]
): string[] => {
  const diff: string[] = [];

  pushNumericDiff(diff, "truth_score", before.stats.truthScore, after.stats.truthScore);
  pushNumericDiff(diff, "judge_trust", before.stats.judgeTrust, after.stats.judgeTrust);
  pushNumericDiff(diff, "jury_bias", before.stats.juryBias, after.stats.juryBias);
  pushNumericDiff(diff, "public_pressure", before.stats.publicPressure, after.stats.publicPressure);
  pushNumericDiff(
    diff,
    "evidence_integrity",
    before.stats.evidenceIntegrity,
    after.stats.evidenceIntegrity
  );

  if (!before.flags.keyWitnessFlipped && after.flags.keyWitnessFlipped) {
    diff.push("key_witness_flipped: false -> true");
  }
  if (!before.flags.forgedEvidenceAdmitted && after.flags.forgedEvidenceAdmitted) {
    diff.push("forged_evidence_admitted: false -> true");
  }
  if (!before.flags.interferenceDetected && after.flags.interferenceDetected) {
    diff.push("interference_detected: false -> true");
  }

  const beforeWitnessTrust = before.npcRelations.keyWitness?.trust ?? 0;
  const afterWitnessTrust = after.npcRelations.keyWitness?.trust ?? 0;
  pushNumericDiff(diff, "key_witness_trust", beforeWitnessTrust, afterWitnessTrust);

  const beforeEvidence = before.evidencePool[0];
  const afterEvidence = after.evidencePool[0];
  if (beforeEvidence && afterEvidence && beforeEvidence.status !== afterEvidence.status) {
    diff.push(`evidence_status: ${beforeEvidence.status} -> ${afterEvidence.status}`);
  }

  return diff.length > 0 ? diff : fallback;
};

const pushNumericDiff = (rows: string[], key: string, before: number, after: number): void => {
  const delta = after - before;
  if (delta !== 0) {
    rows.push(`${key} ${delta > 0 ? `+${delta}` : delta}`);
  }
};

const snapshotState = (state: GameState) => {
  return JSON.parse(
    JSON.stringify({
      stats: state.stats,
      flags: state.flags,
      npcRelations: state.npcRelations,
      evidencePool: state.evidencePool
    })
  ) as {
    stats: Stats;
    flags: Flags;
    npcRelations: Record<string, NpcRelation>;
    evidencePool: EvidenceItem[];
  };
};
