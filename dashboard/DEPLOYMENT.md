# Multibase Dashboard - Production Deployment Guide

## Overview

This guide covers deploying the Multibase Dashboard in a production environment on your server.

## Server Requirements

- **OS**: Linux (Ubuntu 20.04+, Debian 11+, or similar)
- **Node.js**: Version 20 or higher
- **Docker**: Version 24.0+ with Docker Compose
- **Redis**: Version 7.0+ (can run in Docker)
- **Memory**: Minimum 4GB RAM recommended
- **Disk**: 20GB+ for Docker volumes and logs
- **Network**: Ports 80, 443, 3001, 5173 (or custom)

## Quick Start

### 1. Clone/Upload the Project

```bash
# On your server
cd /opt  # or your preferred location
git clone <your-repo-url> multibase
cd multibase/dashboard
```

### 2. Configure Environment

```bash
# Backend configuration
cd backend
cp .env.example .env
nano .env
```

Edit the following variables:

```env
# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL="file:./prisma/data/multibase.db"

# Redis
REDIS_URL=redis://localhost:6379

# Docker - Windows named pipe for Docker Desktop
DOCKER_SOCKET_PATH=//./pipe/docker_engine

# Projects path (absolute path)
PROJECTS_PATH=/opt/multibase/projects

# CORS - Add your domain
CORS_ORIGIN=https://yourdomain.com,http://localhost:5173

# Monitoring intervals
METRICS_INTERVAL=15000
HEALTH_CHECK_INTERVAL=10000
```

```bash
# Frontend configuration
cd ../frontend
nano .env
```

```env
# Point to your backend API
VITE_API_URL=https://yourdomain.com/api
VITE_PORT=5173
```

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma migrate deploy

# Frontend
cd ../frontend
npm install
npm run build
```

### 4. Set Up Reverse Proxy (Nginx)

Create `/etc/nginx/sites-available/multibase-dashboard`:

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS configuration
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend (static files)
    location / {
        root /opt/multibase/dashboard/frontend/dist;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeouts for long-running operations
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Socket.io WebSocket
    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Logging
    access_log /var/log/nginx/multibase-dashboard-access.log;
    error_log /var/log/nginx/multibase-dashboard-error.log;
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/multibase-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Set Up SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 6. Create Systemd Services

**Backend Service** (`/etc/systemd/system/multibase-dashboard-backend.service`):

```ini
[Unit]
Description=Multibase Dashboard Backend
After=network.target docker.service redis.service
Requires=docker.service

[Service]
Type=simple
User=youruser
WorkingDirectory=/opt/multibase/dashboard/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/multibase/dashboard/backend/prisma/data /opt/multibase/projects

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable multibase-dashboard-backend
sudo systemctl start multibase-dashboard-backend
sudo systemctl status multibase-dashboard-backend
```

### 7. Set Up Redis

**Option 1: Docker (Recommended)**

```bash
docker run -d \
  --name multibase-redis \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  -v multibase-redis-data:/data \
  redis:alpine redis-server --appendonly yes
```

**Option 2: System Package**

```bash
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### 8. Verify Installation

```bash
# Check backend
curl http://localhost:3001/api/ping

# Check frontend
curl http://localhost:80

# Check logs
sudo journalctl -u multibase-dashboard-backend -f

# Check Redis
redis-cli ping
```

## Production Checklist

- [ ] Node.js 20+ installed
- [ ] Docker and Docker Compose installed and running
- [ ] Redis running and accessible
- [ ] Backend `.env` configured with production settings
- [ ] Frontend built and configured
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed
- [ ] Systemd service created and enabled
- [ ] Firewall configured (ports 80, 443 open)
- [ ] Projects directory created with correct permissions
- [ ] Database initialized and migrated

## Monitoring & Maintenance

### View Logs

```bash
# Backend logs
sudo journalctl -u multibase-dashboard-backend -f

# Nginx access logs
sudo tail -f /var/log/nginx/multibase-dashboard-access.log

# Nginx error logs
sudo tail -f /var/log/nginx/multibase-dashboard-error.log
```

### Restart Services

```bash
# Backend
sudo systemctl restart multibase-dashboard-backend

# Nginx
sudo systemctl reload nginx

# Redis
docker restart multibase-redis
```

### Update Application

```bash
cd /opt/multibase/dashboard

# Pull latest code
git pull

# Update backend
cd backend
npm install
npm run build
npx prisma migrate deploy
sudo systemctl restart multibase-dashboard-backend

# Update frontend
cd ../frontend
npm install
npm run build
sudo systemctl reload nginx
```

### Backup Database

```bash
# SQLite backup
cp /opt/multibase/dashboard/backend/prisma/data/multibase.db \
   /opt/multibase/backups/multibase-$(date +%Y%m%d-%H%M%S).db

# Redis backup
docker exec multibase-redis redis-cli BGSAVE
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
sudo journalctl -u multibase-dashboard-backend -n 50

# Check Docker
docker ps
sudo systemctl status docker

# Check Redis
redis-cli ping

# Check permissions
ls -la /opt/multibase/projects
```

### WebSocket not connecting

1. Check nginx WebSocket configuration
2. Verify CORS settings in backend `.env`
3. Check browser console for errors
4. Verify backend is running: `curl http://localhost:3001/socket.io/`

### Docker instances not starting

1. Check Docker daemon: `sudo systemctl status docker`
2. Verify Docker socket path in backend `.env`
3. Check user permissions: `groups youruser` (should include `docker`)
4. Check Docker logs: `docker logs <container-name>`

## Security Considerations

1. **Firewall**: Only expose ports 80 and 443
2. **User Permissions**: Run backend as non-root user
3. **Environment Variables**: Keep `.env` files secure (chmod 600)
4. **SSL**: Always use HTTPS in production
5. **Docker**: Keep Docker daemon secure
6. **Updates**: Regularly update dependencies

## Performance Tuning

### Nginx

```nginx
# Add to http block in /etc/nginx/nginx.conf
worker_processes auto;
worker_connections 2048;

# Enable gzip compression
gzip on;
gzip_vary on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
```

### Node.js Backend

```env
# In backend/.env
NODE_OPTIONS="--max-old-space-size=2048"
```

### Redis

```bash
# Increase maxmemory
docker exec multibase-redis redis-cli CONFIG SET maxmemory 512mb
docker exec multibase-redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

## Support

For issues:

- Check logs: `journalctl -u multibase-dashboard-backend`
- Verify services: `systemctl status multibase-dashboard-backend`
- Check Docker: `docker ps -a`
- Test connectivity: `curl http://localhost:3001/api/ping`

---

**Production Deployment Complete! 🚀**
