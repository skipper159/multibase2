# Multibase Dashboard - Version 1.1 Features

**Release:** Q1 2026 (Planned)  
**Status:** In Development 🚧

---

## � Roadmap v1.1 - At a Glance

| Feature          | Status      | Priority | Description                                |
| ---------------- | ----------- | -------- | ------------------------------------------ |
| **User Mgmt**    | ✅ Done     | High     | Roles, Profiles, 2FA, Sessions             |
| **Alert System** | ✅ Done     | High     | Rule Engine, Notifications (Email/Webhook) |
| **Backups**      | ✅ Done     | High     | Schedules, Restore, Retention              |
| **Security**     | ✅ Done     | High     | Rate Limiting, Zod Validation, Audits      |
| **Monitoring**   | ✅ Done     | Medium   | Health Check API, Deep Audit Logging       |
| **Templates**    | ✅ Done     | Medium   | Instance Presets & Blueprints              |
| **API Keys**     | ✅ Done     | Medium   | External Access Management                 |
| **Deployment**   | ✅ Done     | Medium   | Production Setup, Nginx, Systemd           |
| **Migrations**   | ✅ Done     | Low      | DB Migration GUI                           |
| **SMTP**         | ✅ Done     | High     | Email Configuration (Global/Instance)      |
| **CI/CD**        | ⏸️ Optional | Low      | Webhooks & Deployment Triggers             |

---

## 📝 Detailed Feature Specification

This section describes every feature in technical detail, including API endpoints and database models.

### 1. 👥 User Management

Comprehensive user administration system.

**Features:**

- **Extended Roles:** Support for `Super Admin`, `Admin`, `User`, `Viewer`, `Guest`.
- **User Profiles:**
  - Avatar Upload (JPG/PNG, max 2MB).
  - Bio and Contact Info.
  - Password Change & Reset flows.
- **Security:**
  - **2FA (Two-Factor Authentication):** TOTP based (Google Authenticator).
  - **Session Management:** View active sessions (IP, User Agent) and revoke them.
  - **Email Verification:** Require email confirmation on signup.

**Technical Details:**

- **Models:** `User` (extended), `Session` (new).
- **Endpoints:**
  - `POST /api/users/:id/avatar`
  - `POST /api/users/:id/2fa/enable`
  - `GET /api/users/:id/sessions`

---

### 2. 🔔 Alert System

Proactive monitoring and notification engine.

**Features:**

- **Rule Engine:** Define alerts based on CPU %, RAM %, Disk Usage %, or Service Health (Down).
- **Notification Channels:**
  - **Browser Push:** In-app notifications.
  - **Email:** Via SMTP (Admin/User emails).
  - **Webhook:** Generic POST request to Slack/Discord/Teams.
- **Management:**
  - Enable/Disable rules.
  - Set thresholds and duration (e.g., "CPU > 90% for 5 mins").
  - Alert History/Log.

**Technical Details:**

- **Models:** `AlertRule`, `AlertNotification`, `AlertChannel`.
- **Endpoints:**
  - `POST /api/alerts/rules`
  - `POST /api/alerts/test`

---

### 3. 💾 Backup System (Extended)

Robust disaster recovery.

**Features:**

- **Scheduled Backups:** Cron-like scheduling (Daily, Weekly @ Time).
- **Retention Policy:** Auto-delete old backups (e.g., "Keep last 7 days").
- **Restore:**
  - One-click restore for Database dumps.
  - Full instance restore (Volumes + DB).
- **Storage:** Support for local disk and S3-compatible targets.

**Technical Details:**

- **Models:** `BackupSchedule`, `BackupPolicy`.
- **Endpoints:**
  - `POST /api/backups/schedule`
  - `POST /api/backups/:id/restore`

---

### 4. 🔒 Security & Stability

Hardening the application for production.

**Features:**

- **Rate Limiting:** Protect API from DOS attacks (Tokens bucket algorithm).
- **Input Validation:** Strict `Zod` schema validation for all API inputs.
- **Sanitization:** Prevent XSS and SQL Injection (via Prisma).

**Technical Details:**

- **Middleware:** `rateLimitMiddleware`, `validateRequest(schema)`.

---

### 5. � Monitoring & Ops

Deep visibility into system actions.

**Features:**

- **Audit Logging:** Track _who_ did _what_ and _when_.
  - Log every sensitive action (Create Instance, Delete User, Change Settings).
  - Searchable UI for Audit Logs.
- **Health Check Endpoint:** Public `/health` endpoint for external load balancers.

**Technical Details:**

- **Models:** `AuditLog` (action, resource, userId, meta).
- **Endpoints:**
  - `GET /api/audit-logs`

---

### 6. 🚀 Production Deployment

Infrastructure as Code and setup scripts.

**Features:**

- **Nginx Config:** Reverse proxy template with WebSocket support.
- **Systemd Service:** `multibase.service` file for auto-start.
- **SSL/TLS:** Integration guide for Certbot/Let's Encrypt.
- **PostgreSQL Migration:** Scripts to move from SQLite (Dev) to Postgres (Prod).

---

### 7. � Instance Templates

Reusability for Supabase instances.

**Features:**

- **Presets:** "Small", "Medium", "Large" resource configs.
- **Blueprints:** Pre-installed extensions or schemas (e.g., "SaaS Starter", "E-Commerce").
- **Management:** Create, Edit, Delete templates from dashboard.

**Technical Details:**

- **Models:** `InstanceTemplate` (json config).

---

### 8. 🔑 API Key Management

External access control.

**Features:**

- **Key Generation:** Secure random keys for 3rd party scripts.
- **Scopes:** Read-Only vs. Full Access.
- **Usage Stats:** Track "Last Used" and "Request Count".
- **Revocation:** Invalidate leaked keys instantly.

**Technical Details:**

- **Models:** `ApiKey`.
- **Endpoints:**
  - `POST /api/keys`
  - `DELETE /api/keys/:id`

---

### 9. 🗄️ Database Migrations

Manage internal database changes.

**Features:**

- **Migration UI:** View history of applied migrations.
- **Execution:** Run `prisma migrate deploy` from UI.
- **Rollback:** (Experimental) Down-migrations.

---

### 10. 🔄 CI/CD Integration (Optional ⏸️)

_Status: Paused / Optional_

**Features:**

- **Webhooks:** Trigger "Pull & Restart" via URL.
- **Deployment Logs:** View CI/CD output in dashboard.

---

### 11. � SMTP Configuration

Email infrastructure.

**Features:**

- **Global SMTP:** Default server for system alerts.
- **Instance Override:** Allow specific instances to use their own SMTP.
- **Test:** "Send Test Email" button.

**Technical Details:**

- **Models:** `GlobalSettings`.
- **Endpoints:**
  - `POST /api/settings/smtp/test`

---

## 🔮 Roadmap v1.2 - Future Sneak Peek

Planned for Q2-Q3 2026.

- **🏢 Multi-Tenancy:** Teams & Organizations.
- **💰 Billing:** Cost tracking & Invoicing.
- **📈 Advanced Metrics:** Grafana & Prometheus integration.
- **📸 Snapshots:** Instant instance cloning.

See [Readme1_2_Feature.md](./Readme1_2_Feature.md) for details.
