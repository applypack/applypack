/**
 * The named character references a posting may carry: HTML 4's 252 and
 * `&apos;` — every Latin-1 letter and sign ("caf&eacute;", "&euro;"), the
 * typography ("&mdash;", "&rsquo;", "&hellip;"), Greek, arrows and the
 * maths signs — at the code points HTML 5 gives them. HTML 5 knows two
 * thousand more, nearly all maths; a name outside this table stays in the
 * text as it was written. Pure.
 */

/** U+00A0 onward, one name per code point. */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

/** U+0391 onward; U+03A2 has no letter, so no name. */
const GREEK_CAPITALS = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega';
/** U+03B1 onward. */
const GREEK_SMALL = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega';

const SCATTERED: Readonly<Record<string, number>> = {
  quot: 0x22, amp: 0x26, apos: 0x27, lt: 0x3c, gt: 0x3e,
  OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192, circ: 0x2c6, tilde: 0x2dc,
  thetasym: 0x3d1, upsih: 0x3d2, piv: 0x3d6,
  ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, zwnj: 0x200c, zwj: 0x200d, lrm: 0x200e, rlm: 0x200f,
  ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d, bdquo: 0x201e,
  dagger: 0x2020, Dagger: 0x2021, bull: 0x2022, hellip: 0x2026, permil: 0x2030, prime: 0x2032, Prime: 0x2033,
  lsaquo: 0x2039, rsaquo: 0x203a, oline: 0x203e, frasl: 0x2044, euro: 0x20ac,
  image: 0x2111, weierp: 0x2118, real: 0x211c, trade: 0x2122, alefsym: 0x2135,
  larr: 0x2190, uarr: 0x2191, rarr: 0x2192, darr: 0x2193, harr: 0x2194, crarr: 0x21b5,
  lArr: 0x21d0, uArr: 0x21d1, rArr: 0x21d2, dArr: 0x21d3, hArr: 0x21d4,
  forall: 0x2200, part: 0x2202, exist: 0x2203, empty: 0x2205, nabla: 0x2207, isin: 0x2208, notin: 0x2209, ni: 0x220b,
  prod: 0x220f, sum: 0x2211, minus: 0x2212, lowast: 0x2217, radic: 0x221a, prop: 0x221d, infin: 0x221e, ang: 0x2220,
  and: 0x2227, or: 0x2228, cap: 0x2229, cup: 0x222a, int: 0x222b, there4: 0x2234, sim: 0x223c, cong: 0x2245, asymp: 0x2248,
  ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265, sub: 0x2282, sup: 0x2283, nsub: 0x2284, sube: 0x2286, supe: 0x2287,
  oplus: 0x2295, otimes: 0x2297, perp: 0x22a5, sdot: 0x22c5,
  lceil: 0x2308, rceil: 0x2309, lfloor: 0x230a, rfloor: 0x230b, lang: 0x27e8, rang: 0x27e9,
  loz: 0x25ca, spades: 0x2660, clubs: 0x2663, hearts: 0x2665, diams: 0x2666,
};

/**
 * Where the text wants something other than the character. A no-break space
 * is a space — titles and descriptions are matched word by word — and a soft
 * hyphen is nothing: it shows only where it breaks a line, and a word that
 * holds one no longer matches the keyword it spells.
 */
const AS_TEXT: Readonly<Record<string, string>> = { nbsp: ' ', shy: '' };

/** The names feeds also write in capitals ("&AMP;", "&NBSP;"). */
const CASELESS = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp']);

function table(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const run = (names: string, from: number) =>
    names.split(' ').forEach((name, i) => {
      if (name !== '-') out.set(name, String.fromCodePoint(from + i));
    });
  run(LATIN1, 0xa0);
  run(GREEK_CAPITALS, 0x391);
  run(GREEK_SMALL, 0x3b1);
  for (const [name, code] of Object.entries(SCATTERED)) out.set(name, String.fromCodePoint(code));
  for (const [name, text] of Object.entries(AS_TEXT)) out.set(name, text);
  return out;
}

const NAMED = table();

/** The text `&name;` stands for, or undefined for a name this table does not know. */
export function namedEntity(name: string): string | undefined {
  const lower = name.toLowerCase();
  return NAMED.get(name) ?? (CASELESS.has(lower) ? NAMED.get(lower) : undefined);
}
