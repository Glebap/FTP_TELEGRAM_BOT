import { Composer } from 'telegraf';
import { matchingConfig, type MatchScope } from '../../config/matching.js';
import { getSportConfig } from '../../config/sports.js';
import { eventRepository } from '../../db/repositories/eventRepository.js';
import { userRepository } from '../../db/repositories/userRepository.js';
import { contactService } from '../../services/contactService.js';
import { matchingService } from '../../services/matchingService.js';
import { userService } from '../../services/userService.js';
import { showMainMenu, showWelcome } from '../flow.js';
import {
  contactKeyboard,
  emptySearchKeyboard,
  playerCardKeyboard,
  searchSportKeyboard,
} from '../keyboards/index.js';
import { checkSearchQuota } from '../middlewares/rateLimit.js';
import type { BotContext } from '../session.js';
import { ack, screen, send } from '../ui.js';
import { escapeHtml } from '../../utils/text.js';
import { profileFromUser, renderMatchCard } from '../views/profileView.js';

export const searchHandler = new Composer<BotContext>();

/** Sport the current search runs for: the chosen one, else the primary. */
function activeSportSlug(ctx: BotContext): string {
  const chosen = ctx.session.search?.sportSlug;
  if (chosen && userService.playsSport(ctx.dbUser, chosen)) return chosen;
  return userService.primarySportSlug(ctx.dbUser);
}

async function requireRegistration(ctx: BotContext): Promise<boolean> {
  if (userService.isRegistered(ctx.dbUser)) return true;
  // Search is closed to unregistered users (ТЗ §45).
  await screen(ctx, 'Сначала создайте профиль — это займёт пару минут.');
  await showWelcome(ctx);
  return false;
}

/** Loads the next batch of ranked candidates into the session queue. */
async function refillQueue(
  ctx: BotContext,
  sportSlug: string,
  scope: MatchScope,
): Promise<number[]> {
  const candidates = await matchingService.findCandidates({
    viewer: ctx.dbUser,
    sportSlug,
    scope,
  });
  return candidates.map((candidate) => candidate.user.id);
}

async function showEmptyResult(
  ctx: BotContext,
  sportSlug: string,
  scope: MatchScope,
): Promise<void> {
  const viewed = await matchingService.countViewed(ctx.dbUser.id, sportSlug);
  const sport = getSportConfig(sportSlug);
  const city = ctx.dbUser.city;
  // Offering to leave the city only makes sense while the search is limited.
  const canExpand = scope === 'city' && Boolean(city);

  const where = scope === 'city' && city ? ` в ${escapeHtml(city)}` : '';
  const lines = [`${sport.emoji} <b>Больше некого показать${where}</b>`, ''];

  if (viewed > 0) {
    lines.push(
      city && scope === 'city'
        ? `Вы посмотрели всех подходящих игроков в ${escapeHtml(city)}.`
        : 'Вы посмотрели всех подходящих игроков.',
    );
  } else {
    lines.push(
      city && scope === 'city'
        ? `В ${escapeHtml(city)} пока нет подходящих игроков по ${sport.title.toLowerCase()}.`
        : 'Подходящих игроков пока нет.',
    );
  }

  if (canExpand) {
    lines.push('', 'Можно посмотреть игроков из других городов — но играть с ними будет сложнее.');
  }
  if (!city) {
    lines.push('', '💡 Укажите город в профиле — так бот найдёт игроков рядом.');
  }
  if (!ctx.dbUser.isActive) {
    lines.push('', '🙈 Ваш профиль скрыт, другие игроки вас не видят.');
  }

  await screen(ctx, lines.join('\n'), emptySearchKeyboard({ hasViewed: viewed > 0, canExpand }));
}

/** Renders the current candidate and marks them as seen (ТЗ §19, §20). */
async function showNextCandidate(ctx: BotContext): Promise<void> {
  const sportSlug = activeSportSlug(ctx);
  const state = ctx.session.search ?? { sportSlug, queue: [] };
  ctx.session.search = state;
  state.sportSlug = sportSlug;

  const scope = state.scope ?? matchingConfig.defaultScope;
  if (state.queue.length === 0) {
    state.queue = await refillQueue(ctx, sportSlug, scope);
  }

  let candidate: Awaited<ReturnType<typeof userRepository.findById>> = null;
  while (state.queue.length > 0 && !candidate) {
    const nextId = state.queue.shift();
    if (nextId === undefined) break;
    const found = await userRepository.findById(nextId);
    // The profile may have been hidden or deleted since the queue was built.
    if (found && found.isActive && found.isRegistered && !found.isBlocked) {
      candidate = found;
    }
  }

  if (!candidate) {
    delete state.currentUserId;
    await showEmptyResult(ctx, sportSlug, scope);
    return;
  }

  state.currentUserId = candidate.id;

  // Recorded on display, so an abandoned search never repeats a profile.
  await matchingService.recordAction({
    viewerId: ctx.dbUser.id,
    viewedUserId: candidate.id,
    sportSlug,
    action: 'view',
  });

  const card = renderMatchCard(profileFromUser(candidate, sportSlug));
  const keyboard = playerCardKeyboard(candidate.telegramUsername);

  if (ctx.callbackQuery) await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (candidate.photoFileId) {
    try {
      await ctx.replyWithPhoto(candidate.photoFileId, {
        caption: card,
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
      return;
    } catch {
      // A stale file_id must not break the search — fall back to text.
    }
  }

  await send(ctx, card, keyboard);
}

/** Runs the search for one sport, from the first candidate. */
async function searchSport(
  ctx: BotContext,
  sportSlug: string,
  scope: MatchScope = matchingConfig.defaultScope,
): Promise<void> {
  eventRepository.track('search', ctx.dbUser.id, sportSlug);
  ctx.session.search = { sportSlug, scope, queue: [] };
  await showNextCandidate(ctx);
}

export async function startSearch(ctx: BotContext): Promise<void> {
  if (!(await requireRegistration(ctx))) return;

  const from = ctx.from;
  if (from && !checkSearchQuota(from.id)) {
    await screen(ctx, 'Слишком много запросов поиска. Попробуйте через минуту.');
    return;
  }

  // Playing several sports means the search has to know which one to look for.
  const slugs = userService.sportSlugs(ctx.dbUser);
  if (slugs.length > 1) {
    await screen(
      ctx,
      '🏆 <b>По какому виду спорта искать?</b>',
      searchSportKeyboard(
        slugs.map((slug) => {
          const sport = getSportConfig(slug);
          return { slug, label: `${sport.emoji} ${sport.title}` };
        }),
      ),
    );
    return;
  }

  await searchSport(ctx, activeSportSlug(ctx));
}

searchHandler.action(/^search:sport:([a-z_]+)$/, async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;

  const slug = ctx.match[1];
  if (!slug || !userService.playsSport(ctx.dbUser, slug)) {
    await screen(ctx, 'Этот вид спорта не в вашем профиле.');
    return;
  }
  await searchSport(ctx, slug);
});

/** Explicitly widens the search beyond the user's city. */
searchHandler.action('search:expand', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;

  const sportSlug = activeSportSlug(ctx);
  // Everyone already seen inside the city stays excluded, so the widened
  // search continues where the local one stopped.
  await searchSport(ctx, sportSlug, 'any');
});

searchHandler.action('search:next', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;

  const state = ctx.session.search;
  if (state?.currentUserId) {
    await matchingService.recordAction({
      viewerId: ctx.dbUser.id,
      viewedUserId: state.currentUserId,
      sportSlug: state.sportSlug,
      action: 'next',
    });
  }
  await showNextCandidate(ctx);
});

searchHandler.action('search:msg', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;

  const state = ctx.session.search;
  if (!state?.currentUserId) {
    await screen(ctx, 'Карточка устарела. Начните поиск заново.');
    return;
  }

  const target = await userRepository.findById(state.currentUserId);
  if (!target) {
    await screen(ctx, 'Этот игрок больше недоступен.');
    await showNextCandidate(ctx);
    return;
  }

  const result = await contactService.contact({
    fromUserId: ctx.dbUser.id,
    toUserId: target.id,
    toUsername: target.telegramUsername,
    sportSlug: state.sportSlug,
  });

  if (!result.ok) {
    const message =
      result.reason === 'rate_limited_minute'
        ? 'Слишком много новых контактов подряд. Подождите минуту.'
        : 'Достигнут дневной лимит новых контактов. Продолжите завтра.';
    await screen(ctx, `⏳ ${message}`);
    return;
  }

  await matchingService.recordAction({
    viewerId: ctx.dbUser.id,
    viewedUserId: target.id,
    sportSlug: state.sportSlug,
    action: 'message',
  });

  const name = escapeHtml(userService.displayNameOf(target));
  const lines = result.username
    ? [`💬 Вы можете начать общение с <b>${name}</b>.`]
    : [
        `💬 У <b>${name}</b> нет открытого username в Telegram, поэтому написать напрямую не получится.`,
        '',
        'Контакт сохранён в разделе «Мои контакты» — попробуйте связаться позже.',
      ];

  await send(ctx, lines.join('\n'), contactKeyboard(result.username));
});

searchHandler.action('search:reset', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  const sportSlug = activeSportSlug(ctx);
  const scope = ctx.session.search?.scope ?? matchingConfig.defaultScope;
  await matchingService.resetViewed(ctx.dbUser.id, sportSlug);
  ctx.session.search = { sportSlug, scope, queue: [] };
  await showNextCandidate(ctx);
});

searchHandler.action('search:stop', async (ctx) => {
  await ack(ctx);
  if (ctx.callbackQuery) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await showMainMenu(ctx);
});
