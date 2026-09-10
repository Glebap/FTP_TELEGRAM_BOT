import { geoService } from '../../services/geoService.js';
import { userService } from '../../services/userService.js';
import { profileConfig } from '../../config/profile.js';
import { formatLevel, getSportConfig } from '../../config/sports.js';
import type { UserWithSports } from '../../db/repositories/userRepository.js';
import { escapeHtml, truncate } from '../../utils/text.js';
import type { RegistrationDraft } from '../session.js';

export interface ProfileSport {
  slug: string;
  level: number | null;
}

export interface RenderableProfile {
  name: string;
  age: number | null;
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
  /** One entry per sport; a match card carries only the searched one. */
  sports: ProfileSport[];
  about: string | null;
  photoFileId: string | null;
}

/**
 * Renders a user for a card. Pass `sportSlug` to show a single sport (search
 * results), omit it to list every sport the user plays ("My profile").
 */
export function profileFromUser(user: UserWithSports, sportSlug?: string): RenderableProfile {
  const entries = sportSlug
    ? user.sports.filter((entry) => entry.sport.slug === sportSlug)
    : [...user.sports].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id,
      );

  return {
    name: userService.displayNameOf(user),
    age: user.age,
    countryCode: user.countryCode,
    countryName: user.countryName,
    city: user.city,
    sports:
      entries.length > 0
        ? entries.map((entry) => ({ slug: entry.sport.slug, level: entry.level }))
        : sportSlug
          ? [{ slug: sportSlug, level: null }]
          : [],
    about: user.about,
    photoFileId: user.photoFileId,
  };
}

export function profileFromDraft(
  draft: RegistrationDraft,
  fallbackName: string,
  sportSlug: string,
): RenderableProfile {
  return {
    // The name chosen on the first step; the fallback covers a draft that
    // somehow reached the confirmation screen without one.
    name: draft.displayName ?? fallbackName,
    age: draft.age ?? null,
    countryCode: draft.countryCode ?? null,
    countryName: draft.countryName ?? null,
    city: draft.city ?? null,
    sports: [{ slug: sportSlug, level: draft.level ?? null }],
    about: draft.about ?? null,
    photoFileId: draft.photoFileId ?? null,
  };
}

/**
 * One card, one message (ТЗ §43): the same renderer is used for the
 * confirmation screen, "My profile" and the search results.
 */
export function renderProfileCard(
  profile: RenderableProfile,
  options?: { title?: string; showPhotoStatus?: boolean },
): string {
  const lines: string[] = [];

  if (options?.title) {
    lines.push(`<b>${escapeHtml(options.title)}</b>`, '');
  }

  const nameLine =
    profile.age !== null
      ? `👤 <b>${escapeHtml(profile.name)}, ${profile.age}</b>`
      : `👤 <b>${escapeHtml(profile.name)}</b>`;
  lines.push(nameLine);

  lines.push(formatCountryLine(profile.countryCode, profile.countryName));
  if (profile.city) lines.push(`📍 ${escapeHtml(profile.city)}`);
  // One line per sport: "🎾 NTRP 3.5", "🥎 Уровень: средний".
  for (const entry of profile.sports) {
    const sport = getSportConfig(entry.slug);
    lines.push(`${sport.emoji} ${sport.title} — ${formatLevel(entry.slug, entry.level)}`);
  }

  const about = profile.about?.trim();
  if (about) {
    lines.push('', `<i>${escapeHtml(truncate(about, profileConfig.aboutMaxLength))}</i>`);
  }

  if (options?.showPhotoStatus) {
    lines.push('', `Фото: ${profile.photoFileId ? '✅' : '—'}`);
  }

  return lines.join('\n');
}

export function renderMatchCard(profile: RenderableProfile): string {
  return renderProfileCard(profile);
}

/**
 * Country line of a card. The reference data owns the flag and the display
 * name; the stored countryName is only a fallback for rows written before a
 * country left the dataset.
 */
export function formatCountryLine(
  code: string | null | undefined,
  fallbackName?: string | null,
): string {
  const country = geoService.getCountry(code);
  if (country) return `${country.flag} ${country.name}`;
  if (fallbackName) return `🌍 ${fallbackName}`;
  return '—';
}
