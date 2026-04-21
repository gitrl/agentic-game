import type { GameState, SaveListItem, SaveSnapshot } from "../types/game.js";

export type GameRepository = {
  createSessionId(): Promise<string>;
  getSession(sessionId: string): Promise<GameState | undefined>;
  upsertSession(state: GameState): Promise<void>;
  createSave(sessionId: string, state: GameState, label: string): Promise<SaveSnapshot>;
  getSave(saveId: string): Promise<SaveSnapshot | undefined>;
  listSaves(sessionId: string): Promise<SaveListItem[]>;
  deleteSave(saveId: string): Promise<void>;
};
