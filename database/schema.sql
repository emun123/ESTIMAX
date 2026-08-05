-- ══════════════════════════════════════════════════════════════
--  ESTIMAX — סכמת מסד נתונים (Supabase / PostgreSQL)
--  הרץ את הקובץ הזה ב-Supabase → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. פרופילי משתמשים (שמאים)
--    Supabase Auth מנהל את הסיסמאות בטבלה auth.users.
--    כאן שומרים רק מידע עסקי.
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default '',
  license_no   text,                       -- מספר רישיון שמאי
  phone        text,
  office_name  text,
  role         text not null default 'appraiser'
               check (role in ('appraiser','admin','viewer')),
  signature_url text,                      -- חתימה דיגיטלית סרוקה
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 2. תיקי שמאות
--    data = כל טופס האפליקציה כ-JSON (אותו מבנה של serializeDraft)
--    כך אין צורך לשנות סכמה בכל פעם שמוסיפים שדה לטופס.
-- ─────────────────────────────────────────────
create table if not exists public.cases (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,

  -- שדות מפתח שנשלפים החוצה כדי לאפשר חיפוש ומיון מהירים
  case_number  text,
  plate        text,                        -- מספר רישוי
  form_type    text,                        -- סוג חוות דעת
  client_name  text,
  insurer      text,                        -- חברת ביטוח
  status       text not null default 'draft'
               check (status in ('draft','in_progress','completed','sent','archived')),
  damage_total numeric(12,2),
  depreciation numeric(6,2),                -- ירידת ערך באחוזים

  data         jsonb not null default '{}'::jsonb,   -- הטופס המלא

  -- שדות סנכרון
  device_id    text,                        -- מאיזה מכשיר נשמר לאחרונה
  version      integer not null default 1,  -- עולה בכל שמירה (זיהוי התנגשויות)
  deleted_at   timestamptz,                 -- מחיקה רכה — כדי שהמחיקה תסונכרן

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists cases_owner_idx    on public.cases(owner_id);
create index if not exists cases_updated_idx  on public.cases(owner_id, updated_at desc);
create index if not exists cases_plate_idx    on public.cases(plate);
create index if not exists cases_status_idx   on public.cases(owner_id, status);

-- ─────────────────────────────────────────────
-- 3. תמונות נזק (הקובץ עצמו יושב ב-Supabase Storage)
-- ─────────────────────────────────────────────
create table if not exists public.case_images (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,               -- הנתיב בתוך הבאקט 'case-images'
  caption     text,
  sort_order  integer not null default 0,
  ai_analysis jsonb,                        -- תוצאת ניתוח Vision של "אנטולי"
  created_at  timestamptz not null default now()
);

create index if not exists case_images_case_idx on public.case_images(case_id, sort_order);

-- ─────────────────────────────────────────────
-- 4. דוחות מופקים (PDF)
-- ─────────────────────────────────────────────
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,               -- הנתיב בתוך הבאקט 'reports'
  report_type text,
  issued_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 5. עדכון אוטומטי של updated_at + version
-- ─────────────────────────────────────────────
create or replace function public.touch_row()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'cases' then
    new.version := coalesce(old.version, 0) + 1;
  end if;
  return new;
end $$;

drop trigger if exists cases_touch on public.cases;
create trigger cases_touch before update on public.cases
  for each row execute function public.touch_row();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_row();

-- ─────────────────────────────────────────────
-- 6. יצירת פרופיל אוטומטית בהרשמה
-- ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
--  7. אבטחה — Row Level Security
--     בלי זה כל משתמש יכול לקרוא את התיקים של כולם.
--     זה החלק הכי חשוב בקובץ.
-- ══════════════════════════════════════════════════════════════
alter table public.profiles    enable row level security;
alter table public.cases       enable row level security;
alter table public.case_images enable row level security;
alter table public.reports     enable row level security;

-- פרופילים: כל אחד רואה ומעדכן רק את שלו
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- תיקים: כל שמאי רואה רק את התיקים שלו
drop policy if exists cases_own on public.cases;
create policy cases_own on public.cases
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists case_images_own on public.case_images;
create policy case_images_own on public.case_images
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists reports_own on public.reports;
create policy reports_own on public.reports
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ─────────────────────────────────────────────
-- 8. באקטים לאחסון קבצים
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('case-images','case-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('reports','reports', false)
on conflict (id) do nothing;

-- כל משתמש ניגש רק לתיקייה שנקראת על שם ה-uid שלו: <uid>/<case_id>/<file>
drop policy if exists storage_own_files on storage.objects;
create policy storage_own_files on storage.objects
  for all
  using  (bucket_id in ('case-images','reports') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('case-images','reports') and (storage.foldername(name))[1] = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════
--  סיום. אחרי ההרצה: Authentication → Users → Add user
--  צור משתמש ראשון עם המייל שלך, וזהו — אפשר להתחבר מהאפליקציה.
-- ══════════════════════════════════════════════════════════════
