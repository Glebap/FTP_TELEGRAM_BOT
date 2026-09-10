import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import { geoConfig } from '../../config/geo.js';
import { profileConfig } from '../../config/profile.js';
import { getActiveSportConfigs, getSportConfig } from '../../config/sports.js';
import type { GeoCity, GeoCountry } from '../../services/geoService.js';

export const MAIN_MENU_BUTTONS = {
  search: '🎾 Найти партнёра',
  profile: '👤 Мой профиль',
  contacts: '👀 Кого я смотрел',
  settings: '⚙️ Настройки',
} as const;

/** Persistent reply keyboard shown in the main menu (ТЗ §16). */
export function mainMenuKeyboard() {
  return Markup.keyboard([
    [MAIN_MENU_BUTTONS.search],
    [MAIN_MENU_BUTTONS.profile, MAIN_MENU_BUTTONS.contacts],
    [MAIN_MENU_BUTTONS.settings],
  ]).resize();
}

export function removeKeyboard() {
  return Markup.removeKeyboard();
}

export function startRegistrationKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🚀 Начать регистрацию', 'reg:start')]]);
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

const backButton = (target = 'reg:back') => Markup.button.callback('⬅️ Назад', target);

/**
 * Name step: the Telegram name as a one-tap option, anything else typed in.
 * `telegramName` is absent only if Telegram gave us no first name at all.
 */
export function nameKeyboard(
  telegramName: string | null,
  options?: { mode?: 'reg' | 'profile'; withBack?: boolean },
) {
  const rows: InlineKeyboardButton[][] = [];
  if (telegramName) {
    rows.push([Markup.button.callback(`✅ ${telegramName}`, 'reg:name_tg')]);
  }
  if (options?.mode === 'profile') {
    rows.push([Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')]);
  } else if (options?.withBack) {
    rows.push([backButton()]);
  }
  return Markup.inlineKeyboard(rows);
}

/** Age picker: one-tap buttons for the common range, manual entry beyond it. */
export function ageKeyboard(page = 0, withBack = false) {
  const { from, to } = profileConfig.quickAgeRange;
  const all: number[] = [];
  for (let age = from; age <= to; age += 1) all.push(age);

  const perPage = profileConfig.agesPerPage;
  const pageCount = Math.ceil(all.length / perPage);
  const safePage = Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
  const slice = all.slice(safePage * perPage, safePage * perPage + perPage);

  const rows: InlineKeyboardButton[][] = chunk(
    slice.map((age) => Markup.button.callback(String(age), `reg:age:${age}`)),
    profileConfig.agesPerRow,
  );

  const nav: InlineKeyboardButton[] = [];
  if (safePage > 0) nav.push(Markup.button.callback('◀️', `reg:age_page:${safePage - 1}`));
  if (safePage < pageCount - 1) {
    nav.push(Markup.button.callback('▶️', `reg:age_page:${safePage + 1}`));
  }
  if (nav.length > 0) rows.push(nav);

  rows.push([Markup.button.callback('✍️ Ввести другой возраст', 'reg:age_manual')]);
  if (withBack) rows.push([backButton()]);

  return Markup.inlineKeyboard(rows);
}

/**
 * Country picker: popular countries as buttons, everything else by typing.
 * The full ISO list is searchable, so no pagination is needed here (ТЗ §7).
 */
export function countryKeyboard(popular: GeoCountry[], options?: { withBack?: boolean }) {
  const rows: InlineKeyboardButton[][] = chunk(
    popular.map((country) =>
      Markup.button.callback(`${country.flag} ${country.name}`, `reg:country:${country.code}`),
    ),
    geoConfig.countriesPerRow,
  );
  if (options?.withBack !== false) rows.push([backButton()]);
  return Markup.inlineKeyboard(rows);
}

/** "Did you mean..." list after a typo in the country name. */
export function countrySuggestionsKeyboard(
  suggestions: GeoCountry[],
  mode: 'reg' | 'profile' = 'reg',
) {
  const rows: InlineKeyboardButton[][] = suggestions.map((country) => [
    Markup.button.callback(`${country.flag} ${country.name}`, `reg:country:${country.code}`),
  ]);
  rows.push([Markup.button.callback('🌍 Показать частые страны', 'reg:country_popular')]);
  rows.push([
    mode === 'profile' ? Markup.button.callback('↩️ Отмена', 'profile:cancel_edit') : backButton(),
  ]);
  return Markup.inlineKeyboard(rows);
}

/** Biggest cities of the chosen country, offered before the user types. */
export function cityKeyboard(topCities: GeoCity[], options?: { withBack?: boolean }) {
  const rows: InlineKeyboardButton[][] = topCities.map((city) => [
    Markup.button.callback(city.name, `reg:city:${city.id}`),
  ]);
  rows.push([Markup.button.callback('⏭ Пропустить', 'reg:city_skip')]);
  if (options?.withBack !== false) rows.push([backButton()]);
  return Markup.inlineKeyboard(rows);
}

/** "Did you mean..." list after a typo in the city name. */
export function citySuggestionsKeyboard(suggestions: GeoCity[], options?: { withBack?: boolean }) {
  const rows: InlineKeyboardButton[][] = suggestions.map((city) => [
    Markup.button.callback(city.name, `reg:city:${city.id}`),
  ]);
  rows.push([Markup.button.callback('📋 Список городов', 'reg:city_top')]);
  rows.push([Markup.button.callback('⏭ Пропустить', 'reg:city_skip')]);
  if (options?.withBack !== false) rows.push([backButton()]);
  return Markup.inlineKeyboard(rows);
}

export function sportKeyboard() {
  const rows = getActiveSportConfigs().map((sport) => [
    Markup.button.callback(`${sport.emoji} ${sport.title}`, `reg:sport:${sport.slug}`),
  ]);
  rows.push([backButton()]);
  return Markup.inlineKeyboard(rows);
}

/** Level picker built from the sport config, never hardcoded (ТЗ §39). */
export function levelKeyboard(sportSlug: string, options?: { withBack?: boolean; prefix?: string }) {
  const sport = getSportConfig(sportSlug);
  const prefix = options?.prefix ?? 'reg';
  const rows: InlineKeyboardButton[][] = chunk(
    sport.levels.map((level) =>
      Markup.button.callback(level.label, `${prefix}:level:${level.value}`),
    ),
    3,
  );
  rows.push([Markup.button.callback('🤔 Не знаю свой уровень', `${prefix}:level_unknown`)]);
  if (options?.withBack !== false) rows.push([backButton()]);
  return Markup.inlineKeyboard(rows);
}

export function quizIntroKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('▶️ Пройти тест', 'quiz:start')],
    [Markup.button.callback('⬅️ Выбрать уровень вручную', 'quiz:cancel')],
  ]);
}

export function quizQuestionKeyboard(
  answers: Array<{ id: number; answer: string }>,
  canGoBack: boolean,
) {
  const rows: InlineKeyboardButton[][] = answers.map((answer) => [
    Markup.button.callback(answer.answer, `quiz:a:${answer.id}`),
  ]);
  if (canGoBack) rows.push([Markup.button.callback('⬅️ Назад', 'quiz:back')]);
  return Markup.inlineKeyboard(rows);
}

export function quizResultKeyboard(context: 'registration' | 'profile') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Принять уровень', `quiz:accept:${context}`)],
    [Markup.button.callback('✏️ Выбрать уровень вручную', `quiz:manual:${context}`)],
    [Markup.button.callback('🔄 Пройти тест заново', 'quiz:restart')],
  ]);
}

export function photoKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏭ Пропустить', 'reg:photo_skip')],
    [backButton()],
  ]);
}

export function aboutKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏭ Пропустить', 'reg:about_skip')],
    [backButton()],
  ]);
}

export function confirmProfileKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Всё верно', 'reg:confirm')],
    [Markup.button.callback('✏️ Изменить', 'reg:edit')],
  ]);
}

/** Field picker used both by "Изменить" during registration and by the profile menu. */
export function editFieldsKeyboard(scope: 'reg' | 'profile') {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎂 Возраст', `${scope}:edit_field:age`),
      Markup.button.callback('🌍 Страна', `${scope}:edit_field:country`),
    ],
    [
      Markup.button.callback('📍 Город', `${scope}:edit_field:city`),
      Markup.button.callback('🎾 Уровень', `${scope}:edit_field:level`),
    ],
    [
      Markup.button.callback('📷 Фото', `${scope}:edit_field:photo`),
      Markup.button.callback('✍️ О себе', `${scope}:edit_field:about`),
    ],
    [
      Markup.button.callback(
        scope === 'reg' ? '⬅️ К проверке профиля' : '⬅️ Назад',
        scope === 'reg' ? 'reg:to_confirm' : 'profile:show',
      ),
    ],
  ]);
}

/**
 * Keyboard for editing one field outside registration: the flow has no Back,
 * only "clear this value" (where the field is optional) and Cancel.
 */
export function editValueKeyboard(
  field: 'age' | 'country' | 'city' | 'photo' | 'about' | 'level',
  options?: { clearable?: boolean },
) {
  const rows: InlineKeyboardButton[][] = [];
  if (options?.clearable) {
    rows.push([Markup.button.callback('🚫 Убрать значение', `profile:clear:${field}`)]);
  }
  rows.push([Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')]);
  return Markup.inlineKeyboard(rows);
}

export function ageEditKeyboard(page = 0) {
  const base = ageKeyboard(page, false);
  return Markup.inlineKeyboard([
    ...base.reply_markup.inline_keyboard,
    [Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')],
  ]);
}

export function countryEditKeyboard(popular: GeoCountry[]) {
  const base = countryKeyboard(popular, { withBack: false });
  return Markup.inlineKeyboard([
    ...base.reply_markup.inline_keyboard,
    [Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')],
  ]);
}

export function cityEditKeyboard(topCities: GeoCity[], options?: { clearable?: boolean }) {
  const rows: InlineKeyboardButton[][] = topCities.map((city) => [
    Markup.button.callback(city.name, `reg:city:${city.id}`),
  ]);
  if (options?.clearable) {
    rows.push([Markup.button.callback('🚫 Убрать город', 'profile:clear:city')]);
  }
  rows.push([Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')]);
  return Markup.inlineKeyboard(rows);
}

export function citySuggestionsEditKeyboard(suggestions: GeoCity[]) {
  const rows: InlineKeyboardButton[][] = suggestions.map((city) => [
    Markup.button.callback(city.name, `reg:city:${city.id}`),
  ]);
  rows.push([Markup.button.callback('📋 Список городов', 'reg:city_top')]);
  rows.push([Markup.button.callback('↩️ Отмена', 'profile:cancel_edit')]);
  return Markup.inlineKeyboard(rows);
}

export function profileKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить профиль', 'profile:edit')],
    [Markup.button.callback('🏆 Виды спорта и уровни', 'profile:sports')],
    [Markup.button.callback('📷 Изменить фото', 'profile:edit_field:photo')],
  ]);
}

/**
 * Sports the user plays: tap one to change its level, plus adding and removing
 * whole sport profiles (ТЗ §39 — several sports per user).
 */
export function userSportsKeyboard(
  played: Array<{ slug: string; label: string }>,
  canAdd: boolean,
  canRemove: boolean,
) {
  const rows: InlineKeyboardButton[][] = played.map((sport) => [
    Markup.button.callback(sport.label, `profile:sport_level:${sport.slug}`),
  ]);

  if (canRemove) {
    rows.push(
      ...played.map((sport) => [
        Markup.button.callback(`🗑 Убрать ${sport.label}`, `profile:sport_remove:${sport.slug}`),
      ]),
    );
  }
  if (canAdd) {
    rows.push([Markup.button.callback('➕ Добавить вид спорта', 'profile:sport_add')]);
  }
  rows.push([Markup.button.callback('⬅️ Назад', 'profile:show')]);
  return Markup.inlineKeyboard(rows);
}

/** Sports the user does not play yet. */
export function addSportKeyboard(available: Array<{ slug: string; label: string }>) {
  const rows: InlineKeyboardButton[][] = available.map((sport) => [
    Markup.button.callback(sport.label, `profile:sport_new:${sport.slug}`),
  ]);
  rows.push([Markup.button.callback('⬅️ Назад', 'profile:sports')]);
  return Markup.inlineKeyboard(rows);
}

/** Which sport to search partners for, when the user plays several. */
export function searchSportKeyboard(played: Array<{ slug: string; label: string }>) {
  const rows: InlineKeyboardButton[][] = played.map((sport) => [
    Markup.button.callback(sport.label, `search:sport:${sport.slug}`),
  ]);
  rows.push([Markup.button.callback('🏠 В меню', 'search:stop')]);
  return Markup.inlineKeyboard(rows);
}

/** Telegram usernames: 5–32 of letters, digits and underscores. */
const TELEGRAM_USERNAME = /^[A-Za-z0-9_]{4,32}$/;

export function telegramLink(username: string | null | undefined): string | null {
  if (!username) return null;
  const handle = username.replace(/^@/, '');
  return TELEGRAM_USERNAME.test(handle) ? `https://t.me/${handle}` : null;
}

/**
 * Player card actions (ТЗ §19). "Написать" is a plain link straight into the
 * player's Telegram chat — one tap, no intermediate screen. Only a player
 * without a public username falls back to a callback, because there is nothing
 * to link to and the bot has to explain that.
 */
export function playerCardKeyboard(username: string | null | undefined) {
  const link = telegramLink(username);

  return Markup.inlineKeyboard([
    [
      link
        ? Markup.button.url('💬 Написать', link)
        : Markup.button.callback('💬 Написать', 'search:msg'),
      Markup.button.callback('➡️ Следующий', 'search:next'),
    ],
    [Markup.button.callback('🏠 В меню', 'search:stop')],
  ]);
}

export function contactKeyboard(username: string | null) {
  const rows: InlineKeyboardButton[][] = [];
  if (username) {
    rows.push([Markup.button.url('💬 Открыть Telegram', `https://t.me/${username}`)]);
  }
  rows.push([Markup.button.callback('➡️ Следующий игрок', 'search:next')]);
  rows.push([Markup.button.callback('🏠 В меню', 'search:stop')]);
  return Markup.inlineKeyboard(rows);
}

export function emptySearchKeyboard(options: { hasViewed: boolean; canExpand: boolean }) {
  const rows: InlineKeyboardButton[][] = [];
  if (options.canExpand) {
    // Leaving the city is always an explicit choice, never a silent fallback.
    rows.push([Markup.button.callback('🌍 Искать в других городах', 'search:expand')]);
  }
  if (options.hasViewed) {
    rows.push([Markup.button.callback('🔄 Смотреть заново', 'search:reset')]);
  }
  rows.push([Markup.button.callback('🏠 В меню', 'search:stop')]);
  return Markup.inlineKeyboard(rows);
}

export function settingsKeyboard(options: { isActive: boolean; notifyNewPlayers: boolean }) {
  return Markup.inlineKeyboard([
    [
      options.isActive
        ? Markup.button.callback('🙈 Скрыть профиль', 'settings:hide')
        : Markup.button.callback('👁 Вернуть профиль в поиск', 'settings:show'),
    ],
    [
      options.notifyNewPlayers
        ? Markup.button.callback('🔕 Отключить уведомления', 'settings:notify_off')
        : Markup.button.callback('🔔 Включить уведомления', 'settings:notify_on'),
    ],
    [Markup.button.callback('✏️ Изменить профиль', 'profile:edit')],
    [Markup.button.callback('🗑 Удалить аккаунт', 'settings:delete')],
  ]);
}

export function deleteConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Да, удалить', 'settings:delete_confirm')],
    [Markup.button.callback('↩️ Отмена', 'settings:cancel')],
  ]);
}
