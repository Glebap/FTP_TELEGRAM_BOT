import { formatLevel } from '../config/sports.js';
import { userService } from '../services/userService.js';
import { goToNextStep, showConfirmation, showProfileScreen } from './flow.js';
import type { BotContext } from './session.js';
import { send } from './ui.js';

/**
 * Single place where a collected value is stored. During registration it lands
 * in the session draft; when the user edits one field from "My profile" it is
 * written straight to the database. Every handler funnels through here so the
 * two flows can never drift apart.
 */

async function afterEdit(ctx: BotContext, notice: string): Promise<void> {
  delete ctx.session.editing;
  await send(ctx, notice);
  await showProfileScreen(ctx);
}

/** True when the answer belongs to a single-field edit rather than registration. */
export function isEditing(ctx: BotContext, field?: string): boolean {
  if (!ctx.session.editing) return false;
  return field === undefined || ctx.session.editing === field;
}

/** Registration draft edits started from the confirmation screen return to it. */
async function afterDraftChange(ctx: BotContext, fromConfirmEdit: boolean): Promise<void> {
  if (fromConfirmEdit) {
    delete ctx.session.draftField;
    await showConfirmation(ctx);
    return;
  }
  await goToNextStep(ctx);
}

/**
 * The chosen name is stored separately from `firstName`, which keeps tracking
 * Telegram on every update — otherwise a custom name would be overwritten the
 * moment the user sent the next message.
 */
export async function applyName(ctx: BotContext, name: string): Promise<void> {
  if (isEditing(ctx, 'name')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, { displayName: name });
    await afterEdit(ctx, `✅ Имя обновлено: ${name}`);
    return;
  }
  ctx.session.draft.displayName = name;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

export async function applyAge(ctx: BotContext, age: number): Promise<void> {
  if (isEditing(ctx, 'age')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, { age });
    await afterEdit(ctx, `✅ Возраст обновлён: ${age}`);
    return;
  }
  ctx.session.draft.age = age;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

export async function applyCountry(
  ctx: BotContext,
  country: { code: string; name: string },
): Promise<void> {
  if (isEditing(ctx, 'country')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, {
      countryCode: country.code,
      countryName: country.name,
    });
    await afterEdit(ctx, `✅ Страна обновлена: ${country.name}`);
    return;
  }
  ctx.session.draft.countryCode = country.code;
  ctx.session.draft.countryName = country.name;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

/**
 * `city` always comes from the geo reference data, never from raw user text,
 * so two players in one city can never end up with two different spellings.
 */
export async function applyCity(
  ctx: BotContext,
  city: { name: string; id: number } | null,
): Promise<void> {
  if (isEditing(ctx, 'city')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, {
      city: city?.name ?? null,
      cityGeonameId: city?.id ?? null,
    });
    await afterEdit(ctx, city ? `✅ Город обновлён: ${city.name}` : '✅ Город удалён');
    return;
  }
  ctx.session.draft.city = city?.name ?? null;
  ctx.session.draft.cityId = city?.id ?? null;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

export async function applyPhoto(ctx: BotContext, photoFileId: string | null): Promise<void> {
  if (isEditing(ctx, 'photo')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, { photoFileId });
    await afterEdit(ctx, photoFileId ? '✅ Фото обновлено' : '✅ Фото удалено');
    return;
  }
  ctx.session.draft.photoFileId = photoFileId;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

export async function applyAbout(ctx: BotContext, about: string | null): Promise<void> {
  if (isEditing(ctx, 'about')) {
    ctx.dbUser = await userService.updateFields(ctx.dbUser.id, { about });
    await afterEdit(ctx, about ? '✅ Текст о себе обновлён' : '✅ Текст о себе удалён');
    return;
  }
  ctx.session.draft.about = about;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}

export async function applyLevel(
  ctx: BotContext,
  level: number,
  source: 'self' | 'quiz',
  sportSlug: string,
): Promise<void> {
  if (isEditing(ctx, 'level')) {
    await userService.setLevel({
      userId: ctx.dbUser.id,
      sportSlug,
      level,
      levelSource: source,
    });
    const refreshed = await userService.getByTelegramId(ctx.dbUser.telegramId);
    if (refreshed) ctx.dbUser = refreshed;
    await afterEdit(ctx, `✅ Уровень обновлён: ${formatLevel(sportSlug, level)}`);
    return;
  }
  ctx.session.draft.level = level;
  ctx.session.draft.levelSource = source;
  ctx.session.draft.sportSlug = sportSlug;
  await afterDraftChange(ctx, ctx.session.step === 'confirm');
}
