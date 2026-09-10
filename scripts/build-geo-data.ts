/**
 * Builds the geo reference data the bot ships with:
 *
 *   src/data/countries.json      — every ISO country with multilingual aliases
 *   src/data/cities/<CC>.json    — cities of that country with search aliases
 *   src/data/geo-meta.json       — what was generated, from which source
 *
 * Source: GeoNames `cities1000` dump (CC BY 4.0) + country name translations
 * from `i18n-iso-countries`. Run it only when the reference data needs a
 * refresh — the generated JSON is committed:
 *
 *   npx tsx scripts/build-geo-data.ts
 *
 * The dump is cached in .cache/geonames; pass --source=<dir> to reuse an
 * existing download.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGeoName } from '../src/utils/geoNormalize.js';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(projectRoot, 'src', 'data');
const citiesDir = join(dataDir, 'cities');

const CITIES_DUMP = 'cities1000';
const DUMP_URL = `https://download.geonames.org/export/dump/${CITIES_DUMP}.zip`;
const COUNTRY_INFO_URL = 'https://download.geonames.org/export/dump/countryInfo.txt';

/**
 * Population thresholds per country. The bot's audience is Eastern Europe, so
 * those countries keep every town in the dump; elsewhere small places are
 * dropped to keep the repository small. Everyone can still pick a nearby city,
 * which is what matters for finding a playing partner.
 */
const FULL_COVERAGE = new Set(
  'MD UA RO PL BG BY RU KZ GE AM LT LV EE CZ SK HU IL TR RS HR SI AL MK AZ UZ KG ME CY'.split(' '),
);
const MEDIUM_COVERAGE = new Set(
  'DE AT CH FR ES IT PT NL BE GB IE US CA AE SE NO DK FI GR'.split(' '),
);
const MEDIUM_MIN_POPULATION = 5_000;
const DEFAULT_MIN_POPULATION = 15_000;

/** Locales pulled from i18n-iso-countries; each adds one alias per country. */
const COUNTRY_LOCALES = ['en', 'ru', 'uk', 'be', 'ro', 'pl', 'de', 'es', 'it', 'fr', 'tr'];

/** Names the ru locale gets politically or colloquially wrong for our audience. */
const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  MD: 'Молдова',
  RU: 'Россия',
  BY: 'Беларусь',
  KZ: 'Казахстан',
  KG: 'Кыргызстан',
  CZ: 'Чехия',
  GB: 'Великобритания',
  US: 'США',
  AE: 'ОАЭ',
  KR: 'Южная Корея',
  NL: 'Нидерланды',
};

/** Extra spellings people actually type that no locale file contains. */
const EXTRA_COUNTRY_ALIASES: Record<string, string[]> = {
  MD: ['Молдавия', 'Moldova', 'Republica Moldova'],
  UA: ['Украина', 'Україна', 'Ukraine', 'Ukraina'],
  RU: ['Россия', 'Российская Федерация', 'РФ', 'Russia'],
  BY: ['Белоруссия', 'Belarus', 'Беларусь'],
  GB: ['Англия', 'England', 'UK', 'Британия'],
  US: ['Америка', 'USA', 'United States'],
  AE: ['Дубай', 'Эмираты', 'UAE'],
  CZ: ['Чехия', 'Czechia', 'Чешская Республика'],
  DE: ['Германия', 'Deutschland'],
  IL: ['Израиль', 'Israel'],
  TR: ['Турция', 'Türkiye', 'Turkey'],
  PL: ['Польша', 'Polska'],
  RO: ['Румыния', 'România'],
  GE: ['Грузия', 'Georgia', 'Сакартвело'],
  AM: ['Армения', 'Armenia', 'Hayastan'],
};

/** Only Latin and Cyrillic aliases are kept; other scripts bloat the files. */
const KEEPABLE_ALIAS = /^[\p{Script=Latin}\p{Script=Cyrillic}0-9\s\-'’.()]+$/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

/** Feature codes that are not a place someone would name as their city. */
const SKIPPED_FEATURE_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

const MAX_LATIN_ALIASES = 8;
const MAX_CYRILLIC_ALIASES = 6;

interface CountryRecord {
  code: string;
  /** Name shown in the UI. */
  name: string;
  nameEn: string;
  population: number;
  /** Normalised search keys. */
  keys: string[];
}

interface CityRecord {
  id: number;
  name: string;
  population: number;
  keys: string[];
}

function parseArgs(): { sourceDir: string | null } {
  const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
  return { sourceDir: sourceArg ? sourceArg.slice('--source='.length) : null };
}

async function download(url: string, target: string): Promise<void> {
  process.stdout.write(`  downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

function extractZip(zipPath: string, targetDir: string): void {
  // bsdtar (Windows 10+, macOS) reads zip; unzip covers most Linux images.
  const attempts = [
    `tar -xf "${zipPath}" -C "${targetDir}"`,
    `unzip -o "${zipPath}" -d "${targetDir}"`,
  ];
  for (const command of attempts) {
    try {
      execSync(command, { stdio: 'ignore' });
      return;
    } catch {
      // try the next tool
    }
  }
  throw new Error(
    `Could not extract ${zipPath}. Unpack it manually and re-run with --source=<dir>.`,
  );
}

async function ensureSource(): Promise<{ citiesFile: string; countryInfoFile: string }> {
  const { sourceDir } = parseArgs();
  const cacheDir = sourceDir ?? join(projectRoot, '.cache', 'geonames');
  mkdirSync(cacheDir, { recursive: true });

  const citiesFile = join(cacheDir, `${CITIES_DUMP}.txt`);
  const countryInfoFile = join(cacheDir, 'countryInfo.txt');

  if (!existsSync(citiesFile)) {
    const zipPath = join(cacheDir, `${CITIES_DUMP}.zip`);
    if (!existsSync(zipPath)) await download(DUMP_URL, zipPath);
    extractZip(zipPath, cacheDir);
  }
  if (!existsSync(countryInfoFile)) {
    await download(COUNTRY_INFO_URL, countryInfoFile);
  }

  return { citiesFile, countryInfoFile };
}

function minPopulationFor(countryCode: string): number {
  if (FULL_COVERAGE.has(countryCode)) return 0;
  if (MEDIUM_COVERAGE.has(countryCode)) return MEDIUM_MIN_POPULATION;
  return DEFAULT_MIN_POPULATION;
}

/** Splits GeoNames alternate names, keeping only Latin/Cyrillic and capping each script. */
function selectAliases(raw: string): string[] {
  const latin: string[] = [];
  const cyrillic: string[] = [];

  for (const alias of raw.split(',')) {
    const trimmed = alias.trim();
    if (trimmed.length < 2 || trimmed.length > 60) continue;
    if (!KEEPABLE_ALIAS.test(trimmed)) continue;
    // Airport/station codes such as "KIV" or "RMO" are noise.
    if (trimmed.length <= 3 && trimmed === trimmed.toUpperCase()) continue;

    if (CYRILLIC.test(trimmed)) {
      if (cyrillic.length < MAX_CYRILLIC_ALIASES) cyrillic.push(trimmed);
    } else if (latin.length < MAX_LATIN_ALIASES) {
      latin.push(trimmed);
    }
  }

  return [...latin, ...cyrillic];
}

function buildKeys(values: string[]): string[] {
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizeGeoName(value);
    if (normalized.length >= 2) keys.add(normalized);
  }
  return [...keys];
}

function buildCountries(countryInfoFile: string): CountryRecord[] {
  const countries = require('i18n-iso-countries') as {
    registerLocale: (locale: unknown) => void;
    getName: (code: string, locale: string) => string | undefined;
  };
  for (const locale of COUNTRY_LOCALES) {
    try {
      countries.registerLocale(require(`i18n-iso-countries/langs/${locale}.json`));
    } catch {
      process.stdout.write(`  ! locale ${locale} unavailable, skipping\n`);
    }
  }

  const records: CountryRecord[] = [];

  for (const line of readFileSync(countryInfoFile, 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim().length === 0) continue;
    const columns = line.split('\t');
    const code = columns[0]?.trim();
    const nameEn = columns[4]?.trim();
    const population = Number(columns[7] ?? 0);
    if (!code || code.length !== 2 || !nameEn) continue;

    const localized = COUNTRY_LOCALES.map((locale) => countries.getName(code, locale)).filter(
      (value): value is string => Boolean(value),
    );
    const extra = EXTRA_COUNTRY_ALIASES[code] ?? [];
    const displayName = COUNTRY_NAME_OVERRIDES[code] ?? countries.getName(code, 'ru') ?? nameEn;

    records.push({
      code,
      name: displayName,
      nameEn,
      population: Number.isFinite(population) ? population : 0,
      keys: buildKeys([displayName, nameEn, ...localized, ...extra, code]),
    });
  }

  return records.sort((a, b) => a.code.localeCompare(b.code));
}

function buildCities(citiesFile: string): Map<string, CityRecord[]> {
  const byCountry = new Map<string, CityRecord[]>();
  const content = readFileSync(citiesFile, 'utf8');
  let skipped = 0;

  for (const line of content.split('\n')) {
    if (line.length === 0) continue;
    const columns = line.split('\t');
    const id = Number(columns[0]);
    const geoName = columns[1]?.trim();
    const asciiName = columns[2]?.trim() ?? '';
    const rawAliases = columns[3] ?? '';
    const featureCode = columns[7]?.trim() ?? '';
    const countryCode = columns[8]?.trim() ?? '';
    const population = Number(columns[14] ?? 0);

    if (!Number.isFinite(id) || !geoName || countryCode.length !== 2) continue;
    // PPLX are districts of a city, the rest are historic or abandoned places.
    if (SKIPPED_FEATURE_CODES.has(featureCode)) continue;
    if (population < minPopulationFor(countryCode)) {
      skipped += 1;
      continue;
    }

    const aliases = selectAliases(rawAliases);
    // The GeoNames primary name is the only trustworthy canonical spelling:
    // alternate names include jokes, historic names and other languages.
    const name = geoName;
    const record: CityRecord = {
      id,
      name,
      population: Number.isFinite(population) ? population : 0,
      keys: buildKeys([name, geoName, asciiName, ...aliases]),
    };

    const list = byCountry.get(countryCode);
    if (list) list.push(record);
    else byCountry.set(countryCode, [record]);
  }

  for (const list of byCountry.values()) {
    // Biggest first: suggestion lists and quick buttons read straight off this.
    list.sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));
  }

  process.stdout.write(`  skipped ${skipped} places below the population threshold\n`);
  return byCountry;
}

async function main(): Promise<void> {
  process.stdout.write('Building geo reference data\n');
  const { citiesFile, countryInfoFile } = await ensureSource();

  const countries = buildCountries(countryInfoFile);
  const cities = buildCities(citiesFile);

  rmSync(citiesDir, { recursive: true, force: true });
  mkdirSync(citiesDir, { recursive: true });

  let cityCount = 0;
  const countryCityCounts: Record<string, number> = {};

  for (const [code, list] of [...cities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    writeFileSync(join(citiesDir, `${code}.json`), JSON.stringify({ code, cities: list }));
    cityCount += list.length;
    countryCityCounts[code] = list.length;
  }

  // Countries without any city in the dump would leave the user stuck.
  const usable = countries.filter((country) => (countryCityCounts[country.code] ?? 0) > 0);

  writeFileSync(
    join(dataDir, 'countries.json'),
    JSON.stringify({
      countries: usable.map((country) => ({ ...country, cities: countryCityCounts[country.code] })),
    }),
  );

  writeFileSync(
    join(dataDir, 'geo-meta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: `GeoNames ${CITIES_DUMP} (CC BY 4.0) + i18n-iso-countries`,
        countries: usable.length,
        cities: cityCount,
        fullCoverage: [...FULL_COVERAGE].sort(),
        mediumCoverage: [...MEDIUM_COVERAGE].sort(),
        mediumMinPopulation: MEDIUM_MIN_POPULATION,
        defaultMinPopulation: DEFAULT_MIN_POPULATION,
      },
      null,
      2,
    ),
  );

  process.stdout.write(`✓ ${usable.length} countries, ${cityCount} cities written to src/data\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
