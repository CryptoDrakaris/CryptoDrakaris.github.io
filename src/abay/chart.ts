// График веса: план (пунктир) и факт (линия с точками). Чистый SVG, цвета из CSS-переменных,
// поэтому читается в светлой и тёмной теме. Ширина резиновая через viewBox.
import { addDays, daysBetween, dm, num } from './util';

const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

interface Opts {
  start: string;
  end: string;
  plan: (iso: string) => number;
  facts: { day: string; v: number }[];
  today: string;
}

export function weightChart({ start, end, plan, facts, today }: Opts): SVGSVGElement {
  const W = 520, H = 320, L = 46, R = 12, T = 34, B = 36;
  const span = daysBetween(start, end);
  const inRange = facts.filter((f) => f.day >= start && f.day <= end);
  const vals = [plan(start), plan(end), ...inRange.map((f) => f.v)];
  const lo = Math.floor(Math.min(...vals) - 1);
  const hi = Math.ceil(Math.max(...vals) + 1);
  const x = (iso: string) => L + ((W - L - R) * daysBetween(start, iso)) / span;
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);

  const last = inRange.at(-1);
  const label = last
    ? `График веса. План: с ${num(plan(start), 1)} до ${num(plan(end), 1)} кг к ${dm(end)}. Последний факт: ${num(last.v, 1)} кг на ${dm(last.day)}.`
    : `График веса. План: с ${num(plan(start), 1)} до ${num(plan(end), 1)} кг к ${dm(end)}. Фактических значений пока нет.`;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ab-chart', role: 'img', 'aria-label': label });

  // сетка и подписи по весу: шаг 1 или 2 кг, чтобы подписей было не больше 8
  const step = hi - lo > 8 ? 2 : 1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(s('text', { x: L - 8, y: y(v) + 6, 'text-anchor': 'end', class: 'tick' }, String(v)));
  }
  // подписи по датам: начало каждой недели и дедлайн
  for (let d = start; daysBetween(d, end) >= 4; d = addDays(d, 7)) {
    svg.append(s('text', { x: x(d), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, dm(d)));
  }
  svg.append(s('text', { x: x(end), y: H - 8, 'text-anchor': 'end', class: 'tick' }, dm(end)));

  // сегодня
  if (today >= start && today <= end) {
    svg.append(s('line', { x1: x(today), x2: x(today), y1: T, y2: H - B, class: 'today' }));
  }
  // план
  svg.append(s('line', { x1: x(start), y1: y(plan(start)), x2: x(end), y2: y(plan(end)), class: 'plan' }));
  // факт
  if (inRange.length > 1) {
    svg.append(s('polyline', { points: inRange.map((f) => `${x(f.day).toFixed(1)},${y(f.v).toFixed(1)}`).join(' '), class: 'fact' }));
  }
  for (const f of inRange) {
    const dot = s('circle', { cx: x(f.day), cy: y(f.v), r: 4, class: 'dot' });
    dot.append(s('title', {}, `${dm(f.day)}: ${num(f.v, 1)} кг`));
    svg.append(dot);
  }
  // легенда
  const lg = s('g', { class: 'legend', 'aria-hidden': 'true' });
  lg.append(s('line', { x1: W - 210, x2: W - 186, y1: 12, y2: 12, class: 'plan' }));
  lg.append(s('text', { x: W - 178, y: 18, class: 'tick' }, 'план'));
  lg.append(s('line', { x1: W - 112, x2: W - 88, y1: 12, y2: 12, class: 'fact' }));
  lg.append(s('circle', { cx: W - 100, cy: 12, r: 4, class: 'dot' }));
  lg.append(s('text', { x: W - 80, y: 18, class: 'tick' }, 'факт'));
  svg.append(lg);
  return svg;
}
