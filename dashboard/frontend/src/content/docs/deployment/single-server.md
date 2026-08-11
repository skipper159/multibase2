# Single Server Deployment

Deploy the complete Multibase Dashboard on a single VPS.

## Prerequisites

Ensure you have completed:

- [System Requirements](/setup/getting-started/requirements)
- [Installing Dependencies](/setup/server-setup/dependencies)
- [Domain Setup](/setup/domain-dns/domain-setup)

## Step 1: Clone the Repository

```bash
# Create directory
sudo mkdir -p /opt/multibase
sudo chown $USER:$USER /opt/multibase

# Clone repository
cd /opt/multibase
git clone https://github.com/YOUR_USERNAME/multibase.git .
```

## Step 2: Setup Backend

```bash
cd /opt/multibase/dashboard/backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit configuration
nano .env
```

### Configure `.env` File

```env
# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL="file:./data/multibase.db"

# Docker (Linux)
DOCKER_ACCESS_MODE=socket
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Projects path
PROJECTS_PATH=/opt/multibase/projects

# CORS - Your domain
CORS_ORIGIN=https://multibase.yourdomain.com

# Session secret (generate a random string)
SESSION_SECRET=your-32-character-random-string-here

# App URL
APP_URL=https://multibase.yourdomain.com
```

### Initialize Database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Build TypeScript
npm run build
```

## Step 3: Setup Frontend

```bash
cd /opt/multibase/dashboard/frontend

# Install dependencies
npm install

# Create production env
nano .env.production
```

Add:

```env
VITE_API_URL=https://multibase.yourdomain.com/api
```

### Build Frontend

```bash
npm run build
```

This creates the `dist/` folder with static files.

## Step 4: Configure Nginx

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/multibase
```

```nginx
server {
    server_name multibase.yourdomain.com;
    listen 80;

    # Frontend (static files)
    root /opt/multibase/dashboard/frontend/dist;
    index index.html;

    # React Router - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket for real-time updates
    location /socket.io/ {
        proxy_pass http://localhost:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

### Enable Site and SSL

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/multibase /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d multibase.yourdomain.com
```

## Step 5: Start Backend with PM2

```bash
cd /opt/multibase/dashboard/backend

# Start with PM2
pm2 start dist/server.js --name "multibase-backend"

# Save PM2 configuration
pm2 save

# Setup auto-start on reboot
pm2 startup
```

## Step 6: Verify Deployment

1. Open `https://multibase.yourdomain.com` in your browser
2. You should see the Multibase Dashboard
3. Register a new admin account
4. Test creating a Supabase instance

## Troubleshooting

### Check Logs

```bash
# PM2 logs
pm2 logs multibase-backend

# Nginx logs
sudo tail -f /var/log/nginx/error.log

# System logs
journalctl -u nginx -f
```

### Common Issues

| Issue           | Solution                                           |
| --------------- | -------------------------------------------------- |
| 502 Bad Gateway | Backend not running. Check `pm2 status`            |
| CORS errors     | Verify `CORS_ORIGIN` in `.env` matches your domain |
| SSL warnings    | Run `certbot --nginx -d yourdomain.com`            |
| WebSocket fails | Check Nginx WebSocket proxy configuration          |

## Next Steps

- [PM2 Configuration](/setup/configuration/pm2) - Advanced process management
- [GitHub Actions](/setup/deployment/github-actions) - Auto-deploy on push
