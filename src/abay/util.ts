// Мелкие помощники трекера: построение DOM без innerHTML, даты по Астане, числа по-русски.
import { TZ_OFFSET_MIN } from './config';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null;

/** Элемент с атрибутами и детьми. Текст всегда через textContent: данные из базы не исполняются. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

// ---------------------------------------------------------------- даты (строки YYYY-MM-DD, время Астаны)

const DAY = 86_400_000;

/** Сейчас по Астане: дата, у которой UTC-поля равны местному времени. */
export function astanaNow(): Date {
  return new Date(Date.now() + TZ_OFFSET_MIN * 60_000);
}
export function todayISO(): string {
  return astanaNow().toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
}
/** Понедельник недели, в которую входит дата. */
export function mondayOf(iso: string): string {
  const wd = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = вс
  return addDays(iso, -((wd + 6) % 7));
}
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export function weekday(iso: string): string {
  return WD[new Date(iso + 'T00:00:00Z').getUTCDay()];
}
/** 16.11 */
export function dm(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
/** 16.11.2026, 21:00 по Астане */
export function dateTime(ts: string): string {
  const d = new Date(Date.parse(ts) + TZ_OFFSET_MIN * 60_000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}, ${d.slice(11, 16)}`;
}

// ---------------------------------------------------------------- числа

/** 1.25 -> «1,25»; 8000 -> «8 000» */
export function num(v: unknown, digits?: number): string {
  if (v === null || v === undefined || v === '') return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('ru-RU', digits === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** Поле ввода с запятой или точкой -> число; пустое -> null; мусор -> NaN */
export function parseNum(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------------------------------------------------------------- localStorage (может быть недоступен)

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим: отметки покупок просто не запомнятся */
  }
}
