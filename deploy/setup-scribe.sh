#!/usr/bin/env bash
# One-time setup of the AI Scribe's own process (PM2 "limitsiz-scribe"). Run once, as root, AFTER migration 0016 is applied
# and the code is pushed and deployed:
#
#   bash /root/Aiclinic/deploy/setup-scribe.sh
#
# What it does:
#   1. copies the Anthropic key from agent/.env into booking/.env (root only; never shown), for the draft notes;
#   2. gives recordings a private folder outside the code (/root/Aiclinic-scribe-audio), where they wait only until they become
#      text, and tells Booking about it (Booking restarts for a few seconds);
#   3. starts limitsiz-scribe and checks it stays up;
#   4. marks the server so every later deploy of Booking restarts the Scribe too.
# Safe to run again. The Scribe stays OFF for every clinic until an administrator turns it on in Settings > AI Scribe.
set -euo pipefail

REPO=/root/Aiclinic
AUDIO=/root/Aiclinic-scribe-audio
MARK=/root/Aiclinic-scribe-deployed.txt
ENV="$REPO/booking/.env"
say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }
# One KEY=value line of a .env file, without quotes ("|| true": a missing line is not an error under pipefail).
value() { { grep -h "^$2=" "$1" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "'\""; }
# The Scribe in PM2: "status restarts", or nothing when it is not there.
state() { pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s||"[]").find(x=>x.name==="limitsiz-scribe");if(p)console.log(p.pm2_env.status+" "+p.pm2_env.restart_time)})'; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
[ -f "$ENV" ] || die "$ENV is missing"
[ -f "$REPO/agent/.env" ] || die "$REPO/agent/.env is missing"
[ -f "$REPO/booking/server/scribe-index.js" ] || die "the Scribe code is not on this server yet: push it first, and let the deploy finish"
pm2 describe limitsiz-booking > /dev/null 2>&1 || die "the limitsiz-booking process is not running"
KEY=$(value "$REPO/agent/.env" ANTHROPIC_API_KEY)
[ -n "$KEY" ] || die "agent/.env has no ANTHROPIC_API_KEY"
# Migration 0016 must be on the database the Scribe uses (Booking's login).
(cd "$REPO/booking" && node --input-type=module -e "
  import 'dotenv/config'; import pg from 'pg';
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  await c.connect(); const r = await c.query(\"select to_regclass('public.visit_notes') as t\"); await c.end();
  if (!r.rows[0].t) { console.error('no visit_notes table'); process.exit(1); }") || die "migration 0016 is not applied to Booking's database"

say "The Anthropic key and the recordings folder in booking/.env"
CHANGED=0
if [ "$(value "$ENV" ANTHROPIC_API_KEY)" != "$KEY" ] || [ "$(value "$ENV" SCRIBE_AUDIO_DIR)" != "$AUDIO" ]; then
  cp -a "$ENV" "$ENV.before-scribe"
  grep -v -e '^ANTHROPIC_API_KEY=' -e '^SCRIBE_AUDIO_DIR=' "$ENV.before-scribe" > "$ENV" || true
  printf '# AI Scribe: the draft notes (the same key as agent/.env), and where recordings wait until they become text.\nANTHROPIC_API_KEY=%s\nSCRIBE_AUDIO_DIR=%s\n' "$KEY" "$AUDIO" >> "$ENV"
  chmod 600 "$ENV" "$ENV.before-scribe"
  CHANGED=1
  echo "Written (the old file is kept as booking/.env.before-scribe)."
else
  echo "Already set; kept."
fi
unset KEY
mkdir -p "$AUDIO"
chmod 700 "$AUDIO"

if [ "$CHANGED" = 1 ]; then
  say "Restarting Booking so it uses the recordings folder"
  pm2 restart limitsiz-booking --update-env
  for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3004/api/health/db > /dev/null && break; sleep 2; done
  curl -fsS http://127.0.0.1:3004/api/health/db > /dev/null || die "Booking did not answer after the restart (the old settings are in booking/.env.before-scribe)"
fi

say "Starting the Scribe"
if pm2 describe limitsiz-scribe > /dev/null 2>&1; then
  pm2 restart limitsiz-scribe --update-env
else
  (cd "$REPO/booking" && pm2 start server/scribe-index.js --name limitsiz-scribe --cwd "$REPO/booking")
fi
sleep 3
BEFORE=$(state)
sleep 8
AFTER=$(state)
case "$AFTER" in online*) ;; *) pm2 logs limitsiz-scribe --lines 20 --nostream || true; die "the Scribe is not running ($AFTER)";; esac
[ "$BEFORE" = "$AFTER" ] || { pm2 logs limitsiz-scribe --lines 20 --nostream || true; die "the Scribe keeps restarting ($BEFORE, then $AFTER)"; }
git -C "$REPO" rev-parse HEAD > "$MARK"
pm2 save

say "Done"
echo "The Scribe is running and stays OFF until a clinic administrator turns it on:"
echo "Booking > Settings > AI Scribe > tick \"Doctors can record visits\", tick the doctors, Save."
echo "Until the speech test picks a real service, it uses the stand-in: the draft is always the sample consultation."
