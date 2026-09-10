import { PrismaClient } from '@prisma/client';
import { sports } from '../config/sports.js';

/**
 * Seeds sports and quiz content from src/config/sports.ts. The config is the
 * source of truth; seeding is idempotent, so re-running it after editing a
 * question updates the row instead of creating a duplicate.
 */
export async function seedSports(
  prisma: PrismaClient,
  options?: { log?: (message: string) => void },
): Promise<void> {
  const log = options?.log ?? (() => {});

  for (const sportConfig of sports) {
    const sportFields = {
      name: sportConfig.name,
      emoji: sportConfig.emoji,
      levelType: sportConfig.levelType,
      isActive: sportConfig.isActive,
      sortOrder: sportConfig.sortOrder,
    };

    const sport = await prisma.sport.upsert({
      where: { slug: sportConfig.slug },
      update: sportFields,
      create: { slug: sportConfig.slug, ...sportFields },
    });

    for (const [index, questionConfig] of sportConfig.quiz.entries()) {
      const question = await prisma.quizQuestion.upsert({
        where: { sportId_key: { sportId: sport.id, key: questionConfig.key } },
        update: { question: questionConfig.question, sortOrder: index, isActive: true },
        create: {
          sportId: sport.id,
          key: questionConfig.key,
          question: questionConfig.question,
          sortOrder: index,
        },
      });

      // Answers have no natural key, so they are replaced wholesale. Existing
      // QuizAttempt rows keep their numbers because they store scores by value.
      await prisma.quizAnswer.deleteMany({ where: { questionId: question.id } });
      for (const [answerIndex, answer] of questionConfig.answers.entries()) {
        await prisma.quizAnswer.create({
          data: {
            questionId: question.id,
            answer: answer.answer,
            score: answer.score,
            sortOrder: answerIndex,
          },
        });
      }
    }

    // Questions dropped from the config are deactivated rather than deleted,
    // so past attempts stay explainable.
    await prisma.quizQuestion.updateMany({
      where: {
        sportId: sport.id,
        key: { notIn: sportConfig.quiz.map((question) => question.key) },
      },
      data: { isActive: false },
    });

    log(
      `✓ ${sportConfig.name} (${sportConfig.slug}): ${sportConfig.quiz.length} quiz question(s), active=${sportConfig.isActive}`,
    );
  }
}

async function runAsScript(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedSports(prisma, { log: (message) => console.log(message) });
    console.log('Seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

// Only self-execute when invoked directly (`npm run db:seed`), never on import.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/db/seed.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('/db/seed.js');

if (invokedDirectly) {
  runAsScript().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
}
