import { Composer } from 'telegraf';
import { eventRepository } from '../../db/repositories/eventRepository.js';
import { userService } from '../../services/userService.js';
import { showMainMenu, showWelcome } from '../flow.js';
import { mainMenuKeyboard } from '../keyboards/index.js';
import type { BotContext } from '../session.js';
import { resetFlow } from '../session.js';
import { screen } from '../ui.js';

export const startHandler = new Composer<BotContext>();

startHandler.start(async (ctx) => {
  resetFlow(ctx.session);
  delete ctx.session.search;

  if (userService.isRegistered(ctx.dbUser)) {
    await showMainMenu(ctx, 'С возвращением! Выбирайте, что дальше 👇');
    return;
  }

  eventRepository.track('registration_started', ctx.dbUser.id);
  await showWelcome(ctx);
});

startHandler.command('menu', async (ctx) => {
  if (!userService.isRegistered(ctx.dbUser)) {
    await showWelcome(ctx);
    return;
  }
  await showMainMenu(ctx);
});

startHandler.command('cancel', async (ctx) => {
  resetFlow(ctx.session);
  delete ctx.session.search;
  if (!userService.isRegistered(ctx.dbUser)) {
    await showWelcome(ctx);
    return;
  }
  await showMainMenu(ctx, 'Отменено.');
});

startHandler.command('help', async (ctx) => {
  await screen(
    ctx,
    [
      '<b>Что умеет бот</b>',
      '',
      '🎾 <b>Найти партнёра</b> — показывает подходящих игроков по одному.',
      '👤 <b>Мой профиль</b> — посмотреть и изменить свои данные.',
      '💬 <b>Мои контакты</b> — игроки, которым вы уже писали.',
      '⚙️ <b>Настройки</b> — скрыть профиль или удалить аккаунт.',
      '',
      'Команды: /start, /menu, /cancel, /help',
    ].join('\n'),
    userService.isRegistered(ctx.dbUser) ? mainMenuKeyboard() : undefined,
  );
});
