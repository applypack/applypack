# Bundled fonts

**Liberation Sans 2.1.5**, regular and bold — SIL Open Font License 1.1, the
full text in `LICENSE-liberation.txt`. Upstream:
<https://github.com/liberationfonts/liberation-fonts> (Red Hat, Inc.; digitised
data © Google).

Embedded in every PDF the clean renderer writes (`render/clean-pdf.ts`), so a
PDF has to carry the glyphs it draws. The `.docx` renderer embeds nothing — it
names the family and the reader's own Word supplies it.

Why this family and not another (ADR 0039, measured with fontkit):

- **Metric-compatible with Arial.** All 95 printable ASCII codepoints have
  identical advance widths (max delta 0 of 2048 units/em). The corpus resume
  is set in Arial, so the `.docx` we name `Arial` in and the `.pdf` we embed
  this in break their lines in the same places.
- **Latin and Cyrillic**, regular and bold: `Назар Бойко`, `Ґ ґ Є є І і Ї ї`
  and the typographic punctuation all have glyphs — 0 missing of the probe set.
- OFL, so it can ship inside the image without a licence question.

825 KB for the pair. Copied into the runtime image by the Dockerfile.
