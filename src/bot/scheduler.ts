import cron, { type ScheduledTask } from 'node-cron';
import type { Telegram } from 'telegraf';
import { digestCronExpressions, notificationsConfig } from '../config/notifications.js';
import { logger } from '../utils/logger.js';
import { runDigest, type DigestRunResult } from './digest.js';

/** Prevents two overlapping runs if a broadcast takes longer than expected. */
let running = false;

async function runOnce(
  telegram: Telegram,
  trigger: string,
): Promise<DigestRunResult | null> {
  if (running) {
    logger.warn({ trigger }, 'Digest run skipped: previous run still in progress');
    return null;
  }

  running = true;
  try {
    logger.info({ trigger }, 'Digest run started');
    return await runDigest(telegram);
  } catch (error) {
    // A failed broadcast must never take the bot down.
    logger.error({ err: error, trigger }, 'Digest run failed');
    return null;
  } finally {
    running = false;
  }
}

/**
 * Schedules the "new players in your city" digest (default 10:00 and 19:00,
 * Europe/Chisinau). Returns the tasks so the caller can stop them on shutdown.
 */
export function startScheduler(telegram: Telegram): ScheduledTask[] {
  if (!notificationsConfig.enabled) {
    logger.info('Digest scheduler disabled (DIGEST_ENABLED=false)');
    return [];
  }

  const expressions = digestCronExpressions();
  if (expressions.length === 0) {
    logger.warn('Digest scheduler has no times configured');
    return [];
  }

  const tasks = expressions.map((expression, index) =>
    cron.schedule(
      expression,
      () => {
        void runOnce(telegram, `cron:${notificationsConfig.times[index] ?? expression}`);
      },
      { timezone: notificationsConfig.timezone },
    ),
  );

  logger.info(
    { times: notificationsConfig.times, timezone: notificationsConfig.timezone },
    'Digest scheduler started',
  );
  return tasks;
}

/** Manual trigger used by the admin command. */
export async function triggerDigestNow(
  telegram: Telegram,
): Promise<DigestRunResult | null> {
  return runOnce(telegram, 'manual');
}
