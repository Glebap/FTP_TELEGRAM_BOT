import { Composer } from 'telegraf';
import { formatLevel, getSportConfig } from '../../config/sports.js';
import { quizService } from '../../services/quizService.js';
import { userService } from '../../services/userService.js';
import { applyLevel } from '../apply.js';
import { draftSportSlug, promptEditField, promptStep } from '../flow.js';
import {
  levelKeyboard,
  quizIntroKeyboard,
  quizQuestionKeyboard,
  quizResultKeyboard,
} from '../keyboards/index.js';
import type { BotContext } from '../session.js';
import { ack, screen } from '../ui.js';

export const quizHandler = new Composer<BotContext>();

type QuizContext = 'registration' | 'profile';

async function startQuizFlow(ctx: BotContext, returnTo: QuizContext): Promise<void> {
  const sportSlug =
    returnTo === 'registration'
      ? draftSportSlug(ctx)
      : (ctx.session.editingSport ?? userService.primarySportSlug(ctx.dbUser));

  const questions = await quizService.getQuestions(sportSlug);
  if (questions.length === 0) {
    await screen(
      ctx,
      'Тест для этого вида спорта пока недоступен — выберите уровень вручную.',
      levelKeyboard(sportSlug, { prefix: returnTo === 'profile' ? 'profile' : 'reg' }),
    );
    return;
  }

  ctx.session.quiz = { sportSlug, index: 0, answers: [], returnTo };
  await screen(
    ctx,
    [
      '🎯 <b>Короткий тест на уровень</b>',
      '',
      `${questions.length} вопросов, примерно минута.`,
      '',
      '<i>Результат — приблизительная оценка, а не официальная классификация.</i>',
    ].join('\n'),
    quizIntroKeyboard(),
  );
}

async function renderQuestion(ctx: BotContext): Promise<void> {
  const state = ctx.session.quiz;
  if (!state) {
    await screen(ctx, 'Тест не запущен. Наберите /start, чтобы продолжить.');
    return;
  }

  const current = await quizService.getQuestionAt(state.sportSlug, state.index);
  if (!current) {
    await finishQuiz(ctx);
    return;
  }

  await screen(
    ctx,
    [
      `<b>Вопрос ${state.index + 1} из ${current.total}</b>`,
      '',
      current.question.question,
    ].join('\n'),
    quizQuestionKeyboard(
      current.question.answers.map((answer) => ({ id: answer.id, answer: answer.answer })),
      state.index > 0,
    ),
  );
}

async function finishQuiz(ctx: BotContext): Promise<void> {
  const state = ctx.session.quiz;
  if (!state || state.answers.length === 0) {
    await screen(ctx, 'Не удалось посчитать результат. Попробуйте пройти тест заново.');
    return;
  }

  const result = await quizService.completeQuiz({
    userId: ctx.dbUser.id,
    sportSlug: state.sportSlug,
    answers: state.answers,
  });
  state.result = result;

  const sport = getSportConfig(state.sportSlug);
  await screen(
    ctx,
    [
      '🎯 <b>Результат теста</b>',
      '',
      `${sport.emoji} Ваш примерный уровень: <b>${formatLevel(state.sportSlug, result.calculatedLevel)}</b>`,
      `Средний балл: ${result.averageScore}`,
      '',
      '<i>Это приблизительная оценка. Уровень всегда можно изменить вручную.</i>',
    ].join('\n'),
    quizResultKeyboard(state.returnTo),
  );
}

/* ------------------------------------------------------------- entry ------ */

quizHandler.action('reg:level_unknown', async (ctx) => {
  await ack(ctx);
  await startQuizFlow(ctx, 'registration');
});

quizHandler.action('profile:level_unknown', async (ctx) => {
  await ack(ctx);
  ctx.session.editing = 'level';
  await startQuizFlow(ctx, 'profile');
});

quizHandler.action('quiz:start', async (ctx) => {
  await ack(ctx);
  if (!ctx.session.quiz) {
    await startQuizFlow(ctx, 'registration');
    return;
  }
  ctx.session.quiz.index = 0;
  ctx.session.quiz.answers = [];
  await renderQuestion(ctx);
});

quizHandler.action('quiz:restart', async (ctx) => {
  await ack(ctx);
  const state = ctx.session.quiz;
  if (!state) {
    await startQuizFlow(ctx, 'registration');
    return;
  }
  state.index = 0;
  state.answers = [];
  await renderQuestion(ctx);
});

quizHandler.action('quiz:cancel', async (ctx) => {
  await ack(ctx);
  const returnTo = ctx.session.quiz?.returnTo ?? 'registration';
  delete ctx.session.quiz;
  if (returnTo === 'profile') {
    await promptEditField(ctx, 'level');
    return;
  }
  await promptStep(ctx, 'level');
});

/* ------------------------------------------------------------ answers ----- */

quizHandler.action(/^quiz:a:(\d+)$/, async (ctx) => {
  await ack(ctx);
  const state = ctx.session.quiz;
  if (!state) {
    // Stale keyboard from a previous session (ТЗ §30).
    await screen(ctx, 'Этот тест уже неактуален. Запустите его заново из настроек уровня.');
    return;
  }

  const answerId = Number(ctx.match[1]);
  const resolved = await quizService.resolveAnswer(answerId);
  if (!resolved) {
    await screen(ctx, 'Пожалуйста, выберите вариант из кнопок ниже.');
    await renderQuestion(ctx);
    return;
  }

  // Re-answering the same question (double tap, or Back) overwrites the score.
  state.answers = state.answers.filter((answer) => answer.questionKey !== resolved.questionKey);
  state.answers.push(resolved);
  state.index += 1;
  await renderQuestion(ctx);
});

quizHandler.action('quiz:back', async (ctx) => {
  await ack(ctx);
  const state = ctx.session.quiz;
  if (!state) return;
  state.index = Math.max(0, state.index - 1);
  state.answers = state.answers.slice(0, state.index);
  await renderQuestion(ctx);
});

/* ------------------------------------------------------------- result ----- */

quizHandler.action(/^quiz:accept:(registration|profile)$/, async (ctx) => {
  await ack(ctx);
  const state = ctx.session.quiz;
  if (!state) {
    await screen(ctx, 'Результат теста устарел, пройдите тест заново.');
    return;
  }

  // The attempt was already scored and stored by finishQuiz; reuse it so
  // accepting the result does not create a second QuizAttempt row.
  const attempt =
    state.result ??
    (await quizService.completeQuiz({
      userId: ctx.dbUser.id,
      sportSlug: state.sportSlug,
      answers: state.answers,
    }));
  const sportSlug = state.sportSlug;
  const returnTo = state.returnTo;
  delete ctx.session.quiz;

  if (returnTo === 'profile') ctx.session.editing = 'level';
  await applyLevel(ctx, attempt.calculatedLevel, 'quiz', sportSlug);
});

quizHandler.action(/^quiz:manual:(registration|profile)$/, async (ctx) => {
  await ack(ctx);
  const returnTo = (ctx.match[1] ?? 'registration') as QuizContext;
  const sportSlug = ctx.session.quiz?.sportSlug ?? draftSportSlug(ctx);
  delete ctx.session.quiz;

  if (returnTo === 'profile') {
    await promptEditField(ctx, 'level');
    return;
  }
  await screen(
    ctx,
    `${getSportConfig(sportSlug).emoji} <b>Выберите уровень</b>`,
    levelKeyboard(sportSlug),
  );
});
