import type { Contact } from '@prisma/client';
import { prisma } from '../client.js';
import type { UserWithSports } from './userRepository.js';

export type ContactWithUser = Contact & {
  toUser: UserWithSports;
  sport: { slug: string };
};

export const contactRepository = {
  async record(input: {
    fromUserId: number;
    toUserId: number;
    sportId: number;
  }): Promise<Contact> {
    return prisma.contact.upsert({
      where: {
        fromUserId_toUserId_sportId: {
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          sportId: input.sportId,
        },
      },
      update: {},
      create: input,
    });
  },

  async listForUser(fromUserId: number, take = 20): Promise<ContactWithUser[]> {
    return prisma.contact.findMany({
      where: { fromUserId },
      include: {
        toUser: { include: { sports: { include: { sport: { select: { slug: true } } } } } },
        sport: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  async countSince(fromUserId: number, since: Date): Promise<number> {
    return prisma.contact.count({ where: { fromUserId, createdAt: { gte: since } } });
  },
};
