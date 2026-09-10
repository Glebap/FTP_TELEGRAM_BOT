import type { Sport } from '@prisma/client';
import { prisma } from '../client.js';

/**
 * Sports are seeded from src/config/sports.ts, so lookups are cached for the
 * lifetime of the process — they never change at runtime.
 */
const cache = new Map<string, Sport>();

export const sportRepository = {
  async findBySlug(slug: string): Promise<Sport | null> {
    const cached = cache.get(slug);
    if (cached) return cached;
    const sport = await prisma.sport.findUnique({ where: { slug } });
    if (sport) cache.set(slug, sport);
    return sport;
  },

  /** Same as findBySlug but throws when the seed has not been run. */
  async requireBySlug(slug: string): Promise<Sport> {
    const sport = await this.findBySlug(slug);
    if (!sport) {
      throw new Error(`Sport "${slug}" is not in the database — run "npm run db:seed"`);
    }
    return sport;
  },

  async findActive(): Promise<Sport[]> {
    return prisma.sport.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  },

  clearCache(): void {
    cache.clear();
  },
};
