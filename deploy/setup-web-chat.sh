#!/usr/bin/env bash
# One-time setup of "Talk to the assistant" on the online booking page. Run once, as root, AFTER migration 0014 is applied
# and the code is pushed and deployed:
#
#   bash /root/Aiclinic/deploy/setup-web-chat.sh
#
# Makes the secret the page uses to reach the assistant (WEB_CHAT_SECRET), writes it to agent/.env and booking/.env (both
# root only; never shown), then restarts the assistant and the online booking page, a few seconds each. Safe to run again:
# an existing secret is kept. The chat stays OFF for every clinic until an administrator turns it on in Settings.
set -euo pipefail

REPO=/root/Aiclinic
say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
[ -f "$REPO/agent/.env" ] || die "$REPO/agent/.env is missing"
[ -f "$REPO/booking/.env" ] || die "$REPO/booking/.env is missing"
grep -q '^PUBLIC_DATABASE_URL=' "$REPO/booking/.env" || die "the online booking page is not set up yet (deploy/setup-online-booking.sh)"
[ -f "$REPO/agent/limitsiz_agent/agent/web.py" ] || die "the web chat code is not on this server yet: push it first, and let the deploy finish"
pm2 describe limitsiz-agent > /dev/null 2>&1 || die "the limitsiz-agent process is not running"
pm2 describe limitsiz-public > /dev/null 2>&1 || die "the limitsiz-public process is not running"

say "The shared secret"
current() { grep -h '^WEB_CHAT_SECRET=' "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\""; }
A=$(current "$REPO/agent/.env"); B=$(current "$REPO/booking/.env")
if [ -n "$A" ] && [ "$A" = "$B" ]; then
  echo "Both files already have the same secret; kept."
else
  SECRET=${A:-$(openssl rand -hex 32)}
  for f in "$REPO/agent/.env" "$REPO/booking/.env"; do
    cp -a "$f" "$f.before-web-chat"
    grep -v '^WEB_CHAT_SECRET=' "$f.before-web-chat" > "$f" || true
    # No quotes: agent/.env is read as plain KEY=value (quotes would become part of the secret); hex needs none.
    printf "# The online booking page's chat reaches the assistant with this (the same in agent/.env and booking/.env).\nWEB_CHAT_SECRET=%s\n" "$SECRET" >> "$f"
    chmod 600 "$f" "$f.before-web-chat"
  done
  unset SECRET
  echo "Written to agent/.env and booking/.env (the old files are kept as .env.before-web-chat)."
fi

say "Restarting the assistant and the online booking page"
pm2 restart limitsiz-agent --update-env
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3002/health > /dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:3002/health > /dev/null || die "the assistant did not answer after the restart"
pm2 restart limitsiz-public --update-env
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3005/api/health/db > /dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:3005/api/health/db > /dev/null || die "the online booking page did not answer after the restart"
# The assistant refuses a wrong secret (proof it is set), without calling the AI.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'x-web-secret: wrong' \
  -d '{"clinic_id":"x","chat_id":"x","text":"x"}' http://127.0.0.1:3002/web/turn)
[ "$code" = 401 ] || die "the assistant answered $code to a wrong secret (expected 401)"
pm2 save

say "Done"
echo "The chat is ready but OFF. To try it: Booking > Settings > Online booking > Assistant on the page > tick it and Save,"
echo "then open the clinic's page and tap \"Talk to the assistant\"."
