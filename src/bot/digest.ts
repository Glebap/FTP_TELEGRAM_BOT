import { Markup, TelegramError, type Telegram } from 'telegraf';
import { notificationsConfig } from '../config/notifications.js';
import { getSportConfig } from '../config/sports.js';
import { digestService, type DigestItem } from '../services/digestService.js';
import { logger } from '../utils/logger.js';
import { escapeHtml, pluralizeRu } from '../utils/text.js';

export interface DigestRunResult {
  candidates: number;
  sent: number;
  failed: number;
  optedOut: number;
}

function digestKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎾 Посмотреть', 'digest:open')],
    [Markup.button.callback('🔕 Не присылать', 'digest:mute')],
  ]);
}

export function renderDigest(item: DigestItem): string {
  const players = pluralizeRu(item.total, 'новый игрок', 'новых игрока', 'новых игроков');
  const city = item.user.city ? ` в ${escapeHtml(item.user.city)}` : '';
  const single = item.sports.length === 1 ? item.sports[0] : null;

  const lines: string[] = [];

  if (single) {
    const sport = getSportConfig(single.sportSlug);
    lines.push(`${sport.emoji} <b>${item.total} ${players}${city}</b>`);
    if (single.sampleNames.length > 0) {
      lines.push('', single.sampleNames.map((name) => escapeHtml(name)).join(', '));
    }
  } else {
    // Several sports: one line each, so the numbers stay readable.
    lines.push(`🏆 <b>${item.total} ${players}${city}</b>`, '');
    for (const entry of item.sports) {
      const sport = getSportConfig(entry.sportSlug);
      const names =
        entry.sampleNames.length > 0
          ? ` — ${entry.sampleNames.map((name) => escapeHtml(name)).join(', ')}`
          : '';
      lines.push(`${sport.emoji} ${sport.title}: ${entry.newPlayers}${names}`);
    }
  }

  lines.push('', 'Загляните в поиск — возможно, это ваш партнёр по игре.');
  return lines.join('\n');
}

/** True when Telegram says this chat can no longer be written to. */
function isUnreachable(error: unknown): boolean {
  if (!(error instanceof TelegramError)) return false;
  const description = error.description ?? '';
  return (
    error.code === 403 ||
    description.includes('bot was blocked') ||
    description.includes('user is deactivated') ||
    description.includes('chat not found')
  );
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Sends one round of digests. Failures never abort the run: a user who blocked
 * the bot simply gets unsubscribed.
 */
export async function runDigest(telegram: Telegram): Promise<DigestRunResult> {
  const items = await digestService.collectDigests();
  const result: DigestRunResult = {
    candidates: items.length,
    sent: 0,
    failed: 0,
    optedOut: 0,
  };

  for (const item of items) {
    try {
      await telegram.sendMessage(Number(item.user.telegramId), renderDigest(item), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: digestKeyboard().reply_markup,
      });
      await digestService.markSent(item.user.id, item.coveredUntil);
      result.sent += 1;
    } catch (error) {
      if (isUnreachable(error)) {
        await digestService.setEnabled(item.user.id, false);
        result.optedOut += 1;
        logger.info({ userId: item.user.id }, 'Digest disabled: chat unreachable');
      } else {
        result.failed += 1;
        logger.warn({ err: error, userId: item.user.id }, 'Failed to send digest');
      }
    }

    if (notificationsConfig.sendDelayMs > 0) await pause(notificationsConfig.sendDelayMs);
  }

  logger.info(result, 'Digest run finished');
  return result;
}
