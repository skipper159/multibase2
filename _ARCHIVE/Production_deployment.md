# 🚀 Multibase Dashboard - Production Deployment Guide

## Übersicht

Diese Anleitung beschreibt das komplette Deployment des Multibase Dashboards auf einem Linux-Server mit PM2 und Nginx.

## Voraussetzungen

- Linux Server (Ubuntu 20.04+ / Debian 11+)
- Root- oder sudo-Zugriff
- Node.js 20+ installiert
- Docker und Docker Compose installiert
- Domain oder öffentliche IP-Adresse

## 1. Server-Vorbereitung

### Node.js installieren (falls noch nicht vorhanden)

```bash
# NodeSource Repository hinzufügen
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Node.js installieren
sudo apt update
sudo apt install -y nodejs

# Überprüfen
node --version  # sollte v20.x.x sein
npm --version
```

### PM2 global installieren

```bash
sudo npm install -g pm2

# PM2 Startup-Script erstellen (damit es nach Reboot startet)
pm2 startup
# Führe den angezeigten Befehl aus (beginnt mit sudo)
```

### Nginx installieren

```bash
sudo apt update
sudo apt install -y nginx

# Nginx starten
sudo systemctl start nginx
sudo systemctl enable nginx

# Firewall konfigurieren
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## 2. Projekt auf Server hochladen

### Via Git (empfohlen)

```bash
cd /opt
sudo git clone <your-repo-url> multibase
sudo chown -R $USER:$USER /opt/multibase
cd /opt/multibase/dashboard
```

### Via SCP (von lokalem Windows)

```powershell
# Auf Windows-Client
scp -r C:\Users\thoma\Multibase\multibase root@85.114.138.116:/opt/
```

## 3. Backend einrichten

### Dependencies installieren

```bash
cd /opt/multibase/dashboard/backend
npm install
```

### Datenbank initialisieren

```bash
# Prisma Client generieren
npx prisma generate

# Datenbank-Migration durchführen
npx prisma migrate deploy

# Admin-User erstellen
npm run prisma:seed
```

**Standard-Login:**

- Email: `admin@multibase.local`
- Passwort: `admin123`

### Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
nano .env
```

Wichtige Einstellungen:

```env
# Server Configuration
PORT=3001
NODE_ENV=production
HOST=0.0.0.0

# Database (SQLite)
DATABASE_URL="file:./data/multibase.db"

# JWT Secret (generiere einen sicheren Key!)
JWT_SECRET=<generiere-hier-einen-sicheren-key-min-32-zeichen>

# Session Expiry (24 Stunden)
SESSION_EXPIRY=86400

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# Docker Configuration
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Projects Path (Supabase Instanzen)
PROJECTS_PATH=/opt/multibase/projects

# CORS Configuration (deine Domain/IP)
CORS_ORIGIN=http://85.114.138.116,https://deine-domain.de

# Monitoring Intervals
METRICS_INTERVAL=15000
HEALTH_CHECK_INTERVAL=10000

# Logging
LOG_LEVEL=info
```

**JWT Secret generieren:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Backend kompilieren

```bash
npm run build
```

### Backend mit PM2 starten

```bash
# Backend als PM2 Prozess starten
pm2 start dist/server.js --name multibase-backend

# Logs ansehen
pm2 logs multibase-backend

# Status prüfen
pm2 status

# PM2-Konfiguration speichern (für Reboot)
pm2 save
```

**PM2 Befehle:**

```bash
pm2 restart multibase-backend  # Neu starten
pm2 stop multibase-backend     # Stoppen
pm2 delete multibase-backend   # Entfernen
pm2 logs multibase-backend     # Live-Logs
pm2 monit                      # Monitoring-Dashboard
```

## 4. Frontend einrichten

### Dependencies installieren

```bash
cd /opt/multibase/dashboard/frontend
npm install
```

### Umgebungsvariablen konfigurieren

```bash
nano .env
```

Mit Nginx (empfohlen):

```env
VITE_API_URL=http://85.114.138.116
```

Ohne Nginx (direkter Zugriff):

```env
VITE_API_URL=http://85.114.138.116:3001
```

### Frontend kompilieren

```bash
npm run build
```

Dies erstellt den `dist/` Ordner mit den statischen Dateien.

## 5. Nginx konfigurieren

### Nginx-Konfiguration erstellen

```bash
sudo nano /etc/nginx/sites-available/multibase
```

**Basis-Konfiguration (HTTP):**

```nginx
server {
    listen 80;
    server_name 85.114.138.116;  # Ersetze mit deiner Domain/IP

    # Frontend (Static Files)
    location / {
        root /opt/multibase/dashboard/frontend/dist;
        try_files $uri $uri/ /index.html;

        # Cache-Header für statische Assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
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

        # Timeouts für lange Requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket (Socket.io)
    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # WebSocket-spezifische Timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Gzip Kompression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_vary on;
    gzip_min_length 1024;
}
```

### Konfiguration aktivieren

```bash
# Symlink erstellen
sudo ln -s /etc/nginx/sites-available/multibase /etc/nginx/sites-enabled/

# Standard-Site deaktivieren (optional)
sudo rm /etc/nginx/sites-enabled/default

# Nginx-Konfiguration testen
sudo nginx -t

# Nginx neu laden
sudo systemctl reload nginx
```

## 6. SSL/HTTPS einrichten (empfohlen)

### Let's Encrypt mit Certbot

```bash
# Certbot installieren
sudo apt install -y certbot python3-certbot-nginx

# SSL-Zertifikat erstellen (automatisch)
sudo certbot --nginx -d deine-domain.de

# Auto-Renewal testen
sudo certbot renew --dry-run
```

Certbot aktualisiert automatisch die Nginx-Konfiguration für HTTPS.

### Manuelle HTTPS-Konfiguration

```nginx
server {
    listen 80;
    server_name deine-domain.de;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name deine-domain.de;

    ssl_certificate /etc/letsencrypt/live/deine-domain.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/deine-domain.de/privkey.pem;

    # SSL-Konfiguration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # ... rest der Konfiguration wie oben
}
```

## 7. Systemd Services (Alternative zu PM2)

Falls du systemd statt PM2 bevorzugst:

### Backend-Service erstellen

```bash
sudo nano /etc/systemd/system/multibase-backend.service
```

```ini
[Unit]
Description=Multibase Dashboard Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/multibase/dashboard/backend
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=multibase-backend

Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

### Service aktivieren

```bash
sudo systemctl daemon-reload
sudo systemctl enable multibase-backend
sudo systemctl start multibase-backend
sudo systemctl status multibase-backend

# Logs ansehen
sudo journalctl -u multibase-backend -f
```

## 8. Monitoring & Logs

### PM2 Monitoring

```bash
# Live-Monitoring
pm2 monit

# Logs ansehen
pm2 logs multibase-backend

# Nur Fehler
pm2 logs multibase-backend --err

# Log-Rotation einrichten
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Nginx Logs

```bash
# Access-Log
sudo tail -f /var/log/nginx/access.log

# Error-Log
sudo tail -f /var/log/nginx/error.log
```

### Prisma Studio (Datenbank-Verwaltung)

```bash
cd /opt/multibase/dashboard/backend

# Prisma Studio starten (nur temporär)
npx prisma studio

# Mit SSH-Tunnel von lokalem PC:
# ssh -L 5555:localhost:5555 root@85.114.138.116
# Dann im Browser: http://localhost:5555
```

## 9. Backup & Wartung

### Datenbank-Backup

```bash
#!/bin/bash
# backup-db.sh

BACKUP_DIR="/opt/backups/multibase"
DATE=$(date +%Y%m%d_%H%M%S)
DB_FILE="/opt/multibase/dashboard/backend/data/multibase.db"

mkdir -p $BACKUP_DIR
cp $DB_FILE $BACKUP_DIR/multibase-$DATE.db
gzip $BACKUP_DIR/multibase-$DATE.db

# Alte Backups löschen (älter als 30 Tage)
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup erstellt: multibase-$DATE.db.gz"
```

**Cronjob einrichten (täglich um 3 Uhr):**

```bash
crontab -e
```

```cron
0 3 * * * /opt/multibase/scripts/backup-db.sh >> /var/log/multibase-backup.log 2>&1
```

### Updates deployen

```bash
# 1. Code aktualisieren
cd /opt/multibase
git pull

# 2. Backend aktualisieren
cd dashboard/backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 restart multibase-backend

# 3. Frontend aktualisieren
cd ../frontend
npm install
npm run build
sudo systemctl reload nginx
```

## 10. Troubleshooting

### Backend startet nicht

```bash
# Logs prüfen
pm2 logs multibase-backend --err

# Port-Konflikt prüfen
sudo lsof -i :3001
sudo netstat -tulpn | grep 3001

# Prozess töten
sudo kill -9 <PID>

# Datenbank prüfen
cd /opt/multibase/dashboard/backend
npx prisma studio
```

### WebSocket verbindet nicht

```bash
# Nginx-Fehlerlog prüfen
sudo tail -f /var/log/nginx/error.log

# Nginx-Konfiguration testen
sudo nginx -t

# Backend-Logs prüfen
pm2 logs multibase-backend | grep socket
```

### Frontend zeigt 404

```bash
# Nginx-Konfiguration prüfen
sudo nginx -t

# Root-Pfad prüfen
ls -la /opt/multibase/dashboard/frontend/dist

# Nginx neu laden
sudo systemctl reload nginx
```

### Prisma-Fehler

```bash
cd /opt/multibase/dashboard/backend

# Client neu generieren
npx prisma generate

# Datenbank resetten (⚠️ löscht alle Daten!)
npx prisma migrate reset --force
npm run prisma:seed
```

## 11. Sicherheit

### Firewall konfigurieren

```bash
# UFW einrichten
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### Fail2Ban für SSH

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### Passwörter ändern

```bash
# Admin-Passwort im Dashboard ändern (über UI)
# Oder über Prisma Studio:
npx prisma studio
# Navigiere zu Users → Admin → Passwort hashen und ändern
```

### Regelmäßige Updates

```bash
# System-Updates
sudo apt update && sudo apt upgrade -y

# Node.js Pakete aktualisieren
cd /opt/multibase/dashboard/backend
npm audit
npm audit fix

cd ../frontend
npm audit
npm audit fix
```

## 12. Performance-Optimierung

### PM2 Cluster-Modus

```bash
# Mehrere Instanzen starten (nutzt alle CPU-Kerne)
pm2 start dist/server.js -i max --name multibase-backend
pm2 save
```

### Nginx Caching

```nginx
# In /etc/nginx/sites-available/multibase

# Cache-Zone definieren (vor server block)
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=100m inactive=60m;

server {
    # ... existing config

    location /api {
        proxy_cache api_cache;
        proxy_cache_valid 200 5m;
        proxy_cache_bypass $http_cache_control;
        add_header X-Cache-Status $upstream_cache_status;

        # ... existing proxy settings
    }
}
```

### Redis für Caching

```bash
# Redis installieren
sudo apt install -y redis-server

# Redis starten
sudo systemctl enable redis-server
sudo systemctl start redis-server

# In backend/.env
REDIS_URL=redis://localhost:6379
```

## 13. Checkliste

- [ ] Node.js 20+ installiert
- [ ] PM2 global installiert
- [ ] Nginx installiert und läuft
- [ ] Projekt auf Server hochgeladen
- [ ] Backend-Dependencies installiert
- [ ] Datenbank migriert und geseeded
- [ ] Backend `.env` konfiguriert
- [ ] Backend kompiliert
- [ ] Backend mit PM2 gestartet
- [ ] Frontend-Dependencies installiert
- [ ] Frontend `.env` konfiguriert
- [ ] Frontend kompiliert
- [ ] Nginx konfiguriert und neu geladen
- [ ] SSL-Zertifikat eingerichtet (optional)
- [ ] Firewall konfiguriert
- [ ] Backup-Script eingerichtet
- [ ] Admin-Passwort geändert
- [ ] PM2 Startup-Script gespeichert

## 14. Nützliche Befehle

```bash
# PM2
pm2 list                          # Alle Prozesse
pm2 restart multibase-backend     # Neu starten
pm2 logs multibase-backend        # Logs ansehen
pm2 monit                         # Monitoring
pm2 save                          # Konfiguration speichern

# Nginx
sudo nginx -t                     # Konfiguration testen
sudo systemctl reload nginx       # Neu laden
sudo systemctl restart nginx      # Neu starten
sudo tail -f /var/log/nginx/error.log  # Fehlerlog

# Systemd (falls verwendet)
sudo systemctl status multibase-backend
sudo systemctl restart multibase-backend
sudo journalctl -u multibase-backend -f

# Datenbank
cd /opt/multibase/dashboard/backend
npx prisma studio                 # DB-Admin UI
npx prisma migrate deploy         # Migrationen ausführen
npm run prisma:seed               # Daten seeden
```

---

**Das Dashboard ist jetzt live! 🎉**

Zugriff: `http://85.114.138.116` oder `https://deine-domain.de`

Bei Problemen: PM2-Logs und Nginx-Logs prüfen!
