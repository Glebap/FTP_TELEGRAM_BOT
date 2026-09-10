import { matchingConfig, matchingWeights, type MatchingWeights } from '../config/matching.js';

/**
 * Everything the compatibility score needs, and nothing else. Keeping this
 * free of Prisma types is what makes the algorithm unit-testable (ТЗ §37, §44).
 */
export interface ScoringProfile {
  id: number;
  age: number | null;
  countryCode: string | null;
  city: string | null;
  /** GeoNames id of the city; the reliable way to compare two locations. */
  cityId?: number | null;
  level: number | null;
  hasPhoto: boolean;
  hasAbout: boolean;
  updatedAt?: Date;
}

export interface ScoreBreakdown {
  total: number;
  parts: Record<string, number>;
}

/** City comparison is case- and whitespace-insensitive, "Кишинёв" == "кишинев ". */
export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const normalized = city
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

/**
 * Two profiles are in the same city when they point at the same reference
 * entry. Names are only compared for rows written before the city reference
 * data existed.
 */
export function isSameCity(a: ScoringProfile, b: ScoringProfile): boolean {
  if (a.cityId != null && b.cityId != null) return a.cityId === b.cityId;

  const cityA = normalizeCity(a.city);
  const cityB = normalizeCity(b.city);
  return cityA !== null && cityA === cityB;
}

function pointsForDifference(
  difference: number,
  tiers: Array<{ maxDiff: number; points: number }>,
): number {
  // Tiers are ordered from the tightest match to the loosest.
  for (const tier of tiers) {
    if (difference <= tier.maxDiff + 1e-9) return tier.points;
  }
  return 0;
}

export function computeCompatibilityScore(
  viewer: ScoringProfile,
  candidate: ScoringProfile,
  weights: MatchingWeights = matchingWeights,
  now: Date = new Date(),
): ScoreBreakdown {
  const parts: Record<string, number> = {};

  const sameCountry =
    viewer.countryCode !== null &&
    candidate.countryCode !== null &&
    viewer.countryCode === candidate.countryCode;

  // same city > same country > other countries (ТЗ §8). A city match only
  // counts inside the same country, so "Berlin, US" never matches "Berlin, DE".
  if (sameCountry && isSameCity(viewer, candidate)) {
    parts.sameCity = weights.sameCity;
  }
  if (sameCountry) {
    parts.sameCountry = weights.sameCountry;
  }

  if (viewer.level !== null && candidate.level !== null) {
    const levelPoints = pointsForDifference(
      Math.abs(viewer.level - candidate.level),
      weights.levelDifference,
    );
    if (levelPoints > 0) parts.level = levelPoints;
  }

  if (viewer.age !== null && candidate.age !== null) {
    const agePoints = pointsForDifference(
      Math.abs(viewer.age - candidate.age),
      weights.ageDifference,
    );
    if (agePoints > 0) parts.age = agePoints;
  }

  if (candidate.hasPhoto) parts.hasPhoto = weights.hasPhoto;
  if (candidate.hasAbout) parts.hasAbout = weights.hasAbout;

  if (candidate.updatedAt) {
    const ageInDays = (now.getTime() - candidate.updatedAt.getTime()) / 86_400_000;
    if (ageInDays <= matchingConfig.recentlyActiveDays) {
      parts.recentlyActive = weights.recentlyActive;
    }
  }

  const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { total, parts };
}

export interface ScoredCandidate<T> {
  candidate: T;
  score: number;
  breakdown: ScoreBreakdown;
}

/**
 * Sorts candidates by score, descending. Ties break on id so pagination is
 * stable across calls.
 */
export function rankCandidates<T extends ScoringProfile>(
  viewer: ScoringProfile,
  candidates: T[],
  weights: MatchingWeights = matchingWeights,
  now: Date = new Date(),
): ScoredCandidate<T>[] {
  return candidates
    .map((candidate) => {
      const breakdown = computeCompatibilityScore(viewer, candidate, weights, now);
      return { candidate, score: breakdown.total, breakdown };
    })
    .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
}
