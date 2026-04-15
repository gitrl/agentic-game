import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import type { GameState, SaveSnapshot } from "../../types/game.js";
import type { GameRepository } from "../gameRepository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../../../data");
const SESSIONS_DIR = resolve(DATA_DIR, "sessions");
const SAVES_DIR = resolve(DATA_DIR, "saves");

async function ensureDirs(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(SAVES_DIR, { recursive: true });
}

function sessionPath(sessionId: string): string {
  return resolve(SESSIONS_DIR, `${sessionId}.json`);
}

function savePath(saveId: string): string {
  return resolve(SAVES_DIR, `${saveId}.json`);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class FileGameRepository implements GameRepository {
  private ready: Promise<void>;

  constructor() {
    this.ready = ensureDirs();
  }

  async createSessionId(): Promise<string> {
    await this.ready;
    return uuidv4();
  }

  async getSession(sessionId: string): Promise<GameState | undefined> {
    await this.ready;
    return readJson<GameState>(sessionPath(sessionId));
  }

  async upsertSession(state: GameState): Promise<void> {
    await this.ready;
    await writeJson(sessionPath(state.sessionId), state);
  }

  async createSave(sessionId: string, state: GameState): Promise<SaveSnapshot> {
    await this.ready;
    const snapshot: SaveSnapshot = {
      saveId: uuidv4(),
      sessionId,
      state: JSON.parse(JSON.stringify(state)) as GameState,
      createdAt: new Date().toISOString()
    };
    await writeJson(savePath(snapshot.saveId), snapshot);
    return snapshot;
  }

  async getSave(saveId: string): Promise<SaveSnapshot | undefined> {
    await this.ready;
    return readJson<SaveSnapshot>(savePath(saveId));
  }
}
