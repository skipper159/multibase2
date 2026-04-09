# Scripts Reference

All operational scripts for managing Multibase in production and development.

> The old dev helper scripts (`launch.sh`, `stop.sh`, `status.sh`, `start.ps1`) have been archived. Production runs via **PM2 + Nginx**, local dev via `npm run dev`.

---

## 🏗️ setup_shared.py

Initialise and manage the Shared Infrastructure stack.

```bash
python setup_shared.py init           # First-time setup
python setup_shared.py init --force   # Force reinit
python setup_shared.py start          # Start shared stack
python setup_shared.py stop           # Stop shared stack
python setup_shared.py status         # Status of all 8 services
python setup_shared.py create-db <name>  # Create tenant DB
python setup_shared.py drop-db <name>    # Drop tenant DB
python setup_shared.py list-dbs          # List all tenant DBs
```

---

## 🐍 supabase_manager.py

CLI for tenant project lifecycle management.

```bash
# Shared infrastructure
python supabase_manager.py shared-start
python supabase_manager.py shared-stop
python supabase_manager.py shared-status

# Tenant projects
python supabase_manager.py create <name> [--base-port 8100]
python supabase_manager.py start <name>
python supabase_manager.py stop <name> [--keep-volumes]
python supabase_manager.py reset <name>
python supabase_manager.py status <name>
python supabase_manager.py list
```

---

## 🚀 deployment/install.sh

Fully automated production install on Ubuntu/Debian VPS:

```bash
curl -sSL https://raw.githubusercontent.com/skipper159/multibase2/main/deployment/install.sh | sudo bash
```

Installs Node.js, Docker, PM2, Nginx, Certbot — configures everything end-to-end.

---

## 🗑️ deployment/uninstall.sh

Complete removal from the server:

```bash
sudo bash deployment/uninstall.sh
```

---

## 🩹 shared/studio-patches/apply-patches.sh

Applies multi-tenant patches to the Studio container. Runs automatically during `setup_shared.py init`.

---

## 🛠️ Common Maintenance Commands

```bash
# PM2 (backend)
pm2 list
pm2 logs multibase-backend
pm2 restart multibase-backend

# Docker Compose (shared stack)
docker compose -f shared/docker-compose.shared.yml --env-file shared/.env.shared --project-name multibase-shared up -d

# Prisma (database)
cd dashboard/backend && npx prisma migrate deploy

# Local development
cd dashboard/backend && npm run dev    # Terminal 1
cd dashboard/frontend && npm run dev  # Terminal 2
```

---

*Alte Scripts (launch.sh, stop.sh, status.sh, start.ps1) → `_ARCHIVE/`*
**Purpose**: Start all services in the correct order with health checks and validation.

**Usage**:
```bash
./launch.sh [OPTIONS]
```

**Options**:
- `--skip-redis`: Don't start/check Redis container (assume it's already running)
- `--force-ports`: Automatically kill processes using required ports
- `--production`: Build and run production versions (compiled)
- `--build`: Force rebuild before starting
- `--help`: Show help message

**What it does**:
1. ✅ Pre-flight checks (Node.js, Docker, npm)
2. ✅ Verify/install dependencies (node_modules, Prisma)
3. ✅ Start Redis container (if not running)
4. ✅ Start backend API (port 3001)
5. ✅ Wait for backend health check
6. ✅ Start frontend dev server (port 5173)
7. ✅ Wait for frontend readiness
8. ✅ Display status and access URLs

**PID Management**:
- Stores PIDs in `.pids/backend.pid` and `.pids/frontend.pid`
- Enables reliable process tracking for shutdown

---

### 🛑 stop.sh
**Purpose**: Gracefully shutdown all services with proper cleanup.

**Usage**:
```bash
./stop.sh [OPTIONS]
```

**Options**:
- `--force`: Use SIGKILL immediately (no graceful shutdown)
- `--stop-redis`: Also stop the Redis container
- `--cleanup-redis`: Stop and remove Redis container
- `--help`: Show help message

**What it does**:
1. ✅ Find processes via PID files (fallback to port/name search)
2. ✅ Send SIGTERM to frontend (5s graceful timeout)
3. ✅ Send SIGTERM to backend (10s graceful timeout with built-in handlers)
4. ✅ Force SIGKILL if processes don't stop
5. ✅ Optionally stop/remove Redis container
6. ✅ Clean up PID files
7. ✅ Verify ports are freed
8. ✅ Check for orphaned processes

**Graceful Shutdown**:
- Frontend: 5 second timeout
- Backend: 10 second timeout (backend has built-in graceful shutdown)
- Automatic SIGKILL fallback if needed

---

### 📊 status.sh
**Purpose**: Quick status overview of all services.

**Usage**:
```bash
./status.sh
```

**What it shows**:
- ✅ Service status (Redis, Backend, Frontend)
- ✅ Process IDs and ports
- ✅ Backend health check results
- ✅ Port usage (in use vs available)
- ✅ Supabase instance summary (count, health)
- ✅ Individual instance details
- ✅ Access URLs
- ✅ Useful commands

**No options needed** - just run it anytime to see current status.

---

### 🔄 migrate_nginx_configs.sh
**Purpose**: Migrate existing Supabase instance Nginx configurations to include authentication features.

**Usage**:
```bash
cd ../bash
./migrate_nginx_configs.sh [OPTIONS]
```

**Options**:
- `--dry-run`: Show what would be done without making changes
- `--skip-reload`: Don't reload Nginx after updating configs
- `--skip-ssl`: Don't run Certbot for SSL certificates
- `--projects-dir DIR`: Custom projects directory (default: ../projects)
- `--nginx-dir DIR`: Custom nginx config directory (default: ../nginx/sites-enabled)
- `--help`: Show help message

**What it does**:
1. ✅ Scan projects directory for existing instances
2. ✅ Read instance configuration from .env files
3. ✅ Generate updated Nginx configs with authentication
4. ✅ Backup existing configs before updating
5. ✅ Reload Nginx to apply changes
6. ✅ Optionally run Certbot for SSL certificates

**When to use**:
- After upgrading to a version with authentication features
- To add authentication to instances created before auth was available
- To regenerate Nginx configs for existing instances

**Documentation**: See [NGINX_MIGRATION.md](../docs/NGINX_MIGRATION.md) for detailed guide.

---

## Common Workflows

### First Time Setup
```bash
# Start everything from scratch
./launch.sh

# Check status
./status.sh
```

### Daily Development
```bash
# Start services
./launch.sh --skip-redis

# Work on your code...

# Check status anytime
./status.sh

# Stop services when done
./stop.sh
```

### Handling Port Conflicts
```bash
# If ports are already in use
./launch.sh --force-ports

# Or manually stop first
./stop.sh --force
./launch.sh
```

### Production Deployment
```bash
# Build and run production versions
./launch.sh --production --build

# Stop everything including Redis
./stop.sh --stop-redis
```

### Clean Restart
```bash
# Force stop everything
./stop.sh --force

# Start fresh
./launch.sh --force-ports
```

### Full Cleanup
```bash
# Stop and remove everything
./stop.sh --cleanup-redis --force

# Start from scratch
./launch.sh
```

---

## Service Dependencies

```
Redis Container (port 6379)
    ↓ required by
Backend API (port 3001)
    ↓ proxied by
Frontend Dev Server (port 5173)
```

**Startup Order**:
1. Redis (first)
2. Backend (waits for Redis)
3. Frontend (waits for Backend)

**Shutdown Order**:
1. Frontend (first)
2. Backend (graceful shutdown with 10s timeout)
3. Redis (optional, only with `--stop-redis`)

---

## Health Checks

### Backend Health
```bash
curl http://localhost:3001/api/ping
# Expected: {"status":"ok","services":{"docker":true,"redis":true}}
```

### Frontend Health
```bash
curl http://localhost:5173/
# Expected: HTML page with <!DOCTYPE html>
```

### Redis Health
```bash
docker ps --filter "name=multibase-redis"
redis-cli -h localhost -p 6379 ping
# Expected: PONG
```

---

## Troubleshooting

### Services Won't Start

**Check logs**:
```bash
# Backend logs
tail -f backend/logs/backend.log

# Frontend logs
tail -f frontend/logs/frontend.log
```

**Check ports**:
```bash
# See what's using ports
ss -tlnp | grep -E ":(3001|5173|6379)"
```

**Force clean restart**:
```bash
./stop.sh --force
./launch.sh --force-ports
```

### PID Files Out of Sync

If services are running but scripts can't find them:

```bash
# Remove stale PID files
rm -rf .pids/*.pid

# Stop will now search by port/name
./stop.sh

# Start fresh
./launch.sh
```

### Port Already in Use

**Option 1: Use force flag**
```bash
./launch.sh --force-ports
```

**Option 2: Manual cleanup**
```bash
# Find process on port 3001
fuser 3001/tcp

# Kill it
fuser -k 3001/tcp
```

### Redis Container Issues

**Check container status**:
```bash
docker ps -a --filter "name=multibase-redis"
```

**Restart Redis**:
```bash
docker restart multibase-redis
```

**Remove and recreate**:
```bash
./stop.sh --cleanup-redis
./launch.sh
```

### Orphaned Processes

**Find dashboard processes**:
```bash
pgrep -af "tsx|vite|node.*server"
```

**Kill all**:
```bash
pkill -f "tsx.*server.ts"
pkill -f "vite.*dev"
```

---

## Directory Structure

```
dashboard/
├── launch.sh           # Start script
├── stop.sh             # Stop script
├── status.sh           # Status check script
├── .pids/              # PID files directory
│   ├── backend.pid     # Backend process ID
│   └── frontend.pid    # Frontend process ID
├── backend/
│   └── logs/
│       ├── backend.log     # Backend output
│       ├── combined.log    # Winston logs
│       └── error.log       # Winston errors
└── frontend/
    └── logs/
        └── frontend.log    # Frontend output
```

---

## Script Features

### ✅ Implemented Features

**launch.sh**:
- Pre-flight system checks
- Dependency validation
- Automatic dependency installation
- Redis container management
- Port conflict detection
- Graceful port cleanup (with --force-ports)
- Health check polling
- PID tracking
- Color-coded status output
- Production build support
- Comprehensive error handling

**stop.sh**:
- PID file-based process discovery
- Fallback to port/name-based discovery
- Graceful SIGTERM shutdown
- Configurable timeouts
- Force SIGKILL fallback
- Redis container management
- Port cleanup verification
- Orphaned process detection
- Clean PID file removal
- Status summary

**status.sh**:
- Real-time service status
- Process information
- API health checks
- Port usage display
- Instance count and health
- Detailed instance list
- Access URLs
- Quick command reference

---

## Exit Codes

**launch.sh**:
- `0`: Success - all services started
- `1`: Failure - check error output

**stop.sh**:
- `0`: Success - all services stopped
- Non-zero values indicate partial failures

**status.sh**:
- `0`: Always (information only)

---

## Environment Requirements

- **Node.js**: 20+ (checked by launch.sh)
- **Docker**: Running daemon (checked)
- **npm**: Available (checked)
- **Redis**: Optional (can skip with --skip-redis)
- **Ports**: 3001, 5173, 6379 (checked and cleaned if needed)

---

## Best Practices

1. **Always check status first**:
   ```bash
   ./status.sh
   ```

2. **Use --skip-redis during development**:
   ```bash
   ./launch.sh --skip-redis
   ```

3. **Check logs if services fail**:
   ```bash
   tail -f backend/logs/backend.log
   ```

4. **Clean shutdown before restart**:
   ```bash
   ./stop.sh && ./launch.sh
   ```

5. **Use --force-ports for quick restarts**:
   ```bash
   ./launch.sh --force-ports
   ```

---

## Access URLs

Once services are running:

- **Dashboard**: http://localhost:5173
- **API**: http://localhost:3001/api/ping
- **Nginx** (production): http://mission.smartpi.ai

---

## Support

For issues:
1. Check `./status.sh` output
2. Review logs in `backend/logs/` and `frontend/logs/`
3. Try `./stop.sh --force && ./launch.sh --force-ports`
4. Check Docker with `docker ps -a`

---

**Built for Multibase Dashboard** - Comprehensive Supabase Instance Management
