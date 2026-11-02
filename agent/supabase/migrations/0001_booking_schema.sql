-- Limitsiz Clinic: WhatsApp booking agent, data model (step 1).
-- Runs on a Supabase project of its own, separate from the website leads project.
--
-- Rules the database enforces itself, so the AI agent cannot break them:
--   * every row belongs to one clinic, and an appointment can only use a doctor, service and patient
--     of that same clinic (composite foreign keys);
--   * a doctor can never have two active appointments that overlap (exclusion constraint);
--   * a patient phone number is unique per clinic.
--
-- Row Level Security is on for every table with no policies, so the public (anon) key can read or
-- write nothing. Only the agent server, using the secret key or a direct database connection, can.
-- Staff dashboard policies come with step 7.
--
-- LangGraph keeps its own conversation-state tables (created by PostgresSaver.setup()); they are not here.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- clinics

create table clinics (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_en               text not null,
  name_ar               text not null,
  timezone              text not null default 'Asia/Amman',
  phone                 text,
  -- Meta WhatsApp Cloud API "phone number ID" this clinic receives messages on.
  wa_phone_number_id    text unique,
  address_en            text,
  address_ar            text,
  maps_url              text,
  default_language      text not null default 'ar' check (default_language in ('ar', 'en')),
  booking_window_days   int  not null default 30 check (booking_window_days between 1 and 365),
  min_notice_minutes    int  not null default 60 check (min_notice_minutes >= 0),
  cancel_notice_minutes int  not null default 120 check (cancel_notice_minutes >= 0),
  slot_step_minutes     int  not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Answers the agent may give word for word (location, parking, payment, insurance, preparation).
create table clinic_faqs (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics (id) on delete cascade,
  topic       text not null,
  question_en text not null,
  question_ar text not null,
  answer_en   text not null,
  answer_ar   text not null,
  sort        int  not null default 0
);
create index on clinic_faqs (clinic_id, sort);

-- ---------------------------------------------------------------- doctors and services

create table doctors (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics (id) on delete cascade,
  name_en    text not null,
  name_ar    text not null,
  title_en   text,
  title_ar   text,
  -- Some patients ask for a female or male doctor.
  gender     text check (gender in ('f', 'm')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table services (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics (id) on delete cascade,
  name_en          text not null,
  name_ar          text not null,
  description_en   text,
  description_ar   text,
  duration_minutes int  not null check (duration_minutes between 5 and 480),
  price_jod        numeric(10, 2) check (price_jod >= 0),
  -- true when price_jod is a starting price ("from 25 JOD").
  price_is_from    boolean not null default false,
  active           boolean not null default true,
  sort             int  not null default 0,
  unique (clinic_id, id)
);

-- Which doctor offers which service.
create table doctor_services (
  clinic_id  uuid not null,
  doctor_id  uuid not null,
  service_id uuid not null,
  primary key (doctor_id, service_id),
  foreign key (clinic_id, doctor_id)  references doctors  (clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references services (clinic_id, id) on delete cascade
);

-- ---------------------------------------------------------------- availability

-- Weekly hours in the clinic's local time. weekday: 0 = Sunday ... 6 = Saturday (as Postgres "dow").
-- Several rows on one day make a split shift.
create table working_hours (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null,
  doctor_id  uuid not null,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time),
  foreign key (clinic_id, doctor_id) references doctors (clinic_id, id) on delete cascade,
  exclude using gist (doctor_id with =, weekday with =, tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) with &&)
);

-- Leave, conferences and holidays. doctor_id null = the whole clinic is closed.
create table time_off (
  id        uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  doctor_id uuid,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  reason    text,
  check (ends_at > starts_at),
  foreign key (clinic_id, doctor_id) references doctors (clinic_id, id) on delete cascade
);
create index on time_off (clinic_id, starts_at);

-- ---------------------------------------------------------------- patients and appointments

-- Contact details only. No medical records are kept here.
create table patients (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references clinics (id) on delete cascade,
  phone_e164         text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  full_name          text,
  preferred_language text check (preferred_language in ('ar', 'en')),
  -- Set when the patient accepts the first-message privacy notice.
  consent_at         timestamptz,
  consent_version    text,
  created_at         timestamptz not null default now(),
  unique (clinic_id, phone_e164),
  unique (clinic_id, id)
);

create type appointment_status as enum ('booked', 'confirmed', 'cancelled', 'completed', 'no_show');

create table appointments (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null,
  doctor_id     uuid not null,
  service_id    uuid not null,
  patient_id    uuid not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        appointment_status not null default 'booked',
  source        text not null default 'whatsapp' check (source in ('whatsapp', 'staff', 'web')),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (clinic_id, doctor_id)  references doctors  (clinic_id, id),
  foreign key (clinic_id, service_id) references services (clinic_id, id),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id),
  -- No double booking: two active appointments of one doctor can never overlap,
  -- even when two patients try to take the same slot at the same moment.
  constraint no_overlapping_appointments exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('booked', 'confirmed'))
);
create index on appointments (clinic_id, starts_at);
create index on appointments (patient_id, starts_at);

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger appointments_updated_at before update on appointments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- conversations

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  patient_id      uuid,
  wa_phone        text not null,
  -- 'handed_off': clinic staff are answering; the agent stays quiet until it is set back to 'active'.
  status          text not null default 'active' check (status in ('active', 'handed_off', 'closed')),
  language        text check (language in ('ar', 'en')),
  -- WhatsApp only allows free-form replies within 24 hours of the patient's last message.
  last_inbound_at timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete set null (patient_id),
  unique (clinic_id, wa_phone)
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  kind            text not null default 'text' check (kind in ('text', 'template', 'interactive', 'system')),
  body            text,
  -- Meta's message ID; unique so a webhook delivered twice is handled once.
  wa_message_id   text unique,
  created_at      timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

-- When the agent passes a conversation to a person.
create table handoffs (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  reason          text not null check (reason in ('emergency', 'medical_question', 'patient_request', 'complaint', 'agent_unsure')),
  summary         text,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index on handoffs (clinic_id, status, created_at);

-- ---------------------------------------------------------------- row level security

alter table clinics         enable row level security;
alter table clinic_faqs     enable row level security;
alter table doctors         enable row level security;
alter table services        enable row level security;
alter table doctor_services enable row level security;
alter table working_hours   enable row level security;
alter table time_off        enable row level security;
alter table patients        enable row level security;
alter table appointments    enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table handoffs        enable row level security;
