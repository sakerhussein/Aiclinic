#!/usr/bin/env bash
# First-time setup of Limitsiz Clinic Accounts and Booking on the VPS. Run once, as root:
#
#   bash /root/Aiclinic/deploy/setup-platform.sh you@example.com
#
# The email receives the nightly audit report. Safe to run again: finished steps are skipped, and secrets are never replaced.
# The website and the agent are not restarted, and their Nginx sites are not changed.
set -euo pipefail

REPO=/root/Aiclinic
AUDIT_EMAIL=${1:-}
DOMAINS="accounts.limitsiz.si booking.limitsiz.si"
SERVICES="accounts booking"
MARK=/root/Aiclinic-platform-deployed.txt

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
[ -n "$AUDIT_EMAIL" ] || die "give the email for the nightly audit report: bash $0 you@example.com"
for tool in node npm pm2 nginx certbot curl git; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node 20 or newer is needed; this is $(node -v)"
[ -f "$REPO/agent/.env" ] || die "$REPO/agent/.env is missing"
SERVER_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
for d in $DOMAINS; do
  ip=$(getent ahostsv4 "$d" | awk 'NR==1 {print $1}')
  [ -n "$ip" ] || die "$d has no DNS record yet. Add it, wait a few minutes, run this again. Nothing was changed."
  [ -z "$SERVER_IP" ] || [ "$ip" = "$SERVER_IP" ] || die "$d points to $ip, not this server ($SERVER_IP)"
done
echo "OK: tools, Node $(node -v), DNS."

say "Getting the latest code"
cd "$REPO"
# The VPS npm rewrites the website's lockfiles on install; drop that so it never blocks the pull.
git checkout -- app/package-lock.json app/client/package-lock.json
git pull --ff-only origin main
echo "Version: $(git rev-parse --short HEAD)"

say "Installing and building (a few minutes)"
for s in $SERVICES; do
  cd "$REPO/$s"
  npm ci --omit=dev --no-audit --no-fund
  cd client
  npm ci --no-audit --no-fund
  npm run build
  [ -f dist/index.html ] || die "$s: the build produced no index.html"
done

say "Creating secrets and settings"
cd "$REPO"
export AUDIT_EMAIL REPO
set +e
node deploy/setup-secrets.mjs
code=$?
set -e
if [ "$code" = 3 ]; then
  echo "Paste the Supabase connection string with the database password (Supabase > Connect > Session pooler). It will not be shown or saved:"
  read -rs OWNER_DATABASE_URL
  export OWNER_DATABASE_URL
  node deploy/setup-secrets.mjs
  unset OWNER_DATABASE_URL
elif [ "$code" != 0 ]; then
  die "the settings were not created"
fi

say "Starting the services"
start() { # name, folder, port
  if pm2 describe "$1" > /dev/null 2>&1; then
    pm2 restart "$1"
  else
    pm2 start server/index.js --name "$1" --cwd "$REPO/$2"
  fi
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$3/api/health/db" > /dev/null; then echo "$1 answers, and reaches the database."; return 0; fi
    sleep 2
  done
  pm2 logs "$1" --lines 20 --nostream || true
  die "$1 did not answer on port $3"
}
cd "$REPO/accounts" && start limitsiz-accounts accounts 3003
cd "$REPO/booking" && start limitsiz-booking booking 3004
pm2 save

say "Connecting Nginx"
for s in $SERVICES; do
  # Never replaced once there: certbot adds its https lines to this file.
  [ -f "/etc/nginx/sites-available/limitsiz-$s" ] || cp "$REPO/deploy/nginx/limitsiz-$s.conf" "/etc/nginx/sites-available/limitsiz-$s"
  ln -sf "/etc/nginx/sites-available/limitsiz-$s" "/etc/nginx/sites-enabled/limitsiz-$s"
done
if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/limitsiz-accounts /etc/nginx/sites-enabled/limitsiz-booking
  die "Nginx rejected the new sites. They were removed again and Nginx was not reloaded, so nothing else changed."
fi
systemctl reload nginx

say "Getting https certificates"
for d in $DOMAINS; do
  certbot --nginx -d "$d" --non-interactive --redirect --keep-until-expiring
done

say "Checking from the outside"
for d in $DOMAINS; do
  curl -fsS --max-time 15 "https://$d/api/health/db" > /dev/null || die "https://$d does not answer"
  echo "OK: https://$d"
done
git -C "$REPO" rev-parse HEAD > "$MARK"

say "Done"
cat <<EOF
Next, create the first administrator (use your own email and name). It prints a one-time link, valid for 72 hours:

  cd $REPO/accounts && node server/cli.js invite --clinic demo-derma --email you@example.com --name "Your Name"

Open the link, choose a password and set up two-step. Then sign in at https://booking.limitsiz.si
EOF
