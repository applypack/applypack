# Bundled fonts

The dashboard fetches nothing from a third party, its typefaces included.
Each file is served as it came from npm, byte for byte;
`src/web/self-contained.test.ts` holds it to the hash below.

| File | Package | Version | Licence | SHA-256 |
| --- | --- | --- | --- | --- |
| `inter-latin.woff2` | Inter variable, latin subset, as served by Google Fonts | — | OFL 1.1 (`LICENSE-Inter.txt`) | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `inter-cyrillic.woff2` | [@fontsource-variable/inter](https://www.npmjs.com/package/@fontsource-variable/inter) (`files/inter-cyrillic-wght-normal.woff2`) | 5.3.0 | OFL 1.1 (`LICENSE-Inter.txt`) | `71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075` |
| `noto-sans-devanagari.woff2` | [@fontsource-variable/noto-sans-devanagari](https://www.npmjs.com/package/@fontsource-variable/noto-sans-devanagari) (`files/noto-sans-devanagari-devanagari-wght-normal.woff2`) | 5.3.0 | OFL 1.1 (`LICENSE-NotoSansDevanagari.txt`) | `3b3cae4d2600cb502286577fcfbc7f0caa05d9bb3c28d6699aeb56302d35e730` |

The latin file is on every page. The other two carry a `unicode-range`
(`../../tailwind.css`), so a browser asks for one only when a page holds
Cyrillic or Devanagari text: an English page costs what it did.

To add a script: `npm pack @fontsource-variable/<family>@<version>`, copy the
subset's `wght-normal.woff2` here with the package's `LICENSE`, add its
`@font-face` with the `unicode-range` the package's CSS gives it, and a row
to this table and to the test.
