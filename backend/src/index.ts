import "./config/loadEnv.js";
import { createApp } from "./app.js";
import { createRepositoryContext } from "./config/repositoryFactory.js";
import { GameService } from "./services/gameService.js";

const PORT = Number(process.env.PORT ?? 4000);

const bootstrap = async () => {
  const repositoryContext = await createRepositoryContext();
  const gameService = new GameService(repositoryContext.repository);
  const app = createApp(gameService);

  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Backend listening on http://localhost:${PORT} (repository=${repositoryContext.mode})`
    );
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down backend...`);

    server.close(async () => {
      await repositoryContext.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
};

void bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Backend startup failed:", error);
  process.exit(1);
});
