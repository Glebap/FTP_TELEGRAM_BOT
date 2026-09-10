/**
 * Normalisation and fuzzy matching for place names.
 *
 * The same function is used by the data generator (scripts/build-geo-data.ts)
 * and at runtime, so the pre-computed alias index always matches what a user's
 * input turns into. Keep it pure and dependency-free.
 */

/**
 * Letters that differ only by script or national variant are folded together,
 * which is what makes "Україна", "Украина" and "Ukraina" land on one key.
 */
const LETTER_FOLDING: Record<string, string> = {
  // Cyrillic national variants -> Russian base letters
  ё: 'е',
  є: 'е',
  і: 'и',
  ї: 'и',
  й: 'и',
  ґ: 'г',
  ў: 'у',
  ђ: 'д',
  ћ: 'ч',
  џ: 'ч',
  њ: 'н',
  љ: 'л',
  ѝ: 'и',
  ѐ: 'е',
  ъ: '',
  ь: '',
  // Latin letters that survive diacritic stripping but still differ
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ł: 'l',
  ı: 'i',
};

/**
 * Folds a place name to a comparison key: lowercase, no diacritics, no
 * punctuation, national letter variants merged.
 *
 * `normalizeGeoName('Chişinău') === normalizeGeoName('Chisinau')`
 * `normalizeGeoName('Київ') === normalizeGeoName('Киев')` → false (different
 * words), but both are separate aliases of the same city in the index.
 */
export function normalizeGeoName(input: string): string {
  const withoutDiacritics = input
    .normalize('NFD')
    // Strip combining marks: ă -> a, ș -> s, é -> e.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  let folded = '';
  for (const char of withoutDiacritics) {
    folded += LETTER_FOLDING[char] ?? char;
  }

  return folded
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein distance with an early exit once `limit` is exceeded. */
export function levenshtein(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0]!;

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      const value = Math.min(substitution, deletion, insertion);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    // Every remaining row can only grow, so bail out early.
    if (rowMin > limit) return limit + 1;

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length]!;
}

/**
 * How many typos are tolerated for a query of this length. Short names get a
 * tight budget so "Рим" does not match "Ром", "Рио" and everything else.
 */
export function typoBudget(length: number): number {
  // Roughly a third of the query may be wrong: "Укрна" (5) has to reach
  // "украина" (7), which is two edits away. Suggestions are always shown as
  // buttons rather than accepted silently, so a generous budget is safe.
  if (length <= 3) return 0;
  if (length <= 6) return 2;
  if (length <= 10) return 3;
  return 4;
}

export interface FuzzyCandidate<T> {
  item: T;
  /** Normalised strings this item can be found by. */
  keys: string[];
  /** Higher wins among equally good matches (population, popularity). */
  weight: number;
}

export interface FuzzyMatch<T> {
  item: T;
  /** 0 = exact, 1 = prefix, 2+ = edit distance. */
  distance: number;
  kind: 'exact' | 'prefix' | 'fuzzy';
}

/**
 * Ranks candidates against a query: exact matches first, then prefix matches,
 * then names within the typo budget.
 */
export function fuzzySearch<T>(
  query: string,
  candidates: Iterable<FuzzyCandidate<T>>,
  options?: { limit?: number },
): FuzzyMatch<T>[] {
  const normalized = normalizeGeoName(query);
  if (normalized.length === 0) return [];

  const budget = typoBudget(normalized.length);
  const exact: FuzzyMatch<T>[] = [];
  const prefix: Array<FuzzyMatch<T> & { weight: number; keyLength: number }> = [];
  const fuzzy: Array<FuzzyMatch<T> & { weight: number }> = [];

  for (const candidate of candidates) {
    let best: { distance: number; kind: FuzzyMatch<T>['kind']; keyLength: number } | null = null;

    for (const key of candidate.keys) {
      if (key === normalized) {
        best = { distance: 0, kind: 'exact', keyLength: key.length };
        break;
      }

      // A prefix match is what makes "кишин" offer "Chisinau" while typing.
      if (key.startsWith(normalized) && normalized.length >= 3) {
        if (!best || best.distance > 1) {
          best = { distance: 1, kind: 'prefix', keyLength: key.length };
        }
        continue;
      }

      if (budget > 0 && Math.abs(key.length - normalized.length) <= budget) {
        const distance = levenshtein(key, normalized, budget);
        if (distance <= budget && (!best || distance + 1 < best.distance)) {
          best = { distance: distance + 1, kind: 'fuzzy', keyLength: key.length };
        }
      }
    }

    if (!best) continue;

    if (best.kind === 'exact') {
      exact.push({ item: candidate.item, distance: 0, kind: 'exact' });
    } else if (best.kind === 'prefix') {
      prefix.push({
        item: candidate.item,
        distance: best.distance,
        kind: 'prefix',
        weight: candidate.weight,
        keyLength: best.keyLength,
      });
    } else {
      fuzzy.push({
        item: candidate.item,
        distance: best.distance,
        kind: 'fuzzy',
        weight: candidate.weight,
      });
    }
  }

  // Shorter prefix hits are the more likely intent: "рим" -> Rome, not Rimini.
  prefix.sort((a, b) => a.keyLength - b.keyLength || b.weight - a.weight);
  fuzzy.sort((a, b) => a.distance - b.distance || b.weight - a.weight);

  const merged: FuzzyMatch<T>[] = [
    ...exact,
    ...prefix.map(({ item, distance, kind }) => ({ item, distance, kind })),
    ...fuzzy.map(({ item, distance, kind }) => ({ item, distance, kind })),
  ];

  return options?.limit ? merged.slice(0, options.limit) : merged;
}

/** Turns an ISO 3166-1 alpha-2 code into its flag emoji. */
export function flagFromCode(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🌍';
  const base = 0x1f1e6;
  const upper = code.toUpperCase();
  return (
    String.fromCodePoint(base + (upper.charCodeAt(0) - 65)) +
    String.fromCodePoint(base + (upper.charCodeAt(1) - 65))
  );
}
