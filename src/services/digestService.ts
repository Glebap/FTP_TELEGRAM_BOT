import { notificationsConfig } from '../config/notifications.js';
import { prisma } from '../db/client.js';
import { userRepository, type UserWithSports } from '../db/repositories/userRepository.js';
import { logger } from '../utils/logger.js';
import { matchingService } from './matchingService.js';
import { userService } from './userService.js';

/**
 * "New players in your city" digest.
 *
 * A user is written to only when there is something genuinely new for them:
 * players who registered after the previous digest, in the same city, at a
 * compatible level, and whom the user has not already seen in search.
 */

/** New players for one of the user's sports. */
export interface DigestSportItem {
  sportSlug: string;
  newPlayers: number;
  /** Names of the first few, for a friendlier message. */
  sampleNames: string[];
}

export interface DigestItem {
  user: UserWithSports;
  /** One entry per sport that has something new; never empty. */
  sports: DigestSportItem[];
  /** New players across all the user's sports. */
  total: number;
  /** The moment this digest covers up to; stored once the message is sent. */
  coveredUntil: Date;
}

/** Everyone eligible for a digest: registered, visible, not blocked, opted in. */
async function findSubscribers(): Promise<UserWithSports[]> {
  return prisma.user.findMany({
    where: {
      isRegistered: true,
      isActive: true,
      isBlocked: false,
      notifyNewPlayers: true,
      // Without a city there is no "players near you" to report.
      city: { not: null },
    },
    include: { sports: { include: { sport: { select: { slug: true } } } } },
  });
}

function sameCity(a: UserWithSports, b: UserWithSports): boolean {
  if (a.cityGeonameId !== null && b.cityGeonameId !== null) {
    return a.cityGeonameId === b.cityGeonameId;
  }
  return Boolean(a.city && b.city && a.city === b.city);
}

export const digestService = {
  /**
   * Works out what each subscriber should be told. Pure read-only: nothing is
   * sent and no state is changed, which makes it straightforward to test.
   */
  async collectDigests(now: Date = new Date()): Promise<DigestItem[]> {
    const subscribers = await findSubscribers();
    const maxLookback = new Date(
      now.getTime() - notificationsConfig.maxLookbackDays * 86_400_000,
    );
    const items: DigestItem[] = [];

    for (const user of subscribers) {
      // A player counts as new if they registered after the last digest; for a
      // first digest we look back a bounded window instead of all history.
      const since = user.lastDigestAt ?? maxLookback;
      const cutoff = since > maxLookback ? since : maxLookback;

      const perSport: DigestSportItem[] = [];

      // Every sport the user plays is checked separately: matching, tolerance
      // and the "already viewed" list are all per sport.
      for (const sportSlug of userService.sportSlugs(user)) {
        let candidates;
        try {
          candidates = await matchingService.findCandidates({
            viewer: user,
            sportSlug,
            limit: 100,
          });
        } catch (error) {
          logger.warn(
            { err: error, userId: user.id, sportSlug },
            'Digest matching failed for user',
          );
          continue;
        }

        const fresh = candidates.filter(
          (candidate) => sameCity(user, candidate.user) && candidate.user.createdAt > cutoff,
        );
        if (fresh.length === 0) continue;

        perSport.push({
          sportSlug,
          newPlayers: fresh.length,
          sampleNames: fresh
            .slice(0, 3)
            .map((candidate) => userService.displayNameOf(candidate.user)),
        });
      }

      const total = perSport.reduce((sum, entry) => sum + entry.newPlayers, 0);
      if (total < notificationsConfig.minNewPlayers) continue;

      items.push({ user, sports: perSport, total, coveredUntil: now });
    }

    return items;
  },

  /** Marks the digest as delivered so the same players are not reported twice. */
  async markSent(userId: number, coveredUntil: Date): Promise<void> {
    await userRepository.update(userId, { lastDigestAt: coveredUntil });
  },

  /** Turns the digest off for a user who blocked the bot or opted out. */
  async setEnabled(userId: number, enabled: boolean): Promise<void> {
    await userRepository.update(userId, { notifyNewPlayers: enabled });
  },
};
