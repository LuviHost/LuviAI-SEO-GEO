# LuviAI Deployment

## Hedef: LuviHost VDS (kendi sunucunuz)

### Önkoşullar
- Ubuntu 22.04 LTS veya Debian 12
- 4 vCPU + 8GB RAM minimum
- 80GB SSD/NVMe
- Public IP + 80, 443, 22 portları açık
- DNS:
  - `ai.luvihost.com` → A record sunucu IP'sine
  - `api.ai.luvihost.com` → A record sunucu IP'sine

### Sunucu hazırlık

```bash
# Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin

# Node 22 (geliştirme/migration için)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
npm install -g pnpm@9

# nginx
sudo apt install -y nginx

# Certbot (SSL)
sudo apt install -y certbot python3-certbot-nginx
```

### Repo deploy

```bash
sudo mkdir -p /opt/luviai
sudo chown $USER:$USER /opt/luviai
cd /opt/luviai

git clone https://github.com/emirhanburgazli/luviai.git .
cp .env.example .env
nano .env   # ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, PAYTR_*, ...

pnpm install --frozen-lockfile
pnpm build

# DB migrate
docker compose up -d mysql redis
sleep 10
cd apps/api && pnpm prisma migrate deploy && cd ../..
```

### Servisleri başlat (PM2 ile)

```bash
npm install -g pm2

# API
pm2 start "node apps/api/dist/main.js" --name luviai-api

# Worker
pm2 start "node apps/worker/dist/index.js" --name luviai-worker

# Web (Next.js standalone)
pm2 start "node apps/web/.next/standalone/server.js" --name luviai-web

pm2 save
pm2 startup  # boot'ta otomatik başlatma
```

### nginx config

```nginx
# /etc/nginx/sites-available/ai.luvihost.com
server {
  listen 80;
  server_name ai.luvihost.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# /etc/nginx/sites-available/api.ai.luvihost.com
server {
  listen 80;
  server_name api.ai.luvihost.com;

  location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 50M;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ai.luvihost.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.ai.luvihost.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d ai.luvihost.com -d api.ai.luvihost.com
```

### Cloudflare

1. Cloudflare DNS — A records:
   - `ai.luvihost.com` → sunucu IP (proxy ON, turuncu bulut)
   - `api.ai.luvihost.com` → sunucu IP (proxy ON)
2. SSL/TLS mode: **Full (Strict)**
3. WAF rules:
   - Rate limit: 100 req/min per IP
   - Bot Fight Mode: ON
4. Page Rules: `api.ai.luvihost.com/*` → cache bypass

### Backup cron

```bash
# /etc/cron.daily/luviai-backup
#!/bin/bash
DATE=$(date +%Y%m%d)
docker exec luviai-mysql mysqldump -u luviai -pPASS luviai | gzip > /opt/backups/luviai-${DATE}.sql.gz
# S3 upload
aws s3 cp /opt/backups/luviai-${DATE}.sql.gz s3://luviai-backups/
# 30 günden eski sil
find /opt/backups -name "luviai-*.sql.gz" -mtime +30 -delete
```

### Monitoring

```bash
# Sentry
SENTRY_DSN'i .env'e ekle, otomatik error reporting

# pm2 monitoring
pm2 install pm2-server-monit
pm2 monit

# Disk + RAM uyarısı
crontab -e
# 0 */6 * * * df -h | mail -s "LuviAI disk usage" emirhanburgazli@gmail.com
```

### Rollback prosedürü

```bash
cd /opt/luviai
git checkout LAST_KNOWN_GOOD_COMMIT
pnpm install --frozen-lockfile
pnpm build
pm2 restart all
```

### Update prosedürü (yeni version deploy)

```bash
cd /opt/luviai
git pull origin main
pnpm install --frozen-lockfile
cd apps/api && pnpm prisma migrate deploy && cd ../..
pnpm build
pm2 restart all
pm2 logs --lines 50  # smoke test
```

## Faz 3 — Scaling

```
Tek VDS (Faz 1-2)
   ↓ ~500-1000 kullanıcı
Multi-server (Faz 3):
  - DB server (read replica)
  - 2x API server (load balanced)
  - 2x Worker server (BullMQ shared)
  - 1x Web server (CDN cache + static)
  - Redis cluster
```
