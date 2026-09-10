import type { MiddlewareFn } from 'telegraf';
import { env } from '../../config/env.js';
import type { BotContext } from '../session.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Global per-user throttle. Generous on purpose: a person tapping quickly
 * through the quiz produces a burst of updates, and only a runaway client
 * should ever hit this.
 */
export const throttleConfig = {
  updatesPerWindow: 90,
  windowMs: 10_000,
};

/** Drops all counters. Used by tests, which replay hundreds of taps at once. */
export function resetQuotas(): void {
  buckets.clear();
}

/**
 * Sliding-window-ish counter kept in memory. Enough for the MVP: it protects
 * against a single user hammering the search, while the durable contact limits
 * live in ContactService (ТЗ §34).
 */
export function consumeQuota(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Drops expired buckets so the map cannot grow without bound. */
export function startRateLimitCleanup(intervalMs = 300_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

/** Global per-user throttle applied to every update. */
export const throttleUpdates: MiddlewareFn<BotContext> = async (ctx, next) => {
  const from = ctx.from;
  if (!from) return next();

  if (
    !consumeQuota(
      `update:${from.id}`,
      throttleConfig.updatesPerWindow,
      throttleConfig.windowMs,
    )
  ) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Слишком много действий, подождите пару секунд').catch(() => {});
    }
    return;
  }

  return next();
};

export function checkSearchQuota(telegramId: number): boolean {
  return consumeQuota(`search:${telegramId}`, env.SEARCH_LIMIT_PER_MINUTE, 60_000);
}
