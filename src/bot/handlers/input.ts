import { Composer } from 'telegraf';
import { message } from 'telegraf/filters';
import { profileConfig } from '../../config/profile.js';
import { geoService } from '../../services/geoService.js';
import {
  applyAbout,
  applyAge,
  applyCity,
  applyCountry,
  applyName,
  applyPhoto,
  isEditing,
} from '../apply.js';
import { promptStep, showMainMenu, showWelcome } from '../flow.js';
import {
  cityEditKeyboard,
  cityKeyboard,
  citySuggestionsEditKeyboard,
  citySuggestionsKeyboard,
  countryEditKeyboard,
  countryKeyboard,
  countrySuggestionsKeyboard,
  MAIN_MENU_BUTTONS,
} from '../keyboards/index.js';
import { openContacts, openProfile } from './profile.js';
import { startSearch } from './search.js';
import { openSettings } from './settings.js';
import type { BotContext, EditableField, RegistrationStep } from '../session.js';
import { screen } from '../ui.js';
import { escapeHtml, normalizeInput, truncate } from '../../utils/text.js';
import { userService } from '../../services/userService.js';

export const inputHandler = new Composer<BotContext>();

/**
 * Text and photo messages are routed here. The expected value is decided by
 * `session.editing` (single-field edit) or `session.step` (registration), and
 * anything unexpected gets a friendly hint instead of an error (ТЗ §30).
 */

type ExpectedInput = EditableField | RegistrationStep | null;

function expectedInput(ctx: BotContext): ExpectedInput {
  if (ctx.session.editing) return ctx.session.editing;
  const step = ctx.session.step;
  if (!step) return null;
  if (step === 'quiz' || step === 'sport') return null;
  // 'confirm' is also the step while one draft field is re-entered.
  if (step === 'confirm') return ctx.session.draftField ?? null;
  return step;
}

/* ------------------------------------------------- main menu shortcuts ---- */

inputHandler.hears(MAIN_MENU_BUTTONS.search, async (ctx) => {
  await startSearch(ctx);
});

inputHandler.hears(MAIN_MENU_BUTTONS.profile, async (ctx) => {
  await openProfile(ctx);
});

inputHandler.hears(MAIN_MENU_BUTTONS.contacts, async (ctx) => {
  await openContacts(ctx);
});

inputHandler.hears(MAIN_MENU_BUTTONS.settings, async (ctx) => {
  await openSettings(ctx);
});

/* ------------------------------------------------------------- photos ----- */

inputHandler.on(message('photo'), async (ctx) => {
  const target =
    ctx.session.editing ??
    ctx.session.draftField ??
    (ctx.session.step === 'photo' ? 'photo' : null);

  if (target !== 'photo') {
    await screen(ctx, 'Фото здесь не нужно. Выберите вариант из кнопок ниже 👇');
    return;
  }

  // Telegram sends several sizes; the last one is the largest (ТЗ §28).
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  if (!largest) {
    await screen(ctx, 'Не удалось прочитать фото, попробуйте отправить другое.');
    return;
  }

  await applyPhoto(ctx, largest.file_id);
});

/* --------------------------------------------------------------- text ----- */

inputHandler.on(message('text'), async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();

  const field = expectedInput(ctx);

  switch (field) {
    case 'name':
      await handleName(ctx, text);
      return;

    case 'age':
      await handleAge(ctx, text);
      return;

    case 'city':
      await handleCity(ctx, text);
      return;

    case 'about':
      await handleAbout(ctx, text);
      return;

    case 'country':
      await handleCountry(ctx, text);
      return;

    case 'photo':
      await screen(ctx, 'Отправьте фотографию или нажмите «Пропустить» 👇');
      return;

    case 'level':
      await screen(ctx, 'Пожалуйста, выберите уровень из кнопок ниже 👇');
      return;

    default:
      await handleUnexpectedText(ctx);
  }
});

async function handleName(ctx: BotContext, text: string): Promise<void> {
  const name = normalizeInput(text);

  if (name.length < profileConfig.nameMinLength) {
    await screen(ctx, 'Слишком короткое имя. Напишите хотя бы две буквы.');
    return;
  }
  if (name.length > profileConfig.nameMaxLength) {
    await screen(ctx, `Имя слишком длинное — максимум ${profileConfig.nameMaxLength} символов.`);
    return;
  }
  // A name made only of digits or emoji is almost certainly a mistake.
  if (!/\p{L}/u.test(name)) {
    await screen(ctx, 'В имени должны быть буквы. Напишите, как вас называть.');
    return;
  }

  await applyName(ctx, name);
}

async function handleAge(ctx: BotContext, text: string): Promise<void> {
  const parsed = Number.parseInt(normalizeInput(text), 10);

  if (!Number.isFinite(parsed)) {
    await screen(
      ctx,
      'Возраст нужно указать числом, например: <code>28</code>. Или выберите из кнопок 👇',
    );
    return;
  }
  if (parsed < profileConfig.minAge) {
    await screen(ctx, `Проверьте возраст: минимум ${profileConfig.minAge}.`);
    return;
  }
  if (parsed > profileConfig.maxAge) {
    await screen(ctx, `Проверьте возраст: максимум ${profileConfig.maxAge}.`);
    return;
  }

  await applyAge(ctx, parsed);
}

/**
 * City input is resolved against the reference data (ТЗ §8): an exact hit is
 * accepted, a near miss becomes a "did you mean" list, and something that
 * matches nothing is rejected instead of being stored as a typo.
 */
async function handleCity(ctx: BotContext, text: string): Promise<void> {
  const editing = isEditing(ctx, 'city');
  const countryCode = editing
    ? ctx.dbUser.countryCode
    : (ctx.session.draft.countryCode ?? ctx.dbUser.countryCode);

  if (!countryCode) {
    await screen(ctx, 'Сначала выберите страну.');
    await promptStep(ctx, 'country');
    return;
  }

  const query = normalizeInput(text);
  if (query.length < 2) {
    await screen(ctx, 'Слишком короткое название. Напишите город целиком.');
    return;
  }

  const country = geoService.getCountry(countryCode);
  const { exact, suggestions } = geoService.searchCities(countryCode, query);

  if (exact) {
    await applyCity(ctx, { name: exact.name, id: exact.id });
    return;
  }

  const topCities = geoService.listTopCities(countryCode);

  if (suggestions.length === 0) {
    await screen(
      ctx,
      [
        `❌ В ${country?.name ?? 'этой стране'} не нашли город «${escapeHtml(query)}».`,
        '',
        'Проверьте написание или выберите город из списка ниже.',
      ].join('\n'),
      editing
        ? cityEditKeyboard(topCities, { clearable: Boolean(ctx.dbUser.city) })
        : cityKeyboard(topCities),
    );
    return;
  }

  await screen(
    ctx,
    [`🔎 Не нашли точного совпадения для «${escapeHtml(query)}».`, '', 'Вы имели в виду:'].join(
      '\n',
    ),
    editing ? citySuggestionsEditKeyboard(suggestions) : citySuggestionsKeyboard(suggestions),
  );
}

async function handleAbout(ctx: BotContext, text: string): Promise<void> {
  const about = text.trim();
  if (about.length === 0) {
    await screen(ctx, 'Напишите пару предложений или нажмите «Пропустить».');
    return;
  }
  if (about.length > profileConfig.aboutMaxLength) {
    await screen(
      ctx,
      [
        `Текст слишком длинный: ${about.length} из ${profileConfig.aboutMaxLength} символов.`,
        '',
        'Сократите его немного и отправьте снова.',
      ].join('\n'),
    );
    return;
  }

  await applyAbout(ctx, truncate(about, profileConfig.aboutMaxLength));
}

/**
 * Country input goes through the same three outcomes as the city one (ТЗ §7).
 * Thanks to the folded search keys "Україна", "украина" and "Ukraina" are all
 * exact hits, while "Укрна" comes back as a suggestion.
 */
async function handleCountry(ctx: BotContext, text: string): Promise<void> {
  const query = normalizeInput(text);
  if (query.length < 2 || query.length > 60) {
    await screen(ctx, 'Напишите название страны или выберите её из кнопок 👇');
    return;
  }

  const editing = isEditing(ctx, 'country');
  const { exact, suggestions } = geoService.searchCountries(query);

  if (exact) {
    await applyCountry(ctx, { code: exact.code, name: exact.name });
    return;
  }

  if (suggestions.length === 0) {
    await screen(
      ctx,
      [
        `❌ Страны «${escapeHtml(query)}» не существует.`,
        '',
        'Проверьте написание или выберите из списка ниже.',
      ].join('\n'),
      editing
        ? countryEditKeyboard(geoService.listPopularCountries())
        : countryKeyboard(geoService.listPopularCountries()),
    );
    return;
  }

  await screen(
    ctx,
    [`🔎 Не нашли точного совпадения для «${escapeHtml(query)}».`, '', 'Вы имели в виду:'].join(
      '\n',
    ),
    countrySuggestionsKeyboard(suggestions, editing ? 'profile' : 'reg'),
  );
}

async function handleUnexpectedText(ctx: BotContext): Promise<void> {
  if (!userService.isRegistered(ctx.dbUser)) {
    await screen(ctx, 'Пожалуйста, выберите вариант из кнопок ниже 👇');
    await showWelcome(ctx);
    return;
  }

  const step = ctx.session.step;
  if (step) {
    await screen(ctx, 'Пожалуйста, выберите вариант из кнопок ниже 👇');
    await promptStep(ctx, step);
    return;
  }

  await showMainMenu(ctx, 'Не понял сообщение. Выберите действие из меню 👇');
}
