import { prisma } from '../client.js';
import { logger } from '../../utils/logger.js';

export type AppEventType = 'registration_started' | 'registration_completed' | 'search' | 'contact';

export const eventRepository = {
  /**
   * Fire-and-forget counter for /admin. Analytics must never break a handler,
   * so failures are logged and swallowed.
   */
  track(type: AppEventType, userId?: number, meta?: string): void {
    void prisma.appEvent
      .create({ data: { type, userId: userId ?? null, meta: meta ?? null } })
      .catch((error: unknown) => {
        logger.warn({ err: error, type }, 'Failed to track event');
      });
  },

  async countByType(type: AppEventType, since?: Date): Promise<number> {
    return prisma.appEvent.count({
      where: { type, ...(since ? { createdAt: { gte: since } } : {}) },
    });
  },
};
