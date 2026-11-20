-- Say Again: hedef PostgreSQL semasi (taslak).
-- Henuz API'ye bagli degil. Asama 2'de secilen veritabani paketiyle goc dosyalarina donusturulur.
-- Senaryolar veritabaninda degil, content/scenarios.json icinde durur; scenario_id o dosyadaki id'dir.

create extension if not exists "pgcrypto";

-- Cihaz kimligi ile anonim kullanici. Hesap ve giris magaza surumunden once eklenir.
create table users (
  id            uuid primary key default gen_random_uuid(),
  device_id     text not null unique,
  level         text check (level in ('A2', 'B1', 'B2', 'C1')),
  pack          text not null default 'professional' check (pack in ('professional', 'seller')),
  difficulty    text not null default 'easy' check (difficulty in ('easy', 'hard')),
  -- Ogrenilen dil (ISO 639-1). MVP yalnizca 'en'; senaryolarin targetLanguage alaniyla eslesir.
  target_language text not null default 'en' check (target_language ~ '^[a-z]{2}$'),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Bir prova. Durumlar: in_progress -> awaiting_resay -> completed.
create table lessons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  scenario_id   text not null,
  difficulty    text not null check (difficulty in ('easy', 'hard')),
  state         text not null default 'in_progress'
                check (state in ('in_progress', 'awaiting_resay', 'completed', 'abandoned')),
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  -- Kalite testi 10: ders basina maliyet olcumu.
  stt_seconds   integer not null default 0,
  tts_chars     integer not null default 0,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0
);
create index lessons_user_started_idx on lessons (user_id, started_at desc);

-- Koc ve kullanici satirlari. Ses saklanmaz; yalnizca metin.
create table turns (
  id            uuid primary key default gen_random_uuid(),
  lesson_id     uuid not null references lessons (id) on delete cascade,
  position      integer not null,
  speaker       text not null check (speaker in ('coach', 'learner')),
  text          text not null,
  latency_ms    integer,
  created_at    timestamptz not null default now(),
  unique (lesson_id, position)
);

-- Ders basina tek duzeltme.
create table corrections (
  id              uuid primary key default gen_random_uuid(),
  lesson_id       uuid not null unique references lessons (id) on delete cascade,
  kind            text not null check (kind in ('correction', 'polish')),
  original        text not null,
  improved        text not null,
  explanation_tr  text not null,
  category        text not null,
  resay_text      text,
  reported_wrong  boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Dersten cikan kisisel ifade (Defter).
create table phrases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  correction_id  uuid not null references corrections (id) on delete cascade,
  scenario_id    text not null,
  text           text not null,
  created_at     timestamptz not null default now()
);
create index phrases_user_idx on phrases (user_id, created_at desc);

-- Tekrar (1, 3, 7 gun) ve transfer (3 gun) kuyrugu.
create table review_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  phrase_id   uuid not null references phrases (id) on delete cascade,
  kind        text not null check (kind in ('review', 'transfer')),
  due_at      timestamptz not null,
  done_at     timestamptz,
  outcome     text check (outcome in ('unaided', 'hinted', 'failed')),
  created_at  timestamptz not null default now()
);
create index review_items_due_idx on review_items (user_id, due_at) where done_at is null;

-- Aylik ders sayaci (kota). month: ayin ilk gunu.
create table usage_months (
  user_id            uuid not null references users (id) on delete cascade,
  month              date not null,
  lessons_completed  integer not null default 0,
  primary key (user_id, month)
);

-- Magaza aboneligi durumu (Asama 5).
create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users (id) on delete cascade,
  store               text not null check (store in ('app_store', 'play_store')),
  product_id          text not null,
  status              text not null check (status in ('active', 'grace', 'expired', 'refunded')),
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now()
);
create index subscriptions_user_idx on subscriptions (user_id);
