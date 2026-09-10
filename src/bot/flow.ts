import { profileConfig } from '../config/profile.js';
import {
  DEFAULT_SPORT_SLUG,
  getActiveSportConfigs,
  getSportConfig,
} from '../config/sports.js';
import { userService } from '../services/userService.js';
import { geoService } from '../services/geoService.js';
import {
  aboutKeyboard,
  ageEditKeyboard,
  ageKeyboard,
  cityEditKeyboard,
  cityKeyboard,
  confirmProfileKeyboard,
  countryEditKeyboard,
  countryKeyboard,
  editValueKeyboard,
  levelKeyboard,
  mainMenuKeyboard,
  nameKeyboard,
  photoKeyboard,
  sportKeyboard,
  profileKeyboard,
  startRegistrationKeyboard,
} from './keyboards/index.js';
import type { BotContext, EditableField, RegistrationStep } from './session.js';
import { resetFlow } from './session.js';
import { screen, send } from './ui.js';
import {
  profileFromDraft,
  profileFromUser,
  renderProfileCard,
} from './views/profileView.js';

/**
 * Linear registration path (ТЗ §29). `quiz` is deliberately absent: it is a
 * sub-flow entered from the `level` step, so Back never lands inside it.
 * The sport step disappears while only one sport is enabled.
 */
export function navigationSteps(): RegistrationStep[] {
  const steps: RegistrationStep[] = ['name', 'age', 'country', 'city'];
  if (getActiveSportConfigs().length > 1) steps.push('sport');
  steps.push('level', 'photo', 'about', 'confirm');
  return steps;
}

export function nextStep(current: RegistrationStep): RegistrationStep {
  const steps = navigationSteps();
  const index = steps.indexOf(current);
  return steps[Math.min(index + 1, steps.length - 1)] ?? 'confirm';
}

export function previousStep(current: RegistrationStep): RegistrationStep | null {
  const steps = navigationSteps();
  const index = steps.indexOf(current);
  if (index <= 0) return null;
  return steps[index - 1] ?? null;
}

export function draftSportSlug(ctx: BotContext): string {
  return ctx.session.draft.sportSlug ?? DEFAULT_SPORT_SLUG;
}

export async function showWelcome(ctx: BotContext): Promise<void> {
  const active = getActiveSportConfigs();
  const emojis = active.map((sport) => sport.emoji).join('');
  // Built from the sport registry, so enabling a sport updates this text too.
  const names = active.map((sport) => sport.title.toLowerCase()).join(', ');

  await screen(
    ctx,
    [
      `${emojis} <b>Привет!</b>`,
      '',
      `Этот бот поможет найти партнёра для игры: ${names}.`,
      'Давай создадим твой профиль — это займёт пару минут.',
    ].join('\n'),
    startRegistrationKeyboard(),
  );
}

export async function showMainMenu(ctx: BotContext, text?: string): Promise<void> {
  resetFlow(ctx.session);
  delete ctx.session.search;
  await send(ctx, text ?? 'Главное меню — выбирайте, что дальше 👇', mainMenuKeyboard());
}

export async function startRegistration(ctx: BotContext): Promise<void> {
  ctx.session.draft = { sportSlug: DEFAULT_SPORT_SLUG };
  delete ctx.session.quiz;
  delete ctx.session.editing;
  await goToStep(ctx, 'name');
}

export async function goToStep(ctx: BotContext, step: RegistrationStep): Promise<void> {
  ctx.session.step = step;
  ctx.session.page = 0;
  await promptStep(ctx, step);
}

export async function goToNextStep(ctx: BotContext): Promise<void> {
  const current = ctx.session.step ?? 'age';
  await goToStep(ctx, nextStep(current));
}

/** Renders the question for a step. Never mutates the draft. */
export async function promptStep(ctx: BotContext, step: RegistrationStep): Promise<void> {
  const sportSlug = draftSportSlug(ctx);
  const isFirst = previousStep(step) === null;

  switch (step) {
    case 'name': {
      const telegramName = ctx.dbUser.firstName;
      await screen(
        ctx,
        [
          '👤 <b>Как вас зовут?</b>',
          '',
          telegramName
            ? 'Нажмите на имя из Telegram или напишите другое — его увидят другие игроки.'
            : 'Напишите имя — его увидят другие игроки.',
        ].join('\n'),
        nameKeyboard(telegramName, { withBack: !isFirst }),
      );
      return;
    }

    case 'age':
      await screen(ctx, '🎂 <b>Сколько вам лет?</b>', ageKeyboard(ctx.session.page ?? 0, !isFirst));
      return;

    case 'country':
      await screen(
        ctx,
        '🌍 <b>Выберите страну из списка или напишите название</b>',
        countryKeyboard(geoService.listPopularCountries()),
      );
      return;

    case 'city': {
      const countryCode = ctx.session.draft.countryCode;
      const topCities = countryCode ? geoService.listTopCities(countryCode) : [];
      await screen(
        ctx,
        '📍 <b>Выберите город из списка или напишите название</b>',
        cityKeyboard(topCities),
      );
      return;
    }

    case 'sport':
      await screen(ctx, '🏆 <b>Какой вид спорта?</b>', sportKeyboard());
      return;

    case 'level': {
      const sport = getSportConfig(sportSlug);
      const scale = sport.levelPrefix ? ` по шкале ${sport.levelPrefix}` : '';
      await screen(
        ctx,
        `${sport.emoji} <b>Какой у вас уровень${scale}?</b>\n\nЕсли не знаете — бот подберёт его по короткому тесту.`,
        levelKeyboard(sportSlug),
      );
      return;
    }

    case 'quiz':
      // The quiz handler owns its own rendering.
      return;

    case 'photo':
      await screen(
        ctx,
        '📷 <b>Добавьте фотографию профиля</b>\n\nПросто отправьте фото в чат. Это необязательно — можно пропустить.',
        photoKeyboard(),
      );
      return;

    case 'about':
      await screen(
        ctx,
        [
          '✍️ <b>Напишите немного о себе</b>',
          '',
          'Что хотите рассказать другим игрокам? Например, как часто играете и что ищете.',
          `До ${profileConfig.aboutMaxLength} символов.`,
        ].join('\n'),
        aboutKeyboard(),
      );
      return;

    case 'confirm':
      await showConfirmation(ctx);
      return;

    default: {
      const exhaustive: never = step;
      throw new Error(`Unhandled registration step: ${String(exhaustive)}`);
    }
  }
}

/** Profile preview before finishing registration (ТЗ §15). */
export async function showConfirmation(ctx: BotContext): Promise<void> {
  ctx.session.step = 'confirm';
  const sportSlug = draftSportSlug(ctx);
  const sport = getSportConfig(sportSlug);
  const profile = profileFromDraft(
    ctx.session.draft,
    userService.displayNameOf(ctx.dbUser),
    sportSlug,
  );

  const text = renderProfileCard(profile, {
    title: `${sport.emoji} Ваш профиль`,
    showPhotoStatus: true,
  });

  if (profile.photoFileId) {
    // A photo card cannot be produced by editing a text message.
    if (ctx.callbackQuery) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.replyWithPhoto(profile.photoFileId, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: confirmProfileKeyboard().reply_markup,
    });
    return;
  }

  await screen(ctx, text, confirmProfileKeyboard());
}

export async function finishRegistration(ctx: BotContext): Promise<void> {
  const draft = ctx.session.draft;
  const sportSlug = draftSportSlug(ctx);

  if (draft.age === undefined || !draft.countryCode || draft.level === undefined) {
    // Should be unreachable; recover instead of throwing at the user.
    await screen(ctx, 'Не хватает данных для профиля. Давайте начнём заново.');
    await startRegistration(ctx);
    return;
  }

  const user = await userService.completeRegistration(ctx.dbUser.id, {
    displayName: draft.displayName ?? null,
    age: draft.age,
    countryCode: draft.countryCode,
    countryName: draft.countryName ?? draft.countryCode,
    city: draft.city ?? null,
    cityGeonameId: draft.cityId ?? null,
    photoFileId: draft.photoFileId ?? null,
    about: draft.about ?? null,
    sportSlug,
    level: draft.level,
    levelSource: draft.levelSource ?? 'self',
  });
  ctx.dbUser = user;

  resetFlow(ctx.session);
  await showMainMenu(
    ctx,
    ['🎉 <b>Профиль готов!</b>', '', 'Теперь можно искать партнёров по игре.'].join('\n'),
  );
}

/** "My profile" screen (ТЗ §23). */
export async function showProfileScreen(ctx: BotContext): Promise<void> {
  // No sport argument: the profile lists every sport the user plays.
  const profile = profileFromUser(ctx.dbUser);

  const hiddenNote = ctx.dbUser.isActive
    ? ''
    : '\n\n🙈 <i>Профиль скрыт и не показывается другим игрокам.</i>';
  const text = renderProfileCard(profile, { title: '👤 Ваш профиль' }) + hiddenNote;

  if (profile.photoFileId) {
    if (ctx.callbackQuery) await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.replyWithPhoto(profile.photoFileId, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: profileKeyboard().reply_markup,
    });
    return;
  }

  await screen(ctx, text, profileKeyboard());
}

/**
 * Prompts for a single field outside the registration flow (ТЗ §23).
 * `ctx.session.editing` tells the text/photo handlers where the answer goes.
 */
export async function promptEditField(ctx: BotContext, field: EditableField): Promise<void> {
  ctx.session.editing = field;
  ctx.session.page = 0;
  const sportSlug =
    ctx.session.editingSport ?? userService.primarySportSlug(ctx.dbUser);

  switch (field) {
    case 'name':
      await screen(
        ctx,
        '👤 <b>Напишите новое имя</b>\n\nИли верните имя из Telegram кнопкой ниже.',
        nameKeyboard(ctx.dbUser.firstName, { mode: 'profile' }),
      );
      return;
    case 'age':
      await screen(ctx, '🎂 <b>Укажите новый возраст</b>', ageEditKeyboard(0));
      return;
    case 'country':
      await screen(
        ctx,
        '🌍 <b>Выберите страну из списка или напишите название</b>',
        countryEditKeyboard(geoService.listPopularCountries()),
      );
      return;
    case 'city': {
      const countryCode = ctx.dbUser.countryCode;
      const topCities = countryCode ? geoService.listTopCities(countryCode) : [];
      await screen(
        ctx,
        '📍 <b>Выберите город из списка или напишите название</b>',
        cityEditKeyboard(topCities, { clearable: Boolean(ctx.dbUser.city) }),
      );
      return;
    }
    case 'level': {
      const sport = getSportConfig(sportSlug);
      // Remembered so the level answer and the quiz land on the right sport.
      ctx.session.editingSport = sportSlug;
      await screen(
        ctx,
        `${sport.emoji} <b>${sport.title}: выберите уровень</b>`,
        levelKeyboard(sportSlug, { withBack: false, prefix: 'profile' }),
      );
      return;
    }
    case 'photo':
      await screen(
        ctx,
        '📷 <b>Отправьте новое фото</b>',
        editValueKeyboard('photo', { clearable: Boolean(ctx.dbUser.photoFileId) }),
      );
      return;
    case 'about':
      await screen(
        ctx,
        `✍️ <b>Напишите текст о себе</b>\n\nДо ${profileConfig.aboutMaxLength} символов.`,
        editValueKeyboard('about', { clearable: Boolean(ctx.dbUser.about) }),
      );
      return;
    default: {
      const exhaustive: never = field;
      throw new Error(`Unhandled editable field: ${String(exhaustive)}`);
    }
  }
}
