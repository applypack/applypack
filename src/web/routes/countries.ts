import { Hono } from 'hono';
import { COUNTRIES, REGIONS } from '../../countries';

/*
 * The gazetteer for the browser (ADR 0032): the country picker on /settings
 * searches it client-side. One static document, the same data
 * src/countries.ts reads, so a spelling that resolves in the picker resolves
 * on the server too. A day of caching — the file changes with a deploy.
 */

const CACHE_CONTROL = 'public, max-age=86400';

export const countriesRoute = new Hono();

countriesRoute.get('/countries.json', (c) => {
  c.header('Cache-Control', CACHE_CONTROL);
  return c.json({
    countries: COUNTRIES.map((x) => ({
      code: x.code,
      name: x.name,
      flag: x.flag,
      names: x.names,
      demonyms: x.demonyms,
      cities: x.cities,
    })),
    regions: REGIONS.map((r) => ({ code: r.code, label: r.label, flag: r.flag ?? '' })),
  });
});
