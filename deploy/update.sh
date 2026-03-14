#!/bin/bash
# Run this to deploy updates from GitHub
cd /var/www/bni-synergy
git checkout -- package-lock.json 2>/dev/null || true
git pull origin main
npm install
npm run build
pm2 restart bni-synergy
echo "✅ Updated and restarted!"
