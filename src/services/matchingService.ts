import { matchingConfig, matchingWeights, type MatchScope } from '../config/matching.js';
import { getSportConfig } from '../config/sports.js';
import { profileViewRepository, type ViewAction } from '../db/repositories/profileViewRepository.js';
import { sportRepository } from '../db/repositories/sportRepository.js';
import { userRepository, type UserWithSports } from '../db/repositories/userRepository.js';
import { logger } from '../utils/logger.js';
import { rankCandidates, type ScoredCandidate, type ScoringProfile } from './scoring.js';

export interface MatchCandidate {
  user: UserWithSports;
  level: number | null;
  score: number;
}

function levelInSport(user: UserWithSports, sportSlug: string): number | null {
  const entry = user.sports.find((s) => s.sport.slug === sportSlug);
  return entry ? entry.level : null;
}

function toScoringProfile(user: UserWithSports, sportSlug: string): ScoringProfile {
  return {
    id: user.id,
    age: user.age,
    countryCode: user.countryCode,
    city: user.city,
    cityId: user.cityGeonameId,
    level: levelInSport(user, sportSlug),
    hasPhoto: Boolean(user.photoFileId),
    hasAbout: Boolean(user.about && user.about.trim().length > 0),
    updatedAt: user.updatedAt,
  };
}

/**
 * Matching (ТЗ §36). Steps, in order:
 * 1. load the viewer's profile,
 * 2. find active players of the same sport,
 * 3. exclude the viewer,
 * 4. exclude already-viewed profiles,
 * 5. apply the level-tolerance filter,
 * 6. compute the compatibility score,
 * 7. sort,
 * 8. return the next profiles.
 */
export const matchingService = {
  async findCandidates(input: {
    viewer: UserWithSports;
    sportSlug: string;
    limit?: number;
    /** Defaults to the configured scope, i.e. the viewer's city only. */
    scope?: MatchScope;
  }): Promise<MatchCandidate[]> {
    const sportConfig = getSportConfig(input.sportSlug);
    const sport = await sportRepository.requireBySlug(input.sportSlug);

    const viewerLevel = levelInSport(input.viewer, input.sportSlug);
    if (viewerLevel === null) {
      logger.warn(
        { userId: input.viewer.id, sport: input.sportSlug },
        'Viewer has no level for the requested sport',
      );
      return [];
    }

    const excludeUserIds = await profileViewRepository.listViewedUserIds(
      input.viewer.id,
      sport.id,
    );

    // 'city' is a hard filter, not a bonus: a partner in another city is not
    // someone you can actually play with (ТЗ §8, §38).
    const scope = input.scope ?? matchingConfig.defaultScope;
    const city =
      scope === 'city' && (input.viewer.cityGeonameId !== null || input.viewer.city !== null)
        ? { geonameId: input.viewer.cityGeonameId, name: input.viewer.city }
        : null;

    const rows = await userRepository.findCandidates({
      viewerId: input.viewer.id,
      sportId: sport.id,
      excludeUserIds,
      minLevel: viewerLevel - sportConfig.levelTolerance,
      maxLevel: viewerLevel + sportConfig.levelTolerance,
      take: matchingConfig.candidatePoolSize,
      city,
    });

    const viewerProfile = toScoringProfile(input.viewer, input.sportSlug);
    const ranked: ScoredCandidate<ScoringProfile & { user: UserWithSports }>[] = rankCandidates(
      viewerProfile,
      rows.map((user) => ({ ...toScoringProfile(user, input.sportSlug), user })),
      matchingWeights,
    );

    return ranked.slice(0, input.limit ?? matchingConfig.candidateBatchSize).map((entry) => ({
      user: entry.candidate.user,
      level: entry.candidate.level,
      score: entry.score,
    }));
  },

  async recordAction(input: {
    viewerId: number;
    viewedUserId: number;
    sportSlug: string;
    action: ViewAction;
  }): Promise<void> {
    const sport = await sportRepository.requireBySlug(input.sportSlug);
    await profileViewRepository.record({
      viewerId: input.viewerId,
      viewedUserId: input.viewedUserId,
      sportId: sport.id,
      action: input.action,
    });
  },

  /** Lets a user who exhausted the pool go through it again. */
  async resetViewed(viewerId: number, sportSlug: string): Promise<number> {
    const sport = await sportRepository.requireBySlug(sportSlug);
    return profileViewRepository.resetForViewer(viewerId, sport.id);
  },

  async countViewed(viewerId: number, sportSlug: string): Promise<number> {
    const sport = await sportRepository.requireBySlug(sportSlug);
    return profileViewRepository.countViewed(viewerId, sport.id);
  },
};
