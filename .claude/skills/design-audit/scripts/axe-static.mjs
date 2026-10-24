#!/usr/bin/env node
// Прогон правил axe-core по собранному HTML в jsdom.
// Закрывает то, что эвристика audit-static.mjs только угадывает: корректность ARIA,
// имя-роль-значение, ориентиры страницы, дубли id, связь подписи с полем, порядок заголовков.
//
// Чего здесь принципиально нет: контраст, размеры целей, переполнение, видимость фокуса.
// В jsdom нет движка раскладки, поэтому такие правила выключены – они остаются
// за scripts/browser-checks.js в настоящем браузере.
//
// Запуск: node <папка-скила>/scripts/axe-static.mjs <папка-сборки> [--json] [--limit 60]
// --limit N – сколько страниц проверить (по умолчанию 60, 0 – все); вывод говорит «N из M».
// Зависимости: axe-core и jsdom. Ищутся от папки сборки вверх, от текущей папки, от папки
// скила и в NODE_PATH – обычно это devDependencies проверяемого проекта.
// Код выхода: 0 – нарушений нет, 1 – есть нарушения, 2 – ошибка запуска.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const USAGE = 'Usage: node axe-static.mjs <build-dir> [--json] [--limit N]';
const fail = (msg) => {
  console.error(`Error: ${msg}\n${USAGE}`);
  process.exit(2);
};
const args = process.argv.slice(2);
let dir = null, asJson = false, limit = 60;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') asJson = true;
  else if (a === '--limit' || a.startsWith('--limit=')) {
    const v = a.includes('=') ? a.split('=')[1] : args[++i];
    if (!/^\d+$/.test(v ?? '')) fail('--limit needs a whole number (0 = all pages)');
    limit = +v;
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else if (dir) fail(`one build folder at a time (got ${dir} and ${a})`);
  else dir = a;
}
if (!dir) fail('no build folder given, e.g. node axe-static.mjs dist/');
if (!(await stat(dir).catch(() => null))?.isDirectory()) fail(`${dir} is not a folder`);

// Правила, которым нужна настоящая раскладка: в jsdom они дают шум или молчат.
// meta-viewport читает только атрибут и в jsdom работает, поэтому включён.
const LAYOUT_RULES = ['color-contrast', 'color-contrast-enhanced', 'target-size', 'scrollable-region-focusable'];

async function loadDeps() {
  // пакеты берём из проверяемого проекта, а не из скила: ищем от папки сборки вверх,
  // затем от текущей папки, от папки скила и в NODE_PATH
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bases = [path.resolve(dir), process.cwd(), here, ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean).map((p) => path.dirname(path.resolve(p)))];
  const req = async (name) => {
    for (const b of bases) {
      try {
        return await import(pathToFileURL(createRequire(path.join(b, 'noop.js')).resolve(name)).href);
      } catch {}
    }
    throw new Error(`${name} not found from ${bases.join(', ')}`);
  };
  try {
    const [{ JSDOM, VirtualConsole }, axeMod] = await Promise.all([req('jsdom'), req('axe-core')]);
    return { JSDOM, VirtualConsole, axe: axeMod.default ?? axeMod };
  } catch (e) {
    console.error('Нужны axe-core и jsdom: npm install -D axe-core jsdom (в проверяемом проекте) или NODE_PATH=<папка>/node_modules');
    console.error(String(e.message ?? e).slice(0, 300));
    process.exit(2);
  }
}

async function htmlFiles(root) {
  const out = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_astro') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.html?$/i.test(e.name)) out.push(p);
    }
  };
  await walk(root);
  return out.sort();
}

const { JSDOM, VirtualConsole, axe } = await loadDeps();
const files = await htmlFiles(dir);
if (!files.length) fail(`В ${dir} нет .html – сначала собери проект`);
const picked = limit ? files.slice(0, limit) : files;

// Одинаковые шаблоны дают одинаковые находки, поэтому страницы группируются по правилу.
const byRule = new Map();
// rules axe found nothing to check on (no images, no forms…): «не применимо», not «в порядке»
const applicable = new Set(), inapplicable = new Set();
let checked = 0;
let failed = 0;

for (const file of picked) {
  let dom;
  try {
    const html = await readFile(file, 'utf8');
    // jsdom сообщает «Not implemented» про canvas и навигацию – к доступности это не относится
    const virtualConsole = new VirtualConsole();
    dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole });
    const { window } = dom;
    window.eval(axe.source);
    const res = await window.axe.run(window.document, {
      resultTypes: ['violations'],
      rules: Object.fromEntries(LAYOUT_RULES.map((id) => [id, { enabled: false }])),
    });
    checked++;
    for (const r of res.inapplicable) inapplicable.add(r.id);
    for (const r of [...res.passes, ...res.violations, ...res.incomplete]) applicable.add(r.id);
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

const notApplicable = [...inapplicable].filter((id) => !applicable.has(id)).sort();
if (asJson) {
  console.log(JSON.stringify({ checked, total: files.length, failed, skippedRules: LAYOUT_RULES, notApplicable, findings: found }, null, 2));
} else {
  const scope = picked.length < files.length ? `${checked} из ${files.length} (--limit ${limit}; --limit 0 – все)` : `${checked} из ${files.length}`;
  console.log(`axe-core: проверено страниц ${scope}${failed ? `, не разобрано ${failed}` : ''}, найдено правил с нарушениями: ${found.length}`);
  console.log(`выключены правила, которым нужна раскладка: ${LAYOUT_RULES.join(', ')}\n`);
  for (const f of found) {
    console.log(`[${(f.impact ?? '?').toUpperCase()}] ${f.id} – ${f.help}`);
    console.log(`   страниц: ${f.pages.length} (${f.pages.slice(0, 4).join(', ')}${f.pages.length > 4 ? ' …' : ''})`);
    for (const n of f.nodes.slice(0, 3)) console.log(`   ${n.sel}\n     ${n.html}`);
    console.log(`   ${f.url}\n`);
  }
  if (!found.length) console.log('Нарушений структурных правил нет.');
  if (notApplicable.length) console.log(`\nне применимо (на проверенных страницах нечего проверять, это не «в порядке»): ${notApplicable.length} правил – ${notApplicable.join(', ')}`);
}
process.exit(found.length ? 1 : 0);
