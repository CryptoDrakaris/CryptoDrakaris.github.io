-- План Абая: напоминания в Telegram. Выполнить в SQL Editor после abay_schema.sql; можно запускать повторно.
--
-- Как устроено:
--   * pg_cron по расписанию вызывает abay_tg_remind(); время в cron – UTC, Астана = UTC+5;
--   * функция смотрит, есть ли вес за сегодня (по Астане), и только если нет – шлёт сообщение через pg_net;
--   * токен бота лежит в Supabase Vault (секрет abay_tg_token), id чатов – в abay_tg;
--   * всё это недоступно сайту: у anon и authenticated нет прав ни на таблицу, ни на функции.
--     Настраивает скрипт scripts/abay-tg.mjs с ключом service role из локального .env.
--
-- Расписание (Астана): 08:00 – «взвесься», 11:00 – повтор, если веса нет, 21:00 – папе, если веса так и нет.

-- Защита от запуска не в том проекте: здесь должна быть схема трекера.
do $$ begin
  if to_regclass('public.abay_checkins') is null or to_regprocedure('public.abay_today()') is null then
    raise exception 'Это не проект трекера: нет abay_checkins / abay_today(). Откройте проект gryklhbnhagffcnjrlik.';
  end if;
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists abay_tg (
  role text primary key check (role in ('father','son')),
  chat_id bigint not null
);
alter table abay_tg enable row level security;
revoke all on abay_tg from public, anon, authenticated;

-- Записать токен и чаты. Пустое значение не трогает уже сохранённое.
create or replace function abay_tg_setup(p_token text, p_son bigint, p_father bigint) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if p_token is not null and p_token <> '' then
    select id into sid from vault.secrets where name = 'abay_tg_token';
    if sid is null then perform vault.create_secret(p_token, 'abay_tg_token', 'бот напоминаний Абая');
    else perform vault.update_secret(sid, p_token); end if;
  end if;
  if p_son is not null then
    insert into abay_tg values ('son', p_son) on conflict (role) do update set chat_id = excluded.chat_id;
  end if;
  if p_father is not null then
    insert into abay_tg values ('father', p_father) on conflict (role) do update set chat_id = excluded.chat_id;
  end if;
end $$;

-- Отправить одно сообщение. Возвращает id запроса pg_net или null, если некому или нечем.
create or replace function abay_tg_send(p_role text, p_text text) returns bigint
language plpgsql security definer set search_path = public as $$
declare tok text; chat bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'abay_tg_token';
  select chat_id into chat from abay_tg where role = p_role;
  if tok is null or chat is null then return null; end if;
  return net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000  -- по умолчанию 5 с; соединение с Telegram иногда дольше
  );
end $$;

-- Напоминание по расписанию: kind = morning | late | father; test и test_father – проверка.
create or replace function abay_tg_remind(kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d date := abay_today();
  link constant text := 'https://cryptodrakaris.github.io/abay/';
begin
  if kind = 'test' then
    return abay_tg_send('son', 'Проверка: бот трекера «План Абая» работает. Утром он напомнит про вес.');
  elsif kind = 'test_father' then
    return abay_tg_send('father', 'Проверка: бот трекера «План Абая» работает. Если Абай не внесёт вес до 21:00, придёт сообщение.');
  end if;
  -- только в дни плана
  if not exists (select 1 from abay_weeks where d between starts and ends) then return null; end if;
  -- вес за сегодня уже внесён – молчим
  if exists (select 1 from abay_checkins where day = d and weight is not null) then return null; end if;
  if kind = 'morning' then
    return abay_tg_send('son', 'Доброе утро! Взвесься натощак и внеси вес в трекер: ' || link);
  elsif kind = 'late' then
    return abay_tg_send('son', 'Вес за сегодня ещё не внесён. Внеси сейчас: ' || link);
  elsif kind = 'father' then
    return abay_tg_send('father', 'Абай сегодня (' || to_char(d, 'DD.MM') || ') не внёс вес.');
  end if;
  raise exception 'неизвестный вид напоминания: %', kind;
end $$;

-- Ответ Telegram на отправку (для проверки после настройки).
create or replace function abay_tg_result(p_id bigint) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('status', status_code, 'ok', (content::jsonb ->> 'ok'), 'error', error_msg,
                            'description', (content::jsonb ->> 'description'))
  from net._http_response where id = p_id
$$;

revoke all on function abay_tg_setup(text, bigint, bigint) from public, anon, authenticated;
revoke all on function abay_tg_send(text, text) from public, anon, authenticated;
revoke all on function abay_tg_remind(text) from public, anon, authenticated;
revoke all on function abay_tg_result(bigint) from public, anon, authenticated;
grant execute on function abay_tg_setup(text, bigint, bigint) to service_role;
grant execute on function abay_tg_remind(text) to service_role;
grant execute on function abay_tg_result(bigint) to service_role;

-- Расписание. Повторный запуск обновляет задания с теми же именами.
select cron.schedule('abay-weight-morning', '0 3 * * *', $$select public.abay_tg_remind('morning')$$);
select cron.schedule('abay-weight-late',    '0 6 * * *', $$select public.abay_tg_remind('late')$$);
select cron.schedule('abay-weight-father',  '0 16 * * *', $$select public.abay_tg_remind('father')$$);

-- Чтобы API сразу увидел новые функции.
notify pgrst, 'reload schema';
