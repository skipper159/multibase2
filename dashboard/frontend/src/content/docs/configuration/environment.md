# Environment Configuration

Complete reference for all environment variables in Multibase.

## Backend `.env` File

Location: `dashboard/backend/.env`

### Server Settings

| Variable   | Default       | Description                                |
| ---------- | ------------- | ------------------------------------------ |
| `PORT`     | `3001`        | API server port                            |
| `NODE_ENV` | `development` | Environment: `development` or `production` |

### Database

| Variable       | Default                    | Description          |
| -------------- | -------------------------- | -------------------- |
| `DATABASE_URL` | `file:./data/multibase.db` | SQLite database path |

### Docker

| Variable             | Default            | Description                                                                 |
| -------------------- | ------------------ | --------------------------------------------------------------------------- |
| `DOCKER_ACCESS_MODE` | `socket`           | Direct local Docker socket access; TCP proxy endpoints are not supported    |
| `DOCKER_SOCKET_PATH` | (platform default) | Filesystem path of the Unix socket or Windows Docker Desktop named pipe     |

**Values by OS:**

- **Linux:** `/var/run/docker.sock`
- **Windows:** `//./pipe/docker_engine`
- **macOS:** `/var/run/docker.sock`

> **Security:** Membership in the Linux `docker` group grants effective root-level host control. The installer therefore assigns it only to the dedicated `multibase` service user, verifies the direct socket and `docker exec`, and never exposes the socket over TCP. Keep the backend API admin-protected and do not add interactive users to the `docker` group unnecessarily.

### Paths

| Variable        | Default          | Description                         |
| --------------- | ---------------- | ----------------------------------- |
| `PROJECTS_PATH` | `../../projects` | Where Supabase instances are stored |

### Security

| Variable         | Required | Description                                                         |
| ---------------- | -------- | ------------------------------------------------------------------- |
| `SESSION_SECRET` | Yes      | Random string (min 32 chars) for session encryption                 |
| `CORS_ORIGIN`    | Yes      | Allowed origins (comma-separated)                                   |
| `COOKIE_DOMAIN`  | No       | Cookie domain for cross-subdomain auth (e.g., `.yourdomain.com`)    |

### SMTP (Email)

| Variable    | Default | Description          |
| ----------- | ------- | -------------------- |
| `SMTP_HOST` | -       | SMTP server hostname |
| `SMTP_PORT` | `587`   | SMTP port            |
| `SMTP_USER` | -       | SMTP username        |
| `SMTP_PASS` | -       | SMTP password        |
| `SMTP_FROM` | -       | "From" address       |

### Application

| Variable  | Default | Description                  |
| --------- | ------- | ---------------------------- |
| `APP_URL` | -       | Public URL (for email links) |

### Intervals

| Variable                | Default | Description                      |
| ----------------------- | ------- | -------------------------------- |
| `METRICS_INTERVAL`      | `15000` | Metrics collection interval (ms) |
| `HEALTH_CHECK_INTERVAL` | `10000` | Health check interval (ms)       |
| `ALERT_CHECK_INTERVAL`  | `60000` | Alert evaluation interval (ms)   |

## Example Production `.env`

```env
# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL="file:./data/multibase.db"

# Docker
DOCKER_ACCESS_MODE=socket
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Projects
PROJECTS_PATH=/opt/multibase/projects

# Security
SESSION_SECRET=your-very-long-random-string-minimum-32-characters
CORS_ORIGIN=https://multibase.yourdomain.com
COOKIE_DOMAIN=.yourdomain.com

# SMTP
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.yourdomain.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Multibase" <noreply@yourdomain.com>

# App URL
APP_URL=https://multibase.yourdomain.com
```

## Frontend `.env.production`

Location: `dashboard/frontend/.env.production`

| Variable       | Description     |
| -------------- | --------------- |
| `VITE_API_URL` | Backend API URL |

```env
VITE_API_URL=https://multibase.yourdomain.com/api
```

## Generating a Session Secret

```bash
# Using openssl
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Cookie Domain Configuration

The `COOKIE_DOMAIN` variable enables cross-subdomain authentication, which is essential for accessing Supabase instances.

### How It Works

When you create Supabase instances, each instance gets its own subdomain:
- Dashboard: `multibase.yourdomain.com`
- Instance 1: `instance1.yourdomain.com`
- Instance 2: `instance2.yourdomain.com`

Setting `COOKIE_DOMAIN=.yourdomain.com` (note the leading dot) allows the authentication cookie to work across all subdomains.

### Configuration Examples

**Production (with custom domain):**
```env
COOKIE_DOMAIN=.yourdomain.com
```

**Development (localhost):**
```env
# Leave unset or comment out for localhost
# COOKIE_DOMAIN=
```

### Troubleshooting

If you experience authentication issues where you're redirected to the login page when accessing instances:

1. Verify `COOKIE_DOMAIN` is set in your production `.env` file
2. Ensure it starts with a dot (`.yourdomain.com`)
3. Restart the backend service after changing the environment variable
4. Clear your browser cookies and try logging in again

## Next Steps

- [Nginx Configuration](/setup/configuration/nginx)
- [PM2 Configuration](/setup/configuration/pm2)
