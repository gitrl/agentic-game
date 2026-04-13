import type { GameState, SaveSnapshot } from "../types/game.js";

export type GameRepository = {
  createSessionId(): Promise<string>;
  getSession(sessionId: string): Promise<GameState | undefined>;
  upsertSession(state: GameState): Promise<void>;
  createSave(sessionId: string, state: GameState): Promise<SaveSnapshot>;
  getSave(saveId: string): Promise<SaveSnapshot | undefined>;
};
