import { MongoClient } from "mongodb";
import type { GameRepository } from "../repositories/gameRepository.js";
import { InMemoryGameRepository } from "../repositories/memory/inMemoryGameRepository.js";
import { MongoGameRepository } from "../repositories/mongodb/mongoGameRepository.js";

export type RepositoryContext = {
  repository: GameRepository;
  mode: "memory" | "mongodb";
  close: () => Promise<void>;
};

export const createRepositoryContext = async (): Promise<RepositoryContext> => {
  const mongoUri = process.env.MONGODB_URI?.trim();
  const mongoDbName = process.env.MONGODB_DB_NAME?.trim() || "agentic_game";
  const strictMongo = process.env.MONGODB_STRICT === "true";

  if (!mongoUri) {
    return {
      repository: new InMemoryGameRepository(),
      mode: "memory",
      close: async () => {
        return;
      }
    };
  }

  try {
    const client = new MongoClient(mongoUri);
    await client.connect();

    const db = client.db(mongoDbName);
    const repository = new MongoGameRepository(db);

    return {
      repository,
      mode: "mongodb",
      close: async () => {
        await client.close();
      }
    };
  } catch (error) {
    if (strictMongo) {
      throw error;
    }

    // eslint-disable-next-line no-console
    console.warn("MongoDB connection failed, fallback to in-memory repository.", error);
    return {
      repository: new InMemoryGameRepository(),
      mode: "memory",
      close: async () => {
        return;
      }
    };
  }
};
