# Nginx Configuration Migration Guide

This guide explains how to migrate existing Supabase instance Nginx configurations to include authentication features.

## Background

The Multibase dashboard now supports authentication features for Supabase instances. New instances automatically get Nginx configurations with `auth_request` directives that protect access to the Studio UI and API endpoints.

However, instances created before this feature was added don't have these authentication configurations. This migration script updates existing instance Nginx configs to include the authentication layer.

## What the Migration Does

The migration script:

1. **Scans** the projects directory for existing Supabase instances
2. **Reads** each instance's `.env` file to extract port configurations
3. **Generates** updated Nginx configurations with:
   - Authentication subrequests to the dashboard backend
   - Protected Studio UI (main domain)
   - Protected API endpoint (-api subdomain)
   - Health check endpoints (without authentication for monitoring)
   - Security headers
   - Error handlers that redirect to the login page
4. **Backs up** existing configurations before updating
5. **Reloads** Nginx to apply the changes
6. **Optionally runs** Certbot to set up SSL certificates

## Prerequisites

- Root or sudo access (required for Nginx reload and Certbot)
- Nginx installed and running
- Certbot installed (if you want automatic SSL setup)
- Projects directory containing existing instances

## Usage

### Basic Migration

Run the script from the `bash` directory:

```bash
cd bash
./migrate_nginx_configs.sh
```

This will:
- Migrate all instances
- Reload Nginx
- Set up SSL certificates with Certbot

### Dry Run (Recommended First)

Preview what the script will do without making changes:

```bash
./migrate_nginx_configs.sh --dry-run
```

This is **highly recommended** before running the actual migration to verify that:
- The script finds all your instances
- The port mappings are correct
- The expected Nginx configs will be created

### Skip Nginx Reload

If you want to review the configs before reloading Nginx:

```bash
./migrate_nginx_configs.sh --skip-reload
```

Then manually reload after verification:

```bash
sudo nginx -t  # Test configuration
sudo nginx -s reload  # Reload if test passes
```

### Skip SSL Setup

If you want to handle SSL certificates manually or already have them configured:

```bash
./migrate_nginx_configs.sh --skip-ssl
```

### Custom Directories

If your projects are in a non-standard location:

```bash
./migrate_nginx_configs.sh --projects-dir /path/to/projects --nginx-dir /path/to/nginx/sites-enabled
```

### Combine Options

You can combine multiple options:

```bash
# Dry run with custom directories
./migrate_nginx_configs.sh --dry-run --projects-dir /custom/path/projects

# Migrate without SSL or reload
./migrate_nginx_configs.sh --skip-ssl --skip-reload
```

## Command Line Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be done without making changes |
| `--skip-reload` | Don't reload Nginx after updating configs |
| `--skip-ssl` | Don't run Certbot for SSL certificates |
| `--projects-dir DIR` | Custom projects directory (default: `../projects`) |
| `--nginx-dir DIR` | Custom nginx config directory (default: `../nginx/sites-enabled`) |
| `--help` | Show help message |

## What Gets Changed

### Before Migration

Existing instances might have:
- Simple proxy configurations
- No authentication
- Direct access to Studio and API

### After Migration

Each instance will have:

**Studio Domain** (`instance-name.backend.tyto-design.de`):
- Authentication required via `auth_request /auth-check`
- Redirects to login on 401/403 errors
- Security headers
- Protected Studio UI at `/`
- Protected Storage endpoint at `/storage/`
- Public health check at `/health`

**API Domain** (`instance-name-api.backend.tyto-design.de`):
- Authentication required via `auth_request /auth-check`
- Redirects to login on 401/403 errors
- Security headers
- Protected API at `/`
- Extended timeouts for API requests
- Public health check at `/health`

## Configuration Details

The generated Nginx configs will:

1. **Authenticate** all requests except `/health` endpoints
2. **Proxy** authentication to the dashboard backend at:
   - `https://backend.tyto-design.de/api/auth/verify-instance-access`
3. **Redirect** unauthorized users to:
   - `https://multibase.lafftale.online/login?redirect=...&reason=...`
4. **Forward** authenticated requests to the instance's Kong port and Studio port
5. **Set** security headers:
   - `X-Frame-Options: SAMEORIGIN`
   - `X-Content-Type-Options: nosniff`
   - `X-XSS-Protection: 1; mode=block`

## Backup and Recovery

### Automatic Backups

The script automatically backs up existing configs before updating:

```
/path/to/nginx/sites-enabled/instance-name.conf
→ /path/to/nginx/sites-enabled/instance-name.conf.backup.YYYYMMDD_HHMMSS
```

### Manual Rollback

If you need to rollback:

```bash
cd /path/to/nginx/sites-enabled
sudo cp instance-name.conf.backup.TIMESTAMP instance-name.conf
sudo nginx -t
sudo nginx -s reload
```

## Troubleshooting

### Script Can't Find Projects

**Error**: `Projects directory not found`

**Solution**: Specify the correct path:
```bash
./migrate_nginx_configs.sh --projects-dir /correct/path/to/projects
```

### Nginx Reload Fails

**Error**: `Failed to reload Nginx` or `Nginx configuration test failed`

**Solution**:
1. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
2. Test configuration: `sudo nginx -t`
3. Review the generated configs in the nginx directory
4. Fix any errors and reload manually

### Permission Denied

**Error**: Permission issues when creating configs or reloading Nginx

**Solution**:
- Run with sudo: `sudo ./migrate_nginx_configs.sh`
- Ensure your user has sudo privileges for Nginx

### Certbot Fails

**Error**: SSL certificate setup fails

**Solution**:
- Certbot failures don't stop the migration
- You can run Certbot manually later:
  ```bash
  sudo certbot --nginx -d instance.backend.tyto-design.de -d instance-api.backend.tyto-design.de
  ```
- Or skip SSL during migration: `./migrate_nginx_configs.sh --skip-ssl`

### Port Mismatch

**Problem**: Wrong ports in generated configs

**Solution**:
1. Check the `.env` file in the instance directory
2. Verify `KONG_HTTP_PORT` and `STUDIO_PORT` values
3. Update the `.env` if needed
4. Re-run the migration

## Verification

After migration, verify the setup:

### 1. Check Nginx Configuration

```bash
sudo nginx -t
```

Should output: `syntax is ok` and `test is successful`

### 2. View Generated Configs

```bash
cat /path/to/nginx/sites-enabled/instance-name.conf
```

Verify the configuration includes `auth_request` directives.

### 3. Test Instance Access

Visit your instance in a browser:
- `https://instance-name.backend.tyto-design.de`

You should be redirected to the login page if not authenticated.

### 4. Check Health Endpoints

Health checks should work without authentication:

```bash
curl https://instance-name.backend.tyto-design.de/health
# Should return: OK

curl https://instance-name-api.backend.tyto-design.de/health
# Should return: OK
```

### 5. Check Nginx Logs

Monitor for any errors:

```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## Environment Variables

The script uses these defaults (can be customized by editing the script):

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `backend.tyto-design.de` | Base domain for instances |
| `DASHBOARD_URL` | `https://multibase.lafftale.online` | Dashboard URL for redirects |
| `BACKEND_URL` | `https://backend.tyto-design.de` | Backend API URL for auth |
| `CERTBOT_EMAIL` | `notification@tyto-design.de` | Email for SSL certificates |

To customize these values, edit the script before running:

```bash
nano migrate_nginx_configs.sh
# Update the variables at the top of the script
```

## Manual Migration (Alternative)

If you prefer to migrate manually or need to migrate a single instance:

1. **Get instance details** from `.env`:
   ```bash
   cd projects/instance-name
   grep -E "KONG_HTTP_PORT|STUDIO_PORT" .env
   ```

2. **Create Nginx config**:
   ```bash
   sudo nano /etc/nginx/sites-enabled/instance-name.conf
   ```

3. **Copy the template** from the script or from a newly created instance

4. **Replace placeholders**:
   - `${instance_name}` → your instance name
   - `${kong_port}` → Kong HTTP port from .env
   - `${studio_port}` → Studio port from .env

5. **Test and reload**:
   ```bash
   sudo nginx -t
   sudo nginx -s reload
   ```

6. **Set up SSL** (optional):
   ```bash
   sudo certbot --nginx -d instance.backend.tyto-design.de -d instance-api.backend.tyto-design.de
   ```

## Support

If you encounter issues:

1. Run with `--dry-run` first to diagnose
2. Check the Nginx error logs
3. Verify project directory structure
4. Ensure all required services are running:
   - Dashboard backend (port 3001)
   - Nginx
   - Redis (for dashboard)

## Related Documentation

- [Nginx Configuration Guide](../dashboard/frontend/src/content/docs/configuration/nginx.md)
- [Instance Management](../README.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)
