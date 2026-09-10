/**
 * Sport registry (ТЗ §3, §39).
 *
 * Nothing in the bot may branch on a hardcoded sport slug. Everything that is
 * tennis-specific — the level scale, its labels, the quiz, the score mapping —
 * is declared here, so adding padel or badminton means adding an entry to
 * `sports` and re-running the seed.
 */
import { badminton, padel } from './sportsPadelBadminton.js';

export interface SportLevel {
  /** Numeric value stored in UserSport.level. */
  value: number;
  /** Short label used on buttons, e.g. "3.5". */
  label: string;
  /** Full label used in profile cards, e.g. "NTRP 3.5". */
  displayLabel: string;
}

export interface QuizAnswerConfig {
  answer: string;
  /** 1 = beginner ... 5 = advanced (ТЗ §12). */
  score: number;
}

export interface QuizQuestionConfig {
  /** Stable key so re-seeding updates instead of duplicating. */
  key: string;
  question: string;
  answers: QuizAnswerConfig[];
}

export interface LevelMappingRange {
  /** Inclusive lower bound of the average score. */
  minAvg: number;
  /** Inclusive upper bound of the average score. */
  maxAvg: number;
  level: number;
}

export interface SportConfig {
  slug: string;
  name: string;
  /** Localised name shown in the UI. */
  title: string;
  emoji: string;
  /** Identifier of the level scale, e.g. "ntrp". */
  levelType: string;
  /** Prefix used when rendering a level, e.g. "NTRP". Empty string for none. */
  levelPrefix: string;
  levels: SportLevel[];
  /** Maximum level difference at which two players are still shown to each other. */
  levelTolerance: number;
  /** Average-score to level mapping used by the quiz (ТЗ §12). */
  levelMapping: LevelMappingRange[];
  quiz: QuizQuestionConfig[];
  isActive: boolean;
  sortOrder: number;
}

const CONFIDENCE_SCALE: QuizAnswerConfig[] = [
  { answer: 'Неуверенно', score: 1 },
  { answer: 'Базово', score: 2 },
  { answer: 'Стабильно', score: 3 },
  { answer: 'Хорошо контролирую направление', score: 4 },
  { answer: 'Могу атаковать', score: 5 },
];

const tennis: SportConfig = {
  slug: 'tennis',
  name: 'Tennis',
  title: 'Теннис',
  emoji: '🎾',
  levelType: 'ntrp',
  levelPrefix: 'NTRP',
  levels: [
    { value: 2.5, label: '2.5', displayLabel: 'NTRP 2.5' },
    { value: 3.0, label: '3.0', displayLabel: 'NTRP 3.0' },
    { value: 3.5, label: '3.5', displayLabel: 'NTRP 3.5' },
    { value: 4.0, label: '4.0', displayLabel: 'NTRP 4.0' },
    { value: 4.5, label: '4.5+', displayLabel: 'NTRP 4.5+' },
  ],
  levelTolerance: 1.0,
  levelMapping: [
    { minAvg: 1.0, maxAvg: 1.7, level: 2.5 },
    { minAvg: 1.8, maxAvg: 2.5, level: 3.0 },
    { minAvg: 2.6, maxAvg: 3.5, level: 3.5 },
    { minAvg: 3.6, maxAvg: 4.3, level: 4.0 },
    { minAvg: 4.4, maxAvg: 5.0, level: 4.5 },
  ],
  quiz: [
    {
      key: 'experience',
      question: 'Как давно вы играете в теннис?',
      answers: [
        { answer: 'Только начал', score: 1 },
        { answer: 'Несколько месяцев', score: 2 },
        { answer: '1–2 года', score: 3 },
        { answer: 'Несколько лет', score: 4 },
        { answer: 'Играю много лет', score: 5 },
      ],
    },
    {
      key: 'frequency',
      question: 'Как часто вы играете?',
      answers: [
        { answer: 'Редко', score: 1 },
        { answer: '1 раз в месяц', score: 2 },
        { answer: '1 раз в неделю', score: 3 },
        { answer: '2–3 раза в неделю', score: 4 },
        { answer: '4+ раз в неделю', score: 5 },
      ],
    },
    {
      key: 'rally',
      question: 'Насколько уверенно вы держите длинный розыгрыш?',
      answers: [
        { answer: 'Пока сложно', score: 1 },
        { answer: 'Несколько ударов', score: 2 },
        { answer: '5–10 ударов', score: 3 },
        { answer: '10+ ударов', score: 4 },
        { answer: 'Могу стабильно поддерживать темп', score: 5 },
      ],
    },
    {
      key: 'serve',
      question: 'Как выполняете подачу?',
      answers: [
        { answer: 'Только учусь', score: 1 },
        { answer: 'Подача часто двойная ошибка', score: 2 },
        { answer: 'Могу стабильно вводить мяч', score: 3 },
        { answer: 'Есть полноценная первая и вторая подача', score: 4 },
        { answer: 'Хорошо контролирую направление и скорость', score: 5 },
      ],
    },
    {
      key: 'matches',
      question: 'Играете ли вы матчи?',
      answers: [
        { answer: 'Нет', score: 1 },
        { answer: 'Иногда', score: 2.5 },
        { answer: 'Регулярно', score: 4 },
        { answer: 'Регулярно участвую в соревнованиях', score: 5 },
      ],
    },
    {
      key: 'forehand',
      question: 'Насколько уверенно играете с отскока справа?',
      answers: CONFIDENCE_SCALE,
    },
    {
      key: 'backhand',
      question: 'Насколько уверенно играете с бэкхенда?',
      answers: CONFIDENCE_SCALE,
    },
    {
      key: 'spin',
      question: 'Используете ли вы вращение?',
      answers: [
        { answer: 'Практически нет', score: 1 },
        { answer: 'Иногда', score: 2.5 },
        { answer: 'Да, умею использовать topspin / slice', score: 4 },
        { answer: 'Хорошо контролирую вращение', score: 5 },
      ],
    },
    {
      key: 'net',
      question: 'Как играете у сетки?',
      answers: [
        { answer: 'Практически не играю', score: 1 },
        { answer: 'Очень редко', score: 2 },
        { answer: 'Иногда', score: 3 },
        { answer: 'Уверенно', score: 4 },
        { answer: 'Хорошо владею воллеями', score: 5 },
      ],
    },
    {
      key: 'self_assessment',
      question: 'Как вы оцениваете свой игровой уровень?',
      answers: [
        { answer: 'Новичок', score: 1 },
        { answer: 'Начинающий', score: 2 },
        { answer: 'Средний', score: 3 },
        { answer: 'Выше среднего', score: 4 },
        { answer: 'Продвинутый', score: 5 },
      ],
    },
  ],
  isActive: true,
  sortOrder: 1,
};

/**
 * Padel and badminton live in their own module: they share a descriptive level
 * scale that has nothing to do with NTRP, and keeping them apart makes it
 * obvious that no sport is privileged in the code.
 */
export const sports: SportConfig[] = [tennis, padel, badminton];

export const DEFAULT_SPORT_SLUG = tennis.slug;

export function getSportConfig(slug: string): SportConfig {
  const sport = sports.find((s) => s.slug === slug);
  if (!sport) {
    throw new Error(`Unknown sport slug: ${slug}`);
  }
  return sport;
}

export function getActiveSportConfigs(): SportConfig[] {
  return sports.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Renders a stored numeric level with the sport's own labels. */
export function formatLevel(slug: string, level: number | null | undefined): string {
  if (level === null || level === undefined) return '—';
  const sport = getSportConfig(slug);
  const known = sport.levels.find((l) => Math.abs(l.value - level) < 0.001);
  if (known) return known.displayLabel;
  return sport.levelPrefix ? `${sport.levelPrefix} ${level}` : String(level);
}

export function formatLevelShort(slug: string, level: number | null | undefined): string {
  if (level === null || level === undefined) return '—';
  const sport = getSportConfig(slug);
  const known = sport.levels.find((l) => Math.abs(l.value - level) < 0.001);
  return known ? known.label : String(level);
}
