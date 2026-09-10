import { Composer } from 'telegraf';
import { notificationsConfig } from '../../config/notifications.js';
import { digestService } from '../../services/digestService.js';
import { userService } from '../../services/userService.js';
import { showMainMenu, showWelcome } from '../flow.js';
import { deleteConfirmKeyboard, removeKeyboard, settingsKeyboard } from '../keyboards/index.js';
import type { BotContext } from '../session.js';
import { createEmptySession, resetFlow } from '../session.js';
import { ack, screen, send } from '../ui.js';
import { startSearch } from './search.js';

export const settingsHandler = new Composer<BotContext>();

function settingsView(ctx: BotContext): { text: string; isActive: boolean; notify: boolean } {
  const isActive = ctx.dbUser.isActive;
  const notify = ctx.dbUser.notifyNewPlayers;

  const visibility = isActive
    ? '👁 Профиль виден другим игрокам.'
    : '🙈 Профиль скрыт — вас не показывают в поиске.';

  const times = notificationsConfig.times.join(' и ');
  const notifications = notify
    ? `🔔 Уведомления включены: бот напишет в ${times}, если в вашем городе появятся новые игроки.`
    : '🔕 Уведомления о новых игроках отключены.';

  return {
    text: ['⚙️ <b>Настройки</b>', '', visibility, '', notifications].join('\n'),
    isActive,
    notify,
  };
}

export async function openSettings(ctx: BotContext): Promise<void> {
  if (!userService.isRegistered(ctx.dbUser)) {
    await showWelcome(ctx);
    return;
  }

  const view = settingsView(ctx);
  await screen(
    ctx,
    view.text,
    settingsKeyboard({ isActive: view.isActive, notifyNewPlayers: view.notify }),
  );
}

settingsHandler.action('settings:hide', async (ctx) => {
  await ack(ctx);
  await userService.setActive(ctx.dbUser.id, false);
  ctx.dbUser.isActive = false;
  await openSettings(ctx);
});

settingsHandler.action('settings:show', async (ctx) => {
  await ack(ctx);
  await userService.setActive(ctx.dbUser.id, true);
  ctx.dbUser.isActive = true;
  await openSettings(ctx);
});

/* ------------------------------------------------------ notifications ----- */

settingsHandler.action('settings:notify_off', async (ctx) => {
  await ack(ctx, 'Уведомления отключены');
  await digestService.setEnabled(ctx.dbUser.id, false);
  ctx.dbUser.notifyNewPlayers = false;
  await openSettings(ctx);
});

settingsHandler.action('settings:notify_on', async (ctx) => {
  await ack(ctx, 'Уведомления включены');
  await digestService.setEnabled(ctx.dbUser.id, true);
  ctx.dbUser.notifyNewPlayers = true;
  await openSettings(ctx);
});

/** "Не присылать" straight from a digest message. */
settingsHandler.action('digest:mute', async (ctx) => {
  await ack(ctx, 'Больше не пишем');
  await digestService.setEnabled(ctx.dbUser.id, false);
  ctx.dbUser.notifyNewPlayers = false;
  await screen(
    ctx,
    '🔕 Больше не буду писать о новых игроках.\n\nВключить обратно можно в «⚙️ Настройки».',
  );
});

/** "Посмотреть" from a digest message goes straight into the search. */
settingsHandler.action('digest:open', async (ctx) => {
  await ack(ctx);
  if (ctx.callbackQuery) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await startSearch(ctx);
});

/* ------------------------------------------------------------- delete ----- */

settingsHandler.action('settings:delete', async (ctx) => {
  await ack(ctx);
  await screen(
    ctx,
    [
      '🗑 <b>Удалить профиль?</b>',
      '',
      'Будут удалены ваши данные, история просмотров и контакты. Это действие нельзя отменить.',
    ].join('\n'),
    deleteConfirmKeyboard(),
  );
});

settingsHandler.action('settings:delete_confirm', async (ctx) => {
  await ack(ctx);
  const userId = ctx.dbUser.id;

  await userService.deleteAccount(userId);
  ctx.session = createEmptySession();

  await screen(ctx, 'Профиль удалён. Если захотите вернуться — просто наберите /start.');
  await send(ctx, 'До встречи! 👋', removeKeyboard());
});

settingsHandler.action('settings:cancel', async (ctx) => {
  await ack(ctx);
  resetFlow(ctx.session);
  await openSettings(ctx);
});

settingsHandler.action('settings:menu', async (ctx) => {
  await ack(ctx);
  await showMainMenu(ctx);
});
