-- Limitsiz Clinic Accounts: users, roles, permissions, sessions (design: booking/DESIGN.md §2, §3, §6).
-- The accounts schema is not exposed through Supabase's public API; only the service roles in 0007 can use it.

create schema if not exists accounts;

-- ---------------------------------------------------------------- services, roles, permissions

create table accounts.apps (
  key           text primary key check (key ~ '^[a-z][a-z0-9_-]*$'),
  name_en       text not null,
  name_ar       text not null,
  url           text,
  -- Single sign-on: where a service may be sent back to, and the hash of its secret for the code exchange.
  redirect_uris text[] not null default '{}',
  secret_hash   text
);

create table accounts.roles (
  key      text primary key check (key ~ '^[a-z][a-z_]*$'),
  label_en text not null,
  label_ar text not null,
  scope    text not null check (scope in ('clinic', 'platform'))
);

create table accounts.permissions (
  key         text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  app_key     text not null references accounts.apps (key),
  description text not null
);

create table accounts.role_permissions (
  role_key   text not null references accounts.roles (key) on delete cascade,
  permission text not null references accounts.permissions (key) on delete cascade,
  primary key (role_key, permission)
);

-- Extra permissions an administrator can switch on for one user, on top of the role.
create table accounts.extra_grants (
  grant_key  text not null check (grant_key in ('manage_bookings')),
  permission text not null references accounts.permissions (key) on delete cascade,
  primary key (grant_key, permission)
);

-- ---------------------------------------------------------------- users

create table accounts.users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  password_hash   text,
  full_name       text not null check (char_length(full_name) between 1 and 120),
  language        text not null default 'ar' check (language in ('ar', 'en')),
  status          text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  mfa_secret_enc  text,
  mfa_enabled     boolean not null default false,
  failed_logins   int not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references accounts.users (id),
  -- An active user must have a password.
  check (status <> 'active' or password_hash is not null)
);

create table accounts.memberships (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references accounts.users (id),
  -- null for platform roles (Limitsiz administrators).
  clinic_id             uuid references public.clinics (id),
  role_key              text not null references accounts.roles (key),
  -- For the Doctor role: which doctor of the clinic this login is ("My schedule").
  doctor_id             uuid,
  can_manage_bookings   boolean not null default false,
  active                boolean not null default true,
  granted_by            uuid references accounts.users (id),
  granted_at            timestamptz not null default now(),
  foreign key (clinic_id, doctor_id) references public.doctors (clinic_id, id)
);
create unique index memberships_user_clinic on accounts.memberships (user_id, coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index on accounts.memberships (clinic_id);

-- ---------------------------------------------------------------- sessions and single sign-on

create table accounts.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references accounts.users (id),
  token_hash       text not null unique,
  clinic_id        uuid references public.clinics (id),
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  -- Absolute limit (12 hours); idle sign-out and lock come from the clinic's settings.
  expires_at       timestamptz not null,
  locked_at        timestamptz,
  mfa_at           timestamptz,
  ip               text,
  user_agent       text,
  revoked_at       timestamptz,
  revoked_reason   text
);
create index on accounts.sessions (user_id) where revoked_at is null;

-- A service's own session, tied to an Accounts session so signing out everywhere ends it too.
create table accounts.app_sessions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references accounts.sessions (id) on delete cascade,
  app_key      text not null references accounts.apps (key),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);

-- One-time codes (60 seconds) for the redirect sign-in.
create table accounts.sso_codes (
  code_hash    text primary key,
  session_id   uuid not null references accounts.sessions (id) on delete cascade,
  app_key      text not null references accounts.apps (key),
  redirect_uri text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

-- ---------------------------------------------------------------- invitations, resets, recovery codes

create table accounts.invites (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null check (email = lower(email)),
  full_name           text not null,
  clinic_id           uuid references public.clinics (id),
  role_key            text not null references accounts.roles (key),
  doctor_id           uuid,
  can_manage_bookings boolean not null default false,
  token_hash          text not null unique,
  expires_at          timestamptz not null,
  invited_by          uuid references accounts.users (id),
  accepted_at         timestamptz,
  created_at          timestamptz not null default now(),
  foreign key (clinic_id, doctor_id) references public.doctors (clinic_id, id)
);

create table accounts.password_resets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references accounts.users (id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table accounts.recovery_codes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references accounts.users (id),
  code_hash text not null,
  used_at   timestamptz
);
create index on accounts.recovery_codes (user_id);

-- ---------------------------------------------------------------- seed: services, roles, permissions

insert into accounts.apps (key, name_en, name_ar, url) values
  ('accounts', 'Accounts', 'الحسابات', 'https://accounts.limitsiz.si'),
  ('booking',  'Booking',  'الحجوزات', 'https://booking.limitsiz.si');

insert into accounts.roles (key, label_en, label_ar, scope) values
  ('clinic_admin',   'Clinic administrator', 'مدير العيادة',  'clinic'),
  ('secretary',      'Secretary',            'سكرتيرة',       'clinic'),
  ('doctor',         'Doctor',               'طبيب',          'clinic'),
  ('readonly',       'Read-only',            'قراءة فقط',     'clinic'),
  ('platform_admin', 'Limitsiz administrator', 'مدير Limitsiz', 'platform');

insert into accounts.permissions (key, app_key, description) values
  ('booking.appointments.view',    'booking',  'See bookings'),
  ('booking.appointments.create',  'booking',  'Create bookings'),
  ('booking.appointments.edit',    'booking',  'Change and confirm bookings'),
  ('booking.appointments.cancel',  'booking',  'Cancel bookings'),
  ('booking.appointments.void',    'booking',  'Void (delete) bookings'),
  ('booking.appointments.restore', 'booking',  'Restore voided bookings'),
  ('booking.patients.view',        'booking',  'See patients'),
  ('booking.patients.edit',        'booking',  'Create and edit patients'),
  ('booking.settings.view',        'booking',  'See the clinic settings'),
  ('booking.settings.edit',        'booking',  'Change the clinic settings'),
  ('booking.conversations.view',   'booking',  'Open WhatsApp conversations (scope set in Settings)'),
  ('booking.audit.view',           'booking',  'See the audit log'),
  ('booking.audit.export',         'booking',  'Export the audit log'),
  ('accounts.users.view',          'accounts', 'See users and sessions'),
  ('accounts.users.invite',        'accounts', 'Invite users'),
  ('accounts.users.edit_role',     'accounts', 'Change roles and extra permissions'),
  ('accounts.users.disable',       'accounts', 'Disable users'),
  ('accounts.users.revoke_sessions','accounts','Sign users out'),
  ('platform.clinics.manage',      'accounts', 'Create and manage clinics (Limitsiz only)');

insert into accounts.role_permissions (role_key, permission)
  select 'clinic_admin', key from accounts.permissions where key like 'booking.%' or key like 'accounts.users.%';

insert into accounts.role_permissions (role_key, permission) values
  ('secretary', 'booking.appointments.view'), ('secretary', 'booking.appointments.create'),
  ('secretary', 'booking.appointments.edit'), ('secretary', 'booking.appointments.cancel'),
  ('secretary', 'booking.appointments.void'),
  ('secretary', 'booking.patients.view'), ('secretary', 'booking.patients.edit'),
  ('secretary', 'booking.settings.view'), ('secretary', 'booking.conversations.view'),
  ('doctor', 'booking.appointments.view'), ('doctor', 'booking.patients.view'),
  ('readonly', 'booking.appointments.view'), ('readonly', 'booking.patients.view');

insert into accounts.role_permissions (role_key, permission)
  select 'platform_admin', key from accounts.permissions where key like 'accounts.users.%' or key = 'platform.clinics.manage';

insert into accounts.extra_grants (grant_key, permission) values
  ('manage_bookings', 'booking.appointments.create'), ('manage_bookings', 'booking.appointments.edit'),
  ('manage_bookings', 'booking.appointments.cancel'), ('manage_bookings', 'booking.appointments.void'),
  ('manage_bookings', 'booking.patients.edit');

-- What a user may do in a clinic: the role's permissions plus the "can also manage bookings" extras.
create view accounts.effective_permissions as
  select m.user_id, m.clinic_id, rp.permission
    from accounts.memberships m join accounts.role_permissions rp on rp.role_key = m.role_key
   where m.active
  union
  select m.user_id, m.clinic_id, eg.permission
    from accounts.memberships m join accounts.extra_grants eg on eg.grant_key = 'manage_bookings'
   where m.active and m.can_manage_bookings;

alter table accounts.apps             enable row level security;
alter table accounts.roles            enable row level security;
alter table accounts.permissions      enable row level security;
alter table accounts.role_permissions enable row level security;
alter table accounts.extra_grants     enable row level security;
alter table accounts.users            enable row level security;
alter table accounts.memberships      enable row level security;
alter table accounts.sessions         enable row level security;
alter table accounts.app_sessions     enable row level security;
alter table accounts.sso_codes        enable row level security;
alter table accounts.invites          enable row level security;
alter table accounts.password_resets  enable row level security;
alter table accounts.recovery_codes   enable row level security;
