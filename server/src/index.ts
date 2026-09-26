import { config } from './config';
import { createApp } from './app';
import { prisma } from './db';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[pos] API listening on :${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: string) {
  console.log(`[pos] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force-exit if connections don't drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
