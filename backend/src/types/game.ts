export type PlayerProfile = {
  name: string;
  role: string;
  talent: string;
  starterItem: string;
};

export type Stats = {
  truthScore: number;
  judgeTrust: number;
  juryBias: number;
  publicPressure: number;
  evidenceIntegrity: number;
};

export type Flags = {
  keyWitnessFlipped: boolean;
  forgedEvidenceAdmitted: boolean;
  interferenceDetected: boolean;
};

export type NpcRelation = {
  trust: number;
  stance: "ally" | "neutral" | "hostile";
};

export type EvidenceItem = {
  id: string;
  title: string;
  source: string;
  reliability: number;
  status: "unverified" | "verified" | "challenged";
  note: string;
};

export type MemoryBundle = {
  shortWindow: string[];
  midSummary: string[];
  longAnchors: string[];
};

export type RebirthState = {
  loop: number;
  memoryRetention: number;
  knownTruths: string[];
  fate: number;
};

export type Progress = {
  chapter: number;
  chapterTitle: string;
  sceneInChapter: number;
  maxScenesInChapter: number;
};

export type Choice = {
  id: string;
  title: string;
  description: string;
  impactHint: string;
};

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type ReplayEntry = {
  turn: number;
  playerAction: string;
  narrativeSummary: string;
  statChanges: string[];
  events: string[];
  tokenUsage: TokenUsage;
  timestamp: string;
};

export type EndingType = "truth" | "wrongful" | "misled" | "interference";

export type GameState = {
  sessionId: string;
  initialized: boolean;
  turn: number;
  progress: Progress;
  player: PlayerProfile;
  stats: Stats;
  flags: Flags;
  evidencePool: EvidenceItem[];
  npcRelations: Record<string, NpcRelation>;
  verdictOutlook: "truth" | "wrongful" | "misled" | "interference" | "undetermined";
  currentNarrative: string;
  currentChoices: Choice[];
  historySummaries: string[];
  memory: MemoryBundle;
  rebirth: RebirthState;
  replay: ReplayEntry[];
  gameOver: boolean;
  endingType: EndingType | null;
  endingNarrative: string;
  lastChoiceId: string;
  /** 玩家实际经历过的最高章节数（存档恢复时防止真相层级跳跃） */
  maxRevealedChapter: number;
};

export type InitPayload = {
  name: string;
  role: string;
  talent: string;
  starterItem: string;
};

export type ActionPayload = {
  choiceId?: string;
  userInput?: string;
};

export type InputFeedbackStatus = "resolved" | "fallback" | "invalid";

export type InputFeedback = {
  mode: "choice_id" | "user_input";
  status: InputFeedbackStatus;
  rawInput: string;
  normalizedInput: string;
  resolvedChoiceId: string;
  resolvedChoiceTitle: string;
  confidence: number;
  fallbackUsed: boolean;
  reason: string;
};

export type ActionResult = {
  narrative: string;
  summary: string;
  choices: Choice[];
  progress: Progress;
  statChanges: string[];
  events: string[];
  tokenUsage: TokenUsage;
  turn: number;
  stats: Stats;
  flags: Flags;
  evidencePool: EvidenceItem[];
  npcRelations: Record<string, NpcRelation>;
  verdictOutlook: GameState["verdictOutlook"];
  rebirth: RebirthState;
  gameOver: boolean;
  endingType: EndingType | null;
  endingNarrative: string;
};

export type SaveSnapshot = {
  saveId: string;
  sessionId: string;
  state: GameState;
  createdAt: string;
};
