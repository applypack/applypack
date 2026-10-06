import { Hono } from 'hono';
import { COUNTRIES, REGIONS } from '../../countries';
import { placeName } from '../../i18n/places';
import { currentLocale, isLocale, withLocale } from '../../i18n/locale';

/*
 * The gazetteer for the browser (ADR 0032): the country picker on /settings
 * searches it client-side. One static document, the same data
 * src/countries.ts reads, so a spelling that resolves in the picker resolves
 * on the server too. A day of caching — the file changes with a deploy.
 *
 * Outside English each country also carries `local`, its name in the
 * interface's language (i18n/places.ts:placeName), which the picker searches
 * and writes into a chip as places.ts:countryChip does. The picker names its
 * language in `?lang=`, so a cached copy is always the one for that language.
 */

const CACHE_CONTROL = 'public, max-age=86400';

export const countriesRoute = new Hono();

countriesRoute.get('/countries.json', (c) => {
  c.header('Cache-Control', CACHE_CONTROL);
  const asked = c.req.query('lang');
  const locale = isLocale(asked) ? asked : currentLocale();
  return withLocale(locale, () =>
    c.json({
      countries: COUNTRIES.map((x) => {
        const local = placeName(x.code);
        return {
          code: x.code,
          name: x.name,
          ...(local === x.name ? {} : { local }),
          flag: x.flag,
          names: x.names,
          demonyms: x.demonyms,
          cities: x.cities,
        };
      }),
      regions: REGIONS.map((r) => ({ code: r.code, label: r.label, flag: r.flag ?? '' })),
    }),
  );
});
