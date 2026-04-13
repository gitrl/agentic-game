import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpenText,
  BrainCircuit,
  Cpu,
  Database,
  Gavel,
  Radar,
  Save,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserRound
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
  EvidenceItem,
  Flags,
  GameStateResponse,
  InitResponse,
  NpcRelation,
  Progress,
  ReplayResponse,
  Stats
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_ROLE = "辩护律师";
const DEFAULT_TALENT = "交叉质证";
const DEFAULT_STARTER_ITEM = "案卷标注笔";
const CASE_BRIEF = [
  "【案件名称】青禾江堤坠亡案",
  "【时间节点】你重生回冤案宣判前 21 天，上一世的错误判决尚未发生。",
  "【被告】林策，27 岁网约车司机；上一世被判故意杀人并执行死刑。",
  "【死者】梁蔚，市重点项目审计员，死前掌握多方利益链条关键资料。",
  "【检方观点】案发当晚林策与梁蔚发生争执，将其推落江堤后伪造报警时间。",
  "【已知疑点】监控黑屏 43 秒、120 接警时间与警方记录错位 7 分钟、法医鉴定链条存在缺口。",
  "【重生限制】你知道真相，但不能直接说；一旦暴露“先验记忆”，证词会被认定为诱导。",
  "【你的任务】只能通过证据链、程序异议与交叉质证，实质改变最终判决。"
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
  truthScore: 46,
  judgeTrust: 50,
  juryBias: 0,
  publicPressure: 42,
  evidenceIntegrity: 48
};

const defaultFlags: Flags = {
  keyWitnessFlipped: false,
  forgedEvidenceAdmitted: false,
  interferenceDetected: false
};

function App() {
  const [sessionId, setSessionId] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("请先阅读案情并输入姓名");

  const [name, setName] = useState("沈言");

  const [storyFeed, setStoryFeed] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const chunkQueueRef = useRef("");
  const playbackTimerRef = useRef<number | null>(null);
  const pendingDoneSummaryRef = useRef<string | null>(null);
  const sessionIdRef = useRef("");

  const [choices, setChoices] = useState<Choice[]>([]);
  const [turn, setTurn] = useState(0);
  const [progress, setProgress] = useState<Progress>(defaultProgress);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [flags, setFlags] = useState<Flags>(defaultFlags);
  const [evidencePool, setEvidencePool] = useState<EvidenceItem[]>([]);
  const [npcRelations, setNpcRelations] = useState<Record<string, NpcRelation>>({});
  const [verdictOutlook, setVerdictOutlook] = useState<VerdictOutlook>("undetermined");

  const [lastStatChanges, setLastStatChanges] = useState<string[]>([]);
  const [lastEvents, setLastEvents] = useState<string[]>([]);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);

  const [saveIdInput, setSaveIdInput] = useState("");
  const [latestSaveId, setLatestSaveId] = useState("");
  const [replayData, setReplayData] = useState<ReplayResponse | null>(null);

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
  };

  const stopPlayback = () => {
    if (playbackTimerRef.current !== null) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  };

  const finalizeTurnStream = (summary?: string) => {
    const completedNarrative = streamingRef.current;
    if (completedNarrative.trim()) {
      setStoryFeed((prev) => [...prev, completedNarrative]);
    }
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

      const nextChar = chunkQueueRef.current[0];
      chunkQueueRef.current = chunkQueueRef.current.slice(1);
      streamingRef.current += nextChar;
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
    streamingRef.current = "";
    setTurn(0);
    setProgress(defaultProgress);
    setStats(defaultStats);
    setFlags(defaultFlags);
    setEvidencePool([]);
    setNpcRelations({});
    setVerdictOutlook("undetermined");
    setLastStatChanges([]);
    setLastEvents([]);
    setLastTokenUsage(null);
    setReplayData(null);
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
      setStoryFeed([data.narrative]);
      setChoices(data.choices);
      setProgress(data.progress);
      setStats(data.stats);
      setFlags(data.flags);
      setEvidencePool(data.evidencePool);
      setNpcRelations(data.npcRelations);
      setVerdictOutlook(data.verdictOutlook);
      setStatus("初始化完成：请选择本轮行动");
    } catch (error) {
      setStatus(`初始化失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleChoice = async (choiceId: string) => {
    if (!initialized || busy) {
      return;
    }

    const activeSessionId = sessionIdRef.current || sessionId;
    if (!activeSessionId) {
      setStatus("会话丢失，请点击“重开案件”后重试");
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
        body: JSON.stringify({ choiceId })
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

    if (eventType === "choices") {
      setChoices((payload as { choices?: Choice[] }).choices ?? []);
      return;
    }

    if (eventType === "state_patch") {
      const typed = payload as {
        turn?: number;
        stats?: Stats;
        flags?: Flags;
        evidencePool?: EvidenceItem[];
        npcRelations?: Record<string, NpcRelation>;
        verdictOutlook?: VerdictOutlook;
        statChanges?: string[];
        events?: string[];
      };

      setTurn((prev) => typed.turn ?? prev);
      if (typed.stats) setStats(typed.stats);
      if (typed.flags) setFlags(typed.flags);
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

    if (eventType === "done") {
      const summary = (payload as { summary?: string }).summary ?? "回合完成";

      if (!chunkQueueRef.current && playbackTimerRef.current === null) {
        finalizeTurnStream(summary);
      } else {
        pendingDoneSummaryRef.current = summary;
      }
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
      const data = (await res.json()) as { saveId: string };
      setLatestSaveId(data.saveId);
      setSaveIdInput(data.saveId);
      setStatus("存档完成");
    } catch (error) {
      setStatus(`存档失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async () => {
    if (!saveIdInput.trim() || busy) {
      return;
    }

    setBusy(true);
    setStatus("读档中...");
    try {
      const res = await fetch(`${API_BASE}/sessions/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveId: saveIdInput.trim() })
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
      setStoryFeed([`[已加载存档 ${saveIdInput.trim()}]`, state.currentNarrative]);
      setChoices(state.currentChoices);
      setProgress(state.progress);
      setStats(state.stats);
      setFlags(state.flags);
      setEvidencePool(state.evidencePool);
      setNpcRelations(state.npcRelations);
      setVerdictOutlook(state.verdictOutlook);
      setTurn(state.turn);
      setStreamingText("");
      streamingRef.current = "";
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
          <div className="col-span-8 grid gap-5">
            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
                  <Scale className="h-5 w-5 text-cyan-300" />
                  案情导入
                </CardTitle>
                <CardDescription className="text-slate-400">重生法庭悬疑模拟：你知道真相，但必须让证据先于记忆发声。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  {CASE_BRIEF.map((line) => (
                    <p key={line} className="rounded-md border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm leading-relaxed text-slate-200">
                      {line}
                    </p>
                  ))}
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.16em] text-slate-400">玩家代号</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={busy}
                      className="border-cyan-400/25 bg-slate-900/70 text-slate-100 placeholder:text-slate-500"
                    />
                  </div>

                  <Button
                    className="h-10 self-end bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                    onClick={handleInit}
                    disabled={busy}
                  >
                    <BrainCircuit className="h-4 w-4" />
                    {initialized ? "重开案件" : "进入庭审"}
                  </Button>
                </div>

                <p className="text-xs text-slate-500">系统默认：{DEFAULT_ROLE} · 专长：{DEFAULT_TALENT}</p>
              </CardContent>
            </Card>

            <Card className="tech-panel border-cyan-300/25 bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
                  <BookOpenText className="h-5 w-5 text-cyan-300" />
                  庭审记录流
                </CardTitle>
                <CardDescription className="text-slate-400">SSE 流式叙事，实时显示本轮攻防进展。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="story-scroll max-h-[470px] space-y-3 overflow-y-auto pr-1">
                  {!initialized ? (
                    <article className="story-card border-dashed border-cyan-300/35 bg-cyan-500/10 text-cyan-100">
                      点击“进入庭审”后，这里会开始输出案件叙事与法庭攻防过程。
                    </article>
                  ) : null}

                  {storyFeed.map((item, index) => (
                    <article key={`${index}-${item.slice(0, 8)}`} className="story-card text-slate-100">
                      <p className="whitespace-pre-line">{item}</p>
                    </article>
                  ))}

                  {streamingText ? (
                    <article className="story-card story-card-live text-slate-100">
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
                <CardDescription className="text-slate-400">每个策略会影响证据完整度、司法信任与舆情风险。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {choices.map((choice) => (
                    <button
                      key={choice.id}
                      className={cn(
                        "group relative min-h-[178px] overflow-hidden rounded-lg border border-cyan-300/20 bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-left transition",
                        "hover:-translate-y-0.5 hover:border-cyan-300/45 hover:shadow-[0_8px_28px_rgba(34,211,238,0.18)]",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                      onClick={() => handleChoice(choice.id)}
                      disabled={busy || !initialized}
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
                <p className="text-slate-300">事件：{lastEvents.length > 0 ? lastEvents.join(" / ") : "无"}</p>
                <ul className="list-disc space-y-1 pl-4 text-slate-300">
                  {lastStatChanges.length === 0 ? <li>暂无变化</li> : null}
                  {lastStatChanges.map((change) => (
                    <li key={change}>{change}</li>
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

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    value={saveIdInput}
                    onChange={(e) => setSaveIdInput(e.target.value)}
                    placeholder="输入 Save ID"
                    disabled={busy}
                    className="border-cyan-400/25 bg-slate-900/70 text-slate-100"
                  />
                  <Button className="bg-cyan-500 text-slate-950 hover:bg-cyan-400" onClick={handleLoad} disabled={!saveIdInput.trim() || busy}>
                    读档
                  </Button>
                </div>

                {latestSaveId ? <p className="text-xs text-cyan-200">最近存档：{latestSaveId}</p> : null}
                {replayData ? (
                  <div className="space-y-1 rounded-md border border-slate-700/80 bg-slate-900/70 p-2 text-xs text-slate-300">
                    <p>总回合：{replayData.totalTurns}</p>
                    <p>总 Action：{replayData.tokenSummary.totalActions}</p>
                    <p>平均 Token/Action：{replayData.tokenSummary.avgPerAction}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
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

export default App;
