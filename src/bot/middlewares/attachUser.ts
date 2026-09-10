import type { MiddlewareFn } from 'telegraf';
import { userService } from '../../services/userService.js';
import { logger } from '../../utils/logger.js';
import type { BotContext } from '../session.js';

/**
 * Loads (or creates) the DB user for every update and exposes it as
 * `ctx.dbUser`, so handlers never touch the repository layer directly.
 */
export const attachUser: MiddlewareFn<BotContext> = async (ctx, next) => {
  const from = ctx.from;
  if (!from || from.is_bot) return;

  ctx.dbUser = await userService.ensureUser({
    telegramId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    firstName: from.first_name ?? null,
  });

  if (ctx.dbUser.isBlocked) {
    logger.warn({ userId: ctx.dbUser.id }, 'Blocked user tried to use the bot');
    await ctx.reply('Доступ к боту ограничен. Напишите администратору, если это ошибка.');
    return;
  }

  return next();
};
