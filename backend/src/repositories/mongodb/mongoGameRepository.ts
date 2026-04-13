import { v4 as uuidv4 } from "uuid";
import type { Collection, Db } from "mongodb";
import type { GameState, SaveSnapshot } from "../../types/game.js";
import type { GameRepository } from "../gameRepository.js";

type SessionDocument = {
  _id: string;
  state: GameState;
  updatedAt: string;
};

type SaveDocument = {
  _id: string;
  sessionId: string;
  state: GameState;
  createdAt: string;
};

const clone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

export class MongoGameRepository implements GameRepository {
  private sessions: Collection<SessionDocument>;
  private saves: Collection<SaveDocument>;

  constructor(db: Db) {
    this.sessions = db.collection<SessionDocument>("sessions");
    this.saves = db.collection<SaveDocument>("saves");
  }

  async createSessionId(): Promise<string> {
    return uuidv4();
  }

  async getSession(sessionId: string): Promise<GameState | undefined> {
    const doc = await this.sessions.findOne({ _id: sessionId });
    return doc ? clone(doc.state) : undefined;
  }

  async upsertSession(state: GameState): Promise<void> {
    await this.sessions.updateOne(
      { _id: state.sessionId },
      {
        $set: {
          state: clone(state),
          updatedAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
  }

  async createSave(sessionId: string, state: GameState): Promise<SaveSnapshot> {
    const doc: SaveDocument = {
      _id: uuidv4(),
      sessionId,
      state: clone(state),
      createdAt: new Date().toISOString()
    };

    await this.saves.insertOne(doc);

    return {
      saveId: doc._id,
      sessionId: doc.sessionId,
      state: clone(doc.state),
      createdAt: doc.createdAt
    };
  }

  async getSave(saveId: string): Promise<SaveSnapshot | undefined> {
    const doc = await this.saves.findOne({ _id: saveId });
    if (!doc) {
      return undefined;
    }

    return {
      saveId: doc._id,
      sessionId: doc.sessionId,
      state: clone(doc.state),
      createdAt: doc.createdAt
    };
  }
}
