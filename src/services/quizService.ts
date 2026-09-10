import { getSportConfig } from '../config/sports.js';
import { quizRepository, type QuizQuestionWithAnswers } from '../db/repositories/quizRepository.js';
import { sportRepository } from '../db/repositories/sportRepository.js';
import { userRepository } from '../db/repositories/userRepository.js';
import { calculateLevelFromScores, type QuizResult } from './levelCalculator.js';

export interface QuizAnswerRecord {
  questionKey: string;
  score: number;
}

export const quizService = {
  async getQuestions(sportSlug: string): Promise<QuizQuestionWithAnswers[]> {
    const sport = await sportRepository.requireBySlug(sportSlug);
    return quizRepository.listQuestions(sport.id);
  },

  async getQuestionAt(
    sportSlug: string,
    index: number,
  ): Promise<{ question: QuizQuestionWithAnswers; total: number } | null> {
    const questions = await this.getQuestions(sportSlug);
    const question = questions[index];
    if (!question) return null;
    return { question, total: questions.length };
  },

  /** Resolves a callback answer id into a score, validating it belongs to the quiz. */
  async resolveAnswer(
    answerId: number,
  ): Promise<{ questionKey: string; score: number } | null> {
    const answer = await quizRepository.findAnswerById(answerId);
    if (!answer) return null;
    return { questionKey: answer.question.key, score: answer.score };
  },

  /**
   * Scores the finished quiz, stores the attempt and writes the resulting level
   * onto the user's sport profile.
   */
  async completeQuiz(input: {
    userId: number;
    sportSlug: string;
    answers: QuizAnswerRecord[];
  }): Promise<QuizResult> {
    const sportConfig = getSportConfig(input.sportSlug);
    const sport = await sportRepository.requireBySlug(input.sportSlug);

    const result = calculateLevelFromScores(
      input.answers.map((answer) => answer.score),
      sportConfig,
    );

    await quizRepository.createAttempt({
      userId: input.userId,
      sportId: sport.id,
      totalScore: result.totalScore,
      averageScore: result.averageScore,
      calculatedLevel: result.calculatedLevel,
      answersRaw: input.answers.map((a) => `${a.questionKey}:${a.score}`).join(','),
    });

    await userRepository.setUserSportLevel({
      userId: input.userId,
      sportId: sport.id,
      level: result.calculatedLevel,
      levelSource: 'quiz',
    });

    return result;
  },
};
