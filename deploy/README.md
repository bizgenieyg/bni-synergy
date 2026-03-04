# Deployment Guide

## First time setup
1. Create Hetzner CX22 server (Ubuntu 24.04)
2. SSH into server: ssh root@YOUR_IP
3. Upload and run setup script:
   ```bash
   curl -o setup.sh https://raw.githubusercontent.com/bizgenieyg/bni-synergy/main/deploy/setup.sh
   chmod +x setup.sh
   ./setup.sh
   ```
4. Edit .env with real values
5. Restart: pm2 restart bni-synergy

## Connect WhatsApp (WAHA)
1. Open http://YOUR_IP/waha-qr (we will add this page)
2. Scan QR code with WhatsApp on your BNI phone number
3. Done - WhatsApp is connected!

## Deploy updates
```bash
ssh root@YOUR_IP
bash /var/www/bni-synergy/deploy/update.sh
```

## Useful commands
```bash
pm2 logs bni-synergy     # view logs
pm2 restart bni-synergy  # restart app
pm2 status               # check status
docker ps                # check WAHA status
docker logs waha         # WAHA logs
```
