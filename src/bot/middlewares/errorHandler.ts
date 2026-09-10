import type { MiddlewareFn } from 'telegraf';
import { TelegramError } from 'telegraf';
import { logger } from '../../utils/logger.js';
import type { BotContext } from '../session.js';

/**
 * Telegram API errors that are expected during normal operation and must not
 * be surfaced to the user (ТЗ §30, §45).
 */
function isBenignTelegramError(error: unknown): boolean {
  if (!(error instanceof TelegramError)) return false;
  const description = error.description ?? '';
  return (
    description.includes('message is not modified') ||
    description.includes('query is too old') ||
    description.includes('message to edit not found') ||
    description.includes('message to delete not found') ||
    description.includes('MESSAGE_ID_INVALID')
  );
}

export const errorBoundary: MiddlewareFn<BotContext> = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    if (isBenignTelegramError(error)) {
      logger.debug({ err: error }, 'Ignored benign Telegram error');
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      return;
    }

    logger.error(
      { err: error, updateType: ctx.updateType, telegramId: ctx.from?.id },
      'Unhandled error while processing update',
    );

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Произошла ошибка, попробуйте ещё раз').catch(() => {});
    }
    await ctx
      .reply('😔 Что-то пошло не так. Попробуйте ещё раз или наберите /start.')
      .catch(() => {});
  }
};

/** Last-resort handler for errors thrown outside the middleware chain. */
export function logBotError(error: unknown, context?: unknown): void {
  logger.error({ err: error, context }, 'Bot-level error');
}
