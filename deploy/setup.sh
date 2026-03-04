#!/bin/bash
# BNI SYNERGY - Server Setup Script
# Run once on fresh Ubuntu 24.04 VPS as root

set -e

echo "=== 1. System update ==="
apt update && apt upgrade -y

echo "=== 2. Install Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "=== 3. Install Docker (for WAHA) ==="
apt install -y docker.io docker-compose
systemctl enable docker
systemctl start docker

echo "=== 4. Install PM2 (process manager) ==="
npm install -g pm2

echo "=== 5. Install Nginx ==="
apt install -y nginx
systemctl enable nginx

echo "=== 6. Clone project from GitHub ==="
mkdir -p /var/www
cd /var/www
git clone https://github.com/bizgenieyg/bni-synergy.git
cd bni-synergy
npm install

echo "=== 7. Setup .env (YOU MUST EDIT THIS) ==="
cp .env.example .env
echo ""
echo "⚠️  EDIT /var/www/bni-synergy/.env with your values!"
echo "    nano /var/www/bni-synergy/.env"

echo "=== 8. Start WAHA (WhatsApp) ==="
docker run -d \
  --name waha \
  --restart always \
  -p 3001:3000 \
  devlikeapro/waha

echo "=== 9. Configure Nginx ==="
cat > /etc/nginx/sites-available/bni-synergy << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/bni-synergy /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 10. Start app with PM2 ==="
cd /var/www/bni-synergy
pm2 start server.js --name bni-synergy
pm2 save
pm2 startup

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env:  nano /var/www/bni-synergy/.env"
echo "2. Restart app: pm2 restart bni-synergy"
echo "3. Connect WhatsApp: open http://YOUR_IP/api/waha/startSession"
echo "4. Check logs: pm2 logs bni-synergy"
