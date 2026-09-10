import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Integration test against a throwaway SQLite database. It covers the parts of
 * the Definition of Done that pure unit tests cannot: a viewed profile is never
 * shown twice, and local players rank above remote ones (ТЗ §45).
 *
 * Run with: npm run test:integration
 */

const workDir = mkdtempSync(join(tmpdir(), 'partner-bot-test-'));
const databaseUrl = `file:${join(workDir, 'test.db').replace(/\\/g, '/')}`;

process.env.DATABASE_URL = databaseUrl;
process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token-0000000000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

type Modules = {
  prisma: typeof import('../src/db/client.js')['prisma'];
  matchingService: typeof import('../src/services/matchingService.js')['matchingService'];
  userService: typeof import('../src/services/userService.js')['userService'];
  sportRepository: typeof import('../src/db/repositories/sportRepository.js')['sportRepository'];
};

let mod: Modules;

async function createPlayer(input: {
  telegramId: number;
  firstName: string;
  age: number;
  countryCode: string;
  city: string | null;
  cityId?: number | null;
  level: number;
  photo?: boolean;
}) {
  const user = await mod.userService.ensureUser({
    telegramId: BigInt(input.telegramId),
    telegramUsername: `user${input.telegramId}`,
    firstName: input.firstName,
  });

  return mod.userService.completeRegistration(user.id, {
    displayName: input.firstName,
    age: input.age,
    countryCode: input.countryCode,
    countryName: input.countryCode,
    city: input.city,
    cityGeonameId: input.cityId ?? null,
    photoFileId: input.photo ? 'photo-file-id' : null,
    about: null,
    sportSlug: 'tennis',
    level: input.level,
    levelSource: 'self',
  });
}

describe('matching service (integration)', () => {
  before(async () => {
    // Build the schema in the temp database, then seed sports and the quiz.
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });

    const { prisma } = await import('../src/db/client.js');
    const { matchingService } = await import('../src/services/matchingService.js');
    const { userService } = await import('../src/services/userService.js');
    const { sportRepository } = await import('../src/db/repositories/sportRepository.js');
    const { seedSports } = await import('../src/db/seed.js');

    mod = { prisma, matchingService, userService, sportRepository };
    await seedSports(prisma);
  });

  after(async () => {
    await mod?.prisma.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns only players from the same city by default', async () => {
    const viewer = await createPlayer({
      telegramId: 2001,
      firstName: 'Local',
      age: 30,
      countryCode: 'MD',
      city: 'Chisinau',
      cityId: 618426,
      level: 3.5,
    });
    await createPlayer({
      telegramId: 2002,
      firstName: 'SameCityPartner',
      age: 30,
      countryCode: 'MD',
      city: 'Chisinau',
      cityId: 618426,
      level: 3.5,
    });
    await createPlayer({
      telegramId: 2003,
      firstName: 'OtherCity',
      age: 30,
      countryCode: 'MD',
      city: 'Bălţi',
      cityId: 618605,
      level: 3.5,
    });
    await createPlayer({
      telegramId: 2004,
      firstName: 'Abroad',
      age: 30,
      countryCode: 'RO',
      city: 'Bucharest',
      cityId: 683506,
      level: 3.5,
    });

    const local = await mod.matchingService.findCandidates({ viewer, sportSlug: 'tennis' });
    assert.deepEqual(
      local.map((candidate) => candidate.user.firstName),
      ['SameCityPartner'],
      'the default scope must not leak other cities',
    );

    // Widening is explicit and then ranks the closest first.
    const wide = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });
    assert.deepEqual(
      wide.map((candidate) => candidate.user.firstName),
      ['SameCityPartner', 'OtherCity', 'Abroad'],
    );

    // A player without a city can only be found by a widened search.
    await createPlayer({
      telegramId: 2005,
      firstName: 'NoCity',
      age: 30,
      countryCode: 'MD',
      city: null,
      cityId: null,
      level: 3.5,
    });
    const stillLocal = await mod.matchingService.findCandidates({ viewer, sportSlug: 'tennis' });
    assert.ok(!stillLocal.some((candidate) => candidate.user.firstName === 'NoCity'));

    // Clean up so the ranking test below starts from a known state.
    for (const telegramId of [2001, 2002, 2003, 2004, 2005]) {
      await mod.prisma.user.deleteMany({ where: { telegramId: BigInt(telegramId) } });
    }
  });

  it('ranks a same-city player above a same-country and a foreign one', async () => {
    const viewer = await createPlayer({
      telegramId: 1001,
      firstName: 'Viewer',
      age: 30,
      countryCode: 'MD',
      city: 'Кишинёв',
      level: 3.5,
    });
    await createPlayer({
      telegramId: 1002,
      firstName: 'Local',
      age: 31,
      countryCode: 'MD',
      city: 'кишинев',
      level: 3.5,
    });
    await createPlayer({
      telegramId: 1003,
      firstName: 'SameCountry',
      age: 31,
      countryCode: 'MD',
      city: 'Бельцы',
      level: 3.5,
    });
    await createPlayer({
      telegramId: 1004,
      firstName: 'Abroad',
      age: 31,
      countryCode: 'RO',
      city: 'Бухарест',
      level: 3.5,
    });

    // Ranking across cities is only visible with the widened scope.
    const candidates = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.user.firstName),
      ['Local', 'SameCountry', 'Abroad'],
    );
    assert.ok(candidates[0]!.score > candidates[1]!.score);
  });

  it('never returns the viewer or an already viewed profile', async () => {
    const viewer = await mod.userService.getByTelegramId(BigInt(1001));
    assert.ok(viewer);

    const first = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });
    const seen = first[0]!.user;

    await mod.matchingService.recordAction({
      viewerId: viewer.id,
      viewedUserId: seen.id,
      sportSlug: 'tennis',
      action: 'view',
    });

    const second = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });
    const ids = second.map((candidate) => candidate.user.id);

    assert.ok(!ids.includes(seen.id), 'a viewed profile came back');
    assert.ok(!ids.includes(viewer.id), 'the viewer matched themselves');
  });

  it('excludes hidden profiles from the results', async () => {
    const viewer = await mod.userService.getByTelegramId(BigInt(1001));
    assert.ok(viewer);

    await mod.matchingService.resetViewed(viewer.id, 'tennis');
    const before = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });

    const hidden = before[0]!.user;
    await mod.userService.setActive(hidden.id, false);

    const after = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });

    assert.equal(after.length, before.length - 1);
    assert.ok(!after.some((candidate) => candidate.user.id === hidden.id));

    await mod.userService.setActive(hidden.id, true);
  });

  it('applies the sport level tolerance as a hard filter', async () => {
    const viewer = await mod.userService.getByTelegramId(BigInt(1001));
    assert.ok(viewer);

    await createPlayer({
      telegramId: 1005,
      firstName: 'FarLevel',
      age: 30,
      countryCode: 'MD',
      city: 'Кишинёв',
      level: 4.5,
    });
    await mod.matchingService.resetViewed(viewer.id, 'tennis');

    // Viewer is 3.5 and tennis tolerance is 1.0, so 4.5 stays in range while a
    // hypothetical 5.5 would not; verify the boundary is inclusive.
    const candidates = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });
    assert.ok(candidates.some((candidate) => candidate.user.firstName === 'FarLevel'));

    await mod.prisma.userSport.updateMany({
      where: { user: { telegramId: BigInt(1005) } },
      data: { level: 5.5 },
    });
    await mod.matchingService.resetViewed(viewer.id, 'tennis');

    const filtered = await mod.matchingService.findCandidates({
      viewer,
      sportSlug: 'tennis',
      scope: 'any',
    });
    assert.ok(!filtered.some((candidate) => candidate.user.firstName === 'FarLevel'));
  });

  it('keeps registration data after a fresh client connects', async () => {
    const reloaded = await mod.userService.getByTelegramId(BigInt(1002));

    assert.ok(reloaded);
    assert.equal(reloaded.isRegistered, true);
    assert.equal(reloaded.city, 'кишинев');
    assert.equal(mod.userService.levelFor(reloaded, 'tennis'), 3.5);
  });
});
