import { env } from '../config/env.js';
import { contactRepository, type ContactWithUser } from '../db/repositories/contactRepository.js';
import { eventRepository } from '../db/repositories/eventRepository.js';
import { sportRepository } from '../db/repositories/sportRepository.js';

export type ContactResult =
  | { ok: true; username: string | null }
  | { ok: false; reason: 'rate_limited_minute' | 'rate_limited_day' };

export const contactService = {
  /**
   * Records the intent to contact a player and reports the username the bot may
   * hand out. Anti-spam limits come from the environment (ТЗ §34).
   */
  async contact(input: {
    fromUserId: number;
    toUserId: number;
    toUsername: string | null;
    sportSlug: string;
  }): Promise<ContactResult> {
    const now = Date.now();
    const minuteAgo = new Date(now - 60_000);
    const dayAgo = new Date(now - 86_400_000);

    const [inLastMinute, inLastDay] = await Promise.all([
      contactRepository.countSince(input.fromUserId, minuteAgo),
      contactRepository.countSince(input.fromUserId, dayAgo),
    ]);

    if (inLastMinute >= env.CONTACT_LIMIT_PER_MINUTE) {
      return { ok: false, reason: 'rate_limited_minute' };
    }
    if (inLastDay >= env.CONTACT_LIMIT_PER_DAY) {
      return { ok: false, reason: 'rate_limited_day' };
    }

    const sport = await sportRepository.requireBySlug(input.sportSlug);
    await contactRepository.record({
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      sportId: sport.id,
    });
    eventRepository.track('contact', input.fromUserId, input.sportSlug);

    return { ok: true, username: input.toUsername };
  },

  async listContacts(fromUserId: number): Promise<ContactWithUser[]> {
    return contactRepository.listForUser(fromUserId);
  },
};
