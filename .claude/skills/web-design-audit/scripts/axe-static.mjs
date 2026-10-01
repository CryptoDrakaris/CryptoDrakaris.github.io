#!/usr/bin/env node
// Прогон правил axe-core по собранному HTML в jsdom.
// Закрывает то, что эвристика audit-static.mjs только угадывает: корректность ARIA,
// имя-роль-значение, ориентиры страницы, дубли id, связь подписи с полем, порядок заголовков.
//
// Чего здесь принципиально нет: контраст, размеры целей, переполнение, видимость фокуса.
// В jsdom нет движка раскладки, поэтому такие правила выключены – они остаются
// за scripts/browser-checks.js в настоящем браузере.
//
// Запуск: node .claude/skills/web-design-audit/scripts/axe-static.mjs <папка-сборки> [--json] [--limit 40]
// Зависимости: axe-core и jsdom в devDependencies проверяемого проекта.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const limit = Number(args[args.indexOf('--limit') + 1]) || 60;

if (!dir) {
  console.error('Укажи папку со собранным сайтом: node axe-static.mjs dist/');
  process.exit(1);
}

// Правила, которым нужна настоящая раскладка: в jsdom они дают шум или молчат.
const LAYOUT_RULES = [
  'color-contrast',
  'color-contrast-enhanced',
  'target-size',
  'scrollable-region-focusable',
  'meta-viewport',
  'meta-viewport-large',
];

async function loadDeps(root) {
  // пакеты берём из node_modules проверяемого проекта, а не из скила,
  // поэтому путь разрешаем require-ом от package.json проекта
  const resolve = createRequire(pathToFileURL(path.join(root, 'package.json')).href).resolve;
  const req = async (name) => import(pathToFileURL(resolve(name)).href);
  try {
    const [{ JSDOM }, axeMod] = await Promise.all([req('jsdom'), req('axe-core')]);
    return { JSDOM, axe: axeMod.default ?? axeMod };
  } catch (e) {
    console.error('Нужны axe-core и jsdom: npm install -D axe-core jsdom');
    console.error(String(e.message ?? e).slice(0, 200));
    process.exit(1);
  }
}

async function htmlFiles(root) {
  const out = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '_astro' || e.name === 'node_modules') continue;
        await walk(p);
      } else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  await walk(root);
  return out.sort();
}

const root = process.cwd();
const { JSDOM, axe } = await loadDeps(root);
const files = await htmlFiles(dir);
if (!files.length) {
  console.error(`В ${dir} нет .html – сначала собери проект`);
  process.exit(1);
}

// Одинаковые шаблоны дают одинаковые находки, поэтому страницы группируются по правилу.
const byRule = new Map();
let checked = 0;
let failed = 0;

for (const file of files.slice(0, limit)) {
  let dom;
  try {
    const html = await readFile(file, 'utf8');
    dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(axe.source);
    const res = await window.axe.run(window.document, {
      resultTypes: ['violations'],
      rules: Object.fromEntries(LAYOUT_RULES.map((id) => [id, { enabled: false }])),
    });
    checked++;
    for (const v of res.violations) {
      const rec = byRule.get(v.id) ?? { impact: v.impact, help: v.help, url: v.helpUrl, pages: [], nodes: [] };
      rec.pages.push(path.relative(dir, file).replace(/\\/g, '/'));
      for (const n of v.nodes.slice(0, 2)) {
        const sel = Array.isArray(n.target) ? n.target.join(' ') : String(n.target);
        if (!rec.nodes.some((x) => x.sel === sel)) rec.nodes.push({ sel, html: (n.html ?? '').slice(0, 160) });
      }
      byRule.set(v.id, rec);
    }
  } catch (e) {
    failed++;
    if (!asJson) console.warn(`  не разобрана ${path.relative(dir, file)}: ${String(e.message ?? e).slice(0, 90)}`);
  } finally {
    dom?.window?.close();
  }
}

const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const found = [...byRule.entries()]
  .map(([id, r]) => ({ id, ...r }))
  .sort((a, b) => (RANK[a.impact] ?? 9) - (RANK[b.impact] ?? 9) || b.pages.length - a.pages.length);

if (asJson) {
  console.log(JSON.stringify({ checked, failed, skippedRules: LAYOUT_RULES, findings: found }, null, 2));
} else {
  console.log(`axe-core: проверено страниц ${checked}${failed ? `, не разобрано ${failed}` : ''}, найдено правил с нарушениями: ${found.length}`);
  console.log(`выключены правила, которым нужна раскладка: ${LAYOUT_RULES.join(', ')}\n`);
  for (const f of found) {
    console.log(`[${(f.impact ?? '?').toUpperCase()}] ${f.id} – ${f.help}`);
    console.log(`   страниц: ${f.pages.length} (${f.pages.slice(0, 4).join(', ')}${f.pages.length > 4 ? ' …' : ''})`);
    for (const n of f.nodes.slice(0, 3)) console.log(`   ${n.sel}\n     ${n.html}`);
    console.log(`   ${f.url}\n`);
  }
  if (!found.length) console.log('Нарушений структурных правил нет.');
}
