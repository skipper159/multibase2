# Split Hosting Deployment

Deploy Multibase across two servers: one for Frontend, one for Backend.

## When to Use Split Hosting

- **Scalability:** Scale frontend and backend independently
- **Security:** Isolate backend from public access
- **Performance:** Dedicated resources for each component

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│     VPS 1       │         │     VPS 2       │
│   (Frontend)    │         │    (Backend)    │
├─────────────────┤         ├─────────────────┤
│ Nginx + Static  │ ──API──▶│ Node.js + Docker│
│ Files           │         │ Supabase        │
│                 │         │ Instances       │
└─────────────────┘         └─────────────────┘
     ▲                           │
     │         HTTPS             │
     └───────── User ────────────┘
```

## VPS 1: Frontend Deployment

### Build Frontend Locally

```bash
cd dashboard/frontend

# Set API URL to backend server
echo "VITE_API_URL=https://api.multibase.yourdomain.com" > .env.production

# Build
npm run build
```

### Upload to VPS 1

```bash
# Create directory on server
ssh user@VPS1_IP "sudo mkdir -p /var/www/multibase && sudo chown $USER:$USER /var/www/multibase"

# Upload dist folder
rsync -avz dist/ user@VPS1_IP:/var/www/multibase/
```

### Nginx Configuration (VPS 1)

```bash
sudo nano /etc/nginx/sites-available/multibase
```

```nginx
server {
    server_name multibase.yourdomain.com;
    listen 80;

    root /var/www/multibase;
    index index.html;

    # React Router support
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/multibase /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d multibase.yourdomain.com
```

## VPS 2: Backend Deployment

### Setup Backend

```bash
# Clone repository
sudo mkdir -p /opt/multibase
sudo chown $USER:$USER /opt/multibase
cd /opt/multibase
git clone https://github.com/YOUR_USERNAME/multibase.git .

# Setup backend
cd dashboard/backend
npm install
cp .env.example .env
nano .env
```

### Configure `.env` (VPS 2)

```env
PORT=3001
NODE_ENV=production
DATABASE_URL="file:./data/multibase.db"
DOCKER_ACCESS_MODE=socket
DOCKER_SOCKET_PATH=/var/run/docker.sock
PROJECTS_PATH=/opt/multibase/projects

# CORS - Frontend domain
CORS_ORIGIN=https://multibase.yourdomain.com

SESSION_SECRET=your-secret-key
APP_URL=https://api.multibase.yourdomain.com
```

### Initialize and Start

```bash
npx prisma generate
npx prisma migrate deploy
npm run build

pm2 start dist/server.js --name "multibase-backend"
pm2 save
pm2 startup
```

### Nginx Configuration (VPS 2)

```bash
sudo nano /etc/nginx/sites-available/api-multibase
```

```nginx
server {
    server_name api.multibase.yourdomain.com;
    listen 80;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api-multibase /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.multibase.yourdomain.com
```

## DNS Configuration

Add these DNS records:

| Type | Name            | Value    |
| ---- | --------------- | -------- |
| A    | `multibase`     | VPS 1 IP |
| A    | `api.multibase` | VPS 2 IP |

## Verification

1. Open `https://multibase.yourdomain.com`
2. Check browser Network tab → API calls should go to `api.multibase.yourdomain.com`
3. Login and create an instance

## Next Steps

- [GitHub Actions](/setup/deployment/github-actions) - Auto-deploy both servers
