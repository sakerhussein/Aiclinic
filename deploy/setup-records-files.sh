#!/usr/bin/env bash
# One-time setup of Records phase B (photos, documents, the nightly backup) on the VPS. Run once, as root, AFTER migration 0022 is
# applied and the code is pushed and deployed:
#
#   bash /root/Aiclinic/deploy/setup-records-files.sh
#
# It asks for the Supabase service key (pasted, never shown), makes the backup folder and key on this server (the key is never
# shown), lets uploads up to 50 MB through Nginx for records.limitsiz.si only, restarts Records once, and runs a first backup and
# restore check. Safe to run again: what is already set is kept. Nothing else on the server changes.
set -euo pipefail

REPO=/root/Aiclinic
ENV="$REPO/records/.env"
BACKUP_DIR=/root/records-backup
KEY="$BACKUP_DIR/backup.key"
SITE=/etc/nginx/sites-available/limitsiz-records

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }
# Set KEY=VALUE in records/.env without printing it; the old file is kept as .env.before-files the first time.
setenv() {
  [ -f "$ENV.before-files" ] || cp "$ENV" "$ENV.before-files"
  grep -v "^$1=" "$ENV" > "$ENV.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV.tmp"
  mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
}
has() { grep -q "^$1=." "$ENV"; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
[ -f /root/Aiclinic-records-deployed.txt ] || die "Records is not set up here yet (deploy/setup-records.sh)"
[ -f "$ENV" ] || die "$ENV is missing"
[ -f "$REPO/records/server/files.js" ] || die "the phase B code is not on this server yet: push and deploy it first"
pm2 describe limitsiz-records > /dev/null 2>&1 || die "the limitsiz-records process is not running"
for tool in node curl nginx openssl; do command -v "$tool" > /dev/null || die "$tool is not installed"; done
echo "OK"

say "Photos and documents: the private Supabase bucket"
# The project address comes from Records' own database login (records_app.<project-ref>@…).
REF=$(grep '^DATABASE_URL=' "$ENV" | sed -E 's#.*://records_app\.([a-z0-9]+):.*#\1#')
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || die "could not read the Supabase project from DATABASE_URL in $ENV"
URL="https://$REF.supabase.co"
if has SUPABASE_SERVICE_KEY; then
  echo "The service key is already set; keeping it."
  SERVICE_KEY=$(grep '^SUPABASE_SERVICE_KEY=' "$ENV" | cut -d= -f2-)
else
  echo "Paste the project's secret key (Supabase > Project settings > API keys > Secret key, or the service_role key)."
  echo "It will not be shown, and it is kept only in $ENV (readable by root only):"
  read -rs SERVICE_KEY
  [ -n "$SERVICE_KEY" ] || die "no key was pasted. Nothing was changed."
fi
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" "$URL/storage/v1/bucket/records")
[ "$code" = 200 ] || die "the key could not open the 'records' bucket (answer $code). Check the key, and that migration 0022 is applied. Nothing was changed."
setenv STORAGE supabase
setenv SUPABASE_URL "$URL"
setenv SUPABASE_SERVICE_KEY "$SERVICE_KEY"
setenv STORAGE_BUCKET records
unset SERVICE_KEY
echo "OK: the bucket answers."

say "The nightly backup: folder and key on this server"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
if [ -f "$KEY" ]; then
  echo "The backup key already exists; keeping it (a new key would make the older copies unreadable)."
else
  ( umask 077; openssl rand 32 > "$KEY" )
  echo "Made a new backup key."
fi
chmod 600 "$KEY"
[ "$(stat -c %s "$KEY")" = 32 ] || die "$KEY is not 32 bytes"
setenv BACKUP_DIR "$BACKUP_DIR"
setenv BACKUP_KEY_FILE "$KEY"
# Failure emails go out the same way as Booking's (its SMTP settings), when it has them.
for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM; do
  if ! has "$k" && grep -q "^$k=." "$REPO/booking/.env" 2>/dev/null; then setenv "$k" "$(grep "^$k=" "$REPO/booking/.env" | cut -d= -f2-)"; fi
done
has SMTP_HOST && echo "Failure emails: using Booking's mail settings." || echo "Note: no SMTP settings in booking/.env, so a failed night shows only in Records > Settings > Backups."

say "Nginx: uploads up to 50 MB for records.limitsiz.si only"
[ -f "$SITE" ] || die "$SITE is missing"
if grep -q "client_max_body_size" "$SITE"; then
  echo "Already set."
else
  cp "$SITE" /root/limitsiz-records.nginx.before-files
  sed -i 's/^\(\s*server_name records\.limitsiz\.si;\)/\1\n    client_max_body_size 51m;/' "$SITE"
  if ! nginx -t; then
    cp /root/limitsiz-records.nginx.before-files "$SITE"
    die "Nginx rejected the change; the old site file was put back and Nginx was not reloaded."
  fi
  systemctl reload nginx
  echo "OK (the old file: /root/limitsiz-records.nginx.before-files)"
fi

say "Restarting Records with the new settings"
pm2 restart limitsiz-records --update-env
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3006/api/health/db > /dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:3006/api/health/db > /dev/null || { pm2 logs limitsiz-records --lines 20 --nostream || true;
  die "Records did not answer. Put the old settings back: cp $ENV.before-files $ENV && pm2 restart limitsiz-records --update-env"; }
pm2 save
echo "OK: Records answers."

say "Where to email when a night fails"
cd "$REPO/records"
CURRENT=$(node --input-type=module -e "import 'dotenv/config'; import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const r=await p.query('select alert_emails from backup_settings'); console.log(r.rows[0]?.alert_emails||''); await p.end();")
if [ -n "$CURRENT" ]; then
  echo "Already set: $CURRENT"
else
  read -rp "Email address(es), separated by commas (Enter to skip): " EMAILS
  if [ -n "$EMAILS" ]; then
    EMAILS="$EMAILS" node --input-type=module -e "import 'dotenv/config'; import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await p.query('update backup_settings set alert_emails = \$1, updated_by_name = \$2', [process.env.EMAILS, 'setup script']); await p.end();"
    echo "Saved."
  fi
fi

say "A first backup, and a restore check"
node server/backup.js run --check || die "the first backup failed (Records > Settings > Backups shows why). Records itself is running."

say "Done"
FP=$(node --input-type=module -e "import fs from 'node:fs'; import {fingerprint} from './server/backup.js'; console.log(fingerprint(fs.readFileSync('$KEY')))")
cat <<EOF
Photos and documents are on. The nightly backup runs at the time in Records > Settings > Backups.

Print the backup key once and keep the paper somewhere safe (not with the server). Without it nobody can read the backups,
including us. To print it, run this yourself, print what it shows, then clear the screen:

  xxd -p $KEY

Its fingerprint, to check the paper later: $FP (Records > Settings > Backups shows the same).
EOF
