import { prisma } from '../client.js';

export type ViewAction = 'view' | 'next' | 'like' | 'message';

export const profileViewRepository = {
  /**
   * Records that `viewerId` has seen `viewedUserId`. The unique constraint
   * keeps one row per pair, so re-viewing only updates the action.
   */
  async record(input: {
    viewerId: number;
    viewedUserId: number;
    sportId: number;
    action: ViewAction;
  }): Promise<void> {
    await prisma.profileView.upsert({
      where: {
        viewerId_viewedUserId_sportId: {
          viewerId: input.viewerId,
          viewedUserId: input.viewedUserId,
          sportId: input.sportId,
        },
      },
      update: { action: input.action },
      create: input,
    });
  },

  /**
   * Recently seen players, newest first. This is what feeds "кого я смотрел":
   * the "Написать" button is a plain Telegram link, so a tap on it never
   * reaches the bot and cannot be recorded — a view can.
   */
  async listRecentlyViewed(viewerId: number, take: number) {
    return prisma.profileView.findMany({
      where: { viewerId },
      include: {
        viewedUser: { include: { sports: { include: { sport: { select: { slug: true } } } } } },
        sport: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  async listViewedUserIds(viewerId: number, sportId: number): Promise<number[]> {
    const rows = await prisma.profileView.findMany({
      where: { viewerId, sportId },
      select: { viewedUserId: true },
    });
    return rows.map((row) => row.viewedUserId);
  },

  async countViewed(viewerId: number, sportId: number): Promise<number> {
    return prisma.profileView.count({ where: { viewerId, sportId } });
  },

  /** Used by "start over" so a user can go through the pool again. */
  async resetForViewer(viewerId: number, sportId: number): Promise<number> {
    const result = await prisma.profileView.deleteMany({ where: { viewerId, sportId } });
    return result.count;
  },
};
