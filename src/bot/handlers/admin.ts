import { Composer } from 'telegraf';
import { isAdmin } from '../../config/env.js';
import { notificationsConfig } from '../../config/notifications.js';
import { DEFAULT_SPORT_SLUG, formatLevelShort } from '../../config/sports.js';
import { digestService } from '../../services/digestService.js';
import { statsService } from '../../services/statsService.js';
import { userService } from '../../services/userService.js';
import { triggerDigestNow } from '../scheduler.js';
import type { BotContext } from '../session.js';
import { screen } from '../ui.js';

export const adminHandler = new Composer<BotContext>();

/** Admin commands (ТЗ §33). Access is limited to ADMIN_IDS from the env. */
adminHandler.command('admin', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    // Stay silent for non-admins so the command is not discoverable.
    return;
  }

  const stats = await statsService.getAdminStats();
  const histogram =
    stats.levelHistogram.length > 0
      ? stats.levelHistogram
          .map((row) => `  ${formatLevelShort(DEFAULT_SPORT_SLUG, row.level)} — ${row.count}`)
          .join('\n')
      : '  нет данных';

  await screen(
    ctx,
    [
      '🛠 <b>Статистика</b>',
      '',
      `👥 Всего пользователей: <b>${stats.totalUsers}</b>`,
      `✅ Завершили регистрацию: <b>${stats.registeredUsers}</b>`,
      `👁 Активных профилей: <b>${stats.activeProfiles}</b>`,
      `🙈 Скрытых профилей: <b>${stats.hiddenProfiles}</b>`,
      `📷 С фотографией: <b>${stats.withPhoto}</b>`,
      '',
      `🆕 Новых за сутки: <b>${stats.newUsersToday}</b>`,
      `🆕 Новых за неделю: <b>${stats.newUsersWeek}</b>`,
      '',
      `🔍 Поисков всего: <b>${stats.searches}</b> (за сутки: ${stats.searchesToday})`,
      `🃏 Просмотров карточек: <b>${stats.profileViews}</b>`,
      `💬 Контактов: <b>${stats.contacts}</b>`,
      `🎯 Пройденных тестов: <b>${stats.quizAttempts}</b>`,
      '',
      '<b>Уровни игроков</b>',
      histogram,
    ].join('\n'),
  );
});

/** Dry run: shows who would be notified without sending anything. */
adminHandler.command('digest_preview', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;

  const items = await digestService.collectDigests();
  const lines = [
    '📬 <b>Рассылка — предпросмотр</b>',
    '',
    `Расписание: ${notificationsConfig.times.join(', ')} (${notificationsConfig.timezone})`,
    `Включена: ${notificationsConfig.enabled ? 'да' : 'нет'}`,
    '',
    `Получателей сейчас: <b>${items.length}</b>`,
  ];

  for (const item of items.slice(0, 20)) {
    const name = userService.displayNameOf(item.user);
    lines.push(`• ${name} (${item.user.city ?? '—'}): ${item.total}`);
  }
  if (items.length > 20) lines.push(`… и ещё ${items.length - 20}`);

  await screen(ctx, lines.join('\n'));
});

/** Sends the digest immediately, outside the schedule. */
adminHandler.command('digest_send', async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;

  await screen(ctx, '📬 Запускаю рассылку…');
  const result = await triggerDigestNow(ctx.telegram);

  if (!result) {
    await screen(ctx, 'Рассылка уже выполняется — попробуйте позже.');
    return;
  }

  await screen(
    ctx,
    [
      '📬 <b>Рассылка завершена</b>',
      '',
      `Кандидатов: ${result.candidates}`,
      `Отправлено: ${result.sent}`,
      `Ошибок: ${result.failed}`,
      `Отписано (бот заблокирован): ${result.optedOut}`,
    ].join('\n'),
  );
});
