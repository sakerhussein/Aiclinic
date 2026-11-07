#!/usr/bin/env bash
# First-time setup of the online booking page (book.limitsiz.si) on the VPS. Run once, as root, AFTER the code is pushed and
# deployed (the Booking deploy builds the page) and AFTER migration 0011 is applied:
#
#   bash /root/Aiclinic/deploy/setup-online-booking.sh
#
# Safe to run again: finished steps are skipped, and the password is never replaced. The website, the agent and Accounts are
# not restarted, and their Nginx sites are not changed. Booking is restarted once (about a second) so it shows the clinic's link.
# The page stays OFF for every clinic until an administrator turns it on in Settings > Online booking.
set -euo pipefail

REPO=/root/Aiclinic
DOMAIN=book.limitsiz.si
MARK=/root/Aiclinic-public-deployed.txt

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }

say "Checking the server"
[ "$(id -u)" = 0 ] || die "run this as root"
for tool in node pm2 nginx certbot curl; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[ -f /root/Aiclinic-platform-deployed.txt ] || die "Accounts and Booking are not set up here yet (deploy/setup-platform.sh)"
pm2 describe limitsiz-booking > /dev/null 2>&1 || die "the limitsiz-booking process is not running"
[ -f "$REPO/booking/server/public-index.js" ] || die "the online booking code is not on this server yet: push it first, and let the deploy finish"
SERVER_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')
[ -n "$ip" ] || die "$DOMAIN has no DNS record yet. Add it, wait a few minutes, run this again. Nothing was changed."
[ -z "$SERVER_IP" ] || [ "$ip" = "$SERVER_IP" ] || die "$DOMAIN points to $ip, not this server ($SERVER_IP)"
echo "OK: tools, Booking running, code present, DNS."

say "Checking the page is built"
if [ ! -f "$REPO/booking/client/dist-public/book.html" ]; then
  (cd "$REPO/booking/client" && npm ci --no-audit --no-fund && npm run build)
  [ -f "$REPO/booking/client/dist-public/book.html" ] || die "the build produced no dist-public/book.html"
fi
echo "OK: the page is built."

say "Creating the database password and settings"
cd "$REPO"
export REPO
set +e
node deploy/setup-public-secret.mjs
code=$?
set -e
if [ "$code" = 3 ]; then
  echo "Paste the Supabase connection string with the database password (Supabase > Connect > Session pooler). It will not be shown or saved:"
  read -rs OWNER_DATABASE_URL
  export OWNER_DATABASE_URL
  node deploy/setup-public-secret.mjs
  unset OWNER_DATABASE_URL
elif [ "$code" != 0 ]; then
  die "the settings were not created"
fi

say "Starting the online booking process"
wait_for() { # name, port
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$2/api/health/db" > /dev/null; then echo "$1 answers, and reaches the database."; return 0; fi
    sleep 2
  done
  pm2 logs "$1" --lines 20 --nostream || true
  return 1
}
cd "$REPO/booking"
if pm2 describe limitsiz-public > /dev/null 2>&1; then
  pm2 restart limitsiz-public
else
  pm2 start server/public-index.js --name limitsiz-public --cwd "$REPO/booking"
fi
wait_for limitsiz-public 3005 || die "limitsiz-public did not answer on port 3005. Booking was not restarted."
# Booking reads PUBLIC_SITE_URL for the link and QR code in Settings > Online booking.
pm2 restart limitsiz-booking --update-env
wait_for limitsiz-booking 3004 || die "limitsiz-booking did not answer after the restart. Put the old settings back: cp $REPO/booking/.env.before-online-booking $REPO/booking/.env && pm2 restart limitsiz-booking"
pm2 save

say "Connecting Nginx"
# Never replaced once there: certbot adds its https lines to this file.
[ -f /etc/nginx/sites-available/limitsiz-public ] || cp "$REPO/deploy/nginx/limitsiz-public.conf" /etc/nginx/sites-available/limitsiz-public
ln -sf /etc/nginx/sites-available/limitsiz-public /etc/nginx/sites-enabled/limitsiz-public
if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/limitsiz-public
  die "Nginx rejected the new site. It was removed again and Nginx was not reloaded, so nothing else changed."
fi
systemctl reload nginx

say "Getting the https certificate"
certbot --nginx -d "$DOMAIN" --non-interactive --redirect --keep-until-expiring

say "Checking from the outside"
curl -fsS --max-time 15 "https://$DOMAIN/api/health/db" > /dev/null || die "https://$DOMAIN does not answer"
curl -fsS --max-time 15 "https://$DOMAIN/demo-derma" | grep -q 'id="root"' || die "https://$DOMAIN/demo-derma does not serve the page"
echo "OK: https://$DOMAIN"
# From now on the Booking deploy also restarts and checks the online booking process.
git -C "$REPO" rev-parse HEAD > "$MARK"

say "Done"
cat <<EOF
The page is ready but OFF. To open it for patients: sign in at https://booking.limitsiz.si as a clinic administrator,
Settings > Online booking, switch it on and save. The clinic's link and QR code are shown there.
EOF
