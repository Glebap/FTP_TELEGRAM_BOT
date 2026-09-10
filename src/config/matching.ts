/**
 * Compatibility scoring weights (ТЗ §18, §37).
 *
 * Every coefficient lives here so the algorithm can be tuned without touching
 * MatchingService. Keep the pure scoring function in src/services/scoring.ts.
 */
export interface MatchingWeights {
  sameCity: number;
  sameCountry: number;
  /** Level difference (on the sport's own scale) -> bonus points. */
  levelDifference: Array<{ maxDiff: number; points: number }>;
  /** Age difference in years -> bonus points. */
  ageDifference: Array<{ maxDiff: number; points: number }>;
  hasPhoto: number;
  hasAbout: number;
  /** Newer profiles get a small nudge so fresh users are not buried. */
  recentlyActive: number;
}

export const matchingWeights: MatchingWeights = {
  sameCity: 40,
  sameCountry: 20,
  levelDifference: [
    { maxDiff: 0, points: 25 },
    { maxDiff: 0.5, points: 20 },
    { maxDiff: 1.0, points: 10 },
  ],
  ageDifference: [
    { maxDiff: 3, points: 10 },
    { maxDiff: 7, points: 5 },
  ],
  hasPhoto: 5,
  hasAbout: 3,
  recentlyActive: 2,
};

/**
 * How wide the search is allowed to look.
 *
 * `city` is the default and a hard filter: a partner in another city cannot be
 * played with, so mixing them into the list only wastes the user's taps. When
 * the local pool runs out the bot offers to switch to `any` explicitly, and
 * scoring still puts the same country first.
 */
export type MatchScope = 'city' | 'any';

export const matchingConfig = {
  /** Scope a search starts with. */
  defaultScope: 'city' as MatchScope,
  /** How many candidates MatchingService pre-loads per query. */
  candidateBatchSize: 20,
  /** Hard cap of rows pulled from the DB before scoring. */
  candidatePoolSize: 300,
  /** A profile updated within this many days counts as "recently active". */
  recentlyActiveDays: 14,
  /**
   * Age window applied as a hard filter. `null` disables it.
   * Kept permissive for the MVP: scoring already prefers closer ages.
   */
  maxAgeDifference: null as number | null,
};
