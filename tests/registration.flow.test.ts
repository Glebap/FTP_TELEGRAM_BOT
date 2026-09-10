import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { Update } from 'telegraf/types';

/**
 * Drives the real bot through `handleUpdate` with a stubbed Telegram API, so
 * the whole registration FSM, the quiz and the search loop are exercised the
 * way a user would (ТЗ §42, §45).
 *
 * Run with: npm run test:flow
 */

const workDir = mkdtempSync(join(tmpdir(), 'partner-bot-flow-'));
const databaseUrl = `file:${join(workDir, 'test.db').replace(/\\/g, '/')}`;

process.env.DATABASE_URL = databaseUrl;
process.env.BOT_TOKEN = 'test-token-0000000000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

let bot: Telegraf<never>;
let prisma: Awaited<typeof import('../src/db/client.js')>['prisma'];
let calls: ApiCall[] = [];
let resetQuotas: () => void = () => {};
let updateId = 0;
let messageId = 100;
/** Last message the bot produced per chat, used as the callback query target. */
const lastBotMessage = new Map<number, { message_id: number; text: string }>();

function user(id: number, firstName: string, username?: string) {
  return { id, is_bot: false, first_name: firstName, ...(username ? { username } : {}) };
}

function textUpdate(chatId: number, name: string, text: string): Update {
  // Telegram marks commands with a bot_command entity, and Telegraf relies on
  // it — without the entity `/start` is just text.
  const command = text.startsWith('/') ? text.split(/\s/)[0]! : null;

  return {
    update_id: ++updateId,
    message: {
      message_id: ++messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: name },
      from: user(chatId, name, `user${chatId}`),
      text,
      ...(command
        ? { entities: [{ offset: 0, length: command.length, type: 'bot_command' as const }] }
        : {}),
    },
  } as Update;
}

function photoUpdate(chatId: number, name: string, fileId: string): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: name },
      from: user(chatId, name, `user${chatId}`),
      photo: [
        { file_id: `${fileId}-small`, file_unique_id: 's', width: 90, height: 90 },
        { file_id: fileId, file_unique_id: 'l', width: 800, height: 800 },
      ],
    },
  } as Update;
}

function callbackUpdate(chatId: number, name: string, data: string): Update {
  const previous = lastBotMessage.get(chatId) ?? { message_id: ++messageId, text: '' };
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++updateId),
      from: user(chatId, name, `user${chatId}`),
      chat_instance: String(chatId),
      data,
      message: {
        message_id: previous.message_id,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', first_name: name },
        text: previous.text,
      },
    },
  } as Update;
}

/** Text of every message the bot sent or edited, oldest first. */
function outgoingText(): string[] {
  return calls
    .filter((call) => ['sendMessage', 'editMessageText', 'sendPhoto'].includes(call.method))
    .map((call) => String(call.payload.text ?? call.payload.caption ?? ''));
}

function lastOutgoing(): string {
  const texts = outgoingText();
  return texts[texts.length - 1] ?? '';
}

/** Callback data of every inline button currently on screen. */
function buttonsInLastMessage(): string[] {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]!;
    if (!['sendMessage', 'editMessageText', 'sendPhoto', 'editMessageReplyMarkup'].includes(call.method)) {
      continue;
    }
    const markup = call.payload.reply_markup as
      | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
      | undefined;
    if (!markup?.inline_keyboard) continue;
    return markup.inline_keyboard.flat().flatMap((button) => (button.callback_data ? [button.callback_data] : []));
  }
  return [];
}

/** Urls of every link button on the last screen. */
function urlButtonsInLastMessage(): string[] {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]!;
    const markup = call.payload.reply_markup as
      | { inline_keyboard?: Array<Array<{ url?: string }>> }
      | undefined;
    if (!markup?.inline_keyboard) continue;
    return markup.inline_keyboard.flat().flatMap((button) => (button.url ? [button.url] : []));
  }
  return [];
}

async function send(update: Update): Promise<void> {
  await bot.handleUpdate(update);
}

describe('bot flow', () => {
  before(async () => {
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });

    const clientModule = await import('../src/db/client.js');
    const { seedSports } = await import('../src/db/seed.js');
    const { createBot } = await import('../src/bot/index.js');
    resetQuotas = (await import('../src/bot/middlewares/rateLimit.js')).resetQuotas;

    prisma = clientModule.prisma;
    await seedSports(prisma);

    bot = createBot() as unknown as Telegraf<never>;
    // handleUpdate needs bot info; there is no network in this test.
    (bot as unknown as { botInfo: unknown }).botInfo = {
      id: 42,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    };

    // Telegraf builds a fresh Telegram instance for every update, so the stub
    // has to live on the prototype rather than on bot.telegram.
    const { Telegram } = await import('telegraf');
    const telegramPrototype = Telegram.prototype as unknown as {
      callApi: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
    };
    telegramPrototype.callApi = async (method, payload) => {
      calls.push({ method, payload });

      if (method === 'sendMessage' || method === 'editMessageText' || method === 'sendPhoto') {
        const chatId = Number(payload.chat_id ?? 0);
        const text = String(payload.text ?? payload.caption ?? '');
        const id = method === 'editMessageText' ? Number(payload.message_id) : ++messageId;
        lastBotMessage.set(chatId, { message_id: id, text });
        return {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: 'private' },
          text,
        };
      }
      return true;
    };
  });

  beforeEach(() => {
    // The suite replays hundreds of taps from one chat; without this the
    // anti-flood throttle would start swallowing them.
    resetQuotas();
  });

  after(async () => {
    await prisma?.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('walks a new user through registration and stores the profile', async () => {
    const chatId = 5001;
    calls = [];

    await send(textUpdate(chatId, 'Alex', '/start'));
    assert.match(lastOutgoing(), /Привет/);
    assert.ok(buttonsInLastMessage().includes('reg:start'));

    await send(callbackUpdate(chatId, 'Alex', 'reg:start'));
    await send(callbackUpdate(chatId, 'Alex', 'reg:name_tg'));
    assert.match(lastOutgoing(), /Сколько вам лет/);

    await send(callbackUpdate(chatId, 'Alex', 'reg:age:24'));
    assert.match(lastOutgoing(), /стран/i);

    await send(callbackUpdate(chatId, 'Alex', 'reg:country:MD'));
    assert.match(lastOutgoing(), /город/i);

    // Typed in Cyrillic, resolved through the city reference data.
    await send(textUpdate(chatId, 'Alex', 'кишинёв'));
    assert.match(lastOutgoing(), /вид спорта/i);

    // Three sports are active, so registration asks which one to start with.
    await send(callbackUpdate(chatId, 'Alex', 'reg:sport:tennis'));
    assert.match(lastOutgoing(), /уровень/i);

    await send(callbackUpdate(chatId, 'Alex', 'reg:level:3.5'));
    assert.match(lastOutgoing(), /фотограф/i);

    await send(photoUpdate(chatId, 'Alex', 'photo-alex'));
    assert.match(lastOutgoing(), /о себе/i);

    await send(textUpdate(chatId, 'Alex', 'Играю два года, ищу партнёра по вечерам.'));

    // Confirmation card: photo caption with the whole profile.
    const confirmation = lastOutgoing();
    assert.match(confirmation, /Ваш профиль/);
    assert.match(confirmation, /Alex, 24/);
    assert.match(confirmation, /Chisinau/);
    assert.match(confirmation, /NTRP 3\.5/);
    assert.ok(buttonsInLastMessage().includes('reg:confirm'));

    await send(callbackUpdate(chatId, 'Alex', 'reg:confirm'));
    assert.match(lastOutgoing(), /Профиль готов/);

    const stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(chatId) },
      include: { sports: true },
    });
    assert.ok(stored);
    assert.equal(stored.isRegistered, true);
    assert.equal(stored.age, 24);
    assert.equal(stored.countryCode, 'MD');
    assert.equal(stored.city, 'Chisinau');
    assert.equal(stored.cityGeonameId, 618426, 'city must be stored by reference id');
    assert.equal(stored.photoFileId, 'photo-alex');
    assert.equal(stored.sports[0]?.level, 3.5);
    assert.equal(stored.sports[0]?.levelSource, 'self');
  });

  it('accepts any sane age and only rejects typos', async () => {
    const chatId = 5002;
    calls = [];

    await send(textUpdate(chatId, 'Kid', '/start'));
    await send(callbackUpdate(chatId, 'Kid', 'reg:start'));
    await send(callbackUpdate(chatId, 'Kid', 'reg:name_tg'));

    // Only obvious typos are refused — there is no 18+ gate any more.
    await send(textUpdate(chatId, 'Kid', '3'));
    assert.match(lastOutgoing(), /минимум 6/);

    await send(textUpdate(chatId, 'Kid', '250'));
    assert.match(lastOutgoing(), /максимум 99/);

    await send(textUpdate(chatId, 'Kid', 'двадцать'));
    assert.match(lastOutgoing(), /числом/);

    await send(textUpdate(chatId, 'Kid', '15'));
    assert.match(lastOutgoing(), /стран/i);

    const stored = await prisma.user.findUnique({ where: { telegramId: BigInt(chatId) } });
    assert.equal(stored?.age, null, 'age is only written when registration completes');
  });

  it('resolves a country typed in another language and rejects nonsense', async () => {
    const chatId = 5004;
    calls = [];

    await send(textUpdate(chatId, 'Olha', '/start'));
    await send(callbackUpdate(chatId, 'Olha', 'reg:start'));
    await send(callbackUpdate(chatId, 'Olha', 'reg:name_tg'));
    await send(callbackUpdate(chatId, 'Olha', 'reg:age:29'));

    // Ukrainian spelling resolves outright.
    await send(textUpdate(chatId, 'Olha', 'Україна'));
    assert.match(lastOutgoing(), /город/i);

    // Back to the country step to try the other two outcomes.
    await send(callbackUpdate(chatId, 'Olha', 'reg:back'));
    assert.match(lastOutgoing(), /стран/i);

    await send(textUpdate(chatId, 'Olha', 'Укрна'));
    assert.match(lastOutgoing(), /Вы имели в виду/);
    assert.ok(
      buttonsInLastMessage().includes('reg:country:UA'),
      'Ukraine should be offered as a correction',
    );

    await send(textUpdate(chatId, 'Olha', 'асдасдасд'));
    assert.match(lastOutgoing(), /не существует/);

    await send(callbackUpdate(chatId, 'Olha', 'reg:country:UA'));
    assert.match(lastOutgoing(), /город/i);
  });

  it('offers city corrections and refuses a city that does not exist', async () => {
    const chatId = 5005;
    calls = [];

    await send(textUpdate(chatId, 'Ivan', '/start'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:start'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:name_tg'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:age:35'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:country:MD'));

    // A typo must not be stored as-is.
    await send(textUpdate(chatId, 'Ivan', 'Кишенев'));
    assert.match(lastOutgoing(), /Вы имели в виду/);
    const suggestion = buttonsInLastMessage().find((data) => data.startsWith('reg:city:'));
    assert.ok(suggestion, 'a city suggestion button was expected');

    await send(textUpdate(chatId, 'Ivan', 'йцукенг'));
    assert.match(lastOutgoing(), /не нашли город/);
    assert.ok(buttonsInLastMessage().some((data) => data.startsWith('reg:city:')));

    await send(callbackUpdate(chatId, 'Ivan', suggestion));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:sport:tennis'));
    assert.match(lastOutgoing(), /уровень/i);

    await send(callbackUpdate(chatId, 'Ivan', 'reg:level:3.0'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:photo_skip'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:about_skip'));
    await send(callbackUpdate(chatId, 'Ivan', 'reg:confirm'));

    const stored = await prisma.user.findUnique({ where: { telegramId: BigInt(chatId) } });
    assert.equal(stored?.city, 'Chisinau');
    assert.equal(stored?.cityGeonameId, 618426);
  });

  it('derives the level from the quiz when the user does not know it', async () => {
    const chatId = 5003;
    calls = [];

    await send(textUpdate(chatId, 'Nina', '/start'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:start'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:name_tg'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:age:31'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:country:MD'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:city_skip'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:sport:tennis'));
    await send(callbackUpdate(chatId, 'Nina', 'reg:level_unknown'));

    assert.match(lastOutgoing(), /тест/i);
    await send(callbackUpdate(chatId, 'Nina', 'quiz:start'));
    assert.match(lastOutgoing(), /Вопрос 1 из 10/);

    // Answer every question with the strongest option on screen.
    for (let step = 0; step < 10; step += 1) {
      const answers = buttonsInLastMessage().filter((data) => data.startsWith('quiz:a:'));
      assert.ok(answers.length > 0, `no answers on question ${step + 1}`);
      await send(callbackUpdate(chatId, 'Nina', answers[answers.length - 1]!));
    }

    assert.match(lastOutgoing(), /Результат теста/);
    assert.match(lastOutgoing(), /NTRP 4\.5\+/);

    await send(callbackUpdate(chatId, 'Nina', 'quiz:accept:registration'));
    assert.match(lastOutgoing(), /фотограф/i);

    const attempt = await prisma.quizAttempt.findFirst({
      where: { user: { telegramId: BigInt(chatId) } },
    });
    assert.ok(attempt, 'the quiz attempt was not stored');
    assert.equal(attempt.calculatedLevel, 4.5);

    // Exactly one attempt: accepting the result must not re-score the quiz.
    const attempts = await prisma.quizAttempt.count({
      where: { user: { telegramId: BigInt(chatId) } },
    });
    assert.equal(attempts, 1);
  });

  it('shows a matching player and does not show them twice', async () => {
    // A second local player at the same level as Alex (chat 5001).
    const partnerChat = 5010;
    await send(textUpdate(partnerChat, 'Boris', '/start'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:start'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:name_tg'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:age:26'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:country:MD'));
    await send(textUpdate(partnerChat, 'Boris', 'Кишинев'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:sport:tennis'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:level:3.5'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:photo_skip'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:about_skip'));
    await send(callbackUpdate(partnerChat, 'Boris', 'reg:confirm'));

    calls = [];
    await send(textUpdate(5001, 'Alex', '🎾 Найти партнёра'));

    // Boris is in the same city at the same level, so he ranks first.
    const card = lastOutgoing();
    assert.match(card, /Boris, 26/);
    assert.match(card, /NTRP 3\.5/);
    assert.match(card, /Chisinau/);
    assert.ok(buttonsInLastMessage().includes('search:next'));
    // "Написать" is a plain link, so it carries a url, not callback data.
    assert.ok(
      urlButtonsInLastMessage().includes('https://t.me/user5010'),
      'the card should link straight into the player chat',
    );
    assert.ok(!buttonsInLastMessage().includes('search:msg'));

    // Walk the whole queue: every card must be a new player, and the run must
    // end with the empty-result screen rather than repeating anyone.
    const seen = [card];
    for (let step = 0; step < 10; step += 1) {
      calls = [];
      await send(callbackUpdate(5001, 'Alex', 'search:next'));
      const next = lastOutgoing();
      if (/некого показать/.test(next)) break;

      assert.ok(!seen.includes(next), `profile shown twice:\n${next}`);
      seen.push(next);
    }

    assert.match(lastOutgoing(), /некого показать/);

    const views = await prisma.profileView.count({
      where: { viewer: { telegramId: BigInt(5001) } },
    });
    assert.equal(views, seen.length, 'every shown profile must be recorded once');
  });

  it('lists the players seen in search, with links', async () => {
    calls = [];
    await send(textUpdate(5001, 'Alex', '👀 Кого я смотрел'));

    const text = lastOutgoing();
    assert.match(text, /Кого я смотрел/);
    assert.match(text, /Boris/);
    assert.match(text, /https:\/\/t\.me\/user5010/);
  });

  it('explains itself when the player has no public username', async () => {
    // Boris hides his username, so there is nothing to link to.
    await prisma.user.update({
      where: { telegramId: BigInt(5010) },
      data: { telegramUsername: null },
    });

    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'search:reset'));
    assert.match(lastOutgoing(), /Boris/);
    assert.equal(urlButtonsInLastMessage().length, 0, 'no username, no link');
    assert.ok(buttonsInLastMessage().includes('search:msg'));

    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'search:msg'));
    assert.match(lastOutgoing(), /username/);

    const contacts = await prisma.contact.count({
      where: { fromUser: { telegramId: BigInt(5001) } },
    });
    assert.equal(contacts, 1, 'the fallback path still records the contact');

    await prisma.user.update({
      where: { telegramId: BigInt(5010) },
      data: { telegramUsername: 'user5010' },
    });
  });

  it('hides and restores the profile from settings', async () => {
    calls = [];
    await send(textUpdate(5001, 'Alex', '⚙️ Настройки'));
    assert.match(lastOutgoing(), /Настройки/);

    await send(callbackUpdate(5001, 'Alex', 'settings:hide'));
    assert.match(lastOutgoing(), /Профиль скрыт/);

    let stored = await prisma.user.findUnique({ where: { telegramId: BigInt(5001) } });
    assert.equal(stored?.isActive, false);

    await send(callbackUpdate(5001, 'Alex', 'settings:show'));
    stored = await prisma.user.findUnique({ where: { telegramId: BigInt(5001) } });
    assert.equal(stored?.isActive, true);
  });

  it('edits a single profile field without touching the rest', async () => {
    calls = [];
    await send(textUpdate(5001, 'Alex', '👤 Мой профиль'));
    assert.match(lastOutgoing(), /Ваш профиль/);

    await send(callbackUpdate(5001, 'Alex', 'profile:edit'));
    await send(callbackUpdate(5001, 'Alex', 'profile:edit_field:city'));
    assert.match(lastOutgoing(), /город/i);

    await send(textUpdate(5001, 'Alex', 'Бельцы'));

    const stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(5001) },
      include: { sports: true },
    });
    assert.equal(stored?.city, 'Bălţi', 'the reference spelling is stored, not the typed one');
    assert.equal(stored?.age, 24, 'unrelated fields must stay untouched');
    assert.equal(stored?.sports[0]?.level, 3.5);
  });

  it('searches only in the chosen city, and widens it only on request', async () => {
    // Alex moved to Bălţi in the previous test; Boris and Ivan are in Chisinau.
    calls = [];
    await send(textUpdate(5001, 'Alex', '🎾 Найти партнёра'));

    assert.match(lastOutgoing(), /некого показать в Bălţi/);
    assert.ok(
      buttonsInLastMessage().includes('search:expand'),
      'the bot should offer to look beyond the city',
    );

    // Widening is an explicit choice, and only then other cities show up.
    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'search:expand'));
    assert.match(lastOutgoing(), /Boris|Ivan/);
    assert.match(lastOutgoing(), /Chisinau/);

    // Back to Chisinau for the rest of the suite.
    await prisma.user.update({
      where: { telegramId: BigInt(5001) },
      data: { city: 'Chisinau', cityGeonameId: 618426 },
    });
    await prisma.profileView.deleteMany({ where: { viewer: { telegramId: BigInt(5001) } } });

    calls = [];
    await send(textUpdate(5001, 'Alex', '🎾 Найти партнёра'));
    assert.match(lastOutgoing(), /Boris|Ivan/, 'local players are found again');
  });

  it('adds a second sport and searches per sport', async () => {
    calls = [];
    await send(textUpdate(5001, 'Alex', '👤 Мой профиль'));
    await send(callbackUpdate(5001, 'Alex', 'profile:sports'));
    assert.match(lastOutgoing(), /Виды спорта/);
    assert.ok(buttonsInLastMessage().includes('profile:sport_add'));

    await send(callbackUpdate(5001, 'Alex', 'profile:sport_add'));
    assert.ok(buttonsInLastMessage().includes('profile:sport_new:padel'));
    assert.ok(buttonsInLastMessage().includes('profile:sport_new:badminton'));

    // A new sport is only added together with its level.
    await send(callbackUpdate(5001, 'Alex', 'profile:sport_new:padel'));
    assert.match(lastOutgoing(), /Падел/);

    await send(callbackUpdate(5001, 'Alex', 'profile:level:3'));
    // The notice comes first, then the refreshed profile card.
    assert.ok(
      outgoingText().some((text) => /Уровень обновлён/.test(text)),
      'expected a confirmation of the new level',
    );
    assert.match(lastOutgoing(), /Падел/);

    const stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(5001) },
      include: { sports: { include: { sport: true } } },
    });
    const bySlug = new Map(stored!.sports.map((entry) => [entry.sport.slug, entry]));
    assert.equal(bySlug.size, 2);
    assert.equal(bySlug.get('tennis')?.level, 3.5);
    assert.equal(bySlug.get('padel')?.level, 3);
    assert.equal(bySlug.get('tennis')?.isPrimary, true, 'the registration sport stays primary');
    assert.equal(bySlug.get('padel')?.isPrimary, false);

    // With two sports the search has to ask which one.
    calls = [];
    await send(textUpdate(5001, 'Alex', '🎾 Найти партнёра'));
    assert.match(lastOutgoing(), /виду спорта/i);
    assert.ok(buttonsInLastMessage().includes('search:sport:tennis'));
    assert.ok(buttonsInLastMessage().includes('search:sport:padel'));

    // Nobody plays padel yet, so that search is empty while tennis is not.
    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'search:sport:padel'));
    assert.match(lastOutgoing(), /некого показать/);

    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'search:sport:tennis'));
    await send(callbackUpdate(5001, 'Alex', 'search:reset'));
    assert.match(lastOutgoing(), /Boris|Ivan/);
  });

  it('removes a sport but never the last one', async () => {
    calls = [];
    await send(textUpdate(5001, 'Alex', '👤 Мой профиль'));
    await send(callbackUpdate(5001, 'Alex', 'profile:sports'));
    await send(callbackUpdate(5001, 'Alex', 'profile:sport_remove:padel'));

    let stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(5001) },
      include: { sports: true },
    });
    assert.equal(stored?.sports.length, 1);

    // The only remaining sport must stay: a profile without a sport is useless.
    await send(callbackUpdate(5001, 'Alex', 'profile:sport_remove:tennis'));
    stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(5001) },
      include: { sports: true },
    });
    assert.equal(stored?.sports.length, 1, 'the last sport cannot be removed');
  });

  it('runs the padel quiz with padel questions, not the tennis ones', async () => {
    const chatId = 5006;
    calls = [];

    await send(textUpdate(chatId, 'Padelist', '/start'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:start'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:name_tg'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:age:33'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:country:MD'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:city_skip'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:sport:padel'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:level_unknown'));
    await send(callbackUpdate(chatId, 'Padelist', 'quiz:start'));

    assert.match(lastOutgoing(), /Вопрос 1 из 10/);
    assert.match(lastOutgoing(), /падел/i, 'the padel quiz must ask about padel');

    const questions: string[] = [];
    for (let step = 0; step < 10; step += 1) {
      questions.push(lastOutgoing());
      const answers = buttonsInLastMessage().filter((data) => data.startsWith('quiz:a:'));
      assert.ok(answers.length > 0, `no answers on question ${step + 1}`);
      await send(callbackUpdate(chatId, 'Padelist', answers[answers.length - 1]!));
    }

    // Padel-specific wording proves the quiz came from the padel config.
    assert.ok(questions.some((text) => /стенки/i.test(text)), 'expected the wall question');
    assert.match(lastOutgoing(), /Результат теста/);
    assert.match(lastOutgoing(), /продвинутый/i);

    await send(callbackUpdate(chatId, 'Padelist', 'quiz:accept:registration'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:photo_skip'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:about_skip'));
    await send(callbackUpdate(chatId, 'Padelist', 'reg:confirm'));

    const stored = await prisma.user.findUnique({
      where: { telegramId: BigInt(chatId) },
      include: { sports: { include: { sport: true } } },
    });
    assert.equal(stored?.sports[0]?.sport.slug, 'padel');
    assert.equal(stored?.sports[0]?.level, 5);
    assert.equal(stored?.sports[0]?.levelSource, 'quiz');
  });

  it('answers an unknown inline button instead of crashing', async () => {
    calls = [];
    await send(callbackUpdate(5001, 'Alex', 'totally:unknown:button'));

    const answered = calls.find((call) => call.method === 'answerCallbackQuery');
    assert.ok(answered, 'the stale button was not acknowledged');
    assert.match(String(answered.payload.text ?? ''), /не активна/);
  });

  it('deletes the account and forgets the user', async () => {
    calls = [];
    await send(textUpdate(5002, 'Kid', '/start'));
    await send(callbackUpdate(5002, 'Kid', 'settings:delete_confirm'));

    const stored = await prisma.user.findUnique({ where: { telegramId: BigInt(5002) } });
    assert.equal(stored, null);
  });
});
