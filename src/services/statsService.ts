import { prisma } from '../db/client.js';
import { eventRepository } from '../db/repositories/eventRepository.js';

export interface AdminStats {
  totalUsers: number;
  registeredUsers: number;
  activeProfiles: number;
  hiddenProfiles: number;
  newUsersToday: number;
  newUsersWeek: number;
  searches: number;
  searchesToday: number;
  contacts: number;
  quizAttempts: number;
  profileViews: number;
  withPhoto: number;
  levelHistogram: Array<{ level: number; count: number }>;
}

export const statsService = {
  /** Numbers behind /admin (ТЗ §33). */
  async getAdminStats(): Promise<AdminStats> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [
      totalUsers,
      registeredUsers,
      activeProfiles,
      hiddenProfiles,
      newUsersToday,
      newUsersWeek,
      searches,
      searchesToday,
      contacts,
      quizAttempts,
      profileViews,
      withPhoto,
      levelRows,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isRegistered: true } }),
      prisma.user.count({ where: { isRegistered: true, isActive: true } }),
      prisma.user.count({ where: { isRegistered: true, isActive: false } }),
      prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      eventRepository.countByType('search'),
      eventRepository.countByType('search', dayAgo),
      prisma.contact.count(),
      prisma.quizAttempt.count(),
      prisma.profileView.count(),
      prisma.user.count({ where: { isRegistered: true, photoFileId: { not: null } } }),
      prisma.userSport.groupBy({ by: ['level'], _count: { level: true } }),
    ]);

    const levelHistogram = levelRows
      .map((row) => ({ level: row.level, count: row._count.level }))
      .sort((a, b) => a.level - b.level);

    return {
      totalUsers,
      registeredUsers,
      activeProfiles,
      hiddenProfiles,
      newUsersToday,
      newUsersWeek,
      searches,
      searchesToday,
      contacts,
      quizAttempts,
      profileViews,
      withPhoto,
      levelHistogram,
    };
  },
};
