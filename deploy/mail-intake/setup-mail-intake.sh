#!/bin/bash
# Inbound-only Postfix for guests@in.bnisynergy.biz -> bni-synergy /internal/mail-intake
# Run as root on the VPS after reviewing: bash /var/www/bni-synergy/deploy/mail-intake/setup-mail-intake.sh
# Idempotent. Does not touch the firewall (it only reports).
set -euo pipefail

APP_DIR=/var/www/bni-synergy
SRC="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d_%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "$APP_DIR/.env not found"; exit 1; }

echo "== 1. MAIL_INTAKE_SECRET in app .env"
if ! grep -q '^MAIL_INTAKE_SECRET=' "$APP_DIR/.env"; then
  printf '\nMAIL_INTAKE_SECRET=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$APP_DIR/.env"
  echo "   generated and appended (restart the app: pm2 restart bni-synergy)"
else
  echo "   already set"
fi
SECRET=$(grep '^MAIL_INTAKE_SECRET=' "$APP_DIR/.env" | tail -1 | cut -d= -f2-)

echo "== 2. Packages"
export DEBIAN_FRONTEND=noninteractive
echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
echo "postfix postfix/mailname string in.bnisynergy.biz"     | debconf-set-selections
apt-get install -y postfix curl ssl-cert

echo "== 3. System user, pipe script, secret file, storage"
id mailintake >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /nonexistent mailintake
install -m 0755 -o root -g root "$SRC/bni-mail-intake" /usr/local/bin/bni-mail-intake
umask 077
printf 'MAIL_INTAKE_SECRET=%s\n' "$SECRET" > /etc/bni-mail-intake.env
chown root:mailintake /etc/bni-mail-intake.env && chmod 640 /etc/bni-mail-intake.env
umask 022
install -d -m 0700 -o root -g root /var/mail-intake
install -m 0755 "$SRC/clean-eml.cron" /etc/cron.daily/bni-mail-intake-clean

echo "== 4. Postfix configuration (backup: *.bak.$STAMP)"
cp -a /etc/postfix/main.cf   "/etc/postfix/main.cf.bak.$STAMP"
cp -a /etc/postfix/master.cf "/etc/postfix/master.cf.bak.$STAMP"
grep -v -e '^#' -e '^[[:space:]]*$' "$SRC/main.cf.params" | while IFS= read -r line; do postconf -e "$line"; done
install -m 0644 "$SRC/transport"         /etc/postfix/transport
install -m 0644 "$SRC/relay_recipients"  /etc/postfix/relay_recipients
postmap /etc/postfix/transport /etc/postfix/relay_recipients
grep -q '^mailintake ' /etc/postfix/master.cf || { echo >> /etc/postfix/master.cf; cat "$SRC/master.cf.snippet" >> /etc/postfix/master.cf; }
postfix check
systemctl enable postfix >/dev/null
systemctl restart postfix

echo "== 5. Open-relay checks (postconf + SMTP dialogue on 127.0.0.1:25)"
postconf smtpd_relay_restrictions smtpd_recipient_restrictions mydestination relay_domains mynetworks
smtp_rcpt() {  # $1 = recipient; prints the SMTP reply to RCPT TO
  exec 3<>/dev/tcp/127.0.0.1/25
  read -r -t 5 _ <&3
  for cmd in "EHLO probe.local" "MAIL FROM:<probe@probe.local>" "RCPT TO:<$1>" "QUIT"; do
    printf '%s\r\n' "$cmd" >&3
    while read -r -t 5 line <&3; do [ "${line:3:1}" = " " ] && break; done
    [ "$cmd" != "${cmd#RCPT}" ] && reply="$line"
  done
  exec 3>&-
  echo "$reply"
}
fail=0
check() {  # $1 = recipient, $2 = expected code prefix
  r=$(smtp_rcpt "$1"); case "$r" in "$2"*) echo "   PASS  $1 -> $r" ;; *) echo "   FAIL  $1 -> $r (expected $2xx)"; fail=1 ;; esac
}
check "someone@gmail.com"            554   # relay access denied
check "other@in.bnisynergy.biz"      550   # unknown recipient
check "guests@in.bnisynergy.biz"     250   # the only accepted recipient
[ "$fail" -eq 0 ] || { echo "!! relay checks failed - do NOT open port 25"; exit 1; }

echo "== 6. Firewall"
ss -ltnp | grep -E ':25\b' || echo "   nothing listens on :25"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw status | grep -E '(^|[^0-9])25(/tcp)?[[:space:]]' >/dev/null && echo "   ufw: 25/tcp already allowed" \
    || echo "   ufw is active and 25/tcp is NOT allowed -> run: ufw allow 25/tcp"
else
  echo "   ufw inactive (nothing to open locally)"
fi
echo "   Also make sure the Kamatera cloud firewall / security group allows inbound TCP 25."
echo
echo "Done. Next: restart the app so it reads MAIL_INTAKE_SECRET (pm2 restart bni-synergy) and follow deploy/mail-intake/README.md."
