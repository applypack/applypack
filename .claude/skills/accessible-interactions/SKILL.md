---
name: accessible-interactions
description: Keyboard, focus, ARIA and reduced-motion rules for every interactive element in the job-hunter dashboard (forms, tables, toggles, action buttons). Read before building or modifying any button, form, table or navigation.
---

# Accessible Interactions

The dashboard is server-rendered forms and tables. Accessibility here is
mostly semantics and focus — get those right and there is little else to do.

## Semantics first

- Actions are `<button>` inside a `<form method="post">` (`ActionForm` +
  `Button` in `ui.tsx`); navigation is `<a>`. Never a clickable `<div>`.
- One `<h1>` per page (`PageHeader`); section titles are `<h2>`
  (`SectionTitle`); heading levels never skip. Landmarks: `header`, `nav`
  (`aria-label="Primary"`), `main#main`, `section` per card, `footer`.
- Every input has a wired label — use `Field`, which wraps the control in a
  `<label>`. Groups of checkboxes/radios sit in a `<fieldset>` with a
  `<legend>`.
- Flash messages render with `role="status"` (`Flash`).
- Tables use `<th scope="col">` (`Table`); numeric cells are `font-mono
  tabular-nums`.
- Status conveyed by text, never colour alone: `Badge` shows the word,
  `FitBadge` shows the number plus a 4-step meter.

## Focus

- Focus order = visual reading order.
- Focus ring: `:focus-visible` outline in `--accent`, 2px offset, defined
  once in `layout.tsx`. Never remove it on a control.
- Skip link to `#main` is the first tabbable element (already in `Layout`).
- Sticky header must not cover a focused control: add `scroll-margin-top`
  when introducing in-page anchors.

## Touch and pointer

- Minimum hit area 32px tall for buttons (`Button` sets `min-h-[32px]`),
  28px for checkbox labels. Nothing depends on hover.
- Destructive actions confirm via `ActionForm confirm=` — the browser
  dialog is keyboard-accessible by default; do not replace it with a custom
  modal.

## Reduced motion

`layout.tsx` collapses all transitions under `prefers-reduced-motion`. Do
not add animations that carry meaning; the only motion is 150ms colour
transitions on hover.

## Forms

- Correct input types (`type="search"`, `type="url"`, `type="date"`,
  `type="number"` with min/max) and `autocomplete="off"` on secrets.
- Server-side validation errors come back as a flash; keep the user's input
  in the re-rendered form.

## Definition of accessible-done

Keyboard-only walkthrough of the changed page; 375px viewport has no
horizontal scroll outside a table's own `overflow-x-auto`; browser console
has zero errors.
