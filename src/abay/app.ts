// План Абая: клиент трекера. Вход по ссылке из письма, данные – Supabase под RLS.
// Вся разметка строится из DOM-узлов (util.h), данные из базы в innerHTML не попадают.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { CATEGORIES, CATEGORY_KEYS, DEADLINE, HABITS, REPORT_FIELDS, ROUTINE, START, TZ_OFFSET_MIN } from './config';
import food from './food.json';
import { addDays, clear, dateTime, daysBetween, dm, h, load, mondayOf, num, parseNum, plural, save, todayISO, weekday } from './util';
import { weightChart } from './chart';

// ---------------------------------------------------------------- типы

type Role = 'father' | 'son';
interface Profile { user_id: string; role: Role; name: string }
interface Goal { key: string; title: string; value: number | string; unit: string | null; editable_by_son: boolean; min_value: number | null; max_value: number | null; options: (number | string)[] | null }
interface GoalChange { id: number; key: string; old_value: unknown; new_value: unknown; reason: string; changed_by: string; changed_at: string }
interface Week { n: number; starts: string; ends: string; report_due: string }
interface Task { id: string; week: number; category: string; title: string; locked: boolean; sort: number; done: boolean; done_at: string | null; note: string | null; created_by: string | null }
interface Checkin { day: string; weight: number | null; steps: number | null; habits: Record<string, boolean>; note: string | null; updated_by: string | null }
interface Report { week: number; weight: number | null; waist: number | null; submitted_at: string; submitted_by: string | null; [k: string]: unknown }
interface Comment { id: number; week: number | null; text: string; author: string; created_at: string }

const S = {
  me: null as Profile | null,
  profiles: [] as Profile[],
  goals: [] as Goal[],
  changes: [] as GoalChange[],
  weeks: [] as Week[],
  tasks: [] as Task[],
  checkins: [] as Checkin[],
  reports: [] as Report[],
  comments: [] as Comment[],
};

// ---------------------------------------------------------------- Supabase

const url = import.meta.env.PUBLIC_ABAY_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_ABAY_SUPABASE_KEY as string | undefined;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const PAGE_URL = `${location.origin}${BASE}/abay/`;

// Ошибку ссылки из письма Supabase кладёт в хэш; читаем до того, как клиент его очистит.
const linkError = (() => {
  const hash = location.hash;
  if (!hash.includes('error')) return null;
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  return p.get('error_code') === 'otp_expired'
    ? 'Ссылка для входа устарела или уже использована. Запроси новую.'
    : 'Войти по этой ссылке не получилось. Запроси новую.';
})();

const sb: SupabaseClient | null = url && key
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // implicit: ссылка из письма работает и в другом браузере, чем тот, где её запросили
        flowType: 'implicit',
        storageKey: 'abay-auth',
      },
    })
  : null;

const root = document.getElementById('abay')!;
let session: Session | null = null;

// ---------------------------------------------------------------- общие помощники

const isFather = () => S.me?.role === 'father';
const uid = () => session?.user.id ?? '';
const nameOf = (id: string | null) => S.profiles.find((p) => p.user_id === id)?.name ?? 'кто-то';
const goal = (k: string) => S.goals.find((g) => g.key === k);
const goalNum = (k: string, fallback: number) => {
  const v = Number(goal(k)?.value);
  return Number.isFinite(v) ? v : fallback;
};

function currentWeek(): Week | undefined {
  const d = todayISO();
  return S.weeks.find((w) => w.starts <= d && d <= w.ends) ?? (d < (S.weeks[0]?.starts ?? '') ? S.weeks[0] : S.weeks.at(-1));
}

type WeekStatus = { text: string; tone: 'ok' | 'bad' | 'now' | 'later' };
function weekStatus(w: Week): WeekStatus {
  if (S.reports.some((r) => r.week === w.n)) return { text: 'отчёт сдан', tone: 'ok' };
  if (Date.now() > Date.parse(w.report_due)) return { text: 'отчёт не сдан', tone: 'bad' };
  if (todayISO() < w.starts) return { text: 'впереди', tone: 'later' };
  return { text: 'идёт', tone: 'now' };
}

/** План по весу на дату: от стартового веса минус «снижение в неделю» за каждую неделю. */
function planWeight(iso: string): number {
  const start = goalNum('start_weight', 125);
  const loss = goalNum('weekly_loss', 1.25);
  return start - (loss * daysBetween(START, iso)) / 7;
}

function errText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет связи. Проверь интернет и попробуй ещё раз.';
  if (/JWT|token/i.test(m)) return 'Сессия устарела. Обнови страницу и войди заново.';
  return m;
}

/** Строка статуса под формой. role=status, чтобы экранная читалка проговорила результат. */
function statusLine() {
  const el = h('p', { class: 'ab-status', role: 'status' });
  return {
    el,
    ok(t: string) { el.className = 'ab-status ok'; el.textContent = t; },
    bad(t: string) { el.className = 'ab-status bad'; el.textContent = t; },
    clear() { el.className = 'ab-status'; el.textContent = ''; },
  };
}

/** Кнопка, которая блокируется на время запроса. */
async function busy(btn: HTMLButtonElement, fn: () => Promise<void>) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------- загрузка

async function loadAll() {
  const c = sb!;
  const [profiles, goals, changes, weeks, tasks, checkins, reports, comments] = await Promise.all([
    q<Profile[]>(c.from('abay_profiles').select('user_id, role, name')),
    q<Goal[]>(c.from('abay_goals').select('key, title, value, unit, editable_by_son, min_value, max_value, options').order('key')),
    q<GoalChange[]>(c.from('abay_goal_changes').select('*').order('changed_at', { ascending: false })),
    q<Week[]>(c.from('abay_weeks').select('*').order('n')),
    q<Task[]>(c.from('abay_tasks').select('id, week, category, title, locked, sort, done, done_at, note, created_by').order('week').order('sort').order('created_at')),
    q<Checkin[]>(c.from('abay_checkins').select('day, weight, steps, habits, note, updated_by').order('day')),
    q<Report[]>(c.from('abay_reports').select('*').order('week')),
    q<Comment[]>(c.from('abay_comments').select('*').order('created_at')),
  ]);
  Object.assign(S, { profiles, goals, changes, weeks, tasks, checkins, reports, comments });
  // порядок целей как в плане
  const order = ['start_weight', 'weekly_loss', 'steps', 'workouts', 'water', 'bedtime'];
  S.goals.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
}

// ---------------------------------------------------------------- вход

function loginView(message?: string) {
  const email = h('input', { type: 'email', id: 'ab-email', autocomplete: 'email', required: true, inputmode: 'email', placeholder: 'name@mail.com' });
  const st = statusLine();
  if (message) st.bad(message);
  const btn = h('button', { type: 'submit', class: 'ab-btn', text: 'Прислать ссылку' });
  const form = h('form', { class: 'ab-card ab-login', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(btn, async () => {
      st.clear();
      const { error } = await sb!.auth.signInWithOtp({
        email: email.value.trim(),
        // учётки заводит папа приглашением; по ссылке новые не создаются
        options: { shouldCreateUser: false, emailRedirectTo: PAGE_URL },
      });
      if (error) {
        st.bad(/signups not allowed|not found|Signups/i.test(error.message)
          ? 'Этот адрес не подключён к плану. Напиши папе.'
          : errText(error));
      } else {
        st.ok('Ссылка отправлена. Открой письмо на этом телефоне и нажми ссылку. Письмо может прийти через минуту, загляни и в «Спам».');
      }
    });
  } },
    h('h1', { text: 'План Абая' }),
    h('p', { class: 'ab-muted', text: 'Вход без пароля: пришлём ссылку на почту.' }),
    h('label', { for: 'ab-email', text: 'Почта' }),
    email,
    btn,
    st.el,
  );
  clear(root, form);
}

function noAccessView() {
  clear(root, h('div', { class: 'ab-card ab-login' },
    h('h1', { text: 'Нет доступа' }),
    h('p', { text: 'Этот адрес не подключён к плану. Если это ошибка – напиши папе.' }),
    h('button', { class: 'ab-btn ghost', text: 'Выйти', onclick: signOut }),
  ));
}

async function signOut() {
  await sb?.auth.signOut({ scope: 'local' });
  location.hash = '';
  loginView();
}

// ---------------------------------------------------------------- оболочка и вкладки

type TabId = 'today' | 'week' | 'report' | 'food' | 'goals' | 'progress' | 'summary';
interface Tab { id: TabId; label: string; render: () => Node }

// Абай заполняет, папа смотрит: у каждого своё меню.
const SON_TABS: Tab[] = [
  { id: 'today', label: 'Сегодня', render: renderToday },
  { id: 'week', label: 'Неделя', render: renderWeeks },
  { id: 'report', label: 'Отчёт', render: renderReport },
  { id: 'food', label: 'Питание', render: renderFood },
  { id: 'goals', label: 'Цели', render: renderGoals },
  { id: 'progress', label: 'Прогресс', render: renderProgress },
];
const FATHER_TABS: Tab[] = [
  { id: 'summary', label: 'Сводка', render: renderSummary },
  { id: 'week', label: 'Недели', render: renderWeeks },
  { id: 'goals', label: 'Цели', render: renderGoals },
  { id: 'progress', label: 'Прогресс', render: renderProgress },
];
let TABS: Tab[] = SON_TABS;
const tabKey = () => `abay-tab-${S.me?.role ?? 'son'}`;

let activeTab: TabId = 'today';
const panel = h('section', { class: 'ab-panel', role: 'tabpanel', tabindex: '-1' });
const tabButtons = new Map<TabId, HTMLButtonElement>();

function shell() {
  TABS = isFather() ? FATHER_TABS : SON_TABS;
  activeTab = load<string>(tabKey(), TABS[0].id) as TabId;
  if (!TABS.some((t) => t.id === activeTab)) activeTab = TABS[0].id;
  tabButtons.clear();
  const tabs = h('div', { class: `ab-tabs n${TABS.length}`, role: 'tablist', 'aria-label': 'Разделы' });
  for (const t of TABS) {
    const b = h('button', {
      type: 'button', role: 'tab', id: `ab-tab-${t.id}`, 'aria-controls': 'ab-panel', text: t.label,
      onclick: () => openTab(t.id, true),
      onkeydown: (e: KeyboardEvent) => {
        const i = TABS.findIndex((x) => x.id === t.id);
        const go = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
        if (go === null) return;
        e.preventDefault();
        const next = TABS[(go + TABS.length) % TABS.length].id;
        openTab(next, false);
        tabButtons.get(next)!.focus();
      },
    });
    tabButtons.set(t.id, b);
    tabs.append(b);
  }
  panel.id = 'ab-panel';
  const days = Math.max(0, daysBetween(todayISO(), DEADLINE));
  clear(root,
    h('header', { class: 'ab-top' },
      h('div', null,
        h('h1', { text: 'План Абая' }),
        h('p', { class: 'ab-muted', text: `${S.me!.name} · до 26.12 ${days} ${plural(days, 'день', 'дня', 'дней')}` }),
      ),
      h('button', { class: 'ab-btn ghost small', text: 'Выйти', onclick: signOut }),
    ),
    tabs,
    panel,
  );
  openTab(activeTab, false);
}

function openTab(id: TabId, focusPanel: boolean) {
  activeTab = id;
  save(tabKey(), id);
  for (const [tid, b] of tabButtons) {
    const on = tid === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  panel.setAttribute('aria-labelledby', `ab-tab-${id}`);
  rerender();
  if (focusPanel) panel.focus({ preventScroll: true });
}

function rerender() {
  const t = TABS.find((x) => x.id === activeTab)!;
  clear(panel, t.render());
}

/** Перечитать данные и перерисовать текущую вкладку. */
async function refresh() {
  await loadAll();
  rerender();
}

// ---------------------------------------------------------------- «Сегодня»

function renderToday(): Node {
  const today = todayISO();
  const dayInput = h('input', { type: 'date', id: 'ab-day', value: today, max: today, min: START });
  const weight = h('input', { type: 'text', id: 'ab-weight', inputmode: 'decimal', autocomplete: 'off', placeholder: 'например, 124,6' });
  const steps = h('input', { type: 'text', id: 'ab-steps', inputmode: 'numeric', autocomplete: 'off', placeholder: `цель ${num(goal('steps')?.value ?? 8000)}` });
  const note = h('textarea', { id: 'ab-note', rows: 2, placeholder: 'Как прошёл день (по желанию)' });
  const boxes = HABITS.map((hb) => h('input', { type: 'checkbox', id: `ab-h-${hb.key}`, name: hb.key }));
  const st = statusLine();

  const fill = () => {
    const c = S.checkins.find((x) => x.day === dayInput.value);
    weight.value = c?.weight != null ? num(c.weight) : '';
    steps.value = c?.steps != null ? String(c.steps) : '';
    note.value = c?.note ?? '';
    boxes.forEach((b) => (b.checked = Boolean(c?.habits?.[b.name])));
    st.clear();
    if (c) st.ok(`Отметка за ${dm(c.day)} уже есть – можно поправить.`);
  };
  dayInput.addEventListener('change', fill);

  const btn = h('button', { type: 'submit', class: 'ab-btn', text: 'Сохранить' });
  const form = h('form', { class: 'ab-card', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(btn, async () => {
      st.clear();
      const w = parseNum(weight.value);
      const s = parseNum(steps.value);
      if (Number.isNaN(w) || (w !== null && (w < 40 || w > 250))) return st.bad('Вес – число от 40 до 250, например 124,6.');
      if (Number.isNaN(s) || (s !== null && (s < 0 || s > 100000 || !Number.isInteger(s)))) return st.bad('Шаги – целое число, например 8500.');
      if (!dayInput.value || dayInput.value > today) return st.bad('Выбери дату не позже сегодняшней.');
      const habits = Object.fromEntries(boxes.map((b) => [b.name, b.checked]));
      try {
        await q(sb!.from('abay_checkins').upsert({ day: dayInput.value, weight: w, steps: s, habits, note: note.value.trim() || null }, { onConflict: 'day' }).select());
        await loadAll();
        st.ok(`Сохранено: ${dm(dayInput.value)}, ${weekday(dayInput.value)}.`);
      } catch (err) {
        st.bad(errText(err));
      }
    });
  } },
    h('h2', { text: 'Отметка за день' }),
    h('div', { class: 'ab-grid3' },
      h('div', null, h('label', { for: 'ab-day', text: 'Дата' }), dayInput),
      h('div', null, h('label', { for: 'ab-weight', text: 'Вес, кг' }, h('span', { class: 'ab-opt', text: ' по желанию' })), weight),
      h('div', null, h('label', { for: 'ab-steps', text: 'Шаги' }), steps),
    ),
    h('fieldset', { class: 'ab-habits' },
      h('legend', { text: 'Сегодня получилось' }),
      HABITS.map((hb, i) => h('label', { class: 'ab-check', for: `ab-h-${hb.key}` }, boxes[i], h('span', { text: hb.title }))),
    ),
    h('label', { for: 'ab-note', text: 'Заметка' }),
    note,
    btn,
    st.el,
  );
  fill();

  const w = currentWeek();
  return h('div', { class: 'ab-stack' },
    form,
    w ? h('div', { class: 'ab-card' },
      h('h2', { text: `Задачи недели ${w.n} · ${dm(w.starts)}–${dm(w.ends)}` }),
      taskList(S.tasks.filter((t) => t.week === w.n), false),
      h('p', { class: 'ab-muted small', text: 'Все недели, свои задачи и комментарии папы – во вкладке «Неделя».' }),
    ) : null,
  );
}

// ---------------------------------------------------------------- задачи

function taskList(tasks: Task[], editable: boolean): Node {
  if (!tasks.length) return h('p', { class: 'ab-muted', text: 'Задач пока нет.' });
  const groups = CATEGORY_KEYS.map((c) => ({ c, items: tasks.filter((t) => t.category === c) })).filter((g) => g.items.length);
  return h('div', { class: 'ab-tasks' }, groups.map((g) =>
    h('div', { class: 'ab-taskgroup' },
      h('h3', { text: CATEGORIES[g.c] }),
      h('ul', null, g.items.map((t) => taskRow(t, editable))),
    ),
  ));
}

function taskRow(t: Task, editable: boolean): HTMLElement {
  const id = `ab-t-${t.id}`;
  const box = h('input', { type: 'checkbox', id, checked: t.done });
  const li = h('li', { class: t.done ? 'done' : '' });
  const st = statusLine();
  box.addEventListener('change', async () => {
    box.disabled = true;
    st.clear();
    try {
      await q(sb!.rpc('abay_set_task', { p_id: t.id, p_done: box.checked }));
      t.done = box.checked;
      li.classList.toggle('done', t.done);
    } catch (e) {
      box.checked = !box.checked;
      st.bad(errText(e));
    } finally {
      box.disabled = false;
    }
  });
  const mine = t.created_by !== null && t.created_by === uid();
  const canEdit = editable && (isFather() || (mine && !t.locked));
  li.append(
    h('label', { class: 'ab-check', for: id }, box,
      h('span', null, t.title,
        t.locked ? h('span', { class: 'ab-lock', title: 'Задачу меняет папа', text: ' 🔒' }) : null,
        mine && !isFather() ? h('span', { class: 'ab-tag', text: 'своя' }) : null,
        isFather() && t.created_by && t.created_by !== uid() ? h('span', { class: 'ab-tag', text: 'добавил Абай' }) : null)),
    canEdit ? h('div', { class: 'ab-row-actions' },
      h('button', { type: 'button', class: 'ab-link', text: 'Изменить', onclick: () => li.replaceWith(taskEditor(t)) }),
      h('button', { type: 'button', class: 'ab-link danger', text: 'Удалить', onclick: async (e: Event) => {
        if (!confirm(`Удалить задачу «${t.title}»?`)) return;
        await busy(e.currentTarget as HTMLButtonElement, async () => {
          try {
            await q(sb!.rpc('abay_delete_task', { p_id: t.id }));
            await refresh();
          } catch (err) {
            st.bad(errText(err));
          }
        });
      } }),
    ) : null,
    st.el,
  );
  return li;
}

function categorySelect(id: string, value?: string) {
  return h('select', { id }, CATEGORY_KEYS.map((c) => h('option', { value: c, text: CATEGORIES[c], selected: c === value })));
}
function weekSelect(id: string, value: number) {
  return h('select', { id }, S.weeks.map((w) => h('option', { value: String(w.n), text: `Неделя ${w.n} (${dm(w.starts)}–${dm(w.ends)})`, selected: w.n === value })));
}

function taskEditor(t: Task): HTMLElement {
  const p = `ab-e-${t.id}`;
  const title = h('textarea', { id: `${p}-title`, rows: 2, value: t.title, maxlength: 300 });
  const cat = categorySelect(`${p}-cat`, t.category);
  const wk = weekSelect(`${p}-week`, t.week);
  const st = statusLine();
  const btn = h('button', { type: 'submit', class: 'ab-btn small', text: 'Сохранить' });
  return h('li', null, h('form', { class: 'ab-inline', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(btn, async () => {
      try {
        await q(sb!.rpc('abay_edit_task', { p_id: t.id, p_week: Number(wk.value), p_category: cat.value, p_title: title.value }));
        await refresh();
      } catch (err) {
        st.bad(errText(err));
      }
    });
  } },
    h('label', { for: `${p}-title`, text: 'Задача' }), title,
    h('div', { class: 'ab-grid2' },
      h('div', null, h('label', { for: `${p}-cat`, text: 'Раздел' }), cat),
      h('div', null, h('label', { for: `${p}-week`, text: 'Неделя' }), wk)),
    h('div', { class: 'ab-actions' }, btn, h('button', { type: 'button', class: 'ab-btn ghost small', text: 'Отмена', onclick: rerender })),
    st.el,
  ));
}

function addTaskForm(w: Week): HTMLElement {
  const p = `ab-add-${w.n}`;
  const title = h('input', { type: 'text', id: `${p}-title`, maxlength: 300, placeholder: 'Что сделать' });
  const cat = categorySelect(`${p}-cat`, 'home');
  const st = statusLine();
  const btn = h('button', { type: 'submit', class: 'ab-btn small', text: 'Добавить' });
  return h('details', { class: 'ab-add' },
    h('summary', { text: isFather() ? '+ Добавить задачу' : '+ Добавить свою задачу' }),
    h('form', { class: 'ab-inline', onsubmit: (e: Event) => {
      e.preventDefault();
      busy(btn, async () => {
        try {
          await q(sb!.rpc('abay_add_task', { p_week: w.n, p_category: cat.value, p_title: title.value }));
          await refresh();
        } catch (err) {
          st.bad(errText(err));
        }
      });
    } },
      h('label', { for: `${p}-title`, text: 'Задача' }), title,
      h('label', { for: `${p}-cat`, text: 'Раздел' }), cat,
      btn, st.el,
    ),
  );
}

// ---------------------------------------------------------------- «Неделя»

function renderWeeks(): Node {
  const cur = currentWeek();
  return h('div', { class: 'ab-stack' }, S.weeks.map((w) => {
    const st = weekStatus(w);
    const tasks = S.tasks.filter((t) => t.week === w.n);
    const done = tasks.filter((t) => t.done).length;
    const comments = S.comments.filter((c) => c.week === w.n);
    return h('details', { class: 'ab-card ab-week', open: w.n === cur?.n },
      h('summary', null,
        h('span', { class: 'ab-week-title', text: `Неделя ${w.n}` }),
        h('span', { class: 'ab-muted', text: ` ${dm(w.starts)}–${dm(w.ends)}` }),
        h('span', { class: `ab-badge ${st.tone}`, text: st.text }),
      ),
      h('p', { class: 'ab-muted small' },
        `Цель по весу к концу недели – ${num(planWeight(w.ends), 1)} кг. Задач выполнено: ${done} из ${tasks.length}. Отчёт – до ${dateTime(w.report_due)}.`),
      isFather() ? reportView(w) : null,
      isFather() ? h('h3', { class: 'ab-sub', text: 'Задачи' }) : null,
      taskList(tasks, true),
      addTaskForm(w),
      h('div', { class: 'ab-comments' },
        h('h3', { text: isFather() ? 'Ваши комментарии' : 'Комментарии папы' }),
        comments.length
          ? h('ul', null, comments.map((c) => h('li', null,
              h('p', { text: c.text }),
              h('p', { class: 'ab-muted small', text: `${nameOf(c.author)}, ${dateTime(c.created_at)}` }))))
          : h('p', { class: 'ab-muted small', text: 'Пока нет.' }),
        isFather() ? commentForm(w) : null,
      ),
    );
  }));
}

/** Отчёт Абая за неделю целиком – для папы. */
function reportView(w: Week): HTMLElement {
  const r = S.reports.find((x) => x.week === w.n);
  if (!r) {
    const st = weekStatus(w);
    return h('div', { class: 'ab-report' },
      h('h3', { class: 'ab-sub', text: 'Отчёт Абая' }),
      h('p', { class: st.tone === 'bad' ? 'ab-bad' : 'ab-muted small', text: st.tone === 'bad' ? `Не сдан, срок был ${dateTime(w.report_due)}.` : `Ещё не сдан. Срок – ${dateTime(w.report_due)}.` }));
  }
  const late = Date.parse(r.submitted_at) > Date.parse(w.report_due);
  const rows: [string, string][] = [];
  if (r.weight != null) rows.push(['Вес', `${num(Number(r.weight), 1)} кг (план ${num(planWeight(w.ends), 1)})`]);
  if (r.waist != null) rows.push(['Талия', `${num(Number(r.waist), 1)} см`]);
  for (const f of REPORT_FIELDS) {
    const v = (r[f.key] as string | null)?.trim();
    rows.push([f.label, v || '–']);
  }
  return h('div', { class: 'ab-report' },
    h('h3', { class: 'ab-sub', text: 'Отчёт Абая' }),
    h('p', { class: 'ab-muted small', text: `Сдан ${dateTime(r.submitted_at)}${late ? ' – после срока' : ''}.` }),
    h('dl', { class: 'ab-dl' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { class: v === '–' ? 'ab-muted' : '', text: v })])),
  );
}

function commentForm(w: Week): HTMLElement {
  const id = `ab-c-${w.n}`;
  const text = h('textarea', { id, rows: 2, maxlength: 4000 });
  const st = statusLine();
  const btn = h('button', { type: 'submit', class: 'ab-btn small', text: 'Написать' });
  return h('form', { class: 'ab-inline', onsubmit: (e: Event) => {
    e.preventDefault();
    if (!text.value.trim()) return st.bad('Комментарий пустой.');
    busy(btn, async () => {
      try {
        await q(sb!.from('abay_comments').insert({ week: w.n, text: text.value.trim() }).select());
        await refresh();
      } catch (err) {
        st.bad(errText(err));
      }
    });
  } }, h('label', { for: id, text: 'Комментарий к неделе' }), text, btn, st.el);
}

// ---------------------------------------------------------------- «Отчёт»

function renderReport(): Node {
  const cur = currentWeek();
  // по умолчанию – текущая неделя; в понедельник утром удобнее прошлая, если она не сдана
  let def = cur?.n ?? 1;
  const prev = S.weeks.find((w) => w.n === def - 1);
  if (prev && !S.reports.some((r) => r.week === prev.n) && daysBetween(prev.ends, todayISO()) <= 1) def = prev.n;

  const wk = weekSelect('ab-r-week', def);
  const weight = h('input', { type: 'text', id: 'ab-r-weight', inputmode: 'decimal', autocomplete: 'off' });
  const waist = h('input', { type: 'text', id: 'ab-r-waist', inputmode: 'decimal', autocomplete: 'off' });
  const fields = REPORT_FIELDS.map((f) => h('textarea', { id: `ab-r-${f.key}`, name: f.key, rows: 2 }));
  const due = h('p', { class: 'ab-muted small' });
  const st = statusLine();
  const btn = h('button', { type: 'submit', class: 'ab-btn' });

  const fill = () => {
    const n = Number(wk.value);
    const w = S.weeks.find((x) => x.n === n)!;
    const r = S.reports.find((x) => x.week === n);
    weight.value = r?.weight != null ? num(r.weight) : '';
    waist.value = r?.waist != null ? num(r.waist) : '';
    fields.forEach((f) => (f.value = (r?.[f.name] as string) ?? ''));
    btn.textContent = r ? 'Сохранить изменения' : 'Сдать отчёт';
    const late = r && Date.parse(r.submitted_at) > Date.parse(w.report_due);
    due.textContent = r
      ? `Сдан ${dateTime(r.submitted_at)}${late ? ' (после срока)' : ''}. Правки не меняют время сдачи.`
      : `Срок – ${weekday(w.ends)} ${dateTime(w.report_due)} по Астане.`;
    st.clear();
  };
  wk.addEventListener('change', fill);

  const form = h('form', { class: 'ab-card', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(btn, async () => {
      st.clear();
      const w = parseNum(weight.value);
      const t = parseNum(waist.value);
      if (w === null) return st.bad('Укажи вес утром натощак.');
      if (Number.isNaN(w) || w < 40 || w > 250) return st.bad('Вес – число от 40 до 250, например 123,4.');
      if (Number.isNaN(t) || (t !== null && (t < 40 || t > 250))) return st.bad('Талия – число в сантиметрах, например 118.');
      const row: Record<string, unknown> = { week: Number(wk.value), weight: w, waist: t };
      fields.forEach((f) => (row[f.name] = f.value.trim() || null));
      try {
        await q(sb!.from('abay_reports').upsert(row, { onConflict: 'week' }).select());
        await loadAll();
        fill();
        st.ok('Отчёт сохранён. Папа его увидит.');
      } catch (err) {
        st.bad(errText(err));
      }
    });
  } },
    h('h2', { text: 'Недельный отчёт' }),
    h('label', { for: 'ab-r-week', text: 'Неделя' }), wk,
    due,
    h('div', { class: 'ab-grid2' },
      h('div', null, h('label', { for: 'ab-r-weight', text: 'Вес утром натощак, кг' }), weight),
      h('div', null, h('label', { for: 'ab-r-waist', text: 'Талия, см' }, h('span', { class: 'ab-opt', text: ' по желанию' })), waist)),
    REPORT_FIELDS.map((f, i) => [
      h('label', { for: `ab-r-${f.key}` }, f.label, f.hint ? h('span', { class: 'ab-opt', text: ` – ${f.hint}` }) : null),
      fields[i],
    ]),
    btn,
    st.el,
  );
  fill();
  return form;
}

// ---------------------------------------------------------------- «Питание»

function renderFood(): Node {
  const weekKey = `abay-shop-${mondayOf(todayISO())}`;
  const bought = load<Record<string, boolean>>(weekKey, {});
  // старые недели больше не нужны
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('abay-shop-') && k !== weekKey) localStorage.removeItem(k);
    }
  } catch { /* нет доступа к хранилищу */ }

  const items = food.shopping_weekly;
  const total = items.reduce((s, x) => s + x.qty * x.price_kzt, 0);
  const left = h('p', { class: 'ab-total' });
  const updateLeft = () => {
    const rest = items.reduce((s, x, i) => s + (bought[i] ? 0 : x.qty * x.price_kzt), 0);
    left.textContent = `Итого ${num(total)} ₸ · осталось купить на ${num(rest)} ₸`;
  };
  updateLeft();
  const cats = [...new Set(items.map((x) => x.category))];

  return h('div', { class: 'ab-stack' },
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Покупки на неделю' }),
      h('p', { class: 'ab-muted small', text: 'Цены Яндекс Лавки на 09.11.2026, могут меняться. Галочки хранятся только на этом телефоне и сбрасываются в понедельник.' }),
      left,
      cats.map((c) => h('div', { class: 'ab-taskgroup' },
        h('h3', { text: c }),
        h('ul', null, items.map((x, i) => x.category !== c ? null : (() => {
          const id = `ab-shop-${i}`;
          const box = h('input', { type: 'checkbox', id, checked: Boolean(bought[i]) });
          const li = h('li', { class: bought[i] ? 'done' : '' },
            h('label', { class: 'ab-check', for: id }, box,
              h('span', null, x.item, h('span', { class: 'ab-price', text: `${x.qty > 1 ? `${x.qty} × ` : ''}${num(x.price_kzt)} ₸` }))));
          box.addEventListener('change', () => {
            bought[i] = box.checked;
            li.classList.toggle('done', box.checked);
            save(weekKey, bought);
            updateLeft();
          });
          return li;
        })())),
      )),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Базовые продукты на месяц' }),
      h('ul', { class: 'ab-plain' }, food.shopping_monthly.map((x) => h('li', null, x.item, h('span', { class: 'ab-price', text: `${num(x.price_kzt)} ₸` })))),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Правила тарелки' }),
      h('ul', { class: 'ab-plain' }, food.rules.map((r) => h('li', { text: r }))),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Меню на неделю' }),
      h('div', { class: 'ab-menu' }, food.menu.map((d) => h('div', { class: 'ab-day' },
        h('h3', { text: d.day }),
        h('dl', null,
          h('dt', { text: 'Завтрак' }), h('dd', { text: d.breakfast }),
          h('dt', { text: 'Обед' }), h('dd', { text: d.lunch }),
          h('dt', { text: 'Перекус' }), h('dd', { text: d.snack }),
          h('dt', { text: 'Ужин' }), h('dd', { text: d.dinner }),
        )))),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'План готовки' }),
      h('ul', { class: 'ab-plain' }, food.cooking_plan.map((c) => h('li', null, h('b', { text: `${c.day}, около ${c.minutes} минут: ` }), c.what))),
      h('h3', { text: 'Распорядок недели' }),
      h('ul', { class: 'ab-plain' }, ROUTINE.map((r) => h('li', { text: r }))),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Рецепты' }),
      food.recipes.map((r) => h('details', { class: 'ab-recipe' },
        h('summary', { text: r.title }),
        h('p', null, h('b', { text: 'Продукты: ' }), r.ingredients),
        h('p', null, h('b', { text: 'Как готовить: ' }), r.steps),
      )),
    ),
  );
}

// ---------------------------------------------------------------- «Цели»

function fmtGoal(g: Goal, v: unknown = g.value): string {
  if (typeof v === 'number') return `${num(v)}${g.unit && g.unit !== 'время' ? ` ${g.unit}` : ''}`;
  return String(v ?? '–');
}

function renderGoals(): Node {
  return h('div', { class: 'ab-stack' },
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Цели' }),
      h('p', { class: 'ab-muted small', text: isFather()
        ? 'Любую цель можно поменять, указав причину. Абай увидит изменение и причину в истории. Цели без замка он может менять сам в указанных пределах.'
        : 'Цель без замка можно поменять самому – в допустимых пределах и с причиной. Цели с замком меняет папа.' }),
      h('ul', { class: 'ab-goals' }, S.goals.map((g) => goalRow(g))),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: 'История изменений' }),
      changesList(S.changes, isFather()),
    ),
  );
}

function goalRow(g: Goal): HTMLElement {
  const can = isFather() || g.editable_by_son;
  const range = g.options ? `варианты: ${g.options.join(', ')}` : g.min_value != null || g.max_value != null ? `от ${num(g.min_value)} до ${num(g.max_value)}` : '';
  const li = h('li', null,
    h('div', { class: 'ab-goal-head' },
      h('span', { class: 'ab-goal-title', text: g.title }),
      h('span', { class: 'ab-goal-value', text: fmtGoal(g) }),
    ),
    h('p', { class: 'ab-muted small' },
      g.editable_by_son ? range : h('span', null, h('span', { 'aria-hidden': 'true', text: '🔒 ' }), 'меняет папа')),
  );
  if (can) li.append(h('button', { type: 'button', class: 'ab-link', text: 'Изменить', onclick: () => li.replaceWith(goalEditor(g)) }));
  return li;
}

function goalEditor(g: Goal): HTMLElement {
  const p = `ab-g-${g.key}`;
  const son = !isFather();
  let input: HTMLInputElement | HTMLSelectElement;
  if (g.options) {
    input = h('select', { id: `${p}-v` }, g.options.map((o) => h('option', { value: String(o), text: String(o), selected: o === g.value })));
  } else if (typeof g.value === 'number') {
    input = h('input', { type: 'text', id: `${p}-v`, inputmode: 'decimal', value: num(g.value).replace(/\s/g, '') });
  } else {
    input = h('input', { type: 'text', id: `${p}-v`, value: String(g.value) });
  }
  const reason = h('textarea', { id: `${p}-r`, rows: 2, placeholder: 'Почему меняю' });
  const st = statusLine();
  const btn = h('button', { type: 'submit', class: 'ab-btn small', text: 'Поменять' });
  const hint = g.options ? '' : son && (g.min_value != null || g.max_value != null) ? ` (от ${num(g.min_value)} до ${num(g.max_value)})` : '';
  return h('li', null, h('form', { class: 'ab-inline', onsubmit: (e: Event) => {
    e.preventDefault();
    busy(btn, async () => {
      st.clear();
      let v: number | string = input.value;
      if (typeof g.value === 'number') {
        const n = parseNum(input.value);
        if (n === null || Number.isNaN(n)) return st.bad('Нужно число, например 7000 или 1,5.');
        if (son && g.min_value != null && n < g.min_value) return st.bad(`Не меньше ${num(g.min_value)}.`);
        if (son && g.max_value != null && n > g.max_value) return st.bad(`Не больше ${num(g.max_value)}.`);
        v = n;
      }
      if (reason.value.trim().length < 5) return st.bad('Напиши причину – хотя бы пару слов.');
      try {
        await q(sb!.rpc('abay_change_goal', { p_key: g.key, p_value: v, p_reason: reason.value.trim() }));
        await refresh();
      } catch (err) {
        st.bad(errText(err));
      }
    });
  } },
    h('p', { class: 'ab-goal-title', text: `${g.title}: сейчас ${fmtGoal(g)}` }),
    h('label', { for: `${p}-v`, text: `Новое значение${hint}` }), input,
    h('label', { for: `${p}-r`, text: 'Причина' }), reason,
    h('div', { class: 'ab-actions' }, btn, h('button', { type: 'button', class: 'ab-btn ghost small', text: 'Отмена', onclick: rerender })),
    st.el,
  ));
}

function changesList(list: GoalChange[], highlightNew: boolean): Node {
  if (!list.length) return h('p', { class: 'ab-muted', text: 'Изменений пока не было.' });
  const weekAgo = Date.now() - 7 * 86_400_000;
  return h('ul', { class: 'ab-changes' }, list.map((c) => {
    const g = goal(c.key);
    const fresh = highlightNew && Date.parse(c.changed_at) > weekAgo;
    return h('li', { class: fresh ? 'fresh' : '' },
      h('p', null,
        fresh ? h('span', { class: 'ab-badge now', text: 'новое' }) : null,
        h('b', { text: g?.title ?? c.key }), ': ',
        g ? fmtGoal(g, c.old_value) : String(c.old_value), ' → ', g ? fmtGoal(g, c.new_value) : String(c.new_value)),
      h('p', { text: `«${c.reason}»` }),
      h('p', { class: 'ab-muted small', text: `${nameOf(c.changed_by)}, ${dateTime(c.changed_at)}` }),
    );
  }));
}

// ---------------------------------------------------------------- «Прогресс»

/** Факт по весу: ежедневные отметки и отчёты (отчёт – на воскресенье недели); отметка за тот же день важнее. */
function weightFacts(): { day: string; v: number }[] {
  const facts = new Map<string, number>();
  for (const r of S.reports) {
    const wk = S.weeks.find((x) => x.n === r.week);
    // отчёт могут сдать раньше воскресенья: вес ставим на день сдачи, а не в будущее
    const sent = new Date(Date.parse(r.submitted_at) + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
    if (wk && r.weight != null && !facts.has(sent < wk.ends ? sent : wk.ends)) facts.set(sent < wk.ends ? sent : wk.ends, Number(r.weight));
  }
  for (const c of S.checkins) if (c.weight != null) facts.set(c.day, Number(c.weight));
  return [...facts].map(([day, v]) => ({ day, v })).sort((a, b) => a.day.localeCompare(b.day));
}

const stat = (value: string, label: string, tone = '') =>
  h('div', { class: `ab-stat ${tone}` }, h('span', { class: 'ab-stat-v', text: value }), h('span', { class: 'ab-stat-l', text: label }));

function renderProgress(): Node {
  const today = todayISO();
  const w = currentWeek();
  const days = Math.max(0, daysBetween(today, DEADLINE));
  const done = S.tasks.filter((t) => t.done).length;
  const due = S.weeks.filter((x) => Date.now() > Date.parse(x.report_due));
  const submitted = S.reports.length;
  const weekIns = w ? S.checkins.filter((c) => c.day >= w.starts && c.day <= w.ends) : [];
  const stepVals = weekIns.map((c) => c.steps).filter((s): s is number => s != null);
  const avgSteps = stepVals.length ? Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length) : null;
  const workouts = weekIns.filter((c) => c.habits?.workout).length;
  const foodOk = weekIns.filter((c) => c.habits?.food_ok).length;
  const daysInWeek = w ? Math.min(7, Math.max(0, daysBetween(w.starts, today) + 1)) : 0;

  const factPoints = weightFacts();
  const last = factPoints.at(-1);

  return h('div', { class: 'ab-stack' },
    h('div', { class: 'ab-card' },
      h('h2', { text: 'Вес: план и факт' }),
      last
        ? h('p', { class: 'ab-muted small', text: `Последний вес ${num(last.v, 1)} кг (${dm(last.day)}), по плану на этот день – ${num(planWeight(last.day), 1)} кг.` })
        : h('p', { class: 'ab-muted small', text: 'Факт появится после первой отметки веса.' }),
      weightChart({ start: START, end: DEADLINE, plan: planWeight, facts: factPoints, today }),
      h('details', { class: 'ab-recipe' },
        h('summary', { text: 'Таблица значений' }),
        factPoints.length
          ? h('table', { class: 'ab-table' },
              h('thead', null, h('tr', null, h('th', { text: 'Дата' }), h('th', { text: 'Факт, кг' }), h('th', { text: 'План, кг' }))),
              h('tbody', null, factPoints.map((p) => h('tr', null, h('td', { text: dm(p.day) }), h('td', { text: num(p.v, 1) }), h('td', { text: num(planWeight(p.day), 1) })))))
          : h('p', { class: 'ab-muted', text: 'Пока пусто.' }),
      ),
    ),
    h('div', { class: 'ab-card' },
      h('h2', { text: w ? `Неделя ${w.n} и весь план` : 'Весь план' }),
      h('div', { class: 'ab-stats' },
        stat(String(days), `${plural(days, 'день', 'дня', 'дней')} до 26.12`),
        stat(`${done} из ${S.tasks.length}`, 'задач выполнено'),
        stat(`${submitted} из ${S.weeks.length}`, due.length ? `отчётов сдано (срок прошёл у ${due.length})` : 'отчётов сдано'),
        stat(avgSteps != null ? num(avgSteps) : '–', `средние шаги за неделю (цель ${num(goal('steps')?.value ?? 8000)})`),
        stat(`${workouts} из ${num(goal('workouts')?.value ?? 3)}`, 'тренировок за неделю'),
        stat(`${foodOk} из ${daysInWeek}`, 'дней «еда по плану»'),
      ),
    ),
  );
}

// ---------------------------------------------------------------- «Сводка» (папа)

function renderSummary(): Node {
  const today = todayISO();
  const w = currentWeek();
  const son = S.profiles.find((p) => p.role === 'son');
  const goTo = (id: TabId, text: string) => h('button', { type: 'button', class: 'ab-link', text, onclick: () => openTab(id, true) });

  // ---- вес
  const facts = weightFacts();
  const last = facts.at(-1);
  const startW = goalNum('start_weight', 125);
  let weightCard: Node;
  if (!last) {
    weightCard = h('p', { class: 'ab-muted', text: 'Абай ещё ни разу не отметил вес.' });
  } else {
    const diff = last.v - planWeight(last.day);
    const lost = startW - last.v;
    const tone = diff > 0.3 ? 'bad' : 'ok';
    const vsPlan = Math.abs(diff) <= 0.3 ? 'по плану' : `${diff > 0 ? '+' : '−'}${num(Math.abs(diff), 1)} кг`;
    const stale = daysBetween(last.day, today);
    weightCard = h('div', { class: 'ab-stats' },
      stat(`${num(last.v, 1)} кг`, `последний вес, ${dm(last.day)}${stale >= 3 ? ` (${stale} ${plural(stale, 'день', 'дня', 'дней')} назад)` : ''}`, stale >= 3 ? 'warn' : ''),
      stat(vsPlan, `${Math.abs(diff) <= 0.3 ? '' : diff > 0 ? 'выше плана' : 'ниже плана'} на ${dm(last.day)}: план ${num(planWeight(last.day), 1)} кг`.trim(), tone),
      stat(`${lost >= 0 ? '−' : '+'}${num(Math.abs(lost), 1)} кг`, `от старта (${num(startW, 1)} кг)`),
      stat(`${num(planWeight(DEADLINE), 1)} кг`, 'цель к 26.12'),
    );
  }

  // ---- последние 7 дней
  const from = [addDays(today, -6), START].sort().at(-1)!;
  const dayList: string[] = [];
  for (let d = today; d >= from; d = addDays(d, -1)) dayList.push(d);
  const stepsGoal = goalNum('steps', 8000);
  const filled = dayList.filter((d) => S.checkins.some((c) => c.day === d)).length;
  const dayRows = dayList.map((d) => {
    const c = S.checkins.find((x) => x.day === d);
    const label = `${weekday(d)} ${dm(d)}`;
    if (!c) {
      return h('tr', { class: d === today ? '' : 'miss' },
        h('td', { text: label }),
        h('td', { colspan: 3, class: d === today ? 'ab-muted' : 'ab-bad', text: d === today ? 'ещё не заполнен' : 'не заполнен' }));
    }
    const nHab = HABITS.filter((hb) => c.habits?.[hb.key]).length;
    return h('tr', null,
      h('td', { text: label }),
      h('td', { text: c.weight != null ? num(Number(c.weight), 1) : '–' }),
      h('td', { class: c.steps != null && c.steps < stepsGoal ? 'ab-bad' : '', text: c.steps != null ? num(c.steps) : '–' }),
      h('td', { text: `${nHab} из ${HABITS.length}` }));
  });
  const notes = dayList.map((d) => S.checkins.find((c) => c.day === d)).filter((c): c is Checkin => !!c?.note?.trim());
  const daysCard = h('div', { class: 'ab-card' },
    h('h2', { text: 'Последние 7 дней' }),
    h('p', { class: filled < dayList.length - 1 ? 'ab-bad' : 'ab-muted small', text: `Заполнено дней: ${filled} из ${dayList.length}. Цель по шагам – ${num(stepsGoal)}.` }),
    h('table', { class: 'ab-table' },
      h('thead', null, h('tr', null, h('th', { text: 'День' }), h('th', { text: 'Вес' }), h('th', { text: 'Шаги' }), h('th', { text: 'Отметки' }))),
      h('tbody', null, dayRows)),
    h('h3', { class: 'ab-sub', text: 'Привычки за эти дни' }),
    h('ul', { class: 'ab-kv' }, HABITS.map((hb) => {
      const n = dayList.filter((d) => S.checkins.find((c) => c.day === d)?.habits?.[hb.key]).length;
      return h('li', null, h('span', { text: hb.short }), h('b', { class: n * 2 < dayList.length ? 'ab-bad' : '', text: `${n} из ${dayList.length}` }));
    })),
    notes.length ? [
      h('h3', { class: 'ab-sub', text: 'Заметки Абая' }),
      h('ul', { class: 'ab-plain' }, notes.map((c) => h('li', null, h('span', { class: 'ab-muted small', text: `${weekday(c.day)} ${dm(c.day)}: ` }), c.note!))),
    ] : null,
  );

  // ---- задачи
  const weekTasks = w ? S.tasks.filter((t) => t.week === w.n) : [];
  const open = weekTasks.filter((t) => !t.done);
  const tails = S.tasks.filter((t) => !t.done && w && t.week < w.n);
  const taskItem = (t: Task) => h('li', null, t.title, h('span', { class: 'ab-muted small', text: ` – ${CATEGORIES[t.category as keyof typeof CATEGORIES] ?? t.category}${w && t.week !== w.n ? `, неделя ${t.week}` : ''}` }));
  const tasksCard = h('div', { class: 'ab-card' },
    h('h2', { text: w ? `Задачи недели ${w.n}: ${weekTasks.length - open.length} из ${weekTasks.length}` : 'Задачи' }),
    open.length
      ? [h('p', { class: 'ab-muted small', text: 'Не сделано:' }), h('ul', { class: 'ab-plain' }, open.map(taskItem))]
      : h('p', { class: 'ab-ok', text: 'Все задачи недели выполнены.' }),
    tails.length ? [
      h('h3', { class: 'ab-sub ab-bad', text: `Хвосты прошлых недель: ${tails.length}` }),
      h('ul', { class: 'ab-plain' }, tails.map(taskItem)),
    ] : null,
    goTo('week', 'Все недели и правка задач'),
  );

  // ---- отчёты
  const started = S.weeks.filter((x) => x.starts <= today);
  const reportsCard = h('div', { class: 'ab-card' },
    h('h2', { text: `Отчёты: сдано ${S.reports.length} из ${S.weeks.length}` }),
    h('ul', { class: 'ab-kv' }, started.map((x) => {
      const st = weekStatus(x);
      const r = S.reports.find((y) => y.week === x.n);
      return h('li', null,
        h('span', null, `Неделя ${x.n}`, h('span', { class: 'ab-muted small', text: r ? ` · ${dateTime(r.submitted_at)}` : ` · срок ${dateTime(x.report_due)}` })),
        h('span', { class: `ab-badge ${st.tone}`, text: st.text }));
    })),
    goTo('week', 'Читать отчёты и комментировать'),
  );

  // ---- изменения целей Абаем за неделю
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = S.changes.filter((c) => c.changed_by === son?.user_id && Date.parse(c.changed_at) > weekAgo);
  const goalsCard = h('div', { class: 'ab-card' },
    h('h2', { text: 'Абай менял цели' }),
    recent.length ? changesList(recent, true) : h('p', { class: 'ab-muted', text: 'За последние 7 дней Абай цели не менял.' }),
    goTo('goals', 'Все цели и история'),
  );

  return h('div', { class: 'ab-stack' },
    h('div', { class: 'ab-card' },
      h('h2', { text: w ? `Неделя ${w.n} из ${S.weeks.length} · ${dm(w.starts)}–${dm(w.ends)}` : 'План' }),
      weightCard,
    ),
    daysCard,
    tasksCard,
    reportsCard,
    goalsCard,
  );
}

// ---------------------------------------------------------------- запуск

async function enter(s: Session | null) {
  session = s;
  if (!s) return loginView(linkError ?? undefined);
  clear(root, h('p', { class: 'ab-muted ab-loading', role: 'status', text: 'Загружаю план…' }));
  try {
    const me = await q<Profile | null>(sb!.from('abay_profiles').select('user_id, role, name').eq('user_id', s.user.id).maybeSingle());
    if (!me) return noAccessView();
    S.me = me;
    await loadAll();
    shell();
  } catch (e) {
    clear(root, h('div', { class: 'ab-card ab-login' },
      h('h1', { text: 'Не загрузилось' }),
      h('p', { text: errText(e) }),
      h('button', { class: 'ab-btn', text: 'Попробовать снова', onclick: () => enter(session) }),
    ));
  }
}

if (!sb) {
  clear(root, h('div', { class: 'ab-card ab-login' },
    h('h1', { text: 'План Абая' }),
    h('p', { text: 'Трекер ещё не подключён к базе: в сборке нет адреса Supabase.' }),
  ));
} else {
  // убираем #access_token из адреса после входа
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s?.user.id !== session?.user.id) setTimeout(() => enter(s), 0);
    if (event === 'SIGNED_OUT') { session = null; S.me = null; }
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  });
  sb.auth.getSession().then(({ data }) => {
    if (location.hash.includes('access_token') || location.hash.includes('error')) history.replaceState(null, '', location.pathname);
    if (!session || data.session?.user.id !== session.user.id) enter(data.session);
  });
}

// вернулись во вкладку через несколько минут – подтянуть свежие данные (папа мог что-то поменять)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  // формы «Сегодня» и «Отчёт» и открытые редакторы не трогаем: несохранённый ввод не должен пропасть
  const dirty = [...panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type=text], textarea')].some((el) => el.value.trim() !== '');
  const safe = activeTab !== 'today' && activeTab !== 'report' && !dirty;
  if (S.me && safe && hiddenAt && Date.now() - hiddenAt > 5 * 60_000) refresh().catch(() => {});
});

