#!/usr/bin/env node
// План Абая: настройка бота напоминаний в Telegram (см. supabase/abay_telegram.sql).
//
//   node scripts/abay-tg.mjs chats                          – кто написал боту (нажал «Start»): id чатов
//   node scripts/abay-tg.mjs setup --son <id> [--father <id>] – сохранить токен и чаты в Supabase
//   node scripts/abay-tg.mjs test [son|father]              – пробное сообщение через базу
//
// Из .env (в git не попадает): ABAY_TG_BOT_TOKEN, ABAY_SUPABASE_URL, ABAY_SERVICE_ROLE_KEY.
// Токен бота нигде не печатается. В базе он хранится в Supabase Vault.

try { process.loadEnvFile(); } catch { /* .env нет – берём из окружения */ }

const [cmd, ...args] = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const token = process.env.ABAY_TG_BOT_TOKEN?.trim();
const url = process.env.ABAY_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.ABAY_SERVICE_ROLE_KEY;

function die(msg) { console.error(msg); process.exit(1); }
const hide = (s) => (token ? String(s).replaceAll(token, '<токен>') : String(s));

async function tg(method) {
  if (!token) die('Нет ABAY_TG_BOT_TOKEN в .env.');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  const j = await r.json().catch(() => ({}));
  if (!j.ok) die(`Telegram ${method}: ${hide(j.description ?? r.status)}`);
  return j.result;
}

async function rpc(fn, body) {
  if (!url || !key) die('Нужны ABAY_SUPABASE_URL и ABAY_SERVICE_ROLE_KEY в .env.');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) die(`Supabase ${fn}: ${hide(text)}`);
  return text ? JSON.parse(text) : null;
}

if (cmd === 'chats') {
  const me = await tg('getMe');
  console.log(`Бот: @${me.username}`);
  const ups = await tg('getUpdates');
  const chats = new Map();
  for (const u of ups) {
    const m = u.message ?? u.edited_message;
    if (m?.chat?.type === 'private') chats.set(m.chat.id, m.chat);
  }
  if (!chats.size) console.log('Пока никто не написал боту. Пусть Абай (и папа) откроют бота и нажмут «Start».');
  for (const c of chats.values()) console.log(`${c.id}\t${[c.first_name, c.last_name].filter(Boolean).join(' ')}${c.username ? ' @' + c.username : ''}`);
} else if (cmd === 'setup') {
  const son = opt('--son'), father = opt('--father');
  if (!token) die('Нет ABAY_TG_BOT_TOKEN в .env.');
  if (!son && !father) die('Укажи --son <id> и/или --father <id> (id – из команды chats).');
  for (const v of [son, father]) if (v && !/^-?\d+$/.test(v)) die(`id чата – число, получено: ${v}`);
  await tg('getMe'); // токен рабочий
  await rpc('abay_tg_setup', { p_token: token, p_son: son ? Number(son) : null, p_father: father ? Number(father) : null });
  console.log('Сохранено: токен в Vault, чаты' + (son ? ' сына' : '') + (father ? ' папы' : '') + '.');
} else if (cmd === 'test') {
  const who = args[0] ?? 'son';
  if (who !== 'son' && who !== 'father') die('test son | test father');
  const reqId = await rpc('abay_tg_remind', { kind: who === 'son' ? 'test' : 'test_father' });
  if (reqId == null) die('Не отправлено: в базе нет токена или чата. Сначала setup.');
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await rpc('abay_tg_result', { p_id: reqId });
    if (res) {
      console.log(res.ok === 'true' ? 'Доставлено.' : `Не доставлено: ${hide(res.description ?? res.error ?? res.status)}`);
      process.exit(res.ok === 'true' ? 0 : 1);
    }
  }
  die('Ответа от Telegram пока нет (pg_net не успел). Проверь телефон или повтори.');
} else {
  die('Команды: chats | setup --son <id> [--father <id>] | test [son|father]');
}
