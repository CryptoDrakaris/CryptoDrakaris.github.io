#!/usr/bin/env node
// План Абая: однократная загрузка начальных данных в Supabase (цели, недели, задачи).
//
//   node scripts/abay-seed.mjs <путь к seed_plan.json> [--update]
//
// Ключи – из окружения или локального .env (в git не попадает):
//   ABAY_SUPABASE_URL=https://xxxx.supabase.co
//   ABAY_SERVICE_ROLE_KEY=sb_secret_…   (или старый service_role JWT)
// Ключ service role обходит RLS, поэтому живёт только на этом компьютере.
//
// Повторный запуск ничего не дублирует и не затирает сделанное в трекере:
//   * недели обновляются (даты и срок отчёта);
//   * новые цели и задачи добавляются, существующие не трогаются – значения целей,
//     отметки «выполнено» и правки папы сохраняются;
//   * с --update у существующих задач обновляются текст, раздел, неделя, замок и порядок,
//     у целей – название, единица, границы и список вариантов (но не значение).
// seed_plan.json содержит личные сведения и лежит вне репозитория (см. .gitignore).

import { readFileSync } from 'node:fs';

try { process.loadEnvFile(); } catch { /* .env нет – берём из окружения */ }

const [file, ...flags] = process.argv.slice(2);
const update = flags.includes('--update');
const url = process.env.ABAY_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.ABAY_SERVICE_ROLE_KEY;
if (!file || !url || !key) {
  console.error('Нужно: node scripts/abay-seed.mjs <seed_plan.json> [--update]\nи переменные ABAY_SUPABASE_URL, ABAY_SERVICE_ROLE_KEY (в окружении или .env).');
  process.exit(1);
}
if (key.startsWith('sb_publishable_') || /"role":"anon"/.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString())) {
  console.error('Это публичный ключ. Нужен ключ service role (Project Settings → API Keys → secret).');
  process.exit(1);
}

const plan = JSON.parse(readFileSync(file, 'utf8'));
const CATS = ['army', 'work', 'move', 'cat', 'home', 'food', 'health'];

// Проверка файла до записи в базу
const problems = [];
for (const g of plan.goals ?? []) {
  if (!g.key || !g.title || g.value === undefined) problems.push(`цель без key/title/value: ${JSON.stringify(g)}`);
  if (g.min !== undefined && g.max !== undefined && g.min > g.max) problems.push(`цель ${g.key}: min > max`);
}
const ids = new Set();
for (const w of plan.weeks ?? []) {
  for (const t of w.tasks ?? []) {
    if (ids.has(t.id)) problems.push(`повтор id задачи ${t.id}`);
    ids.add(t.id);
    if (!CATS.includes(t.category)) problems.push(`задача ${t.id}: неизвестная категория ${t.category}`);
    if (t.id.startsWith('own-')) problems.push(`задача ${t.id}: префикс own- занят под задачи из трекера`);
  }
}
if (problems.length) {
  console.error('В файле ошибки, в базу ничего не записано:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const headers = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // старый формат ключа

async function upsert(table, conflict, rows, mode) {
  if (!rows.length) return;
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { ...headers, Prefer: `resolution=${mode}-duplicates,return=minimal` },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  console.log(`${table}: ${rows.length} строк (${mode === 'merge' ? 'добавлено или обновлено' : 'новые добавлены, существующие не тронуты'})`);
}

async function patch(table, filter, body) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${table} ${filter}: ${res.status} ${await res.text()}`);
}

const goals = plan.goals.map((g) => ({
  key: g.key,
  title: g.title,
  value: g.value,
  unit: g.unit ?? null,
  editable_by_son: Boolean(g.editable_by_son),
  min_value: g.min ?? null,
  max_value: g.max ?? null,
  options: g.options ?? null,
}));
const weeks = plan.weeks.map((w) => ({ n: w.n, starts: w.starts, ends: w.ends, report_due: w.report_due }));
const tasks = plan.weeks.flatMap((w) => w.tasks.map((t, i) => ({
  id: t.id, week: w.n, category: t.category, title: t.title, locked: Boolean(t.locked), sort: i,
})));

try {
  await upsert('abay_weeks', 'n', weeks, 'merge');
  await upsert('abay_goals', 'key', goals, 'ignore');
  await upsert('abay_tasks', 'id', tasks, 'ignore');
  if (update) {
    for (const g of goals) {
      const { key: k, value, ...meta } = g;
      await patch('abay_goals', `key=eq.${encodeURIComponent(k)}`, meta);
    }
    for (const t of tasks) {
      const { id, ...rest } = t;
      await patch('abay_tasks', `id=eq.${encodeURIComponent(id)}`, rest);
    }
    console.log(`--update: обновлены описания ${goals.length} целей и ${tasks.length} задач (значения целей и отметки не тронуты)`);
  }
  console.log('Готово.');
} catch (e) {
  console.error('Ошибка:', e.message);
  process.exit(1);
}
