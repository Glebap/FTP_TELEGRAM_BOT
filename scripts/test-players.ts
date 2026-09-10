/**
 * Test players for manual checks in Telegram.
 *
 *   npx tsx scripts/test-players.ts add [count]   # add fake players
 *   npx tsx scripts/test-players.ts clear         # remove all of them
 *   npx tsx scripts/test-players.ts list          # show what is in the database
 *
 * They live in a reserved telegramId range so `clear` can never touch a real
 * user. Never run `add` against a production database.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_SPORT_SLUG } from '../src/config/sports.js';

const prisma = new PrismaClient();

/** Fake Telegram ids: real ones are far below this. */
const TEST_ID_BASE = 900_000_000n;
const TEST_ID_LIMIT = 901_000_000n;

const CHISINAU = { city: 'Chisinau', cityGeonameId: 618426, countryCode: 'MD', countryName: 'Молдова' };

interface TestPlayer {
  firstName: string;
  age: number;
  level: number;
  about: string | null;
  /** Set to reuse a photo the bot has already seen (see below). */
  withPhoto?: boolean;
}

/**
 * Levels are inside the tennis tolerance of ±1.0 around 3.5, so they show up
 * for a 3.0–4.5 player in Chisinau.
 */
const PLAYERS: TestPlayer[] = [
  {
    firstName: 'Andrei',
    age: 26,
    level: 3.5,
    about: 'Играю два раза в неделю по вечерам. Ищу партнёра для регулярных игр, корты на Ботанике.',
    withPhoto: true,
  },
  {
    firstName: 'Victor',
    age: 31,
    level: 4.0,
    about: 'Играю несколько лет, люблю быстрый темп. Свободен по утрам в выходные.',
  },
  {
    firstName: 'Sergiu',
    age: 22,
    level: 3.0,
    about: null,
  },
];

/**
 * A bot can only send a photo by a file_id it has seen itself, so there is no
 * way to invent one. To show the card with a picture we reuse a photo that is
 * already in the database (the admin's own), and fall back to a text card.
 */
async function borrowPhotoFileId(): Promise<string | null> {
  const withPhoto = await prisma.user.findFirst({
    where: { photoFileId: { not: null }, telegramId: { lt: TEST_ID_BASE } },
    select: { photoFileId: true },
  });
  return withPhoto?.photoFileId ?? null;
}

async function add(count: number): Promise<void> {
  const sport = await prisma.sport.findUnique({ where: { slug: DEFAULT_SPORT_SLUG } });
  if (!sport) throw new Error('Sports are not seeded — run "npm run db:seed" first');

  const photoFileId = await borrowPhotoFileId();
  const admin = await prisma.user.findFirst({
    where: { telegramId: { lt: TEST_ID_BASE }, telegramUsername: { not: null } },
    select: { telegramUsername: true },
  });

  for (const [index, player] of PLAYERS.slice(0, count).entries()) {
    const telegramId = TEST_ID_BASE + BigInt(index + 1);

    const user = await prisma.user.upsert({
      where: { telegramId },
      update: {},
      create: {
        telegramId,
        // Reusing the admin's username keeps the "Написать" button safe to tap:
        // it opens the admin's own chat instead of a stranger's.
        telegramUsername: admin?.telegramUsername ?? null,
        firstName: player.firstName,
        age: player.age,
        about: player.about,
        photoFileId: player.withPhoto ? photoFileId : null,
        isRegistered: true,
        isActive: true,
        // A fake chat cannot receive anything, so keep them out of the digest.
        notifyNewPlayers: false,
        ...CHISINAU,
      },
    });

    await prisma.userSport.upsert({
      where: { userId_sportId: { userId: user.id, sportId: sport.id } },
      update: { level: player.level },
      create: { userId: user.id, sportId: sport.id, level: player.level, isPrimary: true },
    });

    console.log(
      `✓ ${player.firstName}, ${player.age} — ${DEFAULT_SPORT_SLUG} ${player.level}, ${CHISINAU.city}` +
        `${player.withPhoto && photoFileId ? ', с фото' : ''}`,
    );
  }
}

async function clear(): Promise<void> {
  const { count } = await prisma.user.deleteMany({
    where: { telegramId: { gte: TEST_ID_BASE, lt: TEST_ID_LIMIT } },
  });
  // Views and contacts pointing at them are removed by the cascade.
  console.log(`✓ удалено тестовых профилей: ${count}`);
}

async function list(): Promise<void> {
  const users = await prisma.user.findMany({
    include: { sports: { include: { sport: true } } },
    orderBy: { telegramId: 'asc' },
  });

  for (const user of users) {
    const test = user.telegramId >= TEST_ID_BASE && user.telegramId < TEST_ID_LIMIT;
    const sports = user.sports.map((s) => `${s.sport.slug} ${s.level}`).join(', ') || '—';
    console.log(
      `${test ? '[тест]' : '[реал]'} ${user.firstName ?? '—'}, ${user.age ?? '—'} | ` +
        `${user.city ?? '—'} | ${sports} | активен: ${user.isActive}`,
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'add';
  const count = Number(process.argv[3] ?? 1);

  if (command === 'add') await add(Number.isFinite(count) && count > 0 ? count : 1);
  else if (command === 'clear') await clear();
  else if (command === 'list') await list();
  else {
    console.error(`Unknown command "${command}". Use add | clear | list.`);
    process.exit(1);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
