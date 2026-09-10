import { DEFAULT_SPORT_SLUG } from '../config/sports.js';
import { eventRepository } from '../db/repositories/eventRepository.js';
import { sportRepository } from '../db/repositories/sportRepository.js';
import { userRepository, type UserWithSports } from '../db/repositories/userRepository.js';

export interface ProfileDraftInput {
  displayName: string | null;
  age: number;
  countryCode: string;
  countryName: string;
  city: string | null;
  cityGeonameId: number | null;
  photoFileId: string | null;
  about: string | null;
  sportSlug: string;
  level: number;
  levelSource: 'self' | 'quiz';
}

export const userService = {
  /** Called on every update: keeps username/first name fresh (ТЗ §5). */
  async ensureUser(input: {
    telegramId: bigint;
    telegramUsername: string | null;
    firstName: string | null;
  }): Promise<UserWithSports> {
    return userRepository.upsertFromTelegram(input);
  },

  async getByTelegramId(telegramId: bigint): Promise<UserWithSports | null> {
    return userRepository.findByTelegramId(telegramId);
  },

  /** Name shown to other players: the chosen one, else the Telegram one. */
  displayNameOf(user: { displayName: string | null; firstName: string | null }): string {
    return user.displayName?.trim() || user.firstName?.trim() || 'Игрок';
  },

  isRegistered(user: UserWithSports | null): boolean {
    return Boolean(user?.isRegistered);
  },

  levelFor(user: UserWithSports, sportSlug: string = DEFAULT_SPORT_SLUG): number | null {
    const entry = user.sports.find((s) => s.sport.slug === sportSlug);
    return entry ? entry.level : null;
  },

  /** Slugs of every sport the user plays, primary one first. */
  sportSlugs(user: UserWithSports): string[] {
    return [...user.sports]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id)
      .map((entry) => entry.sport.slug);
  },

  /** The sport used by default in search and notifications. */
  primarySportSlug(user: UserWithSports): string {
    return this.sportSlugs(user)[0] ?? DEFAULT_SPORT_SLUG;
  },

  playsSport(user: UserWithSports, sportSlug: string): boolean {
    return user.sports.some((entry) => entry.sport.slug === sportSlug);
  },

  /** Adds a second (or third) sport profile with its own level. */
  async addSport(input: {
    userId: number;
    sportSlug: string;
    level: number;
    levelSource: 'self' | 'quiz';
  }): Promise<void> {
    const sport = await sportRepository.requireBySlug(input.sportSlug);
    await userRepository.setUserSportLevel({
      userId: input.userId,
      sportId: sport.id,
      level: input.level,
      levelSource: input.levelSource,
    });
  },

  /** Removes a sport profile; the last remaining one cannot be removed. */
  async removeSport(user: UserWithSports, sportSlug: string): Promise<boolean> {
    if (user.sports.length <= 1) return false;
    const sport = await sportRepository.requireBySlug(sportSlug);
    await userRepository.removeUserSport(user.id, sport.id);
    return true;
  },

  /** Writes the confirmed registration draft and marks the profile registered. */
  async completeRegistration(
    userId: number,
    draft: ProfileDraftInput,
  ): Promise<UserWithSports> {
    const sport = await sportRepository.requireBySlug(draft.sportSlug);

    await userRepository.update(userId, {
      displayName: draft.displayName,
      age: draft.age,
      countryCode: draft.countryCode,
      countryName: draft.countryName,
      city: draft.city,
      cityGeonameId: draft.cityGeonameId,
      photoFileId: draft.photoFileId,
      about: draft.about,
      isRegistered: true,
      isActive: true,
    });

    await userRepository.setUserSportLevel({
      userId,
      sportId: sport.id,
      level: draft.level,
      levelSource: draft.levelSource,
    });

    eventRepository.track('registration_completed', userId, draft.sportSlug);

    const user = await userRepository.findById(userId);
    if (!user) throw new Error(`User ${userId} disappeared during registration`);
    return user;
  },

  async updateFields(
    userId: number,
    fields: Partial<{
      displayName: string | null;
      age: number;
      countryCode: string;
      countryName: string;
      city: string | null;
      cityGeonameId: number | null;
      photoFileId: string | null;
      about: string | null;
    }>,
  ): Promise<UserWithSports> {
    return userRepository.update(userId, fields);
  },

  async setLevel(input: {
    userId: number;
    sportSlug: string;
    level: number;
    levelSource: 'self' | 'quiz';
  }): Promise<void> {
    const sport = await sportRepository.requireBySlug(input.sportSlug);
    await userRepository.setUserSportLevel({
      userId: input.userId,
      sportId: sport.id,
      level: input.level,
      levelSource: input.levelSource,
    });
  },

  /** Hide / unhide the profile in search results (ТЗ §31). */
  async setActive(userId: number, isActive: boolean): Promise<void> {
    await userRepository.setActive(userId, isActive);
  },

  /** Full deletion; cascades remove views, contacts and quiz attempts (ТЗ §32). */
  async deleteAccount(userId: number): Promise<void> {
    await userRepository.delete(userId);
  },
};
