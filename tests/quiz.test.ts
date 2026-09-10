import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSportConfig, sports } from '../src/config/sports.js';
import { calculateLevelFromScores, mapAverageToLevel } from '../src/services/levelCalculator.js';

const tennis = getSportConfig('tennis');

describe('every active sport is usable', () => {
  const active = sports.filter((sport) => sport.isActive);

  it('ships tennis, padel and badminton', () => {
    assert.deepEqual(
      active.map((sport) => sport.slug).sort(),
      ['badminton', 'padel', 'tennis'],
    );
  });

  for (const sport of active) {
    it(`${sport.slug}: has a level scale, a tolerance and a full quiz`, () => {
      assert.ok(sport.levels.length >= 3, 'a level picker needs at least three options');
      assert.ok(sport.levelTolerance > 0, 'without tolerance nobody matches');
      assert.ok(
        sport.quiz.length >= 8 && sport.quiz.length <= 12,
        `expected ~10 quiz questions, got ${sport.quiz.length}`,
      );

      const keys = sport.quiz.map((question) => question.key);
      assert.equal(new Set(keys).size, keys.length, 'quiz keys must be unique');

      for (const question of sport.quiz) {
        assert.ok(question.answers.length >= 3, `${question.key}: too few answers`);
        const scores = question.answers.map((answer) => answer.score);
        assert.deepEqual(scores, [...scores].sort((a, b) => a - b), `${question.key}: not ordered`);
        for (const score of scores) {
          assert.ok(score >= 1 && score <= 5, `${question.key}: score out of range`);
        }
      }
    });

    it(`${sport.slug}: the quiz can only produce levels the sport offers`, () => {
      const offered = new Set(sport.levels.map((level) => level.value));
      for (let score = 1; score <= 5; score += 0.1) {
        const result = calculateLevelFromScores([Number(score.toFixed(1))], sport);
        assert.ok(
          offered.has(result.calculatedLevel),
          `${sport.slug}: level ${result.calculatedLevel} is not in the picker`,
        );
      }
    });

    it(`${sport.slug}: extreme answer sheets hit the lowest and highest level`, () => {
      const lowest = Math.min(...sport.levels.map((level) => level.value));
      const highest = Math.max(...sport.levels.map((level) => level.value));

      const allOnes = calculateLevelFromScores(Array.from({ length: 10 }, () => 1), sport);
      const allFives = calculateLevelFromScores(Array.from({ length: 10 }, () => 5), sport);

      assert.equal(allOnes.calculatedLevel, lowest);
      assert.equal(allFives.calculatedLevel, highest);
    });
  }
});

describe('tennis quiz config', () => {
  it('has about ten questions, as the spec requires', () => {
    assert.ok(tennis.quiz.length >= 9 && tennis.quiz.length <= 12, 'expected ~10 questions');
  });

  it('gives every question at least three answers with scores in 1..5', () => {
    for (const question of tennis.quiz) {
      assert.ok(question.answers.length >= 3, `${question.key} has too few answers`);
      for (const answer of question.answers) {
        assert.ok(answer.score >= 1 && answer.score <= 5, `${question.key}: score out of range`);
      }
    }
  });

  it('uses unique question keys', () => {
    const keys = tennis.quiz.map((question) => question.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('keeps answers ordered from weakest to strongest', () => {
    for (const question of tennis.quiz) {
      const scores = question.answers.map((answer) => answer.score);
      const sorted = [...scores].sort((a, b) => a - b);
      assert.deepEqual(scores, sorted, `${question.key}: answers are not ordered by score`);
    }
  });

  it('covers the whole 1..5 average range in the level mapping', () => {
    for (const sport of sports) {
      const ranges = [...sport.levelMapping].sort((a, b) => a.minAvg - b.minAvg);
      assert.equal(ranges[0]!.minAvg, 1.0, `${sport.slug}: mapping must start at 1.0`);
      assert.equal(ranges[ranges.length - 1]!.maxAvg, 5.0, `${sport.slug}: mapping must end at 5.0`);
    }
  });
});

describe('mapAverageToLevel', () => {
  it('maps the ranges from the spec', () => {
    assert.equal(mapAverageToLevel(1.0, tennis), 2.5);
    assert.equal(mapAverageToLevel(1.5, tennis), 2.5);
    assert.equal(mapAverageToLevel(2.0, tennis), 3.0);
    assert.equal(mapAverageToLevel(3.4, tennis), 3.5);
    assert.equal(mapAverageToLevel(4.0, tennis), 4.0);
    assert.equal(mapAverageToLevel(5.0, tennis), 4.5);
  });

  it('clamps values outside the configured bounds', () => {
    assert.equal(mapAverageToLevel(0, tennis), 2.5);
    assert.equal(mapAverageToLevel(9, tennis), 4.5);
  });

  it('resolves the gaps between ranges to the nearest boundary', () => {
    // 1.75 falls between the 1.0–1.7 and 1.8–2.5 ranges.
    const level = mapAverageToLevel(1.75, tennis);
    assert.ok(level === 2.5 || level === 3.0);
  });

  it('is monotonic: a higher average never lowers the level', () => {
    let previous = 0;
    for (let average = 1; average <= 5; average += 0.05) {
      const level = mapAverageToLevel(Number(average.toFixed(2)), tennis);
      assert.ok(level >= previous, `level dropped at average ${average}`);
      previous = level;
    }
  });
});

describe('calculateLevelFromScores', () => {
  it('averages the answers and maps the result', () => {
    const result = calculateLevelFromScores([3, 3, 4, 3, 4, 3, 3, 4, 3, 4], tennis);

    assert.equal(result.totalScore, 34);
    assert.equal(result.averageScore, 3.4);
    assert.equal(result.calculatedLevel, 3.5);
  });

  it('puts an all-beginner answer sheet at the lowest level', () => {
    const result = calculateLevelFromScores(Array.from({ length: 10 }, () => 1), tennis);

    assert.equal(result.averageScore, 1);
    assert.equal(result.calculatedLevel, 2.5);
  });

  it('puts an all-advanced answer sheet at the highest level', () => {
    const result = calculateLevelFromScores(Array.from({ length: 10 }, () => 5), tennis);

    assert.equal(result.averageScore, 5);
    assert.equal(result.calculatedLevel, 4.5);
  });

  it('always returns a level the sport actually offers', () => {
    const offered = new Set(tennis.levels.map((level) => level.value));
    for (let score = 1; score <= 5; score += 0.1) {
      const result = calculateLevelFromScores([Number(score.toFixed(1))], tennis);
      assert.ok(offered.has(result.calculatedLevel), `level ${result.calculatedLevel} is not offered`);
    }
  });

  it('rejects an empty answer sheet', () => {
    assert.throws(() => calculateLevelFromScores([], tennis), /zero answers/);
  });
});
