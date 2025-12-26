# Multibase Dashboard - Deployment Scripts

This directory contains automated scripts for deploying and managing the Multibase Dashboard on a Linux server.

## Scripts

| Script         | Description                                               |
| -------------- | --------------------------------------------------------- |
| `install.sh`   | Automated installation script (out-of-the-box deployment) |
| `uninstall.sh` | Clean uninstallation script                               |

## Quick Start

### One-Line Installation

```bash
# Download and run the installer
curl -sSL https://raw.githubusercontent.com/your-org/multibase/main/deployment/install.sh | sudo bash
```

### Manual Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/multibase.git /opt/multibase
cd /opt/multibase/deployment

# 2. Make scripts executable
chmod +x install.sh uninstall.sh

# 3. Run installer
sudo ./install.sh
```

## What the Installer Does

1. **Pre-Flight Checks**

   - Verifies OS compatibility (Ubuntu/Debian)
   - Checks available memory and disk space
   - Prompts for domain name

2. **Installs Dependencies**

   - Node.js 20
   - Docker + Docker Compose
   - PostgreSQL
   - Redis
   - Nginx
   - Certbot (Let's Encrypt)

3. **Creates User & Directories**

   - Creates `multibase` system user
   - Sets up `/opt/multibase` directory structure

4. **Database Setup**

   - Creates PostgreSQL database and user
   - Generates secure credentials

5. **Builds Application**

   - Installs npm dependencies
   - Compiles TypeScript backend
   - Builds React frontend
   - Runs database migrations

6. **Configures Services**

   - Sets up Nginx reverse proxy with WebSocket support
   - Creates systemd service for backend
   - Obtains SSL certificate from Let's Encrypt

7. **Creates Admin User**
   - Generates secure admin password
   - Creates initial admin account

## Requirements

- **OS**: Ubuntu 20.04+, Debian 11+
- **RAM**: 4GB+ recommended
- **Disk**: 20GB+ available
- **Domain**: Pointing to server IP
- **Ports**: 80, 443 open

## Post-Installation

After installation, you can:

1. **Access the dashboard**: `https://your-domain.com`
2. **View logs**: `journalctl -u multibase-backend -f`
3. **Restart backend**: `systemctl restart multibase-backend`
4. **Check status**: `systemctl status multibase-backend`

## Uninstallation

```bash
# Full uninstall (removes everything including data)
sudo ./uninstall.sh

# Keep data but remove services
sudo ./uninstall.sh --keep-data
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
journalctl -u multibase-backend -n 100

# Verify database connection
sudo -u postgres psql -c "\l" | grep multibase

# Test Docker
docker ps
```

### SSL certificate issues

```bash
# Re-run Certbot
sudo certbot --nginx -d your-domain.com

# Check Certbot logs
sudo cat /var/log/letsencrypt/letsencrypt.log
```

### Permission issues

```bash
# Fix ownership
sudo chown -R multibase:multibase /opt/multibase

# Fix Docker permissions
sudo usermod -aG docker multibase
```

## Configuration

Configuration files are located at:

| File                                            | Purpose                |
| ----------------------------------------------- | ---------------------- |
| `/opt/multibase/dashboard/backend/.env`         | Backend configuration  |
| `/opt/multibase/dashboard/frontend/.env`        | Frontend configuration |
| `/etc/nginx/sites-available/multibase`          | Nginx configuration    |
| `/etc/systemd/system/multibase-backend.service` | Systemd service        |

## Updating

To update to a new version:

```bash
cd /opt/multibase
git pull origin main
cd dashboard/backend && npm ci && npm run build && npx prisma migrate deploy
cd ../frontend && npm ci && npm run build
sudo systemctl restart multibase-backend
```

## Support

For issues and questions:

- Check the logs first: `journalctl -u multibase-backend -f`
- Verify all services are running
- Check disk space and memory usage
