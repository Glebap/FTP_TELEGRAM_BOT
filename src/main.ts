import { createBot, registerBotCommands } from './bot/index.js';
import { startRateLimitCleanup } from './bot/middlewares/rateLimit.js';
import { startScheduler } from './bot/scheduler.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/client.js';
import { sportRepository } from './db/repositories/sportRepository.js';
import { DEFAULT_SPORT_SLUG } from './config/sports.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await connectDatabase();

  // Fail fast with a clear message instead of breaking on the first search.
  await sportRepository.requireBySlug(DEFAULT_SPORT_SLUG);

  const bot = createBot();
  startRateLimitCleanup();
  // Twice-a-day "new players in your city" digest.
  const scheduledTasks = startScheduler(bot.telegram);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    for (const task of scheduledTasks) task.stop();
    bot.stop(signal);
    await disconnectDatabase();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });

  await registerBotCommands(bot).catch((error: unknown) => {
    logger.warn({ err: error }, 'Could not register bot commands');
  });

  logger.info({ env: env.NODE_ENV }, 'Starting bot (long polling)');
  await bot.launch({ dropPendingUpdates: true }, () => {
    logger.info('Bot is running');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal startup error');
  process.exit(1);
});
