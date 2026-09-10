import type { QuizAnswer, QuizAttempt, QuizQuestion } from '@prisma/client';
import { prisma } from '../client.js';

export type QuizQuestionWithAnswers = QuizQuestion & { answers: QuizAnswer[] };

export const quizRepository = {
  async listQuestions(sportId: number): Promise<QuizQuestionWithAnswers[]> {
    return prisma.quizQuestion.findMany({
      where: { sportId, isActive: true },
      include: { answers: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async findAnswerById(answerId: number): Promise<(QuizAnswer & { question: QuizQuestion }) | null> {
    return prisma.quizAnswer.findUnique({
      where: { id: answerId },
      include: { question: true },
    });
  },

  async createAttempt(input: {
    userId: number;
    sportId: number;
    totalScore: number;
    averageScore: number;
    calculatedLevel: number;
    answersRaw: string;
  }): Promise<QuizAttempt> {
    return prisma.quizAttempt.create({ data: input });
  },

  async findLatestAttempt(userId: number, sportId: number): Promise<QuizAttempt | null> {
    return prisma.quizAttempt.findFirst({
      where: { userId, sportId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
