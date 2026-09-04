import { z } from 'zod';
import { fetchWithRetry, HttpError } from '../http';
import { redactSecrets } from '../source-keys';

/*
 * France Travail's OAuth2 client-credentials flow (francetravail.io docs,
 * "Générer un access token", read 2026-09-04): POST the client id, secret
 * and scopes as a form to the partner realm, get a bearer token that lives
 * ~1 499 s. Cached per process and refreshed a minute early; the secret is
 * scrubbed from anything this module throws.
 */
export const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
export const OFFERS_SCOPE = 'api_offresdemploiv2 o2dsoffre';
const TIMEOUT_MS = 15_000;
/** Refresh this long before the vendor's expiry so a call never lands on a dead token. */
const REFRESH_MARGIN_MS = 60_000;

const TokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).passthrough();

export interface FranceTravailCredentials {
  client_id: string;
  client_secret: string;
}

interface CachedToken {
  clientId: string;
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

/** Pure: is a token issued at `expiresAt` still worth using at `now`? */
export function tokenFresh(expiresAt: number, now: number): boolean {
  return expiresAt - REFRESH_MARGIN_MS > now;
}

/** A bearer token for the offers API — the cached one while it is fresh, a new one otherwise. */
export async function franceTravailToken(creds: FranceTravailCredentials, now = Date.now()): Promise<string> {
  if (cached && cached.clientId === creds.client_id && tokenFresh(cached.expiresAt, now)) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: OFFERS_SCOPE,
  });
  const secrets = [creds.client_secret, creds.client_id];
  let raw: unknown;
  try {
    const resp = await fetchWithRetry(TOKEN_URL, {
      timeoutMs: TIMEOUT_MS,
      init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    });
    raw = await resp.json();
  } catch (err) {
    throw scrubbed(err, secrets);
  }
  const parsed = TokenSchema.safeParse(raw);
  if (!parsed.success) throw new Error('France Travail: the token endpoint answered without an access_token — check the client id and secret');
  cached = { clientId: creds.client_id, token: parsed.data.access_token, expiresAt: now + parsed.data.expires_in * 1000 };
  return cached.token;
}

/** Drops the cached token — after a 401, so the next call fetches a new one. */
export function forgetFranceTravailToken(): void {
  cached = null;
}

/** The same error with the credentials replaced, for anything that may be logged or stored. */
export function scrubbed(err: unknown, secrets: readonly string[]): unknown {
  if (err instanceof HttpError) return new HttpError(redactSecrets(err.message, secrets), err.status, redactSecrets(err.url, secrets));
  if (err instanceof Error) {
    const clean = new Error(redactSecrets(err.message, secrets));
    clean.name = err.name;
    return clean;
  }
  return err;
}
