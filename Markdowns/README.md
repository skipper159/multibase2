# Multibase Dashboard - Version 1.0 (Current State)

**Release Date:** December 25, 2025  
**Status:** Stable - Production Ready

---

## 🎯 Overview

Multibase Dashboard is a fully functional management system for managing multiple Supabase instances with authentication, user management, and backup/restore capabilities.

---

## ✅ Implemented Features (Version 1.0)

### 🔐 Authentication & User Management

- ✅ Session-based authentication with JWT
- ✅ Bcrypt password hashing
- ✅ Role management (Admin, User, Viewer)
- ✅ Login/Logout functionality
- ✅ Protected Routes (Frontend)
- ✅ User CRUD operations (Admin only)
- ✅ Session management with automatic expiration

### 💾 Backup & Restore

- ✅ Full backups (Database + Volumes)
- ✅ Instance-specific backups
- ✅ Database-only backups
- ✅ Restore functionality (Admin only)
- ✅ Backup list with size information
- ✅ Automatic ZIP compression

### 📊 Dashboard Features

- ✅ Real-time monitoring of all instances
- ✅ Health checks for services
- ✅ Metrics collection (CPU, RAM, etc.)
- ✅ Log Viewer
- ✅ Alert System
- ✅ WebSocket for live updates
- ✅ Docker Container management

---

## 🏗️ Architecture

```
dashboard/
├── backend/          # Node.js + Express + TypeScript API
│   ├── src/
│   │   ├── services/     # Core services (Docker, Instance, Health, Metrics)
│   │   ├── routes/       # REST API endpoints
│   │   ├── utils/        # Utilities (logger, env parser, key generator)
│   │   └── server.ts     # Main Express + Socket.io server
│   └── prisma/           # SQLite database schema
│
└── frontend/         # React 19.2 + Vite + TypeScript
    └── src/
        ├── components/   # UI components
        ├── pages/        # Page components
        ├── hooks/        # Custom React hooks
        └── lib/          # API client & utilities
```

---

## 💻 Tech Stack

### Backend

- **Node.js 20+** with TypeScript
- **Express** - REST API framework
- **Socket.io** - Real-time WebSocket communication
- **Prisma** + **SQLite** - Database ORM and storage
- **Redis** - Caching layer
- **dockerode** - Docker API integration

### Frontend

- **React 19.2** with TypeScript
- **Vite** - Build tool and dev server
- **TailwindCSS** + **shadcn/ui** - Styling and components
- **Recharts** - Data visualization
- **React Query** - Data fetching and caching
- **Socket.io-client** - Real-time updates

---

## 📋 System Requirements

- **Node.js 20+** and npm/yarn
- **Docker** and Docker Compose
- **Redis** (can run in Docker)
- **Git**

---

## 🚀 Installation & Start

### Quick Start (Development)

#### Windows

```powershell
# Navigate to dashboard directory
cd C:\path\to\multibase\dashboard

# Run the PowerShell launcher
.\start.ps1
```

#### Linux/macOS

```bash
# Navigate to dashboard directory
cd /path/to/multibase/dashboard

# Run the launcher
./launch.sh
```

The start script checks:

- ✅ Node.js 20+ present
- ✅ Docker running
- ✅ Redis available
- ✅ Installs dependencies
- ✅ Starts Backend & Frontend

---

## 📁 Database Structure (Prisma)

### User Model

```prisma
model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  password  String
  role      String   @default("user") // "admin", "user", "viewer"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Backup Model

```prisma
model Backup {
  id           Int      @id @default(autoincrement())
  instanceName String
  type         String   // "full", "database"
  path         String
  size         BigInt?
  createdAt    DateTime @default(now())
}
```

---

## 🔌 API Endpoints

### Authentication

- `POST /api/auth/login` - User Login
- `POST /api/auth/logout` - User Logout
- `GET /api/auth/me` - Current Session

### Users (Admin only)

- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Instances

- `GET /api/instances` - All instances
- `POST /api/instances` - Create new instance
- `PUT /api/instances/:name/start` - Start instance
- `PUT /api/instances/:name/stop` - Stop instance
- `DELETE /api/instances/:name` - Delete instance

### Health & Metrics

- `GET /api/instances/:name/health` - Health status
- `GET /api/instances/:name/metrics` - Metrics
- `GET /api/instances/:name/logs` - Logs

### Backups (Admin only)

- `GET /api/backups` - Backup list
- `POST /api/backups` - Create backup
- `POST /api/backups/:id/restore` - Restore backup

---

## 🔒 Security

### Implemented in v1.0

- ✅ Bcrypt password hashing
- ✅ JWT Session Tokens
- ✅ Role-Based Access Control (RBAC)
- ✅ Protected API Routes
- ✅ CORS Configuration
- ✅ Input Validation

---

## 📊 Monitoring & Logs

### Health Checks

- Database Service Status
- API Service Status
- Realtime Service Status
- Storage Service Status
- Auth Service Status

### Metrics

- CPU Usage per Container
- RAM Usage
- Disk I/O
- Network Traffic
- Container Status (running/stopped/error)

### Logs

- Container Logs (stdout/stderr)
- Backend API Logs
- Error Logs
- Access Logs

---

## 🌐 WebSocket Events

### Client → Server

- `subscribe:instance` - Register for instance updates
- `unsubscribe:instance` - Unsubscribe from instance updates

### Server → Client

- `health:update` - Health status update
- `metrics:update` - Metrics update
- `alert` - New alert message

---

## 📦 Backup Types

1. **Full Backup**: Database + all volumes (api, db, storage, functions, logs)
2. **Database Only**: PostgreSQL database dump only

### Backup Structure

```
backups/
└── {instance-name}/
    └── backup_{timestamp}.zip
        ├── db/           # PostgreSQL Dump
        ├── api/          # Kong Config
        ├── storage/      # S3-compatible files
        ├── functions/    # Edge Functions
        └── logs/         # Vector Logs
```

---

## 🎨 Frontend Components

### Pages

- **Dashboard** - Overview of all instances
- **Instance Details** - Detailed instance view with Health/Metrics/Logs
- **Backups** - Backup management
- **Users** - User management (Admin)
- **Login** - Authentication

### Components

- **InstanceCard** - Instance card with status
- **HealthStatus** - Service health display
- **MetricsChart** - Recharts-based visualization
- **LogViewer** - Scrollable log display
- **BackupManager** - Backup create/restore
- **UserManagement** - User CRUD

---

## 🐛 Known Limitations (v1.0)

1. **Backup**: No automatic/scheduled backups
2. **Alerts**: No email/webhook notifications
3. **Monitoring**: No long-term metrics storage
4. **Multi-Tenancy**: No team/organization separation
5. **Rate Limiting**: Not yet implemented
6. **Input Validation**: Basic validation, no Zod yet

---

## 🔄 Next Steps

See [Readme1_1_feature.md](./Readme1_1_feature.md) for planned features in Version 1.1.

---

## 📝 License

See [LICENSE](../LICENSE) in the root directory.

---

## 👥 Support & Documentation

Additional Documentation:

- [Deployment Guide](../dashboard/DEPLOYMENT.md)
- [Production Deployment](../dashboard/Production_deployment.md)
- [Quick Reference](../dashboard/QUICK_REFERENCE.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)
