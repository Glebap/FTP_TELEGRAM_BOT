import type { Context } from 'telegraf';
import type { MatchScope } from '../config/matching.js';
import type { UserWithSports } from '../db/repositories/userRepository.js';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

/** Registration FSM states (ТЗ §29). */
export const REGISTRATION_STEPS = [
  'name',
  'age',
  'country',
  'city',
  'sport',
  'level',
  'quiz',
  'photo',
  'about',
  'confirm',
] as const;

export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];

/** Fields the user can edit one at a time from "My profile" (ТЗ §23). */
export type EditableField =
  | 'name'
  | 'age'
  | 'country'
  | 'city'
  | 'photo'
  | 'about'
  | 'level';

export interface RegistrationDraft {
  /** Name chosen on the first step, either typed or taken from Telegram. */
  displayName?: string;
  age?: number;
  countryCode?: string;
  countryName?: string;
  city?: string | null;
  /** GeoNames id of the picked city; null when the step was skipped. */
  cityId?: number | null;
  sportSlug?: string;
  level?: number;
  levelSource?: 'self' | 'quiz';
  photoFileId?: string | null;
  about?: string | null;
}

export interface QuizState {
  sportSlug: string;
  index: number;
  answers: Array<{ questionKey: string; score: number }>;
  /** Where to go once the quiz finishes: registration flow or level editing. */
  returnTo: 'registration' | 'profile';
  /** Scored result, kept so accepting it does not re-run the calculation. */
  result?: { totalScore: number; averageScore: number; calculatedLevel: number };
}

export interface SearchState {
  sportSlug: string;
  /** 'city' searches the viewer's city only; 'any' drops that filter. */
  scope?: MatchScope;
  /** Pre-ranked queue of user ids; refilled when it runs out. */
  queue: number[];
  currentUserId?: number;
  /** Message id of the card being shown, so it can be replaced in place. */
  cardMessageId?: number;
  cardHasPhoto?: boolean;
}

export interface SessionData {
  step?: RegistrationStep;
  draft: RegistrationDraft;
  quiz?: QuizState;
  search?: SearchState;
  /** Set while the bot waits for a single field update outside registration. */
  editing?: EditableField;
  /** Which sport profile a level edit or quiz applies to. */
  editingSport?: string;
  /**
   * Which draft field is being re-entered from the confirmation screen.
   * Set only during registration; DB edits use `editing` instead.
   */
  draftField?: EditableField;
  /** Pagination offsets for the country / age pickers. */
  page?: number;
}

export function createEmptySession(): SessionData {
  return { draft: {} };
}

export interface BotContext extends Context {
  session: SessionData;
  /** Always present after the `attachUser` middleware runs. */
  dbUser: UserWithSports;
}

/**
 * Prisma-backed session store: an interrupted registration survives a restart,
 * which the in-memory default cannot do.
 */
export const sessionStore = {
  async get(key: string): Promise<SessionData | undefined> {
    const row = await prisma.session.findUnique({ where: { key } });
    if (!row) return undefined;
    try {
      return JSON.parse(row.data) as SessionData;
    } catch (error) {
      logger.warn({ err: error, key }, 'Corrupted session payload, starting fresh');
      return undefined;
    }
  },

  async set(key: string, value: SessionData): Promise<void> {
    const data = JSON.stringify(value);
    await prisma.session.upsert({
      where: { key },
      update: { data },
      create: { key, data },
    });
  },

  async delete(key: string): Promise<void> {
    await prisma.session.deleteMany({ where: { key } });
  },
};

export function resetFlow(session: SessionData): void {
  delete session.step;
  delete session.quiz;
  delete session.editing;
  delete session.editingSport;
  delete session.draftField;
  delete session.page;
  session.draft = {};
}
