import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * The digest writes to people unprompted, so the rules that keep it quiet are
 * the ones worth testing: only new players, only the same city, only opted-in
 * users, and never the same player twice.
 *
 * Run with: npm run test:digest
 */

const workDir = mkdtempSync(join(tmpdir(), 'partner-bot-digest-'));
const databaseUrl = `file:${join(workDir, 'test.db').replace(/\\/g, '/')}`;

process.env.DATABASE_URL = databaseUrl;
process.env.BOT_TOKEN = 'test-token-0000000000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

type Prisma = Awaited<typeof import('../src/db/client.js')>['prisma'];
type DigestService = Awaited<typeof import('../src/services/digestService.js')>['digestService'];
type UserService = Awaited<typeof import('../src/services/userService.js')>['userService'];

let prisma: Prisma;
let digestService: DigestService;
let userService: UserService;
let renderDigest: Awaited<typeof import('../src/bot/digest.js')>['renderDigest'];

/** Chisinau in the geo reference data. */
const CHISINAU = 618426;
const BALTI = 618605;

async function createPlayer(input: {
  telegramId: number;
  firstName: string;
  cityId: number | null;
  city: string | null;
  level: number;
  createdAt?: Date;
}) {
  const user = await userService.ensureUser({
    telegramId: BigInt(input.telegramId),
    telegramUsername: `user${input.telegramId}`,
    firstName: input.firstName,
  });

  const registered = await userService.completeRegistration(user.id, {
    displayName: input.firstName,
    age: 30,
    countryCode: 'MD',
    countryName: 'Молдова',
    city: input.city,
    cityGeonameId: input.cityId,
    photoFileId: null,
    about: null,
    sportSlug: 'tennis',
    level: input.level,
    levelSource: 'self',
  });

  if (input.createdAt) {
    // Registration time is what decides whether a player counts as "new".
    await prisma.user.update({
      where: { id: registered.id },
      data: { createdAt: input.createdAt },
    });
  }

  return registered;
}

function digestFor(items: Awaited<ReturnType<DigestService['collectDigests']>>, telegramId: number) {
  return items.find((item) => item.user.telegramId === BigInt(telegramId));
}

describe('new players digest', () => {
  before(async () => {
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });

    const clientModule = await import('../src/db/client.js');
    const { seedSports } = await import('../src/db/seed.js');
    prisma = clientModule.prisma;
    await seedSports(prisma);

    digestService = (await import('../src/services/digestService.js')).digestService;
    userService = (await import('../src/services/userService.js')).userService;
    renderDigest = (await import('../src/bot/digest.js')).renderDigest;
  });

  after(async () => {
    await prisma?.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports only new players from the same city', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

    // The subscriber registered three days ago and has never been notified.
    await createPlayer({
      telegramId: 7001,
      firstName: 'Subscriber',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.5,
      createdAt: hoursAgo(72),
    });

    // Two new locals at a compatible level: both should be counted.
    await createPlayer({
      telegramId: 7002,
      firstName: 'FreshLocal',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.5,
      createdAt: hoursAgo(2),
    });
    await createPlayer({
      telegramId: 7003,
      firstName: 'AnotherLocal',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.0,
      createdAt: hoursAgo(1),
    });

    // Another city — must not be counted.
    await createPlayer({
      telegramId: 7004,
      firstName: 'OtherCity',
      city: 'Bălţi',
      cityId: BALTI,
      level: 3.5,
      createdAt: hoursAgo(1),
    });

    // Outside the ±1.0 tennis tolerance around 3.5, so matching drops them.
    await createPlayer({
      telegramId: 7005,
      firstName: 'WrongLevel',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 2.0,
      createdAt: hoursAgo(1),
    });

    // Registered long before the lookback window: not "new" any more.
    await createPlayer({
      telegramId: 7006,
      firstName: 'OldLocal',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.5,
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    });

    const items = await digestService.collectDigests();
    const subscriber = digestFor(items, 7001);

    assert.ok(subscriber, 'the subscriber should get a digest');
    assert.equal(subscriber.total, 2, 'only the two fresh locals count');
    assert.deepEqual(
      subscriber.sports.map((entry) => entry.sportSlug),
      ['tennis'],
    );
    assert.deepEqual(subscriber.sports[0]!.sampleNames.sort(), ['AnotherLocal', 'FreshLocal']);
  });

  it('renders a message with the count and the city', () => {
    const text = renderDigest({
      user: { city: 'Chisinau', firstName: 'Subscriber' } as never,
      sports: [
        { sportSlug: 'tennis', newPlayers: 2, sampleNames: ['FreshLocal', 'AnotherLocal'] },
      ],
      total: 2,
      coveredUntil: new Date(),
    });

    assert.match(text, /2 новых игрока в Chisinau/);
    assert.match(text, /FreshLocal/);
  });

  it('uses the right plural for a single player', () => {
    const text = renderDigest({
      user: { city: 'Chisinau' } as never,
      sports: [{ sportSlug: 'tennis', newPlayers: 1, sampleNames: [] }],
      total: 1,
      coveredUntil: new Date(),
    });

    assert.match(text, /1 новый игрок в Chisinau/);
  });

  it('breaks the message down per sport when the user plays several', () => {
    const text = renderDigest({
      user: { city: 'Chisinau' } as never,
      sports: [
        { sportSlug: 'tennis', newPlayers: 2, sampleNames: ['Andrei'] },
        { sportSlug: 'padel', newPlayers: 1, sampleNames: ['Victor'] },
      ],
      total: 3,
      coveredUntil: new Date(),
    });

    assert.match(text, /3 новых игрока в Chisinau/);
    assert.match(text, /Теннис: 2/);
    assert.match(text, /Падел: 1/);
  });

  it('does not repeat the same players after a digest was sent', async () => {
    const before = await digestService.collectDigests();
    const subscriber = digestFor(before, 7001);
    assert.ok(subscriber);

    await digestService.markSent(subscriber.user.id, subscriber.coveredUntil);

    const after = await digestService.collectDigests();
    assert.equal(digestFor(after, 7001), undefined, 'nothing new left to report');
  });

  it('reports a player who appears after the last digest', async () => {
    await createPlayer({
      telegramId: 7007,
      firstName: 'EvenFresher',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.5,
    });

    const items = await digestService.collectDigests();
    const subscriber = digestFor(items, 7001);

    assert.ok(subscriber);
    assert.equal(subscriber.total, 1);
    assert.deepEqual(subscriber.sports[0]!.sampleNames, ['EvenFresher']);
  });

  it('counts new players for every sport the user plays', async () => {
    const subscriber = await userService.getByTelegramId(BigInt(7001));
    assert.ok(subscriber);

    // The subscriber picks up padel as a second sport.
    await userService.addSport({
      userId: subscriber.id,
      sportSlug: 'padel',
      level: 3,
      levelSource: 'self',
    });

    // A padel player in the same city at a compatible level.
    const padelPlayer = await createPlayer({
      telegramId: 7008,
      firstName: 'PadelLocal',
      city: 'Chisinau',
      cityId: CHISINAU,
      level: 3.5,
    });
    await userService.removeSport(
      (await userService.getByTelegramId(BigInt(7008)))!,
      'tennis',
    );
    await userService.addSport({
      userId: padelPlayer.id,
      sportSlug: 'padel',
      level: 3,
      levelSource: 'self',
    });

    const items = await digestService.collectDigests();
    const digest = digestFor(items, 7001);

    assert.ok(digest);
    const bySport = new Map(digest.sports.map((entry) => [entry.sportSlug, entry.newPlayers]));
    assert.equal(bySport.get('padel'), 1, 'the padel player should be reported');
    assert.equal(digest.total, [...bySport.values()].reduce((sum, n) => sum + n, 0));
  });

  it('skips users who turned notifications off', async () => {
    const subscriber = await userService.getByTelegramId(BigInt(7001));
    assert.ok(subscriber);

    await digestService.setEnabled(subscriber.id, false);
    const items = await digestService.collectDigests();
    assert.equal(digestFor(items, 7001), undefined);

    await digestService.setEnabled(subscriber.id, true);
    const restored = await digestService.collectDigests();
    assert.ok(digestFor(restored, 7001), 'turning notifications back on restores the digest');
  });

  it('skips users with a hidden profile and users without a city', async () => {
    const subscriber = await userService.getByTelegramId(BigInt(7001));
    assert.ok(subscriber);

    await userService.setActive(subscriber.id, false);
    assert.equal(digestFor(await digestService.collectDigests(), 7001), undefined);
    await userService.setActive(subscriber.id, true);

    await userService.updateFields(subscriber.id, { city: null, cityGeonameId: null });
    assert.equal(digestFor(await digestService.collectDigests(), 7001), undefined);
  });

  it('never reports a profile the user already viewed in search', async () => {
    const subscriber = await userService.getByTelegramId(BigInt(7001));
    assert.ok(subscriber);
    await userService.updateFields(subscriber.id, {
      city: 'Chisinau',
      cityGeonameId: CHISINAU,
    });

    const pending = digestFor(await digestService.collectDigests(), 7001);
    assert.ok(pending, 'expected something to report before viewing');

    const { matchingService } = await import('../src/services/matchingService.js');
    const viewer = (await userService.getByTelegramId(BigInt(7001)))!;

    // View everyone in every sport the subscriber plays.
    for (const sportSlug of userService.sportSlugs(viewer)) {
      const candidates = await matchingService.findCandidates({ viewer, sportSlug });
      for (const candidate of candidates) {
        await matchingService.recordAction({
          viewerId: subscriber.id,
          viewedUserId: candidate.user.id,
          sportSlug,
          action: 'view',
        });
      }
    }

    assert.equal(
      digestFor(await digestService.collectDigests(), 7001),
      undefined,
      'already-seen players must not come back as "new"',
    );
  });
});
