#!/usr/bin/env bash
# First-time setup of Records (records.limitsiz.si, the patient chart) on the VPS. Run once, as root, AFTER migration 0020 is
# applied and the code is pushed:
#
#   bash /root/Aiclinic/deploy/setup-records.sh
#
# Safe to run again: finished steps are skipped, and secrets are never replaced. The website, the agent and Accounts are not
# restarted, and their Nginx sites are not changed. Booking is restarted once (about a second) so it shows "Open in Records".
set -euo pipefail

REPO=/root/Aiclinic
DOMAIN=records.limitsiz.si
PORT=3006
MARK=/root/Aiclinic-records-deployed.txt

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
for tool in node npm pm2 nginx certbot curl git; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[ -f /root/Aiclinic-platform-deployed.txt ] || die "Accounts and Booking are not set up here yet (deploy/setup-platform.sh)"
pm2 describe limitsiz-booking > /dev/null 2>&1 || die "the limitsiz-booking process is not running"
SERVER_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')
[ -n "$ip" ] || die "$DOMAIN has no DNS record yet. Add it, wait a few minutes, run this again. Nothing was changed."
[ -z "$SERVER_IP" ] || [ "$ip" = "$SERVER_IP" ] || die "$DOMAIN points to $ip, not this server ($SERVER_IP)"
if ! pm2 describe limitsiz-records > /dev/null 2>&1 && ss -ltn "sport = :$PORT" | grep -q LISTEN; then
  die "port $PORT is already used by something else. Nothing was changed."
fi
echo "OK: tools, Booking running, DNS, port $PORT."

say "Getting the latest code"
cd "$REPO"
git checkout -- app/package-lock.json app/client/package-lock.json
git pull --ff-only origin main
[ -f "$REPO/records/server/index.js" ] || die "the Records code is not on this server: push it first"
echo "Version: $(git rev-parse --short HEAD)"

say "Installing and building (a few minutes)"
cd "$REPO/records"
npm ci --omit=dev --no-audit --no-fund
cd client
npm ci --no-audit --no-fund
npm run build
[ -f dist/index.html ] || die "the build produced no index.html"

say "Creating the database password and settings"
cd "$REPO"
export REPO
set +e
node deploy/setup-records-secret.mjs
code=$?
set -e
if [ "$code" = 3 ]; then
  echo "Paste the Supabase connection string with the database password (Supabase > Connect > Session pooler). It will not be shown or saved:"
  read -rs OWNER_DATABASE_URL
  export OWNER_DATABASE_URL
  node deploy/setup-records-secret.mjs
  unset OWNER_DATABASE_URL
elif [ "$code" != 0 ]; then
  die "the settings were not created"
fi

say "Starting Records"
wait_for() { # name, port
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$2/api/health/db" > /dev/null; then echo "$1 answers, and reaches the database."; return 0; fi
    sleep 2
  done
  pm2 logs "$1" --lines 20 --nostream || true
  return 1
}
cd "$REPO/records"
if pm2 describe limitsiz-records > /dev/null 2>&1; then
  pm2 restart limitsiz-records
else
  pm2 start server/index.js --name limitsiz-records --cwd "$REPO/records"
fi
wait_for limitsiz-records "$PORT" || die "limitsiz-records did not answer on port $PORT. Booking was not restarted."
# Booking reads RECORDS_URL for the "Open in Records" links and the chart line on the visit note.
pm2 restart limitsiz-booking --update-env
wait_for limitsiz-booking 3004 || die "limitsiz-booking did not answer after the restart. Put the old settings back: cp $REPO/booking/.env.before-records $REPO/booking/.env && pm2 restart limitsiz-booking"
pm2 save

say "Connecting Nginx"
# Never replaced once there: certbot adds its https lines to this file.
[ -f /etc/nginx/sites-available/limitsiz-records ] || cp "$REPO/deploy/nginx/limitsiz-records.conf" /etc/nginx/sites-available/limitsiz-records
ln -sf /etc/nginx/sites-available/limitsiz-records /etc/nginx/sites-enabled/limitsiz-records
if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/limitsiz-records
  die "Nginx rejected the new site. It was removed again and Nginx was not reloaded, so nothing else changed."
fi
systemctl reload nginx

say "Getting the https certificate"
certbot --nginx -d "$DOMAIN" --non-interactive --redirect --keep-until-expiring

say "Checking from the outside"
curl -fsS --max-time 15 "https://$DOMAIN/api/health/db" > /dev/null || die "https://$DOMAIN does not answer"
curl -fsS --max-time 15 "https://$DOMAIN/" | grep -q 'id="root"' || die "https://$DOMAIN does not serve the pages"
echo "OK: https://$DOMAIN"
# From now on the "Deploy Accounts and Booking" workflow also deploys and checks Records.
git -C "$REPO" rev-parse HEAD > "$MARK"

say "Done"
cat <<EOF
Records is running at https://$DOMAIN. Doctors, secretaries and clinic administrators now see it in "My services" at
https://accounts.limitsiz.si, and Booking's patient page and visit note link to it.
EOF
