import { Composer } from 'telegraf';
import { getSportConfig } from '../../config/sports.js';
import { geoService } from '../../services/geoService.js';
import { eventRepository } from '../../db/repositories/eventRepository.js';
import { userService } from '../../services/userService.js';
import {
  applyAbout,
  applyAge,
  applyCity,
  applyCountry,
  applyLevel,
  applyName,
  applyPhoto,
  isEditing,
} from '../apply.js';
import {
  draftSportSlug,
  finishRegistration,
  goToStep,
  previousStep,
  promptStep,
  showConfirmation,
  showWelcome,
  startRegistration,
} from '../flow.js';
import {
  ageKeyboard,
  cityEditKeyboard,
  cityKeyboard,
  countryEditKeyboard,
  countryKeyboard,
  editFieldsKeyboard,
} from '../keyboards/index.js';
import type { BotContext, EditableField } from '../session.js';
import { ack, screen } from '../ui.js';

export const registrationHandler = new Composer<BotContext>();

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

registrationHandler.action('reg:start', async (ctx) => {
  await ack(ctx);
  if (userService.isRegistered(ctx.dbUser)) {
    await screen(ctx, 'Профиль уже создан. Открываю его.');
    return;
  }
  eventRepository.track('registration_started', ctx.dbUser.id);
  await startRegistration(ctx);
});

/* --------------------------------------------------------------- name ----- */

registrationHandler.action('reg:name_tg', async (ctx) => {
  await ack(ctx);
  const telegramName = ctx.dbUser.firstName?.trim();
  if (!telegramName) {
    await screen(ctx, 'В Telegram не нашли имя — напишите его текстом.');
    return;
  }
  await applyName(ctx, telegramName);
});

/* ---------------------------------------------------------------- age ----- */

registrationHandler.action(/^reg:age:(\d+)$/, async (ctx) => {
  await ack(ctx);
  const age = Number(ctx.match[1]);
  await applyAge(ctx, age);
});

registrationHandler.action(/^reg:age_page:(\d+)$/, async (ctx) => {
  await ack(ctx);
  const page = Number(ctx.match[1]);
  ctx.session.page = page;
  const keyboard = isEditing(ctx, 'age')
    ? ageKeyboard(page, false)
    : ageKeyboard(page, previousStep('age') !== null);
  await ctx.editMessageReplyMarkup(keyboard.reply_markup).catch(() => {});
});

registrationHandler.action('reg:age_manual', async (ctx) => {
  await ack(ctx);
  await screen(ctx, '🎂 Напишите ваш возраст числом, например: <code>34</code>');
});

/* ------------------------------------------------------------ country ----- */

registrationHandler.action(/^reg:country:([A-Z]{2})$/, async (ctx) => {
  await ack(ctx);
  const country = geoService.getCountry(ctx.match[1]);
  if (!country) {
    await screen(
      ctx,
      'Такой страны нет в справочнике. Выберите из кнопок ниже или напишите название.',
      countryKeyboard(geoService.listPopularCountries()),
    );
    return;
  }
  await applyCountry(ctx, { code: country.code, name: country.name });
});

registrationHandler.action('reg:country_popular', async (ctx) => {
  await ack(ctx);
  const popular = geoService.listPopularCountries();
  await screen(
    ctx,
    '🌍 <b>Частые страны</b>\n\nИли напишите название любой другой.',
    isEditing(ctx, 'country') ? countryEditKeyboard(popular) : countryKeyboard(popular),
  );
});

/* --------------------------------------------------------------- city ----- */

/** A city is only ever stored by picking it from the reference data (ТЗ §8). */
registrationHandler.action(/^reg:city:(\d+)$/, async (ctx) => {
  await ack(ctx);
  const countryCode = isEditing(ctx, 'city')
    ? ctx.dbUser.countryCode
    : (ctx.session.draft.countryCode ?? ctx.dbUser.countryCode);
  const cityId = Number(ctx.match[1]);

  const city = countryCode ? geoService.getCity(countryCode, cityId) : null;
  if (!city) {
    await screen(ctx, 'Этот город больше недоступен, выберите другой.');
    await promptStep(ctx, 'city');
    return;
  }

  await applyCity(ctx, { name: city.name, id: city.id });
});

registrationHandler.action('reg:city_top', async (ctx) => {
  await ack(ctx);
  const editing = isEditing(ctx, 'city');
  const countryCode = editing
    ? ctx.dbUser.countryCode
    : (ctx.session.draft.countryCode ?? ctx.dbUser.countryCode);
  const topCities = countryCode ? geoService.listTopCities(countryCode) : [];

  await screen(
    ctx,
    '📋 <b>Крупные города</b>\n\nИли напишите название своего.',
    editing
      ? cityEditKeyboard(topCities, { clearable: Boolean(ctx.dbUser.city) })
      : cityKeyboard(topCities),
  );
});

registrationHandler.action('reg:city_skip', async (ctx) => {
  await ack(ctx);
  await applyCity(ctx, null);
});

/* -------------------------------------------------------------- sport ----- */

registrationHandler.action(/^reg:sport:([a-z_]+)$/, async (ctx) => {
  await ack(ctx);
  const slug = ctx.match[1];
  if (!slug) return;
  ctx.session.draft.sportSlug = getSportConfig(slug).slug;
  await goToStep(ctx, 'level');
});

/* -------------------------------------------------------------- level ----- */

registrationHandler.action(/^reg:level:([\d.]+)$/, async (ctx) => {
  await ack(ctx);
  const level = Number(ctx.match[1]);
  if (!Number.isFinite(level)) return;
  await applyLevel(ctx, level, 'self', draftSportSlug(ctx));
});

/* -------------------------------------------------------------- photo ----- */

registrationHandler.action('reg:photo_skip', async (ctx) => {
  await ack(ctx);
  await applyPhoto(ctx, null);
});

/* -------------------------------------------------------------- about ----- */

registrationHandler.action('reg:about_skip', async (ctx) => {
  await ack(ctx);
  await applyAbout(ctx, null);
});

/* ------------------------------------------------------- back / confirm --- */

registrationHandler.action('reg:back', async (ctx) => {
  await ack(ctx);

  if (ctx.session.editing || ctx.session.draftField) {
    delete ctx.session.editing;
    delete ctx.session.draftField;
    await showConfirmation(ctx);
    return;
  }

  const current = ctx.session.step ?? 'age';
  const previous = previousStep(current);
  if (!previous) {
    await showWelcome(ctx);
    return;
  }
  await goToStep(ctx, previous);
});

registrationHandler.action('reg:to_confirm', async (ctx) => {
  await ack(ctx);
  delete ctx.session.editing;
  delete ctx.session.draftField;
  await showConfirmation(ctx);
});

registrationHandler.action('reg:edit', async (ctx) => {
  await ack(ctx);
  await screen(ctx, '✏️ <b>Что изменить?</b>', editFieldsKeyboard('reg'));
});

registrationHandler.action(/^reg:edit_field:(\w+)$/, async (ctx) => {
  await ack(ctx);
  const field = ctx.match[1];
  if (!field || !isEditableField(field)) return;

  // Editing during registration keeps the value in the draft: `step` stays
  // 'confirm', so the applier knows to return to the confirmation screen.
  ctx.session.step = 'confirm';
  ctx.session.draftField = field;
  delete ctx.session.editing;
  await promptStep(ctx, field);
});

registrationHandler.action('reg:confirm', async (ctx) => {
  await ack(ctx);
  await finishRegistration(ctx);
});
