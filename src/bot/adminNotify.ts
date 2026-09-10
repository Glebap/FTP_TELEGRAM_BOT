import type { Telegram } from 'telegraf';
import { env } from '../config/env.js';
import { formatLevel, getSportConfig } from '../config/sports.js';
import type { UserWithSports } from '../db/repositories/userRepository.js';
import { userRepository } from '../db/repositories/userRepository.js';
import { geoService } from '../services/geoService.js';
import { userService } from '../services/userService.js';
import { logger } from '../utils/logger.js';
import { escapeHtml } from '../utils/text.js';
import { telegramLink } from './keyboards/index.js';

/**
 * Tells the admins about a new player. Purely informational: a failure here
 * must never affect the person who just registered, so everything is caught.
 */
export function renderRegistrationNotice(user: UserWithSports, totalRegistered: number): string {
  const country = geoService.getCountry(user.countryCode);
  const link = telegramLink(user.telegramUsername);

  const lines = [
    '🆕 <b>Новый игрок</b>',
    '',
    // Same shape as a profile card, so the two read alike.
    `👤 <b>${escapeHtml(userService.displayNameOf(user))}${user.age ? `, ${user.age}` : ''}</b>`,
    `${country ? `${country.flag} ${country.name}` : '🌍 —'}${user.city ? ` · 📍 ${escapeHtml(user.city)}` : ''}`,
  ];

  for (const entry of user.sports) {
    const sport = getSportConfig(entry.sport.slug);
    const source = entry.levelSource === 'quiz' ? ' (по тесту)' : '';
    lines.push(`${sport.emoji} ${sport.title} — ${formatLevel(entry.sport.slug, entry.level)}${source}`);
  }

  lines.push(
    `📷 Фото: ${user.photoFileId ? 'есть' : 'нет'} · ✍️ О себе: ${user.about ? 'есть' : 'нет'}`,
  );

  if (link) {
    lines.push('', `<a href="${link}">Открыть чат</a>`);
  } else {
    lines.push('', '<i>username скрыт</i>');
  }

  lines.push('', `Всего игроков с профилем: <b>${totalRegistered}</b>`);
  return lines.join('\n');
}

export async function notifyAdminsAboutRegistration(
  telegram: Telegram,
  user: UserWithSports,
): Promise<void> {
  if (!env.ADMIN_NOTIFY || env.ADMIN_IDS.length === 0) return;

  try {
    const totalRegistered = await userRepository.countRegistered();
    const text = renderRegistrationNotice(user, totalRegistered);

    for (const adminId of env.ADMIN_IDS) {
      // An admin who never opened the bot cannot be written to; skip quietly.
      if (adminId === user.telegramId) continue;

      await telegram
        .sendMessage(Number(adminId), text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        })
        .catch((error: unknown) => {
          logger.warn({ err: error, adminId: String(adminId) }, 'Could not notify admin');
        });
    }
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'Admin notification failed');
  }
}
