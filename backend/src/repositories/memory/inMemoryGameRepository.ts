import { v4 as uuidv4 } from "uuid";
import type { GameState, SaveSnapshot } from "../../types/game.js";
import type { GameRepository } from "../gameRepository.js";

const clone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

export class InMemoryGameRepository implements GameRepository {
  private sessions = new Map<string, GameState>();
  private saves = new Map<string, SaveSnapshot>();

  async createSessionId(): Promise<string> {
    return uuidv4();
  }

  async getSession(sessionId: string): Promise<GameState | undefined> {
    const state = this.sessions.get(sessionId);
    return state ? clone(state) : undefined;
  }

  async upsertSession(state: GameState): Promise<void> {
    this.sessions.set(state.sessionId, clone(state));
  }

  async createSave(sessionId: string, state: GameState): Promise<SaveSnapshot> {
    const snapshot: SaveSnapshot = {
      saveId: uuidv4(),
      sessionId,
      state: clone(state),
      createdAt: new Date().toISOString()
    };
    this.saves.set(snapshot.saveId, snapshot);
    return clone(snapshot);
  }

  async getSave(saveId: string): Promise<SaveSnapshot | undefined> {
    const snapshot = this.saves.get(saveId);
    return snapshot ? clone(snapshot) : undefined;
  }
}
