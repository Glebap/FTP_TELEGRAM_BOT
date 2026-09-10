import { env } from './env.js';

/**
 * Twice-a-day digest about new players in the user's city.
 *
 * Everything about when and how often the bot writes first lives here, so the
 * schedule can be tuned without touching the sending logic.
 */
export const notificationsConfig = {
  enabled: env.DIGEST_ENABLED,
  /** Local times of day, "HH:MM", in `timezone`. */
  times: env.DIGEST_TIMES,
  timezone: env.DIGEST_TIMEZONE,
  /** Do not write for a single new player unless this is 1. */
  minNewPlayers: 1,
  /** Pause between messages so the broadcast stays inside Telegram's limits. */
  sendDelayMs: 60,
  /**
   * A player who registered longer ago than this is never called "new", even
   * if the user has never received a digest.
   */
  maxLookbackDays: 14,
};

/** Cron expressions derived from the configured times. */
export function digestCronExpressions(): string[] {
  return notificationsConfig.times.map((time) => {
    const [hours, minutes] = time.split(':');
    return `${Number(minutes)} ${Number(hours)} * * *`;
  });
}
