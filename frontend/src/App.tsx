import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpenText,
  BrainCircuit,
  ChevronDown,
  Cpu,
  Database,
  Gavel,
  Loader2,
  Radar,
  Save,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserRound,
  Volume2,
  VolumeX
} from "lucide-react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Progress as UiProgress } from "./components/ui/progress";
import { Separator } from "./components/ui/separator";
import { cn } from "./lib/utils";
import type {
  Choice,
  EndingType,
  EvidenceItem,
  Flags,
  GameStateResponse,
  InitResponse,
  InputFeedback,
  NpcRelation,
  Progress,
  RebirthState,
  ReplayResponse,
  SaveListItem,
  Stats
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const STORAGE_KEY = "agentic-game-session-id";
const DEFAULT_ROLE = "辩护律师";
const DEFAULT_TALENT = "交叉质证";
const DEFAULT_STARTER_ITEM = "案卷标注笔";
const CASE_BRIEF = [
  { label: "案件名称", text: "青禾江堤坠亡案" },
  { label: "被告", text: "林策，27 岁，网约车司机。检方以故意杀人罪提起公诉。" },
  { label: "死者", text: "梁蔚，31 岁，青禾市审计局重点项目审计员。" },
  { label: "检方主张", text: "案发当晚 23:34，林策于江堤与梁蔚发生冲突，将其推落护栏，随后伪造报警时间并清理车内痕迹。" },
  { label: "案卷异常", text: "江堤监控在关键时段出现 43 秒黑屏；120 接警记录与手机通话时间存在 7 分钟错位；首轮法医鉴定意见缺失原始样本附录。" },
  { label: "你的直觉", text: "上一世的判决是错的。你说不清哪里不对，但总觉得有些关键的东西被忽略了——或者被刻意隐藏了。" },
  { label: "规则约束", text: "你不能直接说出自己的先验记忆，任何没有证据支撑的超前信息都会被认定为诱导证词。" },
  { label: "任务目标", text: "通过证据链、程序异议与交叉质证，在终审前为林策争取公正判决。" }
];

type VerdictOutlook = "truth" | "wrongful" | "misled" | "interference" | "undetermined";

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

const defaultProgress: Progress = {
  chapter: 1,
  chapterTitle: "未开始",
  sceneInChapter: 1,
  maxScenesInChapter: 8
};

const defaultStats: Stats = {
  truthScore: 50,
  judgeTrust: 50,
  juryBias: 0,
  publicPressure: 40,
  evidenceIntegrity: 50
};

const defaultFlags: Flags = {
  keyWitnessFlipped: false,
  forgedEvidenceAdmitted: false,
  interferenceDetected: false
};

const defaultRebirth: RebirthState = {
  loop: 1,
  memoryRetention: 0.6,
  knownTruths: [],
  fate: 50
};

function App() {
  const [sessionId, setSessionId] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("请先阅读案情并输入姓名");

  const [name, setName] = useState("沈言");

  type ActionSource = "choice" | "input" | "intro";
  type PendingAction = {
    action: string;
    source: "choice" | "input";
    resolvedTitle?: string;
    resolvedConfidence?: number;
    fallbackUsed?: boolean;
  };
  type StoryEntry = {
    narrative: string;
    summary?: string;
    playerAction?: string;
    actionSource?: ActionSource;
    resolvedTitle?: string;
    resolvedConfidence?: number;
    fallbackUsed?: boolean;
    introLabel?: string;
  };
  const [storyFeed, setStoryFeed] = useState<StoryEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [collapsedIndices, setCollapsedIndices] = useState<Set<number>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const streamingRef = useRef("");
  const chunkQueueRef = useRef("");
  const playbackTimerRef = useRef<number | null>(null);
  const pendingDoneSummaryRef = useRef<string | null>(null);
  const sessionIdRef = useRef("");
  const storyScrollRef = useRef<HTMLDivElement>(null);

  const updatePendingAction = (next: PendingAction | null) => {
    pendingActionRef.current = next;
    setPendingAction(next);
  };

  const toggleCollapsed = (index: number) => {
    setCollapsedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const [choices, setChoices] = useState<Choice[]>([]);
  const [turn, setTurn] = useState(0);
  const [progress, setProgress] = useState<Progress>(defaultProgress);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [flags, setFlags] = useState<Flags>(defaultFlags);
  const [rebirth, setRebirth] = useState<RebirthState>(defaultRebirth);
  const [evidencePool, setEvidencePool] = useState<EvidenceItem[]>([]);
  const [npcRelations, setNpcRelations] = useState<Record<string, NpcRelation>>({});
  const [verdictOutlook, setVerdictOutlook] = useState<VerdictOutlook>("undetermined");

  const [lastStatChanges, setLastStatChanges] = useState<string[]>([]);
  const [lastEvents, setLastEvents] = useState<string[]>([]);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);

  const [saveList, setSaveList] = useState<SaveListItem[]>([]);
  const [replayData, setReplayData] = useState<ReplayResponse | null>(null);

  const [gameOver, setGameOver] = useState(false);
  const [endingType, setEndingType] = useState<EndingType | null>(null);
  const [endingNarrative, setEndingNarrative] = useState("");

  const [ttsPlayingIndex, setTtsPlayingIndex] = useState<number | null>(null);
  const [ttsLoadingIndex, setTtsLoadingIndex] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopTts = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setTtsPlayingIndex(null);
    setTtsLoadingIndex(null);
  };

  const playTts = async (text: string, index: number) => {
    // 如果正在播放同一条，则停止
    if (ttsPlayingIndex === index) {
      stopTts();
      return;
    }
    stopTts();
    setTtsLoadingIndex(index);

    try {
      const res = await fetch(`${API_BASE}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        setTtsLoadingIndex(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;

      audio.onplay = () => {
        setTtsLoadingIndex(null);
        setTtsPlayingIndex(index);
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setTtsPlayingIndex(null);
        ttsAudioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setTtsPlayingIndex(null);
        setTtsLoadingIndex(null);
        ttsAudioRef.current = null;
      };

      await audio.play();
    } catch {
      setTtsLoadingIndex(null);
    }
  };

  const progressLabel = useMemo(() => {
    return `第${progress.chapter}章《${progress.chapterTitle}》 ${progress.sceneInChapter}/${progress.maxScenesInChapter}幕`;
  }, [progress]);

  const outlookLabel = useMemo(() => {
    const map: Record<VerdictOutlook, string> = {
      truth: "真相大白倾向",
      wrongful: "冤案风险升高",
      misled: "被误导风险升高",
      interference: "权力干预风险升高",
      undetermined: "走向未定"
    };
    return map[verdictOutlook];
  }, [verdictOutlook]);

  const setActiveSessionId = (nextSessionId: string) => {
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
    if (nextSessionId) {
      localStorage.setItem(STORAGE_KEY, nextSessionId);
    }
  };

  const stopPlayback = () => {
    if (playbackTimerRef.current !== null) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  };

  const finalizeTurnStream = (summary?: string) => {
    const completedNarrative = streamingRef.current;
    const pending = pendingActionRef.current;
    if (completedNarrative.trim()) {
      setStoryFeed((prev) => {
        // 新回合开始时，把刚成为"旧一轮"的条目加入折叠集合
        if (prev.length > 0) {
          const lastIndex = prev.length - 1;
          setCollapsedIndices((set) => {
            if (set.has(lastIndex)) return set;
            const next = new Set(set);
            next.add(lastIndex);
            return next;
          });
        }
        return [
          ...prev,
          {
            narrative: completedNarrative,
            summary,
            playerAction: pending?.action,
            actionSource: pending?.source,
            resolvedTitle: pending?.resolvedTitle,
            resolvedConfidence: pending?.resolvedConfidence,
            fallbackUsed: pending?.fallbackUsed
          }
        ];
      });
    }
    updatePendingAction(null);
    streamingRef.current = "";
    setStreamingText("");
    setStatus(summary ?? "回合完成");
  };

  const ensurePlaybackLoop = () => {
    if (playbackTimerRef.current !== null) {
      return;
    }

    playbackTimerRef.current = window.setInterval(() => {
      if (!chunkQueueRef.current) {
        stopPlayback();

        if (pendingDoneSummaryRef.current !== null) {
          const summary = pendingDoneSummaryRef.current;
          pendingDoneSummaryRef.current = null;
          finalizeTurnStream(summary);
        }
        return;
      }

      // 后端已真流式输出，前端打字机仅用于平滑展示 — 每 tick 吐 2 个字，近似 LLM 真实速率
      const take = Math.min(2, chunkQueueRef.current.length);
      const nextChars = chunkQueueRef.current.slice(0, take);
      chunkQueueRef.current = chunkQueueRef.current.slice(take);
      streamingRef.current += nextChars;
      setStreamingText(streamingRef.current);
    }, 16);
  };

  const pushNarrativeChunk = (text: string) => {
    if (!text) {
      return;
    }
    chunkQueueRef.current += text;
    ensurePlaybackLoop();
  };

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  // 每次新内容到达时自动滚动到底部（流式打字 / 新卡片）
  useEffect(() => {
    const el = storyScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingText, storyFeed]);

  // P2：页面加载时尝试从 localStorage 恢复上次会话
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (!savedId) return;

    const restore = async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${savedId}/state`);
        if (!res.ok) {
          // 只有 404（会话确实不存在）才清除，其他错误（后端未就绪等）保留 sessionId
          if (res.status === 404) {
            localStorage.removeItem(STORAGE_KEY);
          }
          return;
        }
        const state = (await res.json()) as GameStateResponse;
        if (!state.initialized) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        sessionIdRef.current = savedId;
        setSessionId(savedId);
        setInitialized(true);
        setName(state.player?.name ?? "沈言");
        setStoryFeed([
          { narrative: "[已自动恢复上次会话进度]", actionSource: "intro", introLabel: "系统" },
          { narrative: state.currentNarrative, actionSource: "intro", introLabel: "当前进度" }
        ]);
        setCollapsedIndices(new Set());
        setChoices(state.currentChoices);
        setProgress(state.progress);
        setStats(state.stats);
        setFlags(state.flags);
        setRebirth(state.rebirth);
        setEvidencePool(state.evidencePool);
        setNpcRelations(state.npcRelations);
        setVerdictOutlook(state.verdictOutlook);
        setTurn(state.turn);
        if (state.gameOver) {
          setGameOver(true);
          setEndingType(state.endingType ?? null);
          setEndingNarrative(state.endingNarrative ?? "");
        }
        setStatus("已自动恢复上次会话进度");
        // 恢复后拉取存档列表
        try {
          const savesRes = await fetch(`${API_BASE}/sessions/${savedId}/saves`);
          if (savesRes.ok) {
            const savesData = (await savesRes.json()) as { saves: SaveListItem[] };
            setSaveList(savesData.saves ?? []);
          }
        } catch { /* ignore */ }
      } catch {
        // 网络错误（后端未启动等），不清除 localStorage，下次刷新还能重试
      }
    };

    void restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureSession = async (): Promise<string> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }

    const res = await fetch(`${API_BASE}/sessions`, { method: "POST" });
    if (!res.ok) {
      throw new Error(await readApiError(res, "创建会话失败"));
    }

    const data = (await res.json()) as { sessionId: string };
    setActiveSessionId(data.sessionId);
    return data.sessionId;
  };

  const resetForInit = () => {
    setStoryFeed([]);
    setStreamingText("");
    setCollapsedIndices(new Set());
    updatePendingAction(null);
    streamingRef.current = "";
    setTurn(0);
    setProgress(defaultProgress);
    setStats(defaultStats);
    setFlags(defaultFlags);
    setRebirth(defaultRebirth);
    setEvidencePool([]);
    setNpcRelations({});
    setVerdictOutlook("undetermined");
    setLastStatChanges([]);
    setLastEvents([]);
    setLastTokenUsage(null);
    setReplayData(null);
    setGameOver(false);
    setEndingType(null);
    setEndingNarrative("");
  };

  const handleInit = async () => {
    setBusy(true);
    setStatus("正在建立庭审会话...");
    resetForInit();

    try {
      const id = await ensureSession();
      const res = await fetch(`${API_BASE}/sessions/${id}/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          role: DEFAULT_ROLE,
          talent: DEFAULT_TALENT,
          starterItem: DEFAULT_STARTER_ITEM
        })
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, "初始化失败"));
      }

      const data = (await res.json()) as InitResponse;
      setActiveSessionId(data.sessionId || id);
      setInitialized(true);
      setStoryFeed([{ narrative: data.narrative, actionSource: "intro", introLabel: "开场" }]);
      setCollapsedIndices(new Set());
      setChoices(data.choices);
      setProgress(data.progress);
      setStats(data.stats);
      setFlags(data.flags);
      setRebirth(data.rebirth);
      setEvidencePool(data.evidencePool);
      setNpcRelations(data.npcRelations);
      setVerdictOutlook(data.verdictOutlook);
      setSaveList([]);
      setStatus("初始化完成：请选择本轮行动");
    } catch (error) {
      setStatus(`初始化失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submitTurn = async (payload: { choiceId?: string; userInput?: string }) => {
    if (!initialized || busy) {
      return;
    }

    const activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId) {
      setStatus("会话丢失，请点击'重开案件'后重试");
      return;
    }

    if (!payload.choiceId && !payload.userInput?.trim()) {
      setStatus("请输入你的行动指令，或选择下方策略卡片");
      return;
    }

    setBusy(true);
    setStatus("法庭记录中...");
    stopPlayback();
    chunkQueueRef.current = "";
    pendingDoneSummaryRef.current = null;
    setStreamingText("");
    streamingRef.current = "";

    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSessionId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, "回合请求失败"));
      }
      if (!res.body) {
        throw new Error("回合请求失败：服务未返回流式内容");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let eventBreak = buffer.indexOf("\n\n");

        while (eventBreak !== -1) {
          const rawEvent = buffer.slice(0, eventBreak).trim();
          buffer = buffer.slice(eventBreak + 2);
          if (rawEvent) {
            handleSseEvent(rawEvent);
          }
          eventBreak = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        handleSseEvent(buffer.trim());
      }
    } catch (error) {
      setStatus(`请求失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleChoice = async (choiceId: string) => {
    const selected = choices.find((c) => c.id === choiceId);
    updatePendingAction({
      action: selected?.title ?? "（策略卡片）",
      source: "choice"
    });
    await submitTurn({ choiceId });
  };

  const handleSseEvent = (rawEvent: string) => {
    const lines = rawEvent.split("\n");
    let eventType = "message";
    let dataText = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      }
      if (line.startsWith("data:")) {
        dataText += line.slice(5).trim();
      }
    }

    if (!dataText) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(dataText);
    } catch {
      return;
    }

    if (eventType === "narrative_delta") {
      const text = (payload as { text?: string }).text ?? "";
      pushNarrativeChunk(text);
      return;
    }

    if (eventType === "input_feedback") {
      const feedback = payload as InputFeedback;
      const prev = pendingActionRef.current;
      // 仅为自由输入合并识别结果；策略卡片选择时不展示"系统识别"（冗余）
      if (prev?.source === "input") {
        updatePendingAction({
          ...prev,
          resolvedTitle: feedback.resolvedChoiceTitle,
          resolvedConfidence: feedback.confidence,
          fallbackUsed: feedback.fallbackUsed
        });
      }
      return;
    }

    if (eventType === "choices") {
      setChoices((payload as { choices?: Choice[] }).choices ?? []);
      return;
    }

    if (eventType === "state_patch") {
      const typed = payload as {
        turn?: number;
        stats?: Stats;
        flags?: Flags;
        rebirth?: RebirthState;
        evidencePool?: EvidenceItem[];
        npcRelations?: Record<string, NpcRelation>;
        verdictOutlook?: VerdictOutlook;
        statChanges?: string[];
        events?: string[];
      };

      setTurn((prev) => typed.turn ?? prev);
      if (typed.stats) setStats(typed.stats);
      if (typed.flags) setFlags(typed.flags);
      if (typed.rebirth) setRebirth(typed.rebirth);
      if (typed.evidencePool) setEvidencePool(typed.evidencePool);
      if (typed.npcRelations) setNpcRelations(typed.npcRelations);
      if (typed.verdictOutlook) setVerdictOutlook(typed.verdictOutlook);
      setLastStatChanges(typed.statChanges ?? []);
      setLastEvents(typed.events ?? []);
      return;
    }

    if (eventType === "progress") {
      setProgress(payload as Progress);
      return;
    }

    if (eventType === "token_usage") {
      setLastTokenUsage(payload as TokenUsage);
      return;
    }

    if (eventType === "status") {
      const message = (payload as { message?: string }).message;
      if (message) {
        setStatus(message);
      }
      return;
    }

    if (eventType === "done") {
      const summary = (payload as { summary?: string }).summary ?? "回合完成";

      if (!chunkQueueRef.current && playbackTimerRef.current === null) {
        finalizeTurnStream(summary);
      } else {
        pendingDoneSummaryRef.current = summary;
      }
      return;
    }

    if (eventType === "game_over") {
      const data = payload as { endingType?: string; endingNarrative?: string };
      setGameOver(true);
      setEndingType((data.endingType as EndingType) ?? null);
      setEndingNarrative(data.endingNarrative ?? "");
    }
  };

  const fetchSaveList = async () => {
    const activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSessionId}/saves`);
      if (!res.ok) return;
      const data = (await res.json()) as { saves: SaveListItem[] };
      setSaveList(data.saves ?? []);
    } catch {
      // 忽略网络错误
    }
  };

  const handleSave = async () => {
    const activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId || busy) {
      return;
    }

    setBusy(true);
    setStatus("存档中...");
    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSessionId}/save`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await readApiError(res, "保存失败"));
      }
      await fetchSaveList();
      setStatus("存档完成");
    } catch (error) {
      setStatus(`存档失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async (saveId: string) => {
    if (!saveId || busy) {
      return;
    }

    const label = saveList.find((s) => s.saveId === saveId)?.label ?? saveId;

    setBusy(true);
    setStatus("读档中...");
    try {
      const res = await fetch(`${API_BASE}/sessions/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveId })
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "读档失败"));
      }

      const data = (await res.json()) as { sessionId: string };
      setActiveSessionId(data.sessionId);

      const stateRes = await fetch(`${API_BASE}/sessions/${data.sessionId}/state`);
      if (!stateRes.ok) {
        throw new Error(await readApiError(stateRes, "读取状态失败"));
      }
      const state = (await stateRes.json()) as GameStateResponse;

      setInitialized(state.initialized);
      setStoryFeed([
        { narrative: `[已加载存档：${label}]`, actionSource: "intro", introLabel: "系统" },
        { narrative: state.currentNarrative, actionSource: "intro", introLabel: "当前进度" }
      ]);
      setCollapsedIndices(new Set());
      updatePendingAction(null);
      setChoices(state.currentChoices);
      setProgress(state.progress);
      setStats(state.stats);
      setFlags(state.flags);
      setRebirth(state.rebirth);
      setEvidencePool(state.evidencePool);
      setNpcRelations(state.npcRelations);
      setVerdictOutlook(state.verdictOutlook);
      setTurn(state.turn);
      setStreamingText("");
      streamingRef.current = "";
      setGameOver(state.gameOver ?? false);
      setEndingType(state.endingType ?? null);
      setEndingNarrative(state.endingNarrative ?? "");
      setSaveList([]);
      setStatus("读档完成");
    } catch (error) {
      setStatus(`读档失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReplay = async () => {
    const activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId || busy) {
      return;
    }

    setBusy(true);
    setStatus("读取回放中...");
    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSessionId}/replay`);
      if (!res.ok) {
        throw new Error(await readApiError(res, "拉取回放失败"));
      }
      const data = (await res.json()) as ReplayResponse;
      setReplayData(data);
      setStatus("回放已更新");
    } catch (error) {
      setStatus(`回放失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-auto bg-[hsl(var(--background))] text-foreground">
      <div className="pointer-events-none absolute inset-0 cyber-bg" />

      <div className="relative z-10 mx-auto grid min-h-screen min-w-[1240px] max-w-[1600px] gap-5 px-6 py-6">
        <Card className="tech-panel overflow-hidden border border-cyan-300/20 bg-slate-950/70">
          <CardContent className="grid gap-4 p-6 lg:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <p className="tracking-[0.32em] text-xs font-semibold uppercase text-cyan-300/80">Rebirth Legal Suspense</p>
              <h1 className="font-orbitron text-4xl font-semibold tracking-wide text-slate-50">逆判：重生证词</h1>
              <p className="text-sm text-slate-300">{progressLabel}</p>
            </div>

            <div className="grid justify-items-end gap-2 text-sm">
              <Badge className={cn("border px-3 py-1 text-xs font-semibold", outlookToneClass(verdictOutlook))}>{outlookLabel}</Badge>
              <div className="flex items-center gap-2 text-slate-200">
                <Timer className="h-4 w-4 text-cyan-300" />
                <span>回合 {turn}</span>
              </div>
              <div className="max-w-[360px] rounded-md border border-cyan-300/25 bg-cyan-500/10 px-3 py-1.5 text-right text-cyan-100">
                {status}
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid grid-cols-12 gap-5">
          <div className="col-span-8 space-y-5">
            <Card className="tech-panel flex min-h-0 flex-col border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
                  <BookOpenText className="h-5 w-5 text-cyan-300" />
                  庭审记录流
                </CardTitle>
                <CardDescription className="text-slate-400">SSE 流式叙事 · 新回合自动折叠旧条目，点击可随时展开回看。</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <div
                  ref={storyScrollRef}
                  className="story-scroll h-[920px] max-h-[78vh] min-h-[600px] space-y-3 overflow-y-auto pr-1"
                >
                  {!initialized ? (
                    <article className="story-card border-dashed border-cyan-300/35 bg-cyan-500/10 text-cyan-100">
                      点击"进入庭审"后，这里会开始输出案件叙事与法庭攻防过程。
                    </article>
                  ) : null}

                  {storyFeed.map((item, index) => {
                    const collapsed = collapsedIndices.has(index);
                    const hasAction = (item.actionSource === "choice" || item.actionSource === "input") && !!item.playerAction;
                    const isIntro = item.actionSource === "intro";
                    const showResolution = item.actionSource === "input" && !!item.resolvedTitle;
                    const previewText = !item.summary
                      ? item.narrative.slice(0, 60) + (item.narrative.length > 60 ? "…" : "")
                      : "";

                    return (
                      <article
                        key={`${index}-${item.narrative.slice(0, 8)}`}
                        className={cn("story-card text-slate-100", collapsed && "story-card-collapsed")}
                      >
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {hasAction ? (
                              <Badge className="border-amber-300/35 bg-amber-400/10 text-amber-100" variant="outline">
                                <UserRound className="mr-1 h-3 w-3" />
                                本轮行动：{item.playerAction}
                              </Badge>
                            ) : null}
                            {isIntro && item.introLabel ? (
                              <Badge className="border-slate-500/40 bg-slate-700/40 text-slate-300" variant="outline">
                                {item.introLabel}
                              </Badge>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(index)}
                            className="group flex shrink-0 items-center gap-1 rounded-md border border-slate-600/40 bg-slate-800/50 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                            aria-label={collapsed ? "展开全文" : "收起正文"}
                          >
                            <span>{collapsed ? "展开" : "收起"}</span>
                            <ChevronDown className={cn("chevron-icon h-3 w-3", !collapsed && "rotated")} />
                          </button>
                        </div>

                        {showResolution ? (
                          <p className={cn(
                            "mb-1.5 text-[11px] leading-relaxed",
                            item.fallbackUsed ? "text-amber-200/80" : "text-cyan-200/80"
                          )}>
                            系统识别：{item.resolvedTitle}
                            {typeof item.resolvedConfidence === "number" ? (
                              <>（置信度 {Math.round(item.resolvedConfidence * 100)}%）</>
                            ) : null}
                          </p>
                        ) : null}

                        {item.summary ? (
                          <div className="mb-2 flex items-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100">
                            <span className="shrink-0 font-semibold tracking-widest text-cyan-300/90">摘要</span>
                            <span className="flex-1 leading-relaxed">{item.summary}</span>
                            <button
                              type="button"
                              onClick={() => playTts(item.summary!, index)}
                              disabled={ttsLoadingIndex === index}
                              className="shrink-0 rounded p-1 transition-colors hover:bg-cyan-400/20 disabled:opacity-50"
                              aria-label={ttsPlayingIndex === index ? "停止播报" : "语音播报"}
                            >
                              {ttsLoadingIndex === index ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
                              ) : ttsPlayingIndex === index ? (
                                <VolumeX className="h-3.5 w-3.5 text-cyan-300" />
                              ) : (
                                <Volume2 className="h-3.5 w-3.5 text-cyan-300/70 hover:text-cyan-300" />
                              )}
                            </button>
                          </div>
                        ) : null}

                        <div className={cn("collapsible-body", !collapsed && "open")}>
                          <div className="collapsible-inner">
                            <p className="whitespace-pre-line pt-0.5">{item.narrative}</p>
                          </div>
                        </div>

                        {collapsed && !item.summary && previewText ? (
                          <p className="text-xs leading-relaxed text-slate-400">{previewText}</p>
                        ) : null}
                      </article>
                    );
                  })}

                  {streamingText ? (
                    <article className="story-card story-card-live text-slate-100">
                      {pendingAction ? (
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <Badge className="border-amber-300/35 bg-amber-400/10 text-amber-100" variant="outline">
                            <UserRound className="mr-1 h-3 w-3" />
                            本轮行动：{pendingAction.action}
                          </Badge>
                          {pendingAction.source === "input" && pendingAction.resolvedTitle ? (
                            <span className={cn(
                              "text-[11px]",
                              pendingAction.fallbackUsed ? "text-amber-200/80" : "text-cyan-200/80"
                            )}>
                              系统识别：{pendingAction.resolvedTitle}
                              {typeof pendingAction.resolvedConfidence === "number" ? (
                                <>（{Math.round(pendingAction.resolvedConfidence * 100)}%）</>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <span className="whitespace-pre-line">{streamingText}</span>
                      <span className="inline-block h-4 w-[2px] animate-pulse bg-cyan-300 align-middle" />
                    </article>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
                  <Radar className="h-5 w-5 text-cyan-300" />
                  本轮策略
                </CardTitle>
                <CardDescription className="text-slate-400">
                  点击下方策略卡片选择本轮行动。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={cn(
                  "grid gap-3",
                  choices.length <= 3 ? "grid-cols-3" : choices.length === 4 ? "grid-cols-2" : "grid-cols-3"
                )}>
                  {choices.map((choice) => (
                    <button
                      key={choice.id}
                      className={cn(
                        "group relative min-h-[150px] overflow-hidden rounded-lg border border-cyan-300/20 bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-left transition",
                        "hover:-translate-y-0.5 hover:border-cyan-300/45 hover:shadow-[0_8px_28px_rgba(34,211,238,0.18)]",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                      onClick={() => handleChoice(choice.id)}
                      disabled={busy || !initialized || gameOver}
                    >
                      <div className="absolute inset-x-0 top-0 h-[1px] bg-cyan-300/70 opacity-0 transition group-hover:opacity-100" />
                      <p className="mb-2 text-base font-semibold text-slate-100">{choice.title}</p>
                      <p className="text-sm leading-relaxed text-slate-300">{choice.description}</p>
                      <Badge className="absolute bottom-3 left-3 border-cyan-300/30 bg-cyan-500/10 text-cyan-100" variant="outline">
                        影响：{choice.impactHint}
                      </Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="col-span-4 grid gap-5">
            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  案件状态
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <MetricRow label="真相分" value={stats.truthScore} />
                <MetricRow label="法官信任" value={stats.judgeTrust} />
                <MetricRow label="陪审偏置" value={stats.juryBias} />
                <MetricRow label="公众压力" value={stats.publicPressure} />
                <MetricRow label="证据完整度" value={stats.evidenceIntegrity} />

                <div className="rounded-md border border-cyan-300/25 bg-cyan-500/10 p-2 text-xs text-cyan-100">
                  <p>重生循环：第 {rebirth.loop} 周目</p>
                  <p>记忆保留：{Math.round(rebirth.memoryRetention * 100)}%</p>
                  <p>命运阻力：{rebirth.fate}</p>
                </div>

                {rebirth.knownTruths.length > 0 ? (
                  <div className="space-y-1 rounded-md border border-slate-700 bg-slate-900/60 p-2">
                    <p className="text-xs text-slate-400">保留线索</p>
                    {rebirth.knownTruths.map((truth) => (
                      <p key={truth} className="text-xs text-slate-200">
                        - {truth}
                      </p>
                    ))}
                  </div>
                ) : null}

                <Separator className="bg-slate-700/70" />

                <FlagItem label="关键证人反转" enabled={flags.keyWitnessFlipped} />
                <FlagItem label="伪证已入卷" enabled={flags.forgedEvidenceAdmitted} danger />
                <FlagItem label="外部干预" enabled={flags.interferenceDetected} danger />
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Database className="h-4 w-4 text-cyan-300" />
                  证据板
                </CardTitle>
              </CardHeader>
              <CardContent className="story-scroll max-h-[270px] space-y-2 overflow-y-auto pr-1">
                {evidencePool.length === 0 ? <p className="text-sm text-slate-500">暂无证据条目</p> : null}
                {evidencePool.map((item) => (
                  <article key={item.id} className="rounded-md border border-slate-700/80 bg-slate-900/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-100">{item.title}</h3>
                      <Badge className={evidenceToneClass(item.status)}>{statusLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">来源：{item.source}</p>
                    <p className="mt-1 text-sm text-slate-300">{item.note}</p>
                    <p className="mt-2 text-xs text-cyan-200">可信度：{item.reliability}</p>
                  </article>
                ))}
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <UserRound className="h-4 w-4 text-cyan-300" />
                  人物态势
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(npcRelations).length === 0 ? <p className="text-sm text-slate-500">暂无人物动态</p> : null}
                {Object.entries(npcRelations).map(([key, relation]) => (
                  <article key={key} className="rounded-md border border-slate-700/80 bg-slate-900/70 p-3">
                    <p className="text-sm font-semibold text-slate-100">{relationName(key)}</p>
                    <p className="mt-1 text-xs text-slate-400">信任值：{relation.trust}</p>
                    <p className="mt-1 text-xs text-cyan-200">立场：{stanceLabel(relation.stance)}</p>
                  </article>
                ))}
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Gavel className="h-4 w-4 text-cyan-300" />
                  回合快照
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-slate-300">事件：{lastEvents.length > 0 ? lastEvents.map(eventLabel).join(" / ") : "无"}</p>
                <ul className="list-disc space-y-1 pl-4 text-slate-300">
                  {lastStatChanges.length === 0 ? <li>暂无变化</li> : null}
                  {lastStatChanges.map((change) => (
                    <li key={change}>{statChangeLabel(change)}</li>
                  ))}
                </ul>
                {lastTokenUsage ? (
                  <p className="rounded-md border border-cyan-300/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">
                    Token: in {lastTokenUsage.inputTokens} / cache {lastTokenUsage.cachedInputTokens} / out {lastTokenUsage.outputTokens}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Cpu className="h-4 w-4 text-cyan-300" />
                  会话工具
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-500">Session: {sessionId || "未创建"}</p>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" className="bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={handleSave} disabled={!initialized || busy}>
                    <Save className="h-4 w-4" />
                    存档
                  </Button>
                  <Button variant="secondary" className="bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={handleReplay} disabled={!initialized || busy}>
                    刷新回放
                  </Button>
                </div>

                {saveList.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-400">存档列表（最近 3 个）</p>
                    {saveList.map((save) => (
                      <button
                        key={save.saveId}
                        type="button"
                        onClick={() => handleLoad(save.saveId)}
                        disabled={busy}
                        className="w-full rounded-md border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-left transition hover:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <p className="text-sm font-medium text-slate-100">{save.label}</p>
                        <p className="text-xs text-slate-500">
                          第{save.turn}轮 · {save.chapterTitle} · {new Date(save.createdAt).toLocaleString("zh-CN")}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : initialized ? (
                  <p className="text-xs text-slate-500">暂无存档，点击"存档"保存当前进度</p>
                ) : null}
                {replayData ? (
                  <div className="space-y-2">
                    <div className="space-y-1 rounded-md border border-slate-700/80 bg-slate-900/70 p-2 text-xs text-slate-300">
                      <p>总回合：{replayData.totalTurns}</p>
                      <p>总 Action：{replayData.tokenSummary.totalActions}</p>
                      <p>新增输入 Token：{replayData.tokenSummary.inputTokens}</p>
                      <p>缓存输入 Token：{replayData.tokenSummary.cachedInputTokens}</p>
                      <p>输出 Token：{replayData.tokenSummary.outputTokens}</p>
                      <p>平均 Token/Action：{replayData.tokenSummary.avgPerAction}</p>
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full bg-slate-800 text-slate-100 hover:bg-slate-700 text-xs"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(replayData, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `replay-${replayData.sessionId}-${replayData.totalTurns}轮.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      导出回放日志 (JSON)
                    </Button>
                    <details className="rounded-md border border-slate-700/80 bg-slate-900/70">
                      <summary className="cursor-pointer px-2 py-1.5 text-xs text-cyan-200 hover:text-cyan-100">
                        展开逐轮明细 ({replayData.replay.length} 轮)
                      </summary>
                      <div className="max-h-[400px] overflow-y-auto">
                        {replayData.replay.map((entry) => (
                          <div key={entry.turn} className="border-t border-slate-700/50 px-2 py-2 text-xs text-slate-300">
                            <p className="font-semibold text-slate-100">轮 {entry.turn} — {entry.playerAction}</p>
                            <p className="mt-1 text-slate-400">{entry.narrativeSummary}</p>
                            {entry.statChanges.length > 0 && (
                              <p className="mt-1">数值：{entry.statChanges.join("，")}</p>
                            )}
                            {entry.events.length > 0 && (
                              <p className="mt-1 text-amber-200">事件：{entry.events.join("，")}</p>
                            )}
                            <p className="mt-1 text-cyan-300/70">
                              Token: in {entry.tokenUsage.inputTokens} / cache {entry.tokenUsage.cachedInputTokens} / out {entry.tokenUsage.outputTokens}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>

      {/* 案情导入弹窗 —— 未初始化时全屏展示 */}
      {!initialized ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/95 backdrop-blur-md">
          <Card className="tech-panel w-full max-w-2xl border border-cyan-300/30 bg-slate-900/95 shadow-[0_0_80px_rgba(34,211,238,0.12)]">
            <CardHeader className="space-y-3 pb-2">
              <p className="tracking-[0.32em] text-xs font-semibold uppercase text-cyan-300/80">Rebirth Legal Suspense</p>
              <CardTitle className="text-3xl font-semibold tracking-wide text-slate-50">
                <Scale className="mb-1 mr-2 inline-block h-7 w-7 text-cyan-300" />
                重生查案 . 谁推了她
              </CardTitle>
              <CardDescription className="text-sm text-slate-400">
                上一世的判决是错的。这一次，让证据先于记忆发声。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2">
                {CASE_BRIEF.map((item) => (
                  <div key={item.label} className="rounded-md border border-slate-700/70 bg-slate-800/60 px-4 py-2.5">
                    <span className="mr-2 text-xs font-semibold text-cyan-300">{item.label}</span>
                    <span className="text-sm leading-relaxed text-slate-200">{item.text}</span>
                  </div>
                ))}
              </div>

              <Separator className="bg-slate-700/50" />

              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.16em] text-slate-400">辩护律师代号</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    placeholder="输入你的姓名"
                    className="border-cyan-400/25 bg-slate-900/70 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <Button
                  className="h-10 bg-cyan-500 px-6 text-slate-950 hover:bg-cyan-400"
                  onClick={handleInit}
                  disabled={busy}
                >
                  <BrainCircuit className="mr-1 h-4 w-4" />
                  {busy ? "建立庭审中..." : "重开案件"}
                </Button>
              </div>

              <p className="text-center text-xs text-slate-500">
                系统默认角色：{DEFAULT_ROLE} / 专长：{DEFAULT_TALENT} / 初始道具：{DEFAULT_STARTER_ITEM}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* P1：结局画面覆盖层 */}
      {gameOver ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <Card className="tech-panel w-full max-w-2xl border border-cyan-300/30 bg-slate-900/95 shadow-[0_0_60px_rgba(34,211,238,0.15)]">
            <CardHeader className="space-y-3 pb-4">
              <Badge className={cn("w-fit border px-3 py-1 text-sm font-semibold", endingToneClass(endingType))}>
                {endingTypeLabel(endingType)}
              </Badge>
              <CardTitle className="text-2xl text-slate-50">终局宣判</CardTitle>
              <p className="text-sm text-slate-400">
                第 {rebirth.loop} 周目 · 第 {turn} 轮
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/60 p-4">
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
                  {endingNarrative}
                </p>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <EndingStatItem label="真相分" value={stats.truthScore} />
                <EndingStatItem label="法官信任" value={stats.judgeTrust} />
                <EndingStatItem label="陪审偏置" value={stats.juryBias} />
                <EndingStatItem label="公众压力" value={stats.publicPressure} />
                <EndingStatItem label="证据完整度" value={stats.evidenceIntegrity} />
              </div>
              <Button
                className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                onClick={handleInit}
                disabled={busy}
              >
                <BrainCircuit className="h-4 w-4" />
                再试一次（第 {rebirth.loop + 1} 周目）
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(100, Math.max(0, value + (label === "陪审偏置" ? 50 : 0)));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <UiProgress value={normalized} className="h-2 bg-slate-800" />
    </div>
  );
}

function FlagItem({ label, enabled, danger = false }: { label: string; enabled: boolean; danger?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        enabled ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-400",
        enabled && danger && "border-rose-400/35 bg-rose-400/10 text-rose-200"
      )}
    >
      {enabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {label}
    </p>
  );
}

const statusLabel = (status: EvidenceItem["status"]): string => {
  switch (status) {
    case "verified":
      return "已核验";
    case "challenged":
      return "争议中";
    default:
      return "待核验";
  }
};

const relationName = (key: string): string => {
  const map: Record<string, string> = {
    chiefProsecutor: "首席检察官",
    presidingJudge: "审判长",
    keyWitness: "关键证人",
    investigatorXu: "调查员许岚"
  };
  return map[key] ?? key;
};

const stanceLabel = (stance: NpcRelation["stance"]): string => {
  if (stance === "ally") {
    return "协同";
  }
  if (stance === "hostile") {
    return "对立";
  }
  return "观望";
};

const eventLabel = (slug: string): string => {
  const map: Record<string, string> = {
    rebirth_triggered: "重生触发",
    milestone_new_evidence: "新证据·跨江收费站记录",
    milestone_witness_flip: "关键证人立场反转",
    milestone_forged_evidence: "伪证被采纳",
    milestone_interference: "外部干预暴露",
    milestone_xu_notes: "许岚私人笔记浮出",
    milestone_zheng_evidence: "郑浩然过闸记录浮出",
    milestone_prosecutor_doubt: "检察官内心动摇",
    game_over: "终局宣判"
  };
  return map[slug] ?? slug;
};

const STAT_KEY_CN: Record<string, string> = {
  truth_score: "真相分",
  judge_trust: "法官信任",
  jury_bias: "陪审偏置",
  public_pressure: "公众压力",
  evidence_integrity: "证据完整度",
  key_witness_trust: "关键证人信任",
  fate: "命运阻力"
};

const FLAG_FLIP_CN: Record<string, string> = {
  key_witness_flipped: "关键证人立场反转",
  forged_evidence_admitted: "伪证已入卷",
  interference_detected: "外部干预已暴露"
};

const EVIDENCE_STATUS_CN: Record<string, string> = {
  unverified: "待核验",
  verified: "已核验",
  challenged: "争议中"
};

const statChangeLabel = (raw: string): string => {
  const flagMatch = raw.match(/^([a-z_]+):\s*false\s*->\s*true$/);
  if (flagMatch && FLAG_FLIP_CN[flagMatch[1]]) {
    return FLAG_FLIP_CN[flagMatch[1]];
  }

  const evidenceStatus = raw.match(/^evidence_status:\s*(\w+)\s*->\s*(\w+)$/);
  if (evidenceStatus) {
    const from = EVIDENCE_STATUS_CN[evidenceStatus[1]] ?? evidenceStatus[1];
    const to = EVIDENCE_STATUS_CN[evidenceStatus[2]] ?? evidenceStatus[2];
    return `证据状态：${from} → ${to}`;
  }

  const memRet = raw.match(/^memory_retention\s+(\d+)%\s*->\s*(\d+)%$/);
  if (memRet) {
    return `记忆保留 ${memRet[1]}% → ${memRet[2]}%`;
  }

  const knownTruths = raw.match(/^known_truths\s+(\d+)\s*->\s*(\d+)$/);
  if (knownTruths) {
    return `已知真相 ${knownTruths[1]} → ${knownTruths[2]} 条`;
  }

  const loopMatch = raw.match(/^loop\s+\+(\d+)$/);
  if (loopMatch) {
    return `进入下一周目 (+${loopMatch[1]})`;
  }

  const deltaMatch = raw.match(/^([a-z_]+)\s+([+-]\d+)$/);
  if (deltaMatch && STAT_KEY_CN[deltaMatch[1]]) {
    return `${STAT_KEY_CN[deltaMatch[1]]} ${deltaMatch[2]}`;
  }

  return raw;
};

const readApiError = async (res: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await res.json()) as { error?: string; code?: string };
    if (payload.error && payload.code) {
      return `${payload.error} (${payload.code})`;
    }
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore parse failures
  }
  return `${fallback}（HTTP ${res.status}）`;
};

const outlookToneClass = (outlook: VerdictOutlook): string => {
  if (outlook === "truth") {
    return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
  }
  if (outlook === "undetermined") {
    return "border-amber-300/35 bg-amber-400/15 text-amber-100";
  }
  return "border-rose-300/35 bg-rose-400/15 text-rose-100";
};

const evidenceToneClass = (status: EvidenceItem["status"]): string => {
  if (status === "verified") {
    return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
  }
  if (status === "challenged") {
    return "border-rose-300/35 bg-rose-400/15 text-rose-100";
  }
  return "border-amber-300/35 bg-amber-400/15 text-amber-100";
};

const endingTypeLabel = (type: EndingType | null): string => {
  if (type === "truth") return "真相大白";
  if (type === "wrongful") return "冤案终判";
  if (type === "misled") return "误导裁决";
  if (type === "interference") return "权力干预";
  return "终局裁决";
};

const endingToneClass = (type: EndingType | null): string => {
  if (type === "truth") return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
  if (type === "wrongful") return "border-rose-300/35 bg-rose-400/15 text-rose-100";
  if (type === "misled") return "border-amber-300/35 bg-amber-400/15 text-amber-100";
  if (type === "interference") return "border-purple-300/35 bg-purple-400/15 text-purple-100";
  return "border-slate-300/35 bg-slate-400/15 text-slate-100";
};

function EndingStatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-slate-700/60 bg-slate-800/60 p-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-base font-bold text-slate-100">{value}</span>
    </div>
  );
}

export default App;
