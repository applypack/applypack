/*
 * A chart's hover, as progressive enhancement: the chart is drawn by the
 * server and is in the page without this module. With it, the point under
 * the pointer (or the arrow keys, once the plot has focus) gets a guide line,
 * a dot and a small card saying which day it is, how many, and how that
 * compares with the point before. Dependency-free ES module served as-is;
 * nearestIndex(), describePoint() and placeTip() are pure — unit-tested from
 * src/web/chart.test.ts.
 *
 * The plot carries its data: `data-points` is a JSON list of
 * { l: label, v: value, y: the point's height as a share of the plot from
 * the top }, `data-unit` what is counted ("job"), `data-step` one point's
 * span ("day", "3 days" — the number of days is what is read). The card is
 * worded here, in the page's language (i18n.mjs).
 */

import { t } from './i18n.mjs';

/** What a plot can count, by its `data-unit`. */
const UNITS = { job: 'browser.chart.jobs' };

/** The days one point spans: "day" is one, "3 days" three, a number itself. */
function spanDays(step) {
  return Number.parseInt(String(step), 10) || 1;
}

/** The point a horizontal position falls nearest to, the points spread edge to edge. */
export function nearestIndex(x, width, count) {
  if (count <= 1 || width <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((x / width) * (count - 1))));
}

/** What the card says about point `i`: its label, "42 jobs", and the move from the point before. */
export function describePoint(points, i, unit, step) {
  const point = points[i];
  const value = t(UNITS[unit] ?? UNITS.job, { n: point.v });
  if (i === 0) return { label: point.l, value, delta: '', direction: 'flat' };
  const diff = point.v - points[i - 1].v;
  const days = spanDays(step);
  if (diff === 0) return { label: point.l, value, delta: t('browser.chart.same', { step: days }), direction: 'flat' };
  return {
    label: point.l,
    value,
    delta: t('browser.chart.delta', { sign: diff > 0 ? '+' : '−', n: Math.abs(diff), step: days }),
    direction: diff > 0 ? 'up' : 'down',
  };
}

/** The gap between the dot and its card. */
const TIP_GAP = 12;

/**
 * Where the card goes, inside the plot: above the dot and centred on it;
 * beside the dot when a peak leaves no room above — to its right, or to its
 * left near the right edge — so the card never covers the point it is about.
 */
export function placeTip({ x, y, width, tipWidth, tipHeight }) {
  const clamp = (left) => Math.min(Math.max(0, left), Math.max(0, width - tipWidth));
  if (y - tipHeight - TIP_GAP >= 0) return { left: clamp(x - tipWidth / 2), top: y - tipHeight - TIP_GAP };
  const right = x + TIP_GAP;
  const left = right + tipWidth <= width ? right : x - tipWidth - TIP_GAP;
  return { left: clamp(left), top: Math.max(0, y - tipHeight / 2) };
}

function wire(plot) {
  let points;
  try {
    points = JSON.parse(plot.dataset.points ?? '[]');
  } catch {
    return;
  }
  const hover = plot.querySelector('[data-chart-hover]');
  if (!hover || points.length === 0) return;
  const guide = hover.querySelector('[data-chart-guide]');
  const dot = hover.querySelector('[data-chart-dot]');
  const tip = hover.querySelector('[data-chart-tip]');
  const label = hover.querySelector('[data-tip-label]');
  const value = hover.querySelector('[data-tip-value]');
  const delta = hover.querySelector('[data-tip-delta]');
  const unit = plot.dataset.unit ?? 'job';
  const step = plot.dataset.step ?? 'day';
  let current = -1;

  const show = (i) => {
    current = i;
    const said = describePoint(points, i, unit, step);
    label.textContent = said.label;
    value.textContent = said.value;
    delta.textContent = said.delta;
    delta.dataset.direction = said.direction;
    delta.hidden = said.delta === '';
    hover.hidden = false;
    const width = plot.clientWidth;
    const height = plot.clientHeight;
    const x = points.length > 1 ? (i / (points.length - 1)) * width : width / 2;
    const y = (points[i].y / 100) * height;
    guide.style.left = `${x}px`;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    const spot = placeTip({ x, y, width, tipWidth: tip.offsetWidth, tipHeight: tip.offsetHeight });
    tip.style.left = `${spot.left}px`;
    tip.style.top = `${spot.top}px`;
  };
  const hide = () => {
    current = -1;
    hover.hidden = true;
  };

  plot.addEventListener('pointermove', (e) => {
    const rect = plot.getBoundingClientRect();
    const i = nearestIndex(e.clientX - rect.left, rect.width, points.length);
    if (i !== current) show(i);
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('focus', () => show(current >= 0 ? current : points.length - 1));
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      show(Math.min(points.length - 1, Math.max(0, (current >= 0 ? current : points.length - 1) + move)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      show(points.length - 1);
    } else if (e.key === 'Escape') {
      hide();
    }
  });
}

/** Every `[data-plot]` under `root` gets its hover. */
export function wireCharts(root = document) {
  for (const plot of root.querySelectorAll('[data-plot]')) wire(plot);
}
