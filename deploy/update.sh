#!/bin/bash
# Run this to deploy updates from GitHub
cd /var/www/bni-synergy
git pull origin main
npm install
pm2 restart bni-synergy
echo "✅ Updated and restarted!"
