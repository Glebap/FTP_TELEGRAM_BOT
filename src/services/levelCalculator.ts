import type { SportConfig } from '../config/sports.js';

export interface QuizResult {
  totalScore: number;
  averageScore: number;
  calculatedLevel: number;
}

/**
 * Quiz scoring (ТЗ §12). The formula lives here and the ranges live in the
 * sport config, so tuning either never touches a handler.
 */
export function calculateLevelFromScores(scores: number[], sport: SportConfig): QuizResult {
  if (scores.length === 0) {
    throw new Error('Cannot calculate a level from zero answers');
  }

  const totalScore = scores.reduce((sum, score) => sum + score, 0);
  const averageScore = totalScore / scores.length;

  return {
    totalScore: round(totalScore, 2),
    averageScore: round(averageScore, 2),
    calculatedLevel: mapAverageToLevel(averageScore, sport),
  };
}

export function mapAverageToLevel(averageScore: number, sport: SportConfig): number {
  const ranges = [...sport.levelMapping].sort((a, b) => a.minAvg - b.minAvg);
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || !last) {
    throw new Error(`Sport "${sport.slug}" has no level mapping configured`);
  }

  // Clamp outside the configured bounds instead of returning undefined; the
  // ranges in the ТЗ leave small gaps (e.g. 1.7 .. 1.8) that must still resolve.
  if (averageScore <= first.minAvg) return first.level;
  if (averageScore >= last.maxAvg) return last.level;

  for (const range of ranges) {
    if (averageScore >= range.minAvg && averageScore <= range.maxAvg) {
      return range.level;
    }
  }

  // Gap between two ranges: attach to the closer boundary.
  let closest = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const range of ranges) {
    const distance = Math.min(
      Math.abs(averageScore - range.minAvg),
      Math.abs(averageScore - range.maxAvg),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = range;
    }
  }
  return closest.level;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
