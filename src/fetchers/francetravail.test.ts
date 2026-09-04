import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FRANCE_TRAVAIL_LICENCE_URL, franceTravailSearchUrl, licenceLine, mapFranceTravailOffer, parseContentRange } from './francetravail';
import { scrubbed, tokenFresh } from './francetravail-auth';
import { HttpError } from '../http';

// Shaped after the vendor's documented "Consulter une offre" fields (2026-09-04).
const offer = {
  id: '189ABCD',
  intitule: 'Développeur PHP / Laravel (H/F)',
  description: 'Vous rejoignez une équipe de 6 développeurs.\nStack : PHP 8, Laravel, MySQL, Vue.',
  dateCreation: '2026-09-03T08:15:00.000Z',
  dateActualisation: '2026-09-04T06:00:00.000Z',
  lieuTravail: { libelle: '75 - PARIS 08', latitude: 48.87, longitude: 2.31, codePostal: '75008', commune: '75108' },
  romeCode: 'M1805',
  romeLibelle: 'Études et développement informatique',
  appellationlibelle: 'Développeur / Développeuse web',
  entreprise: { nom: 'ACME SAS', description: 'Éditeur de logiciels', logo: 'https://example.test/logo.png' },
  typeContrat: 'CDI',
  typeContratLibelle: 'Contrat à durée indéterminée',
  natureContrat: 'Contrat travail',
  experienceExige: 'S',
  experienceLibelle: '3 An(s)',
  dureeTravailLibelle: '35H Travail en journée',
  dureeTravailLibelleConverti: 'Temps plein',
  salaire: { libelle: 'Annuel de 45000.0 Euros à 55000.0 Euros sur 12.0 mois', complement1: 'Mutuelle' },
  nombrePostes: 2,
  contact: { nom: 'Jane Doe', coordonnees1: 'https://candidat.francetravail.fr/offres/recherche/detail/189ABCD' },
  origineOffre: { origine: '1', urlOrigine: 'https://candidat.francetravail.fr/offres/recherche/detail/189ABCD' },
};

describe('mapFranceTravailOffer', () => {
  it('maps an offer: the licence line first, the board words kept, the whole offer riding along', () => {
    const job = mapFranceTravailOffer(offer, 4);
    assert.equal(job.externalId, '189ABCD');
    assert.equal(job.title, 'Développeur PHP / Laravel (H/F)');
    assert.equal(job.url, 'https://candidat.francetravail.fr/offres/recherche/detail/189ABCD');
    assert.equal(job.location, '75 - PARIS 08, France');
    assert.deepEqual(job.locationHints, { countries: ['FR'] });
    assert.equal(job.postedAt.toISOString(), '2026-09-03T08:15:00.000Z');
    assert.equal(job.sourceUpdatedAt?.toISOString(), '2026-09-04T06:00:00.000Z');
    assert.equal(job.sourcePayload, offer);
    assert.equal(
      job.description,
      `Source: France Travail — updated 2026-09-04. Reused under its licence: ${FRANCE_TRAVAIL_LICENCE_URL} Hiring company: ACME SAS. Occupation: Développeur / Développeuse web. Contract: Contrat à durée indéterminée, Temps plein. Experience: 3 An(s). Salary: Annuel de 45000.0 Euros à 55000.0 Euros sur 12.0 mois; Mutuelle. Positions: 2.\n\nVous rejoignez une équipe de 6 développeurs.\nStack : PHP 8, Laravel, MySQL, Vue.`,
    );
  });

  it('copes with a bare offer and builds the board URL from the id', () => {
    const job = mapFranceTravailOffer({ id: 'X1', intitule: ' Testeur ' }, 4);
    assert.equal(job.title, 'Testeur');
    assert.equal(job.location, 'France');
    assert.equal(job.url, 'https://candidat.francetravail.fr/offres/recherche/detail/X1');
    assert.equal(job.sourceUpdatedAt, null);
    assert.equal(job.description, `Source: France Travail. Reused under its licence: ${FRANCE_TRAVAIL_LICENCE_URL}`);
  });
});

describe('the search URL and the range header', () => {
  it('keeps the token\'s filters, adds the day window, the date sort and the page', () => {
    assert.equal(
      franceTravailSearchUrl('codeROME=M1805&evil=1&range=0-10', 1),
      'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?codeROME=M1805&publieeDepuis=1&sort=1&range=150-299',
    );
    assert.equal(
      franceTravailSearchUrl('?motsCles=php,laravel&departement=75&publieeDepuis=7', 0, 1),
      'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?motsCles=php%2Claravel&departement=75&publieeDepuis=7&sort=1&range=0-0',
    );
  });

  it('reads the total from Content-Range and nothing from anything else', () => {
    assert.equal(parseContentRange('offres 0-149/1234'), 1234);
    assert.equal(parseContentRange('offres 0-0/0'), 0);
    assert.equal(parseContentRange(null), null);
    assert.equal(parseContentRange('bytes 0-100/200'), null);
  });

  it('spells the licence line with and without a date', () => {
    assert.equal(licenceLine(new Date('2026-09-04T06:00:00Z')), `Source: France Travail — updated 2026-09-04. Reused under its licence: ${FRANCE_TRAVAIL_LICENCE_URL}`);
    assert.equal(licenceLine(null), `Source: France Travail. Reused under its licence: ${FRANCE_TRAVAIL_LICENCE_URL}`);
  });
});

describe('the token cache and the scrubbing', () => {
  it('refreshes a token a minute before the vendor expires it', () => {
    const issued = Date.parse('2026-09-04T10:00:00Z');
    const expires = issued + 1499 * 1000;
    assert.equal(tokenFresh(expires, issued + 10_000), true);
    assert.equal(tokenFresh(expires, expires - 30_000), false);
  });

  it('replaces the client secret in an HTTP error and keeps the status', () => {
    const err = scrubbed(new HttpError('HTTP 401 for https://x/?client_secret=s3cr3t', 401, 'https://x/?client_secret=s3cr3t'), ['s3cr3t']);
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 401);
    assert.equal(err.message, 'HTTP 401 for https://x/?client_secret=***');
    assert.equal(err.url, 'https://x/?client_secret=***');
  });
});
