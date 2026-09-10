import { Telegraf, session } from 'telegraf';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { adminHandler } from './handlers/admin.js';
import { inputHandler } from './handlers/input.js';
import { profileHandler } from './handlers/profile.js';
import { quizHandler } from './handlers/quiz.js';
import { registrationHandler } from './handlers/registration.js';
import { searchHandler } from './handlers/search.js';
import { settingsHandler } from './handlers/settings.js';
import { startHandler } from './handlers/start.js';
import { attachUser } from './middlewares/attachUser.js';
import { errorBoundary, logBotError } from './middlewares/errorHandler.js';
import { throttleUpdates } from './middlewares/rateLimit.js';
import { createEmptySession, sessionStore, type BotContext } from './session.js';
import { ack } from './ui.js';

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN, {
    handlerTimeout: 60_000,
  });

  // Order matters: errors first, then throttling, session, user, handlers.
  bot.use(errorBoundary);
  bot.use(throttleUpdates);
  bot.use(
    session({
      store: sessionStore,
      defaultSession: createEmptySession,
      getSessionKey: (ctx) => (ctx.from ? `user:${ctx.from.id}` : undefined),
    }),
  );
  bot.use(attachUser);

  bot.use(adminHandler);
  bot.use(startHandler);
  bot.use(registrationHandler);
  bot.use(quizHandler);
  bot.use(searchHandler);
  bot.use(profileHandler);
  bot.use(settingsHandler);
  bot.use(inputHandler);

  // Any inline button we no longer know about (old message, changed flow).
  bot.on('callback_query', async (ctx) => {
    await ack(ctx, 'Эта кнопка больше не активна');
    logger.debug({ update: ctx.update }, 'Unhandled callback query');
  });

  bot.catch((error, ctx) => {
    logBotError(error, { updateType: ctx.updateType, telegramId: ctx.from?.id });
  });

  return bot;
}

export async function registerBotCommands(bot: Telegraf<BotContext>): Promise<void> {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Начать / главное меню' },
    { command: 'menu', description: 'Главное меню' },
    { command: 'help', description: 'Что умеет бот' },
    { command: 'cancel', description: 'Отменить текущее действие' },
  ]);
}
