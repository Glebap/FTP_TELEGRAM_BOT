import { Composer } from 'telegraf';
import { formatLevel, getActiveSportConfigs, getSportConfig } from '../../config/sports.js';
import { profileViewRepository } from '../../db/repositories/profileViewRepository.js';
import { userService } from '../../services/userService.js';
import { applyAbout, applyCity, applyLevel, applyPhoto } from '../apply.js';
import { promptEditField, showMainMenu, showProfileScreen, showWelcome } from '../flow.js';
import {
  addSportKeyboard,
  editFieldsKeyboard,
  telegramLink,
  userSportsKeyboard,
} from '../keyboards/index.js';
import type { BotContext, EditableField } from '../session.js';
import { ack, screen } from '../ui.js';
import { escapeHtml } from '../../utils/text.js';

export const profileHandler = new Composer<BotContext>();

const EDITABLE_FIELDS: EditableField[] = [
  'name',
  'age',
  'country',
  'city',
  'photo',
  'about',
  'level',
];

function isEditableField(value: string): value is EditableField {
  return (EDITABLE_FIELDS as string[]).includes(value);
}

async function requireRegistration(ctx: BotContext): Promise<boolean> {
  if (userService.isRegistered(ctx.dbUser)) return true;
  await showWelcome(ctx);
  return false;
}

export async function openProfile(ctx: BotContext): Promise<void> {
  if (!(await requireRegistration(ctx))) return;
  delete ctx.session.editing;
  await showProfileScreen(ctx);
}

profileHandler.action('profile:show', async (ctx) => {
  await ack(ctx);
  await openProfile(ctx);
});

profileHandler.action('profile:edit', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  await screen(ctx, '✏️ <b>Что изменить?</b>', editFieldsKeyboard('profile'));
});

profileHandler.action(/^profile:edit_field:(\w+)$/, async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  const field = ctx.match[1];
  if (!field || !isEditableField(field)) return;
  await promptEditField(ctx, field);
});

profileHandler.action(/^profile:level:([\d.]+)$/, async (ctx) => {
  await ack(ctx);
  const level = Number(ctx.match[1]);
  if (!Number.isFinite(level)) return;
  const sportSlug = ctx.session.editingSport ?? userService.primarySportSlug(ctx.dbUser);
  ctx.session.editing = 'level';
  await applyLevel(ctx, level, 'self', sportSlug);
});

/* -------------------------------------------------------- sports list ----- */

function sportLabel(slug: string, level: number | null): string {
  const sport = getSportConfig(slug);
  return level === null
    ? `${sport.emoji} ${sport.title}`
    : `${sport.emoji} ${sport.title} — ${formatLevel(slug, level)}`;
}

/** "My sports": one row per sport with its level (ТЗ §39). */
export async function openSports(ctx: BotContext): Promise<void> {
  if (!(await requireRegistration(ctx))) return;
  delete ctx.session.editing;
  delete ctx.session.editingSport;

  const played = userService.sportSlugs(ctx.dbUser).map((slug) => ({
    slug,
    label: sportLabel(slug, userService.levelFor(ctx.dbUser, slug)),
  }));
  const available = getActiveSportConfigs().filter(
    (sport) => !userService.playsSport(ctx.dbUser, sport.slug),
  );

  await screen(
    ctx,
    [
      '🏆 <b>Виды спорта</b>',
      '',
      'Нажмите на вид спорта, чтобы изменить уровень.',
      available.length > 0 ? 'Можно добавить ещё — партнёров бот ищет по каждому отдельно.' : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
    userSportsKeyboard(played, available.length > 0, played.length > 1),
  );
}

profileHandler.action('profile:sports', async (ctx) => {
  await ack(ctx);
  await openSports(ctx);
});

profileHandler.action(/^profile:sport_level:([a-z_]+)$/, async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  const slug = ctx.match[1];
  if (!slug || !userService.playsSport(ctx.dbUser, slug)) return;

  ctx.session.editingSport = slug;
  await promptEditField(ctx, 'level');
});

profileHandler.action('profile:sport_add', async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;

  const available = getActiveSportConfigs()
    .filter((sport) => !userService.playsSport(ctx.dbUser, sport.slug))
    .map((sport) => ({ slug: sport.slug, label: `${sport.emoji} ${sport.title}` }));

  if (available.length === 0) {
    await screen(ctx, 'Вы уже добавили все доступные виды спорта.');
    await openSports(ctx);
    return;
  }

  await screen(ctx, '➕ <b>Какой вид спорта добавить?</b>', addSportKeyboard(available));
});

profileHandler.action(/^profile:sport_new:([a-z_]+)$/, async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  const slug = ctx.match[1];
  if (!slug) return;

  const sport = getActiveSportConfigs().find((entry) => entry.slug === slug);
  if (!sport) return;

  // The level for the new sport is asked right away; applyLevel then creates
  // the sport profile, so a sport is never added without a level.
  ctx.session.editingSport = slug;
  await promptEditField(ctx, 'level');
});

profileHandler.action(/^profile:sport_remove:([a-z_]+)$/, async (ctx) => {
  await ack(ctx);
  if (!(await requireRegistration(ctx))) return;
  const slug = ctx.match[1];
  if (!slug) return;

  const removed = await userService.removeSport(ctx.dbUser, slug);
  if (!removed) {
    await ack(ctx, 'Нужен хотя бы один вид спорта');
    await openSports(ctx);
    return;
  }

  const refreshed = await userService.getByTelegramId(ctx.dbUser.telegramId);
  if (refreshed) ctx.dbUser = refreshed;
  await openSports(ctx);
});

profileHandler.action(/^profile:clear:(city|photo|about)$/, async (ctx) => {
  await ack(ctx);
  const field = ctx.match[1];
  ctx.session.editing = field as EditableField;

  if (field === 'city') await applyCity(ctx, null);
  else if (field === 'photo') await applyPhoto(ctx, null);
  else await applyAbout(ctx, null);
});

profileHandler.action('profile:cancel_edit', async (ctx) => {
  await ack(ctx);
  delete ctx.session.editing;
  await showProfileScreen(ctx);
});

/**
 * Players the user has already seen in search, newest first (ТЗ §16).
 *
 * "Написать" on a card is a plain Telegram link, so the bot never learns about
 * the tap — a view is the only thing it can record. That makes this list the
 * way back to someone you scrolled past.
 */
export async function openContacts(ctx: BotContext): Promise<void> {
  if (!(await requireRegistration(ctx))) return;

  const views = await profileViewRepository.listRecentlyViewed(ctx.dbUser.id, 15);
  if (views.length === 0) {
    await screen(
      ctx,
      [
        '👀 <b>Кого я смотрел</b>',
        '',
        'Пока пусто. Нажмите «🎾 Найти партнёра» — игроки, которых вы посмотрите, появятся здесь.',
      ].join('\n'),
    );
    return;
  }

  const lines = ['👀 <b>Кого я смотрел</b>', ''];
  for (const view of views) {
    const user = view.viewedUser;
    // Each view remembers which sport search it came from.
    const sportSlug = view.sport.slug;
    const sport = getSportConfig(sportSlug);
    const level = user.sports.find((entry) => entry.sport.slug === sportSlug)?.level ?? null;

    const name = escapeHtml(userService.displayNameOf(user));
    const age = user.age ? `, ${user.age}` : '';
    const city = user.city ? ` · 📍 ${escapeHtml(user.city)}` : '';
    const levelText = level === null ? '' : ` · ${sport.emoji} ${formatLevel(sportSlug, level)}`;
    const link = telegramLink(user.telegramUsername);
    const handle = link
      ? `\n  <a href="${link}">Написать в Telegram</a>`
      : '\n  <i>username скрыт, написать нельзя</i>';

    lines.push(`• <b>${name}</b>${age}${levelText}${city}${handle}`);
  }

  await screen(ctx, lines.join('\n'));
}

profileHandler.action('profile:menu', async (ctx) => {
  await ack(ctx);
  await showMainMenu(ctx);
});
