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
  replay: ReplayEntry[];
};

export type InitPayload = {
  name: string;
  role: string;
  talent: string;
  starterItem: string;
};

export type ActionPayload = {
  choiceId: string;
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
};

export type SaveSnapshot = {
  saveId: string;
  sessionId: string;
  state: GameState;
  createdAt: string;
};
