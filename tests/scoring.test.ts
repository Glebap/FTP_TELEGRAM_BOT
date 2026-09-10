import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchingWeights } from '../src/config/matching.js';
import {
  computeCompatibilityScore,
  normalizeCity,
  rankCandidates,
  type ScoringProfile,
} from '../src/services/scoring.js';

const NOW = new Date('2026-09-09T12:00:00Z');

function profile(overrides: Partial<ScoringProfile> = {}): ScoringProfile {
  return {
    id: 1,
    age: 30,
    countryCode: 'MD',
    city: 'Кишинёв',
    level: 3.5,
    hasPhoto: false,
    hasAbout: false,
    ...overrides,
  };
}

describe('normalizeCity', () => {
  it('ignores case, padding and the ё/е difference', () => {
    assert.equal(normalizeCity(' Кишинёв '), normalizeCity('кишинев'));
    assert.equal(normalizeCity('Chisinau'), 'chisinau');
  });

  it('treats blank input as missing', () => {
    assert.equal(normalizeCity('   '), null);
    assert.equal(normalizeCity(null), null);
  });
});

describe('computeCompatibilityScore', () => {
  it('gives a same-city, same-level player the full local bonus', () => {
    const viewer = profile();
    const candidate = profile({ id: 2 });

    const { total, parts } = computeCompatibilityScore(viewer, candidate, matchingWeights, NOW);

    assert.equal(parts.sameCity, matchingWeights.sameCity);
    assert.equal(parts.sameCountry, matchingWeights.sameCountry);
    assert.equal(parts.level, 25);
    assert.equal(parts.age, 10);
    assert.equal(total, 95);
  });

  it('ranks same city above same country above another country', () => {
    const viewer = profile();
    const sameCity = computeCompatibilityScore(viewer, profile({ id: 2 }), matchingWeights, NOW);
    const sameCountry = computeCompatibilityScore(
      viewer,
      profile({ id: 3, city: 'Бельцы' }),
      matchingWeights,
      NOW,
    );
    const abroad = computeCompatibilityScore(
      viewer,
      profile({ id: 4, countryCode: 'RO', city: 'Бухарест' }),
      matchingWeights,
      NOW,
    );

    assert.ok(sameCity.total > sameCountry.total);
    assert.ok(sameCountry.total > abroad.total);
  });

  it('does not award a city match across different countries', () => {
    const viewer = profile({ city: 'Berlin', countryCode: 'DE' });
    const candidate = profile({ id: 2, city: 'Berlin', countryCode: 'US' });

    const { parts } = computeCompatibilityScore(viewer, candidate, matchingWeights, NOW);

    assert.equal(parts.sameCity, undefined);
    assert.equal(parts.sameCountry, undefined);
  });

  it('degrades the level bonus as the gap widens', () => {
    const viewer = profile();
    const scoreAt = (level: number) =>
      computeCompatibilityScore(viewer, profile({ id: 2, level }), matchingWeights, NOW).parts
        .level ?? 0;

    assert.equal(scoreAt(3.5), 25);
    assert.equal(scoreAt(4.0), 20);
    assert.equal(scoreAt(4.5), 10);
    assert.equal(scoreAt(5.5), 0);
  });

  it('uses the age tiers from the config', () => {
    const viewer = profile({ age: 30 });
    const ageBonus = (age: number) =>
      computeCompatibilityScore(viewer, profile({ id: 2, age }), matchingWeights, NOW).parts.age ??
      0;

    assert.equal(ageBonus(33), 10);
    assert.equal(ageBonus(37), 5);
    assert.equal(ageBonus(45), 0);
  });

  it('adds bonuses for a filled-in profile', () => {
    const viewer = profile();
    const bare = computeCompatibilityScore(viewer, profile({ id: 2 }), matchingWeights, NOW);
    const complete = computeCompatibilityScore(
      viewer,
      profile({ id: 3, hasPhoto: true, hasAbout: true, updatedAt: NOW }),
      matchingWeights,
      NOW,
    );

    assert.equal(
      complete.total - bare.total,
      matchingWeights.hasPhoto + matchingWeights.hasAbout + matchingWeights.recentlyActive,
    );
  });

  it('skips level and age bonuses when the data is missing', () => {
    const viewer = profile({ age: null, level: null });
    const { parts } = computeCompatibilityScore(
      viewer,
      profile({ id: 2, age: null, level: null }),
      matchingWeights,
      NOW,
    );

    assert.equal(parts.level, undefined);
    assert.equal(parts.age, undefined);
  });

  it('ignores a profile last updated long ago for the activity bonus', () => {
    const viewer = profile();
    const stale = new Date(NOW.getTime() - 60 * 86_400_000);
    const { parts } = computeCompatibilityScore(
      viewer,
      profile({ id: 2, updatedAt: stale }),
      matchingWeights,
      NOW,
    );

    assert.equal(parts.recentlyActive, undefined);
  });
});

describe('rankCandidates', () => {
  it('sorts by score descending', () => {
    const viewer = profile();
    const candidates = [
      profile({ id: 10, countryCode: 'RO', city: 'Бухарест', level: 4.5 }),
      profile({ id: 11, city: 'Бельцы' }),
      profile({ id: 12 }),
    ];

    const ranked = rankCandidates(viewer, candidates, matchingWeights, NOW);

    assert.deepEqual(
      ranked.map((entry) => entry.candidate.id),
      [12, 11, 10],
    );
    assert.ok(ranked[0]!.score > ranked[1]!.score);
  });

  it('breaks ties on id so pagination is stable', () => {
    const viewer = profile();
    const candidates = [profile({ id: 7 }), profile({ id: 3 }), profile({ id: 5 })];

    const first = rankCandidates(viewer, candidates, matchingWeights, NOW);
    const second = rankCandidates(viewer, [...candidates].reverse(), matchingWeights, NOW);

    assert.deepEqual(
      first.map((entry) => entry.candidate.id),
      [3, 5, 7],
    );
    assert.deepEqual(
      first.map((entry) => entry.candidate.id),
      second.map((entry) => entry.candidate.id),
    );
  });
});
