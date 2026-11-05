"""Database tests run on a throwaway Postgres given by TEST_DATABASE_URL (never the real project).
A fresh database `booking_test` is created with the migration and the demo clinic seed."""

import os
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

SUPABASE_DIR = Path(__file__).resolve().parents[1] / "supabase"
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"
TEST_DB = "booking_test"


@pytest.fixture(scope="session")
def db_url():
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f"drop database if exists {TEST_DB} with (force)")
        admin.execute(f"create database {TEST_DB} encoding 'UTF8' template template0")
    url = make_conninfo(admin_url, dbname=TEST_DB)
    with psycopg.connect(url, autocommit=True) as conn:
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            conn.execute(migration.read_text(encoding="utf-8"))
        conn.execute((SUPABASE_DIR / "seed_demo_clinic.sql").read_text(encoding="utf-8"))
    return url


@pytest.fixture
def conn(db_url):
    """A connection like the agent's (autocommit; writes use their own transactions), on a clean calendar."""
    with psycopg.connect(db_url, autocommit=True) as c:
        c.execute("delete from handoffs; delete from messages; delete from conversations; "
                  "delete from appointments; delete from time_off; delete from patients; "
                  "delete from accounts.sso_codes; delete from accounts.app_sessions; delete from accounts.sessions; "
                  "delete from accounts.invites; delete from accounts.password_resets; delete from accounts.recovery_codes; "
                  "delete from accounts.memberships; delete from accounts.users; "
                  "delete from clinics where slug <> 'demo-derma'; "
                  "update clinics set wa_phone_number_id = null, staff_alert_email = null; "
                  # Settings back to the defaults
                  "delete from clinic_hours; update doctors set slot_minutes = null, buffer_minutes = 0; "
                  "update booking_rules set min_notice_minutes = 60, window_days = 30, change_notice_minutes = 120, max_upcoming = 3 where audience = 'patient'; "
                  "update booking_rules set min_notice_minutes = 0, window_days = 365, change_notice_minutes = 0, max_upcoming = null where audience = 'staff'; "
                  "update clinic_settings set reminders_enabled = true, reminder_offsets_minutes = '{1440,120}', quiet_start = '21:00', quiet_end = '08:00', "
                  "assistant_enabled = true, after_hours_message_en = null, after_hours_message_ar = null, handoff_alert_emails = '{}'")
        yield c
