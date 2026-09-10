import type { QuizAnswerConfig, SportConfig } from './sports.js';

/**
 * Padel and badminton (ТЗ §3, §39).
 *
 * Both use the same five-step descriptive scale instead of NTRP: there is no
 * widely known rating for either in this region, and a beginner cannot answer
 * "what is your NTRP" for padel anyway. The scale still lives in `levels`, so
 * the level picker, matching tolerance and quiz mapping all keep working
 * without a single sport-specific branch in the code.
 */

/** Shared 1..5 scale: same shape as NTRP, only the labels differ. */
const DESCRIPTIVE_LEVELS = [
  { value: 1, label: 'Новичок', displayLabel: 'Уровень: новичок' },
  { value: 2, label: 'Начальный', displayLabel: 'Уровень: начальный' },
  { value: 3, label: 'Средний', displayLabel: 'Уровень: средний' },
  { value: 4, label: 'Уверенный', displayLabel: 'Уровень: уверенный' },
  { value: 5, label: 'Продвинутый', displayLabel: 'Уровень: продвинутый' },
];

/** Maps the quiz average onto the five levels above. */
const DESCRIPTIVE_MAPPING = [
  { minAvg: 1.0, maxAvg: 1.7, level: 1 },
  { minAvg: 1.8, maxAvg: 2.5, level: 2 },
  { minAvg: 2.6, maxAvg: 3.5, level: 3 },
  { minAvg: 3.6, maxAvg: 4.3, level: 4 },
  { minAvg: 4.4, maxAvg: 5.0, level: 5 },
];

const EXPERIENCE: QuizAnswerConfig[] = [
  { answer: 'Только начал', score: 1 },
  { answer: 'Несколько месяцев', score: 2 },
  { answer: '1–2 года', score: 3 },
  { answer: 'Несколько лет', score: 4 },
  { answer: 'Играю много лет', score: 5 },
];

const FREQUENCY: QuizAnswerConfig[] = [
  { answer: 'Редко', score: 1 },
  { answer: '1 раз в месяц', score: 2 },
  { answer: '1 раз в неделю', score: 3 },
  { answer: '2–3 раза в неделю', score: 4 },
  { answer: '4+ раз в неделю', score: 5 },
];

const MATCHES: QuizAnswerConfig[] = [
  { answer: 'Нет', score: 1 },
  { answer: 'Иногда', score: 2.5 },
  { answer: 'Регулярно', score: 4 },
  { answer: 'Регулярно участвую в соревнованиях', score: 5 },
];

const SELF_ASSESSMENT: QuizAnswerConfig[] = [
  { answer: 'Новичок', score: 1 },
  { answer: 'Начинающий', score: 2 },
  { answer: 'Средний', score: 3 },
  { answer: 'Выше среднего', score: 4 },
  { answer: 'Продвинутый', score: 5 },
];

export const padel: SportConfig = {
  slug: 'padel',
  name: 'Padel',
  title: 'Падел',
  emoji: '🥎',
  levelType: 'descriptive',
  levelPrefix: 'Уровень',
  levels: DESCRIPTIVE_LEVELS,
  levelTolerance: 1,
  levelMapping: DESCRIPTIVE_MAPPING,
  quiz: [
    { key: 'experience', question: 'Как давно вы играете в падел?', answers: EXPERIENCE },
    { key: 'frequency', question: 'Как часто вы играете?', answers: FREQUENCY },
    {
      key: 'other_racket',
      question: 'Играли ли раньше в теннис или другой ракеточный спорт?',
      answers: [
        { answer: 'Нет, падел — первый', score: 1 },
        { answer: 'Немного играл', score: 2.5 },
        { answer: 'Да, играю несколько лет', score: 4 },
        { answer: 'Играю на хорошем уровне', score: 5 },
      ],
    },
    {
      key: 'rally',
      question: 'Насколько уверенно держите розыгрыш?',
      answers: [
        { answer: 'Пока сложно', score: 1 },
        { answer: 'Несколько ударов', score: 2 },
        { answer: '5–10 ударов', score: 3 },
        { answer: '10+ ударов', score: 4 },
        { answer: 'Могу стабильно поддерживать темп', score: 5 },
      ],
    },
    {
      key: 'walls',
      question: 'Играете ли вы от стенки?',
      answers: [
        { answer: 'Нет, мяч от стенки теряю', score: 1 },
        { answer: 'Иногда получается', score: 2 },
        { answer: 'Отбиваю от задней стенки', score: 3 },
        { answer: 'Уверенно играю от задней и боковой', score: 4 },
        { answer: 'Использую стенку в атаке', score: 5 },
      ],
    },
    {
      key: 'serve',
      question: 'Как выполняете подачу?',
      answers: [
        { answer: 'Только учусь', score: 1 },
        { answer: 'Часто ошибаюсь', score: 2 },
        { answer: 'Стабильно ввожу мяч', score: 3 },
        { answer: 'Контролирую направление', score: 4 },
        { answer: 'Подаю с расчётом на выход к сетке', score: 5 },
      ],
    },
    {
      key: 'net',
      question: 'Как играете у сетки?',
      answers: [
        { answer: 'Практически не выхожу', score: 1 },
        { answer: 'Очень редко', score: 2 },
        { answer: 'Иногда', score: 3 },
        { answer: 'Уверенно, играю воллеи', score: 4 },
        { answer: 'Владею бандехой и виборой', score: 5 },
      ],
    },
    {
      key: 'positioning',
      question: 'Понимаете ли позиционную игру в паре?',
      answers: [
        { answer: 'Пока не разбираюсь', score: 1 },
        { answer: 'Знаю основы', score: 2 },
        { answer: 'Держу позицию с партнёром', score: 3 },
        { answer: 'Двигаемся синхронно', score: 4 },
        { answer: 'Строю тактику розыгрыша', score: 5 },
      ],
    },
    { key: 'matches', question: 'Играете ли вы матчи?', answers: MATCHES },
    {
      key: 'self_assessment',
      question: 'Как вы оцениваете свой уровень?',
      answers: SELF_ASSESSMENT,
    },
  ],
  isActive: true,
  sortOrder: 2,
};

export const badminton: SportConfig = {
  slug: 'badminton',
  name: 'Badminton',
  title: 'Бадминтон',
  emoji: '🏸',
  levelType: 'descriptive',
  levelPrefix: 'Уровень',
  levels: DESCRIPTIVE_LEVELS,
  levelTolerance: 1,
  levelMapping: DESCRIPTIVE_MAPPING,
  quiz: [
    { key: 'experience', question: 'Как давно вы играете в бадминтон?', answers: EXPERIENCE },
    { key: 'frequency', question: 'Как часто вы играете?', answers: FREQUENCY },
    {
      key: 'where',
      question: 'Где вы обычно играете?',
      answers: [
        { answer: 'На улице, во дворе', score: 1 },
        { answer: 'Иногда в зале', score: 2.5 },
        { answer: 'В зале, на разметке', score: 4 },
        { answer: 'В зале, в клубе или секции', score: 5 },
      ],
    },
    {
      key: 'rally',
      question: 'Насколько уверенно держите розыгрыш?',
      answers: [
        { answer: 'Пока сложно', score: 1 },
        { answer: 'Несколько ударов', score: 2 },
        { answer: '5–10 ударов', score: 3 },
        { answer: '10+ ударов', score: 4 },
        { answer: 'Могу держать быстрый темп', score: 5 },
      ],
    },
    {
      key: 'clear',
      question: 'Достаёте ли вы воланом до задней линии?',
      answers: [
        { answer: 'Нет', score: 1 },
        { answer: 'Иногда', score: 2 },
        { answer: 'Обычно да', score: 3 },
        { answer: 'Стабильно, высоко и глубоко', score: 4 },
        { answer: 'Контролирую высоту и длину', score: 5 },
      ],
    },
    {
      key: 'smash',
      question: 'Как у вас со смэшем?',
      answers: [
        { answer: 'Не умею', score: 1 },
        { answer: 'Пробую, но нестабильно', score: 2 },
        { answer: 'Иногда получается', score: 3 },
        { answer: 'Уверенно атакую', score: 4 },
        { answer: 'Смэш — моё оружие', score: 5 },
      ],
    },
    {
      key: 'net_drop',
      question: 'Играете ли короткие удары у сетки?',
      answers: [
        { answer: 'Практически нет', score: 1 },
        { answer: 'Иногда', score: 2 },
        { answer: 'Играю дропы и сетку', score: 3 },
        { answer: 'Уверенно, с контролем', score: 4 },
        { answer: 'Владею обманными ударами', score: 5 },
      ],
    },
    {
      key: 'footwork',
      question: 'Насколько уверенно двигаетесь по площадке?',
      answers: [
        { answer: 'Не успеваю за воланом', score: 1 },
        { answer: 'Базово', score: 2 },
        { answer: 'Успеваю в большинстве случаев', score: 3 },
        { answer: 'Хорошая работа ног', score: 4 },
        { answer: 'Отработанные перемещения и выпады', score: 5 },
      ],
    },
    { key: 'matches', question: 'Играете ли вы матчи?', answers: MATCHES },
    {
      key: 'self_assessment',
      question: 'Как вы оцениваете свой уровень?',
      answers: SELF_ASSESSMENT,
    },
  ],
  isActive: true,
  sortOrder: 3,
};
