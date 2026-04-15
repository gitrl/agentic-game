export type Choice = {
  id: string;
  title: string;
  description: string;
  impactHint: string;
};

export type InputFeedback = {
  mode: "choice_id" | "user_input";
  status: "resolved" | "fallback" | "invalid";
  rawInput: string;
  normalizedInput: string;
  resolvedChoiceId: string;
  resolvedChoiceTitle: string;
  confidence: number;
  fallbackUsed: boolean;
  reason: string;
};

export type Progress = {
  chapter: number;
  chapterTitle: string;
  sceneInChapter: number;
  maxScenesInChapter: number;
};

export type Stats = {
  truthScore: number;
  judgeTrust: number;
  juryBias: number;
  publicPressure: number;
  evidenceIntegrity: number;
};

export type RebirthState = {
  loop: number;
  memoryRetention: number;
  knownTruths: string[];
  fate: number;
};

export type Flags = {
  keyWitnessFlipped: boolean;
  forgedEvidenceAdmitted: boolean;
  interferenceDetected: boolean;
};

export type EvidenceItem = {
  id: string;
  title: string;
  source: string;
  reliability: number;
  status: "unverified" | "verified" | "challenged";
  note: string;
};

export type NpcRelation = {
  trust: number;
  stance: "ally" | "neutral" | "hostile";
};

export type InitResponse = {
  sessionId: string;
  narrative: string;
  choices: Choice[];
  progress: Progress;
  stats: Stats;
  flags: Flags;
  rebirth: RebirthState;
  evidencePool: EvidenceItem[];
  npcRelations: Record<string, NpcRelation>;
  verdictOutlook: "truth" | "wrongful" | "misled" | "interference" | "undetermined";
};

export type ReplayEntry = {
  turn: number;
  playerAction: string;
  narrativeSummary: string;
  statChanges: string[];
  events: string[];
  timestamp: string;
  tokenUsage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
};

export type ReplayResponse = {
  sessionId: string;
  totalTurns: number;
  replay: ReplayEntry[];
  tokenSummary: {
    totalActions: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    avgPerAction: number;
  };
};

export type EndingType = "truth" | "wrongful" | "misled" | "interference";

export type GameStateResponse = {
  initialized: boolean;
  currentNarrative: string;
  currentChoices: Choice[];
  progress: Progress;
  stats: Stats;
  flags: Flags;
  rebirth: RebirthState;
  evidencePool: EvidenceItem[];
  npcRelations: Record<string, NpcRelation>;
  verdictOutlook: "truth" | "wrongful" | "misled" | "interference" | "undetermined";
  turn: number;
  gameOver: boolean;
  endingType: EndingType | null;
  endingNarrative: string;
};
