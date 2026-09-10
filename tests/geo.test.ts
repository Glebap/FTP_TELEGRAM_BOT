import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token-0000000000';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./dev.db';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

const { geoService } = await import('../src/services/geoService.js');
const { normalizeGeoName, levenshtein, flagFromCode } = await import(
  '../src/utils/geoNormalize.js'
);

describe('normalizeGeoName', () => {
  it('folds national letter variants onto one key', () => {
    // The whole point: a Ukrainian and a Russian spelling must collide.
    assert.equal(normalizeGeoName('Україна'), normalizeGeoName('Украина'));
    assert.equal(normalizeGeoName('Кишинёв'), normalizeGeoName('Кишинев'));
    assert.equal(normalizeGeoName('Беларусь'), normalizeGeoName('Беларусь '));
  });

  it('strips diacritics so Romanian and Polish spellings match', () => {
    assert.equal(normalizeGeoName('Chişinău'), 'chisinau');
    assert.equal(normalizeGeoName('Chișinău'), 'chisinau');
    assert.equal(normalizeGeoName('Łódź'), 'lodz');
    assert.equal(normalizeGeoName('Timișoara'), 'timisoara');
  });

  it('collapses punctuation and spacing', () => {
    assert.equal(normalizeGeoName('  New   York! '), 'new york');
    assert.equal(normalizeGeoName("Sant'Angelo"), 'sant angelo');
  });

  it('returns an empty string for input without letters', () => {
    assert.equal(normalizeGeoName('!!! ???'), '');
    assert.equal(normalizeGeoName(''), '');
  });
});

describe('levenshtein', () => {
  it('counts single edits', () => {
    assert.equal(levenshtein('киев', 'киев'), 0);
    assert.equal(levenshtein('киев', 'кием'), 1);
    assert.equal(levenshtein('укрна', 'украина'), 2);
  });

  it('stops early once the limit is exceeded', () => {
    assert.ok(levenshtein('абвгде', 'ёжзийк', 2) > 2);
  });
});

describe('flagFromCode', () => {
  it('builds the flag emoji from the ISO code', () => {
    assert.equal(flagFromCode('MD'), '🇲🇩');
    assert.equal(flagFromCode('ua'), '🇺🇦');
    assert.equal(flagFromCode('??'), '🌍');
  });
});

describe('geoService.searchCountries', () => {
  it('resolves the Russian, Ukrainian and Latin spellings exactly', () => {
    for (const query of ['Украина', 'Україна', 'Ukraine', 'ukraina', 'УКРАИНА']) {
      const { exact } = geoService.searchCountries(query);
      assert.equal(exact?.code, 'UA', `failed for "${query}"`);
    }
  });

  it('resolves Moldova however it is written', () => {
    for (const query of ['Молдова', 'Молдавия', 'Moldova', 'republica moldova']) {
      const { exact } = geoService.searchCountries(query);
      assert.equal(exact?.code, 'MD', `failed for "${query}"`);
    }
  });

  it('suggests the country after a typo instead of accepting it', () => {
    const { exact, suggestions } = geoService.searchCountries('Укрна');

    assert.equal(exact, null, 'a typo must not resolve silently');
    assert.ok(
      suggestions.some((country) => country.code === 'UA'),
      `expected Ukraine among ${suggestions.map((c) => c.name).join(', ')}`,
    );
  });

  it('suggests while the name is still being typed', () => {
    const { suggestions } = geoService.searchCountries('Герма');
    assert.ok(suggestions.some((country) => country.code === 'DE'));
  });

  it('returns nothing at all for gibberish', () => {
    for (const query of ['асдасдасд', 'qwrtyzxcvb', 'ццццццц']) {
      const { exact, suggestions } = geoService.searchCountries(query);
      assert.equal(exact, null);
      assert.deepEqual(suggestions, [], `"${query}" should match no country`);
    }
  });

  it('exposes the flag and display name for a stored code', () => {
    const country = geoService.getCountry('MD');
    assert.equal(country?.name, 'Молдова');
    assert.equal(country?.flag, '🇲🇩');
    assert.ok((country?.cities ?? 0) > 50, 'Moldova should have a usable city list');
  });
});

describe('geoService.searchCities', () => {
  it('resolves a city typed in Cyrillic or Latin to the same entry', () => {
    const variants = ['Кишинёв', 'Кишинев', 'Chisinau', 'Chişinău', 'кишинэу'];
    const ids = new Set<number>();

    for (const query of variants) {
      const { exact } = geoService.searchCities('MD', query);
      assert.ok(exact, `"${query}" did not resolve`);
      ids.add(exact.id);
    }

    assert.equal(ids.size, 1, 'all spellings must point at one city');
  });

  it('resolves Ukrainian cities from either spelling', () => {
    const kyiv = geoService.searchCities('UA', 'Киев').exact;
    const kyivUk = geoService.searchCities('UA', 'Київ').exact;

    assert.ok(kyiv);
    assert.equal(kyiv.id, kyivUk?.id);
  });

  it('suggests a correction for a misspelled city', () => {
    const { exact, suggestions } = geoService.searchCities('MD', 'Кишенев');

    assert.equal(exact, null);
    assert.ok(
      suggestions.some((city) => city.name === 'Chisinau'),
      `expected Chisinau among ${suggestions.map((c) => c.name).join(', ')}`,
    );
  });

  it('returns nothing for a city that does not exist in the country', () => {
    const { exact, suggestions } = geoService.searchCities('MD', 'йцукенгш');

    assert.equal(exact, null);
    assert.deepEqual(suggestions, []);
  });

  it('does not leak cities from another country', () => {
    // Kyiv is not in Moldova, so the Moldovan search must not find it.
    const { exact } = geoService.searchCities('MD', 'Киев');
    assert.equal(exact, null);
  });

  it('lists the biggest cities first for the quick buttons', () => {
    const top = geoService.listTopCities('MD', 5);

    assert.equal(top[0]?.name, 'Chisinau');
    for (let i = 1; i < top.length; i += 1) {
      assert.ok(
        top[i - 1]!.population >= top[i]!.population,
        'top cities must be ordered by population',
      );
    }
  });

  it('finds a small town, not just the big ones', () => {
    const { exact } = geoService.searchCities('MD', 'Cahul');
    assert.ok(exact, 'Cahul should be in the Moldovan city list');
  });

  it('round-trips a city through getCity', () => {
    const { exact } = geoService.searchCities('MD', 'Bălţi');
    assert.ok(exact);

    const reloaded = geoService.getCity('MD', exact.id);
    assert.equal(reloaded?.name, exact.name);
  });
});
