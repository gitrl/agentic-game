import type {
  Choice,
  EndingType,
  EvidenceItem,
  Flags,
  GameState,
  InitPayload,
  NpcRelation,
  Progress,
  RebirthState,
  Stats
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

const buildDefaultRebirthState = (): RebirthState => ({
  loop: 1,
  memoryRetention: 0.6,
  knownTruths: ["林策并非直接致死者"],
  fate: 72
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
  rebirth: buildDefaultRebirthState(),
  replay: [],
  gameOver: false,
  endingType: null,
  endingNarrative: "",
  lastChoiceId: ""
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
  rebirth: RebirthState;
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
  state.rebirth = buildDefaultRebirthState();
  state.verdictOutlook = "undetermined";

  const prologue = [
    `第${state.progress.chapter}章《${state.progress.chapterTitle}》第${state.progress.sceneInChapter}/${state.progress.maxScenesInChapter}幕。`,
    `我是${state.player.name}，以${state.player.role}身份走进${COURTROOM_LOCALES[0]}，把${state.player.starterItem}压在案卷边缘。`,
    "【案件名称】青禾江堤坠亡案",
    "【被告身份】林策，27岁，网约车司机；上一世被以“故意杀人”判处死刑。",
    "【死者身份】梁蔚，市重点项目审计员，案发前一周刚提交一份牵涉多方利益的审计复核意见。",
    "【检方核心主张】林策在 23:34 于江堤冲突中将梁蔚推落护栏，随后伪造报警时间并清理车内痕迹。",
    "【我记忆中的真相】真正作案者并非林策，但我不能直接说出“我来自未来”。",
    "【当前异常点】监控黑屏 43 秒、120 接警时间错位 7 分钟、首轮法医鉴定缺失原始样本附录。",
    "【规则约束】任何超前信息都会被认定为诱导证词，我只能让证据先开口。",
    `【重生参数】循环次数 ${state.rebirth.loop}，记忆保留 ${Math.round(
      state.rebirth.memoryRetention * 100
    )}%，命运阻力 ${state.rebirth.fate}。`,
    `【本局目标】依靠“${state.player.talent}”推进证据链与程序战，在终审前扭转冤案判决。`
  ].join("\n");

  state.currentNarrative = prologue;
  state.gameOver = false;
  state.endingType = null;
  state.endingNarrative = "";
  state.lastChoiceId = "";
  state.currentChoices = buildChoices(state.turn, state.stats, state.flags, [], "");
  state.historySummaries = ["序章：我回到冤案宣判前，案件进入实质审理阶段。"];
  state.memory = {
    shortWindow: [prologue],
    midSummary: ["前置背景建立完成：我掌握真相但必须隐藏重生信息。"],
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
    verdictOutlook: state.verdictOutlook,
    rebirth: state.rebirth
  };
};

export const deriveProgress = (turn: number): Progress => {
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
  events: string[],
  lastChoiceId: string
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

  // P4 防重复：确保上一轮已选的选项不作为首个呈现
  let offset = turn % base.length;
  if (lastChoiceId) {
    let attempts = 0;
    while (base[offset]?.id === lastChoiceId && attempts < base.length) {
      offset = (offset + 1) % base.length;
      attempts++;
    }
  }

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

export const maybeTriggerRebirth = (state: GameState, events: string[], statChanges: string[]): void => {
  const doomedOutlook =
    state.verdictOutlook === "wrongful" ||
    state.verdictOutlook === "misled" ||
    state.verdictOutlook === "interference";
  const fateOverflow = state.rebirth.fate >= 88;
  const shouldRebirth = state.turn >= 6 && doomedOutlook && fateOverflow;

  if (!shouldRebirth) {
    return;
  }

  events.push("rebirth_triggered");

  state.rebirth.loop += 1;
  state.rebirth.memoryRetention = Number(clamp(state.rebirth.memoryRetention - 0.06, 0.3, 0.9).toFixed(2));

  const keepCount = Math.max(1, Math.ceil(state.rebirth.knownTruths.length * state.rebirth.memoryRetention));
  state.rebirth.knownTruths = state.rebirth.knownTruths.slice(-keepCount);
  state.rebirth.fate = clamp(state.rebirth.fate - 24, 30, 100);

  state.stats.truthScore = clamp(Math.round((state.stats.truthScore + 42) / 2), 28, 72);
  state.stats.judgeTrust = clamp(Math.round((state.stats.judgeTrust + 48) / 2), 30, 74);
  state.stats.juryBias = clamp(Math.round(state.stats.juryBias * 0.35), -60, 60);
  state.stats.publicPressure = clamp(Math.round((state.stats.publicPressure + 38) / 2), 20, 82);
  state.stats.evidenceIntegrity = clamp(Math.round((state.stats.evidenceIntegrity + 45) / 2), 30, 76);

  state.flags.forgedEvidenceAdmitted = false;
  state.flags.interferenceDetected = false;
  if (state.stats.truthScore < 60) {
    state.flags.keyWitnessFlipped = false;
  }

  statChanges.push(
    `loop +1 -> ${state.rebirth.loop}`,
    `memory_retention -> ${Math.round(state.rebirth.memoryRetention * 100)}%`,
    `known_truths -> ${state.rebirth.knownTruths.length}`,
    `fate -> ${state.rebirth.fate}`
  );
};

export const evaluateVerdictOutlook = (state: GameState): GameState["verdictOutlook"] => {
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

export const updateMemoryBundles = (state: GameState, narrative: string, summary: string): void => {
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

// ─── 结局系统 ───────────────────────────────────────────────────────────────

export const checkGameOver = (state: GameState, events: string[]): void => {
  if (state.gameOver) return;
  // 重生触发当轮不判定结局
  if (events.includes("rebirth_triggered")) return;

  const isMaxTurn = state.turn >= 50;
  const isEarlyVictory =
    state.verdictOutlook === "truth" &&
    state.turn >= 30 &&
    state.stats.truthScore >= 78 &&
    state.stats.evidenceIntegrity >= 72;

  if (!isMaxTurn && !isEarlyVictory) return;

  state.gameOver = true;
  state.endingType =
    state.verdictOutlook === "undetermined" ? "wrongful" : (state.verdictOutlook as EndingType);
  state.endingNarrative = buildEndingNarrative(state);
  events.push("game_over");
};

const buildEndingNarrative = (state: GameState): string => {
  const loop = state.rebirth.loop;
  const isFirstLoop = loop <= 1;

  switch (state.endingType) {
    case "truth":
      if (isFirstLoop) {
        return [
          "判决撤销，重新认定无罪。",
          "",
          "林策在走廊里停了很久，不知道该往哪儿走——他以为今天要死。我把案卷合上，手心的汗是冷的。没有人知道这不是第一次，没有人知道我为什么从第一天就确定他没有杀人。",
          "",
          "真相不总是赢，但这一次，它赢了。"
        ].join("\n");
      }
      return [
        `第 ${loop} 周目，终于走到了这里。`,
        "",
        '"无罪。"',
        "",
        "我站在走廊里，听着法庭里人声逐渐散去。比上一次快了许多——因为我知道哪条路走不通。林策还是那个林策，只有我知道他差点被一份伪造的时间线永远定义。",
        "",
        "这一次，我让证据替真相开口了。"
      ].join("\n");

    case "wrongful":
      if (isFirstLoop) {
        return [
          '锤声落下。"有罪。"',
          "",
          "我站在走廊里，听着审判结束后的脚步声逐渐远去。证据链没有合拢，关键的那一节我没能补上。",
          "",
          "林策会被送进去。我必须再试一次。"
        ].join("\n");
      }
      return [
        `第 ${loop} 周目，又输了。`,
        "",
        "比上一次输得更难看——命运阻力每一次都比上一次更重。我攥着案卷，盯着那一页没能及时质疑的法医意见，记住这一次失败的具体位置。",
        "",
        "还有机会。"
      ].join("\n");

    case "misled":
      return [
        "伪证最终被采信。",
        "",
        "真正的作案者坐在旁听席第三排，面无表情。我本可以更早质疑那份鉴定报告——但我没有，或者质疑得太迟了。",
        "",
        "林策被冤枉，不是因为真相隐藏得太深，而是因为我被一个精心设计的谎言带偏了方向。"
      ].join("\n");

    case "interference":
      return [
        "舆情彻底崩掉的那一刻，这场审判就不再是司法程序了。",
        "",
        "判决书是一份交易的收据。我知道谁在背后施压，但法庭上没有人敢承认这一点。",
        "",
        "真相没有死，它只是被压住了。这个案子，迟早会重新出现在某个人的案头。"
      ].join("\n");

    default:
      return "案件已终局。";
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export const normalizeChanges = (
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

  pushNumericDiff(diff, "fate", before.rebirth.fate, after.rebirth.fate);
  if (before.rebirth.loop !== after.rebirth.loop) {
    diff.push(`loop +${after.rebirth.loop - before.rebirth.loop}`);
  }
  if (before.rebirth.memoryRetention !== after.rebirth.memoryRetention) {
    const beforePct = Math.round(before.rebirth.memoryRetention * 100);
    const afterPct = Math.round(after.rebirth.memoryRetention * 100);
    diff.push(`memory_retention ${beforePct}% -> ${afterPct}%`);
  }
  if (before.rebirth.knownTruths.length !== after.rebirth.knownTruths.length) {
    diff.push(`known_truths ${before.rebirth.knownTruths.length} -> ${after.rebirth.knownTruths.length}`);
  }

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

export const snapshotState = (state: GameState) => {
  return JSON.parse(
    JSON.stringify({
      stats: state.stats,
      flags: state.flags,
      npcRelations: state.npcRelations,
      evidencePool: state.evidencePool,
      rebirth: state.rebirth
    })
  ) as {
    stats: Stats;
    flags: Flags;
    npcRelations: Record<string, NpcRelation>;
    evidencePool: EvidenceItem[];
    rebirth: RebirthState;
  };
};
