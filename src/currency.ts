/*
 * Salary in the posting's own money (plan §5.1 / §6.7). Until now the
 * classifier was asked for `salary_min_usd` with no rate and no currency
 * field: it converted silently, and a stored "60000" could be euros a year
 * or złoty a month. Now the model reports what the posting says — the
 * numbers, the currency, the period — and this file, which is pure and
 * tested, does the arithmetic (ADR 0012's rule: the model reads, the code
 * counts).
 *
 * The rates are approximate and dated on purpose: a salary range is a
 * signal, not an invoice. Refresh them when they drift enough to change a
 * verdict — `curl -s https://open.er-api.com/v6/latest/USD` prints USD per
 * unit as `1 / rates[CODE]` — and move RATES_REVIEWED_ON with them.
 */

/** USD per one unit. Source: exchangerate-api.com, 2026-09-04. */
export const RATES_REVIEWED_ON = '2026-09-04';

const RATES_TO_USD: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.1619,
  GBP: 1.3517,
  CHF: 1.2373,
  PLN: 0.2688,
  SEK: 0.1046,
  NOK: 0.1076,
  DKK: 0.1554,
  CZK: 0.048,
  HUF: 0.00319,
  RON: 0.2211,
  BGN: 0.5941,
  UAH: 0.02235,
  CAD: 0.725,
  AUD: 0.7196,
  NZD: 0.588,
  INR: 0.01058,
  BRL: 0.1963,
  ILS: 0.3318,
  JPY: 0.00641,
  SGD: 0.789,
  MXN: 0.059,
  TRY: 0.02066,
  ZAR: 0.06248,
  AED: 0.2723,
  GEL: 0.3824,
  RSD: 0.0099,
  ISK: 0.00826,
};

export const CURRENCY_CODES: readonly string[] = Object.keys(RATES_TO_USD);

/** How the posting quotes the number. Null in the database means a year. */
export const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'] as const;

export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/**
 * How many of each period a working year holds. Days and hours follow the
 * contracting convention (220 working days, 8 hours each) rather than the
 * calendar — an hourly rate × 8 760 would read as a fantasy salary.
 */
const PER_YEAR: Readonly<Record<SalaryPeriod, number>> = {
  year: 1,
  month: 12,
  week: 52,
  day: 220,
  hour: 1_760,
};

/** Symbols worth showing; everything else prints as its code. */
const SYMBOL: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  PLN: 'zł',
  UAH: '₴',
  INR: '₹',
  ILS: '₪',
};

export function isCurrencyCode(value: unknown): boolean {
  return typeof value === 'string' && value.toUpperCase() in RATES_TO_USD;
}

export function isSalaryPeriod(value: unknown): value is SalaryPeriod {
  return typeof value === 'string' && (SALARY_PERIODS as readonly string[]).includes(value);
}

/** The stored value read back: an unknown or missing currency is USD, as every row before this change. */
export function currencyOf(code: string | null | undefined): string {
  const upper = (code ?? '').toUpperCase();
  return upper in RATES_TO_USD ? upper : 'USD';
}

export function periodOf(value: string | null | undefined): SalaryPeriod {
  return isSalaryPeriod(value) ? value : 'year';
}

/**
 * One comparable number: this amount, in this money, over this period, as
 * USD a year. Null in, null out — a missing salary stays missing.
 */
export function toUsdPerYear(
  amount: number | null | undefined,
  code: string | null | undefined,
  period: string | null | undefined,
): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const rate = RATES_TO_USD[currencyOf(code)] ?? 1;
  return Math.round(amount * rate * PER_YEAR[periodOf(period)]);
}

/** "€60k-80k", "zł20k-27k/mo", "$150k+", "up to £90k", "—". */
export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  code?: string | null,
  period?: string | null,
): string {
  const lo = usable(min);
  const hi = usable(max);
  if (lo === null && hi === null) return '—';
  const money = currencyOf(code);
  const per = periodOf(period);
  const suffix = per === 'year' ? '' : `/${SHORT_PERIOD[per]}`;
  const amount = (n: number) => `${SYMBOL[money] ?? `${money} `}${round(n, per)}`;
  const range =
    lo !== null && hi !== null
      ? lo === hi
        ? amount(lo)
        : `${amount(lo)}-${trimSymbol(amount(hi), money)}`
      : lo !== null
        ? `${amount(lo)}+`
        : `up to ${amount(hi as number)}`;
  return `${range}${suffix}`;
}

/** "≈ $78k/yr" — the same range as one comparable number, or '' when it cannot be one. */
export function formatUsdPerYear(
  min: number | null | undefined,
  max: number | null | undefined,
  code?: string | null,
  period?: string | null,
): string {
  if (currencyOf(code) === 'USD' && periodOf(period) === 'year') return '';
  const usd = toUsdPerYear(max ?? min, code, period) ?? toUsdPerYear(min, code, period);
  return usd === null ? '' : `≈ $${round(usd, 'year')}/yr`;
}

const SHORT_PERIOD: Readonly<Record<SalaryPeriod, string>> = {
  year: 'yr',
  month: 'mo',
  week: 'wk',
  day: 'day',
  hour: 'hr',
};

/** Thousands for a yearly figure, the plain number for an hourly one. */
function round(n: number, period: SalaryPeriod): string {
  if (period === 'hour' || n < 1_000) return String(Math.round(n));
  return `${Math.round(n / 1_000)}k`;
}

/** The second half of a range drops the symbol: "€60k-80k", not "€60k-€80k". */
function trimSymbol(text: string, money: string): string {
  const symbol = SYMBOL[money] ?? `${money} `;
  return text.startsWith(symbol) ? text.slice(symbol.length) : text;
}

function usable(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}
