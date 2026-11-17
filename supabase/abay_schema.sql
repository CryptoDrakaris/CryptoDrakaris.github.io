-- План Абая: схема Supabase (Postgres). Выполнить в SQL Editor проекта Supabase.
-- Все таблицы с префиксом abay_, RLS включён везде. Роли: father (видит всё, правит всё), son (заполняет).
-- Скрипт можно запускать повторно: таблицы создаются if not exists, политики пересоздаются.
--
-- Правила доступа:
--   * читать могут только участники плана (строка в abay_profiles);
--   * цели меняются только через abay_change_goal (у всех ролей), каждое изменение пишется в журнал;
--   * сын отмечает, добавляет, правит и удаляет задачи только через функции; чужие и locked-задачи
--     он не правит и не удаляет;
--   * время сдачи отчёта и авторов записей ставит база, а не клиент;
--   * удалять отметки и отчёты может только отец.

-- ---------------------------------------------------------------- таблицы

create table if not exists abay_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('father','son')),
  name text not null
);

create or replace function abay_role() returns text
language sql stable security definer set search_path = public as $$
  select role from abay_profiles where user_id = auth.uid()
$$;

-- Сегодняшняя дата по Астане (UTC+5, без перехода на летнее время).
create or replace function abay_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'utc' + interval '5 hours')::date
$$;

create table if not exists abay_goals (
  key text primary key,
  title text not null,
  value jsonb not null check (jsonb_typeof(value) in ('number','string')),
  unit text,
  editable_by_son boolean not null default false,
  min_value numeric,
  max_value numeric,
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (min_value is null or max_value is null or min_value <= max_value)
);

create table if not exists abay_goal_changes (
  id bigserial primary key,
  key text not null references abay_goals(key),
  old_value jsonb,
  new_value jsonb not null,
  reason text not null check (length(trim(reason)) >= 5),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create table if not exists abay_weeks (
  n int primary key,
  starts date not null,
  ends date not null,
  report_due timestamptz not null,
  check (starts <= ends)
);

create table if not exists abay_tasks (
  id text primary key,
  week int not null references abay_weeks(n),
  category text not null
    check (category in ('army','work','move','cat','home','food','health')),
  title text not null check (length(trim(title)) between 3 and 300),
  locked boolean not null default false,   -- задачу нельзя удалить или переписать сыну
  sort int not null default 0,
  done boolean not null default false,
  done_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references auth.users(id), -- null у задач из плана, uid у своих задач
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists abay_checkins (
  day date primary key,
  weight numeric(5,1) check (weight is null or weight between 40 and 250),
  steps int check (steps is null or steps between 0 and 100000),
  habits jsonb not null default '{}'::jsonb check (jsonb_typeof(habits) = 'object'),
  note text check (note is null or length(note) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
-- Когда отметку внесли впервые: папа видит дни, заполненные задним числом.
-- Для уже существующих строк берём время последней правки (точнее данных нет).
alter table abay_checkins add column if not exists created_at timestamptz;
update abay_checkins set created_at = updated_at where created_at is null;
alter table abay_checkins alter column created_at set default now();
alter table abay_checkins alter column created_at set not null;

create table if not exists abay_reports (
  week int primary key references abay_weeks(n),
  weight numeric(5,1) check (weight is null or weight between 40 and 250),
  waist numeric(5,1) check (waist is null or waist between 40 and 250),
  army text, work text, move text, cat text, home text, food text, sport text,
  misses text, help text,
  submitted_at timestamptz not null default now(),  -- первая сдача; ставит триггер
  submitted_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists abay_comments (
  id bigserial primary key,
  week int references abay_weeks(n),
  text text not null check (length(trim(text)) between 1 and 4000),
  author uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- триггеры: время и авторы ставит база

create or replace function abay_tg_stamp_checkin() returns trigger
language plpgsql set search_path = public as $$
begin
  -- участники не пишут будущие дни и дни до начала плана (service role – без ограничений)
  if auth.uid() is not null then
    if new.day > abay_today() then raise exception 'нельзя отмечать день, который ещё не наступил'; end if;
    if new.day < (select min(starts) from abay_weeks) then raise exception 'этот день раньше начала плана'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists abay_stamp_checkin on abay_checkins;
create trigger abay_stamp_checkin before insert or update on abay_checkins
  for each row execute function abay_tg_stamp_checkin();

-- Отчёт: время первой сдачи нельзя подделать или сдвинуть повторным сохранением.
create or replace function abay_tg_stamp_report() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_at := now();
    new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  else
    new.week := old.week;
    new.submitted_at := old.submitted_at;
    new.submitted_by := old.submitted_by;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists abay_stamp_report on abay_reports;
create trigger abay_stamp_report before insert or update on abay_reports
  for each row execute function abay_tg_stamp_report();

create or replace function abay_tg_stamp_task() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists abay_stamp_task on abay_tasks;
create trigger abay_stamp_task before insert or update on abay_tasks
  for each row execute function abay_tg_stamp_task();

create or replace function abay_tg_stamp_comment() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author := coalesce(auth.uid(), new.author);
    new.created_at := now();
  else
    new.author := old.author;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists abay_stamp_comment on abay_comments;
create trigger abay_stamp_comment before insert or update on abay_comments
  for each row execute function abay_tg_stamp_comment();

-- ---------------------------------------------------------------- RLS

alter table abay_profiles     enable row level security;
alter table abay_goals        enable row level security;
alter table abay_goal_changes enable row level security;
alter table abay_weeks        enable row level security;
alter table abay_tasks        enable row level security;
alter table abay_checkins     enable row level security;
alter table abay_reports      enable row level security;
alter table abay_comments     enable row level security;

-- Незалогиненным (anon) таблицы недоступны вовсе, даже до проверки RLS.
revoke all on abay_profiles, abay_goals, abay_goal_changes, abay_weeks, abay_tasks,
              abay_checkins, abay_reports, abay_comments from anon;
revoke all on sequence abay_goal_changes_id_seq, abay_comments_id_seq from anon;

-- Удаляем политики прежней версии и текущей (для повторного запуска).
drop policy if exists abay_read_profiles  on abay_profiles;
drop policy if exists abay_read_goals     on abay_goals;
drop policy if exists abay_read_changes   on abay_goal_changes;
drop policy if exists abay_read_weeks     on abay_weeks;
drop policy if exists abay_read_tasks     on abay_tasks;
drop policy if exists abay_read_checkins  on abay_checkins;
drop policy if exists abay_read_reports   on abay_reports;
drop policy if exists abay_read_comments  on abay_comments;
drop policy if exists abay_father_goals   on abay_goals;
drop policy if exists abay_father_weeks   on abay_weeks;
drop policy if exists abay_father_tasks   on abay_tasks;
drop policy if exists abay_father_comments on abay_comments;
drop policy if exists abay_write_checkins on abay_checkins;
drop policy if exists abay_write_reports  on abay_reports;
drop policy if exists abay_ins_checkins   on abay_checkins;
drop policy if exists abay_upd_checkins   on abay_checkins;
drop policy if exists abay_del_checkins   on abay_checkins;
drop policy if exists abay_ins_reports    on abay_reports;
drop policy if exists abay_upd_reports    on abay_reports;
drop policy if exists abay_del_reports    on abay_reports;
drop policy if exists abay_ins_comments   on abay_comments;
drop policy if exists abay_upd_comments   on abay_comments;
drop policy if exists abay_del_comments   on abay_comments;

-- Чтение: только участники плана (father, son).
create policy abay_read_profiles on abay_profiles for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_goals    on abay_goals    for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_changes  on abay_goal_changes for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_weeks    on abay_weeks    for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_tasks    on abay_tasks    for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_checkins on abay_checkins for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_reports  on abay_reports  for select to authenticated using ((select abay_role()) is not null);
create policy abay_read_comments on abay_comments for select to authenticated using ((select abay_role()) is not null);

-- Отец правит недели и задачи напрямую. Цели – только через abay_change_goal, чтобы любое
-- изменение попадало в журнал (прямой записи в abay_goals нет ни у кого, кроме service role).
create policy abay_father_weeks on abay_weeks for all to authenticated
  using ((select abay_role()) = 'father') with check ((select abay_role()) = 'father');
create policy abay_father_tasks on abay_tasks for all to authenticated
  using ((select abay_role()) = 'father') with check ((select abay_role()) = 'father');

-- Комментарии пишет отец; автор – всегда тот, кто вошёл (ставит триггер).
create policy abay_ins_comments on abay_comments for insert to authenticated
  with check ((select abay_role()) = 'father');
create policy abay_upd_comments on abay_comments for update to authenticated
  using ((select abay_role()) = 'father' and author = (select auth.uid()))
  with check ((select abay_role()) = 'father');
create policy abay_del_comments on abay_comments for delete to authenticated
  using ((select abay_role()) = 'father' and author = (select auth.uid()));

-- Ежедневные отметки и недельные отчёты: создают и правят оба, удаляет только отец.
create policy abay_ins_checkins on abay_checkins for insert to authenticated
  with check ((select abay_role()) in ('father','son'));
create policy abay_upd_checkins on abay_checkins for update to authenticated
  using ((select abay_role()) in ('father','son')) with check ((select abay_role()) in ('father','son'));
create policy abay_del_checkins on abay_checkins for delete to authenticated
  using ((select abay_role()) = 'father');

-- Отчёт можно сдать только за неделю, которая уже началась.
create policy abay_ins_reports on abay_reports for insert to authenticated
  with check ((select abay_role()) in ('father','son')
    and exists (select 1 from abay_weeks w where w.n = week and w.starts <= abay_today()));
create policy abay_upd_reports on abay_reports for update to authenticated
  using ((select abay_role()) in ('father','son')) with check ((select abay_role()) in ('father','son'));
create policy abay_del_reports on abay_reports for delete to authenticated
  using ((select abay_role()) = 'father');

-- ---------------------------------------------------------------- функции

-- Изменение цели. Для всех ролей: тип значения совпадает с текущим, причина не короче 5 знаков,
-- запись в журнал. Для сына дополнительно: цель не заблокирована, значение в списке или в диапазоне.
create or replace function abay_change_goal(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g abay_goals;
  r text := abay_role();
  v numeric;
begin
  if r is null then raise exception 'нет доступа'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'укажи причину изменения (не короче 5 знаков)';
  end if;
  if p_value is null or jsonb_typeof(p_value) not in ('number','string') then
    raise exception 'пустое или недопустимое значение';
  end if;

  select * into g from abay_goals where key = p_key for update;
  if not found then raise exception 'цель «%» не найдена', p_key; end if;

  -- Тип не меняется: строка «3000» вместо числа 3000 не обойдёт проверку диапазона.
  if jsonb_typeof(p_value) <> jsonb_typeof(g.value) then
    raise exception 'значение должно быть %',
      case jsonb_typeof(g.value) when 'number' then 'числом' else 'строкой' end;
  end if;
  if p_value = g.value then raise exception 'значение не изменилось'; end if;

  if r = 'son' then
    if not g.editable_by_son then raise exception 'эту цель меняет только папа'; end if;
    if g.options is not null and not (g.options @> jsonb_build_array(p_value)) then
      raise exception 'выбери значение из списка';
    end if;
    if jsonb_typeof(p_value) = 'number' then
      v := (p_value #>> '{}')::numeric;
      -- Нижняя и верхняя граница проверяются отдельно: если задана только одна, она всё равно работает.
      if g.min_value is not null and v < g.min_value then
        raise exception 'не меньше % %', g.min_value, coalesce(g.unit, '');
      end if;
      if g.max_value is not null and v > g.max_value then
        raise exception 'не больше % %', g.max_value, coalesce(g.unit, '');
      end if;
    end if;
  end if;

  insert into abay_goal_changes(key, old_value, new_value, reason, changed_by)
    values (p_key, g.value, p_value, trim(p_reason), auth.uid());
  update abay_goals set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
end $$;

-- Отметить задачу выполненной или снять отметку. Могут оба, для любой задачи.
create or replace function abay_set_task(p_id text, p_done boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if abay_role() is null then raise exception 'нет доступа'; end if;
  if p_done is null then raise exception 'не указано, выполнена ли задача'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'заметка длиннее 1000 знаков'; end if;
  update abay_tasks
     set done = p_done,
         done_at = case when p_done then coalesce(done_at, now()) else null end,
         note = coalesce(nullif(trim(p_note), ''), note)
   where id = p_id;
  if not found then raise exception 'задача не найдена'; end if;
end $$;

-- Проверка недели и категории с понятными сообщениями (общая для add и edit).
create or replace function abay_check_task_input(p_week int, p_category text, p_title text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from abay_weeks where n = p_week) then
    raise exception 'недели % в плане нет', p_week;
  end if;
  if p_category is null or p_category not in ('army','work','move','cat','home','food','health') then
    raise exception 'неизвестная категория';
  end if;
  if p_title is null or length(trim(p_title)) < 3 then raise exception 'опиши задачу (не короче 3 знаков)'; end if;
  if length(trim(p_title)) > 300 then raise exception 'задача длиннее 300 знаков'; end if;
end $$;

-- Своя задача: добавляет любой участник; не locked, автор запоминается.
create or replace function abay_add_task(p_week int, p_category text, p_title text)
returns text language plpgsql security definer set search_path = public as $$
declare new_id text := 'own-' || p_week || '-' || replace(gen_random_uuid()::text, '-', '');
begin
  if abay_role() is null then raise exception 'нет доступа'; end if;
  perform abay_check_task_input(p_week, p_category, p_title);
  insert into abay_tasks(id, week, category, title, locked, sort, created_by)
    values (new_id, p_week, p_category, trim(p_title), false, 100, auth.uid());
  return new_id;
end $$;

-- Исправить свою задачу. Сын правит только задачи, которые сам добавил; отец – любые.
create or replace function abay_edit_task(p_id text, p_week int, p_category text, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare t abay_tasks; r text := abay_role();
begin
  if r is null then raise exception 'нет доступа'; end if;
  select * into t from abay_tasks where id = p_id for update;
  if not found then raise exception 'задача не найдена'; end if;
  if r = 'son' and (t.locked or t.created_by is distinct from auth.uid()) then
    raise exception 'эту задачу меняет только папа';
  end if;
  perform abay_check_task_input(p_week, p_category, p_title);
  update abay_tasks set week = p_week, category = p_category, title = trim(p_title) where id = p_id;
end $$;

-- Удалить свою задачу. Сын удаляет только задачи, которые сам добавил; отец – любые.
create or replace function abay_delete_task(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare t abay_tasks; r text := abay_role();
begin
  if r is null then raise exception 'нет доступа'; end if;
  select * into t from abay_tasks where id = p_id for update;
  if not found then raise exception 'задача не найдена'; end if;
  if r = 'son' and (t.locked or t.created_by is distinct from auth.uid()) then
    raise exception 'эту задачу удаляет только папа';
  end if;
  delete from abay_tasks where id = p_id;
end $$;

-- ---------------------------------------------------------------- права на функции

-- В Supabase функции по умолчанию доступны и anon: закрываем явно.
revoke all on function abay_role() from public, anon;
revoke all on function abay_today() from public, anon;
revoke all on function abay_change_goal(text, jsonb, text) from public, anon;
revoke all on function abay_set_task(text, boolean, text) from public, anon;
revoke all on function abay_check_task_input(int, text, text) from public, anon, authenticated;
revoke all on function abay_add_task(int, text, text) from public, anon;
revoke all on function abay_edit_task(text, int, text, text) from public, anon;
revoke all on function abay_delete_task(text) from public, anon;
revoke all on function abay_tg_stamp_checkin() from public, anon, authenticated;
revoke all on function abay_tg_stamp_report() from public, anon, authenticated;
revoke all on function abay_tg_stamp_task() from public, anon, authenticated;
revoke all on function abay_tg_stamp_comment() from public, anon, authenticated;

grant execute on function abay_role() to authenticated;
grant execute on function abay_today() to authenticated;
grant execute on function abay_change_goal(text, jsonb, text) to authenticated;
grant execute on function abay_set_task(text, boolean, text) to authenticated;
grant execute on function abay_add_task(int, text, text) to authenticated;
grant execute on function abay_edit_task(text, int, text, text) to authenticated;
grant execute on function abay_delete_task(text) to authenticated;

-- ---------------------------------------------------------------- назначение ролей (после первого входа)
-- Выполнить вручную, подставив почты:
--
-- insert into abay_profiles(user_id, role, name)
-- select id, 'father', 'Папа' from auth.users where email = 'ПОЧТА_ОТЦА'
-- union all
-- select id, 'son', 'Абай' from auth.users where email = 'ПОЧТА_АБАЯ'
-- on conflict (user_id) do update set role = excluded.role, name = excluded.name;
