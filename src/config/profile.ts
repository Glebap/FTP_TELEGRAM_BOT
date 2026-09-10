/** Profile field limits and defaults (ТЗ §6, §14). */
export const profileConfig = {
  /**
   * There is no 18+ gate: the bot is about finding someone to play with, so
   * these bounds only exist to catch typos like "5" or "250".
   */
  minAge: 6,
  maxAge: 99,
  /** Ages offered as one-tap buttons; anything else is typed in. */
  quickAgeRange: { from: 12, to: 51 },
  /** Display name shown on the card. */
  nameMinLength: 2,
  nameMaxLength: 32,
  aboutMaxLength: 500,
  agesPerRow: 5,
  agesPerPage: 20,
};
