import type { Prisma, User, UserSport } from '@prisma/client';
import { prisma } from '../client.js';

export type UserWithSports = User & { sports: (UserSport & { sport: { slug: string } })[] };

const withSports = {
  sports: { include: { sport: { select: { slug: true } } } },
} satisfies Prisma.UserInclude;

export const userRepository = {
  async findByTelegramId(telegramId: bigint): Promise<UserWithSports | null> {
    return prisma.user.findUnique({
      where: { telegramId },
      include: withSports,
    });
  },

  async findById(id: number): Promise<UserWithSports | null> {
    return prisma.user.findUnique({ where: { id }, include: withSports });
  },

  async upsertFromTelegram(input: {
    telegramId: bigint;
    telegramUsername: string | null;
    firstName: string | null;
  }): Promise<UserWithSports> {
    return prisma.user.upsert({
      where: { telegramId: input.telegramId },
      // Telegram username and display name can change between sessions.
      update: {
        telegramUsername: input.telegramUsername,
        firstName: input.firstName,
      },
      create: {
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername,
        firstName: input.firstName,
      },
      include: withSports,
    });
  },

  async update(id: number, data: Prisma.UserUpdateInput): Promise<UserWithSports> {
    return prisma.user.update({ where: { id }, data, include: withSports });
  },

  async setActive(id: number, isActive: boolean): Promise<User> {
    return prisma.user.update({ where: { id }, data: { isActive } });
  },

  async delete(id: number): Promise<void> {
    await prisma.user.delete({ where: { id } });
  },

  /** Level of a user in one sport, or null when the sport profile is missing. */
  async findUserSport(userId: number, sportId: number): Promise<UserSport | null> {
    return prisma.userSport.findUnique({ where: { userId_sportId: { userId, sportId } } });
  },

  async removeUserSport(userId: number, sportId: number): Promise<void> {
    await prisma.userSport.deleteMany({ where: { userId, sportId } });
  },

  async setUserSportLevel(input: {
    userId: number;
    sportId: number;
    level: number;
    levelSource: 'self' | 'quiz';
  }): Promise<UserSport> {
    // The sport chosen during registration stays the primary one; sports added
    // later are secondary, which is what search and notifications default to.
    const existing = await prisma.userSport.count({ where: { userId: input.userId } });

    return prisma.userSport.upsert({
      where: { userId_sportId: { userId: input.userId, sportId: input.sportId } },
      update: { level: input.level, levelSource: input.levelSource },
      create: {
        userId: input.userId,
        sportId: input.sportId,
        level: input.level,
        levelSource: input.levelSource,
        isPrimary: existing === 0,
      },
    });
  },

  /**
   * Candidate pool for matching: active, registered, not blocked, playing the
   * same sport, excluding the viewer and everyone already seen (ТЗ §36).
   */
  async findCandidates(input: {
    viewerId: number;
    sportId: number;
    excludeUserIds: number[];
    minLevel: number;
    maxLevel: number;
    take: number;
    /**
     * When set, only players in this city are returned. The id comes from the
     * geo reference data; the name is matched too so rows written before the
     * reference data existed are not lost.
     */
    city?: { geonameId: number | null; name: string | null } | null;
  }): Promise<UserWithSports[]> {
    const cityFilter: Prisma.UserWhereInput[] = [];
    if (input.city?.geonameId != null) {
      cityFilter.push({ cityGeonameId: input.city.geonameId });
    }
    if (input.city?.name) {
      cityFilter.push({ city: input.city.name });
    }

    return prisma.user.findMany({
      where: {
        id: { notIn: [input.viewerId, ...input.excludeUserIds] },
        isActive: true,
        isRegistered: true,
        isBlocked: false,
        sports: {
          some: {
            sportId: input.sportId,
            level: { gte: input.minLevel, lte: input.maxLevel },
          },
        },
        ...(cityFilter.length > 0 ? { OR: cityFilter } : {}),
      },
      include: withSports,
      // Deterministic order; real ranking happens in the scoring layer.
      orderBy: { updatedAt: 'desc' },
      take: input.take,
    });
  },
};
