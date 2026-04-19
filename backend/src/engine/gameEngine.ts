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

const SCENES_PER_CHAPTER = 10;
const CHAPTER_TITLES = ["回溯醒来", "前案重演", "证链反噬", "终局对证", "改判黎明"];
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const buildDefaultStats = (): Stats => ({
  truthScore: 50,
  judgeTrust: 50,
  juryBias: 0,
  publicPressure: 40,
  evidenceIntegrity: 50
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
  knownTruths: ["上一世的判决是错的"],
  fate: 50
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
  lastChoiceId: "",
  maxRevealedChapter: 1
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
    `走进青禾中院第一庭的时候，走廊尽头的日光灯正好闪了一下。`,
    ``,
    `我叫${state.player.name}。案卷摊在桌上，${state.player.starterItem}压住翻起的页角。被告席上坐着林策，二十七岁，网约车司机——检方以故意杀人罪起诉他，说他在江堤把一个叫梁蔚的女人推下了护栏。`,
    ``,
    `梁蔚，三十一岁，青禾市审计局的重点项目审计员。检方说林策在 23:34 与她发生冲突，之后伪造报警时间、清理车内痕迹。证据链看起来很完整，公诉人周锐鸣显然志在必得。`,
    ``,
    `但案卷里有些东西不对。江堤监控在 23:34 出现了 43 秒的黑屏。120 接警记录和林策手机通话时间对不上，差了整整 7 分钟。法医鉴定意见的死亡时间区间宽得离谱，而且原始样本附录——不见了。`,
    ``,
    state.rebirth.loop > 1
      ? `我说不清为什么，但翻开案卷的瞬间，一阵似曾相识的眩晕感涌上来。好像这些文字我读过，这条走廊我走过，这个结局——我见过。但记忆模糊得像隔着磨砂玻璃，我只确定一件事：上一次的判决是错的。`
      : `我说不清哪里不对，但直觉告诉我，有些关键的东西被忽略了——或者被刻意隐藏了。`,
    ``,
    `我不能把直觉当证据。任何没有证据支撑的超前信息都会被认定为诱导证词。我只能从这三份疑点重重的材料开始，一步一步把真相挖出来。`
  ].join("\n");

  state.currentNarrative = prologue;
  state.gameOver = false;
  state.endingType = null;
  state.endingNarrative = "";
  state.lastChoiceId = "";
  state.currentChoices = buildChoices(state.turn, state.stats, state.flags, [], "");
  state.historySummaries = ["序章：案件进入实质审理，案卷中存在多处异常。"];
  state.memory = {
    shortWindow: [prologue],
    midSummary: ["前置背景建立完成：案件疑点浮现，需要从证据入手寻找突破口。"],
    longAnchors: ["上一世的判决是错的，但我无法直接说出理由"]
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
  const chapter = Math.min(Math.floor(turn / SCENES_PER_CHAPTER) + 1, CHAPTER_TITLES.length);
  const chapterTitle = CHAPTER_TITLES[chapter - 1];
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
    // ── 法庭内行动 ──
    {
      id: "cross_examine",
      title: "诱导式交叉质证",
      description: "在法庭上不暴露先验信息，通过细节追问逼出证词矛盾",
      impactHint: "可能提升法官信任，也可能触发对抗"
    },
    {
      id: "file_motion",
      title: "提出程序排异申请",
      description: "在法庭上申请排除瑕疵证据并要求检方补全原始链条",
      impactHint: "改变法庭态势与陪审倾向"
    },
    // ── 庭外调查 ──
    {
      id: "visit_crime_scene",
      title: "重访江堤案发现场",
      description: "前往青禾江堤 B 段 47 号监控点，实地勘查护栏、暗道入口和监控盲区",
      impactHint: "可能发现物理痕迹"
    },
    {
      id: "check_records",
      title: "调取原始档案记录",
      description: "前往急救中心或天网备份机房，比对调度日志与监控操作记录",
      impactHint: "稳步提升证据可信度"
    },
    {
      id: "private_probe",
      title: "追查利益链暗线",
      description: "通过庭外线索反查宏泽置业工地办公室或收费站影像记录",
      impactHint: "高收益高风险"
    },
    // ── 人物互动 ──
    {
      id: "visit_defendant",
      title: "看守所会见林策",
      description: "前往看守所会见室，当面核实林策对案发当晚的关键细节记忆",
      impactHint: "获取第一手线索，风险较低"
    },
    {
      id: "contact_informant",
      title: "接触调查员许岚",
      description: "散庭后在咖啡馆与许岚碰面，试探他掌握的未入卷线索",
      impactHint: "可能获得关键情报，但需要谨慎"
    },
    {
      id: "media_guidance",
      title: "发布庭审澄清纪要",
      description: "公开已核验事实，抑制'被告已定罪'的先入叙事",
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
    base[(offset + 1) % base.length],
    base[(offset + 3) % base.length],
    base[(offset + 5) % base.length]
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
  const shouldRebirth = state.turn >= 15 && doomedOutlook && fateOverflow;

  if (!shouldRebirth) {
    return;
  }

  events.push("rebirth_triggered");

  state.rebirth.loop += 1;
  state.rebirth.memoryRetention = Number(clamp(state.rebirth.memoryRetention - 0.06, 0.3, 0.9).toFixed(2));

  const keepCount = Math.max(1, Math.ceil(state.rebirth.knownTruths.length * state.rebirth.memoryRetention));
  state.rebirth.knownTruths = state.rebirth.knownTruths.slice(-keepCount);
  state.rebirth.fate = clamp(state.rebirth.fate - 24, 30, 100);

  state.stats.truthScore = clamp(Math.round((state.stats.truthScore + 50) / 2), 30, 72);
  state.stats.judgeTrust = clamp(Math.round((state.stats.judgeTrust + 50) / 2), 30, 74);
  state.stats.juryBias = clamp(Math.round(state.stats.juryBias * 0.35), -60, 60);
  state.stats.publicPressure = clamp(Math.round((state.stats.publicPressure + 40) / 2), 20, 82);
  state.stats.evidenceIntegrity = clamp(Math.round((state.stats.evidenceIntegrity + 50) / 2), 30, 76);

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
  if (stats.truthScore <= 35 || stats.evidenceIntegrity <= 32 || stats.judgeTrust <= 28) {
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

// ─── 里程碑事件 + NPC 联动 ─────────────────────────────────────────────────

export const applyMilestones = (state: GameState, events: string[]): void => {
  const { turn, stats, flags, evidencePool, npcRelations, rebirth } = state;

  // ── 里程碑 1：第 5 轮自动新增跨江收费站记录 ──
  if (turn === 5 && !evidencePool.some((e) => e.id === "ev-toll-record")) {
    evidencePool.push({
      id: "ev-toll-record",
      title: "跨江收费站过闸记录",
      source: "市交通管理局调取",
      reliability: 63,
      status: "unverified",
      note: "案发时段有一辆未注册车辆经过江堤附近出口"
    });
    events.push("milestone_new_evidence");
  }

  // ── 里程碑 2：第 9 轮后 + truthScore >= 62 → 证人反转 ──
  if (
    turn >= 9 &&
    stats.truthScore >= 62 &&
    !flags.keyWitnessFlipped &&
    npcRelations.keyWitness &&
    npcRelations.keyWitness.trust >= 45
  ) {
    flags.keyWitnessFlipped = true;
    npcRelations.keyWitness.trust = clamp(npcRelations.keyWitness.trust + 12, 0, 100);
    if (npcRelations.keyWitness.trust >= 62) {
      npcRelations.keyWitness.stance = "ally";
    }
    events.push("milestone_witness_flip");

    // NPC 联动：证人反转 → 检察官被动 → 审判长注意
    if (npcRelations.chiefProsecutor) {
      npcRelations.chiefProsecutor.trust = clamp(npcRelations.chiefProsecutor.trust - 4, 0, 100);
      if (npcRelations.chiefProsecutor.trust <= 32) {
        npcRelations.chiefProsecutor.stance = "hostile";
      }
    }
    if (npcRelations.presidingJudge) {
      npcRelations.presidingJudge.trust = clamp(npcRelations.presidingJudge.trust + 3, 0, 100);
    }

    // 写入已知真相
    if (!rebirth.knownTruths.includes("关键证人的原始口供存在误导")) {
      rebirth.knownTruths.push("关键证人的原始口供存在误导");
      rebirth.knownTruths = rebirth.knownTruths.slice(-8);
    }
  }

  // ── 里程碑 3：第 14 轮后 + evidenceIntegrity <= 42 → 伪证被采纳 ──
  if (turn >= 14 && stats.evidenceIntegrity <= 42 && !flags.forgedEvidenceAdmitted) {
    flags.forgedEvidenceAdmitted = true;
    events.push("milestone_forged_evidence");

    // NPC 联动：伪证被采纳 → 审判长失望 → 调查员警觉
    if (npcRelations.presidingJudge) {
      npcRelations.presidingJudge.trust = clamp(npcRelations.presidingJudge.trust - 5, 0, 100);
      if (npcRelations.presidingJudge.trust <= 32) {
        npcRelations.presidingJudge.stance = "hostile";
      } else if (npcRelations.presidingJudge.trust < 62) {
        npcRelations.presidingJudge.stance = "neutral";
      }
    }
    if (npcRelations.investigatorXu) {
      npcRelations.investigatorXu.trust = clamp(npcRelations.investigatorXu.trust + 2, 0, 100);
    }

    if (!rebirth.knownTruths.includes("争议鉴定结果并非唯一解释")) {
      rebirth.knownTruths.push("争议鉴定结果并非唯一解释");
      rebirth.knownTruths = rebirth.knownTruths.slice(-8);
    }
  }

  // ── 里程碑 4：第 20 轮后 + publicPressure >= 74 → 外部干预暴露 ──
  if (turn >= 20 && stats.publicPressure >= 74 && !flags.interferenceDetected) {
    flags.interferenceDetected = true;
    events.push("milestone_interference");

    // NPC 联动：外部干预暴露 → 调查员积极 → 检察官承压
    if (npcRelations.investigatorXu) {
      npcRelations.investigatorXu.trust = clamp(npcRelations.investigatorXu.trust + 4, 0, 100);
      if (npcRelations.investigatorXu.trust >= 62) {
        npcRelations.investigatorXu.stance = "ally";
      }
    }
    if (npcRelations.chiefProsecutor) {
      npcRelations.chiefProsecutor.trust = clamp(npcRelations.chiefProsecutor.trust - 3, 0, 100);
    }

    if (!rebirth.knownTruths.includes("案件存在场外力量干预")) {
      rebirth.knownTruths.push("案件存在场外力量干预");
      rebirth.knownTruths = rebirth.knownTruths.slice(-8);
    }
  }

  // ── 里程碑 5：第 15 轮 + 调查员信任 >= 65 → 许岚传递未入卷笔记 ──
  if (
    turn === 15 &&
    npcRelations.investigatorXu &&
    npcRelations.investigatorXu.trust >= 65 &&
    !evidencePool.some((e) => e.id === "ev-xu-notes")
  ) {
    evidencePool.push({
      id: "ev-xu-notes",
      title: "许岚个人勘查笔记（未入卷）",
      source: "调查员许岚私下提供",
      reliability: 58,
      status: "unverified",
      note: "记录了办案初期被叫停的疑点：监控跳帧模式、现场第二组脚印、护栏漆面新鲜擦痕"
    });
    events.push("milestone_xu_notes");
  }

  // ── 里程碑 6：第 28 轮 → 自动新增郑浩然收费站记录 ──
  if (turn === 28 && !evidencePool.some((e) => e.id === "ev-zheng-toll")) {
    evidencePool.push({
      id: "ev-zheng-toll",
      title: "郑浩然名下车辆收费站过闸记录",
      source: "跨江收费站交叉比对",
      reliability: 71,
      status: "unverified",
      note: "案发当晚 23:25 经江堤附近出口离开，与约见梁蔚的时间吻合"
    });
    events.push("milestone_zheng_evidence");
  }

  // ── 里程碑 7：第 35 轮 + truthScore >= 70 → 检察官内部动摇 ──
  if (
    turn === 35 &&
    stats.truthScore >= 70 &&
    npcRelations.chiefProsecutor &&
    npcRelations.chiefProsecutor.stance === "hostile"
  ) {
    npcRelations.chiefProsecutor.trust = clamp(npcRelations.chiefProsecutor.trust + 6, 0, 100);
    if (npcRelations.chiefProsecutor.trust > 32) {
      npcRelations.chiefProsecutor.stance = "neutral";
    }
    events.push("milestone_prosecutor_doubt");
  }
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
