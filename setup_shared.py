#!/usr/bin/env python3
"""
Multibase Cloud Version - Shared Infrastructure Setup

Dieses Script initialisiert die Shared Infrastructure:
1. Generiert sichere Secrets (JWT, Passwörter, API-Keys)
2. Schreibt die .env.shared Datei
3. Startet den Shared-Stack (optional)
4. Erstellt Projekt-Datenbanken im Shared PostgreSQL

Usage:
    python setup_shared.py init          # Erstmalige Einrichtung
    python setup_shared.py create-db <name>  # Neue Projekt-DB erstellen
    python setup_shared.py drop-db <name>    # Projekt-DB löschen
    python setup_shared.py list-dbs          # Alle Projekt-DBs auflisten
    python setup_shared.py status            # Status der Shared Services
"""

import io
import os
import sys
import argparse
import subprocess
import random
import string
import json
import time
import hmac
import hashlib
import base64
from pathlib import Path

# Ensure stdout/stderr use UTF-8 on Windows (needed for emoji output)
if isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if isinstance(sys.stderr, io.TextIOWrapper):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def generate_random_string(length, chars=None):
    """Generate a random string of specified length."""
    if chars is None:
        chars = string.ascii_letters + string.digits
    return ''.join(random.choices(chars, k=length))


def generate_jwt_token(secret, role):
    """Generate a JWT token signed with the given secret."""
    header = {'alg': 'HS256', 'typ': 'JWT'}
    now = int(time.time())
    payload = {
        'role': role,
        'iss': 'supabase',
        'iat': now,
        'exp': now + (10 * 365 * 24 * 60 * 60)  # 10 years
    }
    
    def base64url_encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')
    
    # Use compact separators to avoid spaces in base64-encoded header/payload
    header_b64 = base64url_encode(json.dumps(header, separators=(',', ':')).encode())
    payload_b64 = base64url_encode(json.dumps(payload, separators=(',', ':')).encode())
    
    message = f'{header_b64}.{payload_b64}'
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)
    
    return f'{header_b64}.{payload_b64}.{signature_b64}'


def write_with_unix_newlines(path, content):
    """Write file with Unix line endings (LF)."""
    content = content.replace('\r\n', '\n')
    Path(path).write_bytes(content.encode('utf-8'))


class SharedInfraManager:
    """Manager für die Shared Infrastructure."""
    
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.shared_dir = self.base_dir / "shared"
        self.env_file = self.shared_dir / ".env.shared"
        self.compose_file = self.shared_dir / "docker-compose.shared.yml"
    
    def init(self, force=False):
        """Initialize shared infrastructure with generated secrets."""
        if self.env_file.exists() and not force:
            print(f"⚠️  .env.shared existiert bereits. Verwende --force zum Überschreiben.")
            return False
        
        print("🔧 Generiere Shared Infrastructure Secrets...")
        
        # Generate all secrets
        postgres_password = generate_random_string(32)
        jwt_secret = generate_random_string(48)
        secret_key_base = generate_random_string(64)
        pg_meta_crypto_key = generate_random_string(64)
        vault_enc_key = generate_random_string(32)
        logflare_key = generate_random_string(32)
        dashboard_password = generate_random_string(24)
        
        # Generate JWT tokens
        anon_key = generate_jwt_token(jwt_secret, 'anon')
        service_role_key = generate_jwt_token(jwt_secret, 'service_role')
        
        env_content = f"""############################################################
# Multibase Cloud Version - Shared Infrastructure Config
# AUTO-GENERIERT am {time.strftime('%Y-%m-%d %H:%M:%S')}
# ⚠️  NICHT MANUELL BEARBEITEN - Secrets sind automatisch generiert
############################################################

############
# Shared PostgreSQL
############
SHARED_POSTGRES_PASSWORD={postgres_password}
SHARED_PG_PORT=5432
SHARED_JWT_SECRET={jwt_secret}
SHARED_JWT_EXPIRY=3600

############
# Shared Keys
############
SHARED_ANON_KEY={anon_key}
SHARED_SERVICE_ROLE_KEY={service_role_key}
SHARED_PG_META_CRYPTO_KEY={pg_meta_crypto_key}
SHARED_SECRET_KEY_BASE={secret_key_base}
SHARED_VAULT_ENC_KEY={vault_enc_key}

############
# Shared Dashboard
############
SHARED_DASHBOARD_USERNAME=supabase
SHARED_DASHBOARD_PASSWORD={dashboard_password}

############
# Shared Studio
############
SHARED_STUDIO_PORT=3000
SHARED_DB_IMAGE=supabase/postgres:15.8.1.085
SHARED_STUDIO_IMAGE=supabase/studio:2026.08.03-sha-022b374
SHARED_STUDIO_ORG=Multibase
SHARED_STUDIO_PROJECT=default
SHARED_PUBLIC_URL=http://localhost:8000

SHARED_ANALYTICS_IMAGE=supabase/logflare:1.43.1
SHARED_VECTOR_IMAGE=timberio/vector:0.53.0-alpine
SHARED_META_IMAGE=supabase/postgres-meta:v0.96.6
SHARED_IMGPROXY_IMAGE=darthsim/imgproxy:v3.30.1
SHARED_POOLER_IMAGE=supabase/supavisor:2.9.5
SHARED_NGINX_GATEWAY_IMAGE=nginx:1.29.1-alpine

############
# Shared Nginx Gateway
############
SHARED_GATEWAY_PORT=8000
# Tenant ports pre-allocated for nginx port mapping (Windows/Docker Desktop)
NGINX_PORT_1=4928
NGINX_PORT_2=4351
NGINX_PORT_3=4681
NGINX_PORT_4=4100
NGINX_PORT_5=4200

############
# Shared Analytics / Logging
############
SHARED_ANALYTICS_PORT=4000
SHARED_LOGFLARE_API_KEY={logflare_key}

############
# Shared Pooler
############
SHARED_POOLER_PORT=6543
SHARED_POOLER_TENANT_ID=multibase-shared
SHARED_POOLER_POOL_SIZE=50
SHARED_POOLER_MAX_CONN=500

############
# Docker
############
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
"""
        
        write_with_unix_newlines(self.env_file, env_content)
        try:
            self.env_file.chmod(0o600)
            self.shared_dir.chmod(0o750)
        except OSError as exc:
            print(f"Warning: could not harden shared environment permissions: {exc}")
        print(f"✅ .env.shared geschrieben: {self.env_file}")
        print(f"")
        print(f"📋 Übersicht:")
        print(f"   PostgreSQL Port:  5432")
        print(f"   Studio Port:      3000")
        print(f"   Gateway Port:     8000")
        print(f"   Analytics Port:   4000")
        print(f"   Pooler Port:      6543")
        print(f"   Dashboard User:   supabase")
        print(f"   Dashboard Pass:   {dashboard_password}")
        print(f"")
        
        return True
    
    def start(self):
        """Start the shared infrastructure stack."""
        print("🚀 Starte Shared Infrastructure...")
        cmd = self._compose_args() + ["up", "-d"]
        result = subprocess.run(cmd, cwd=str(self.shared_dir))
        if result.returncode == 0:
            self.ensure_postgres_auth_users_compat()
            self._fix_postgres_volume_permissions()
            self._regenerate_nginx_tenant_configs()
            print("✅ Shared Infrastructure gestartet!")
        else:
            print("❌ Fehler beim Starten der Shared Infrastructure")
        return result.returncode

    def _fix_postgres_volume_permissions(self):
        """Ensure postgres data volume ownership matches running container postgres user."""
        try:
            subprocess.run(
                ["docker", "exec", "-u", "0", "multibase-db", "chown", "-R", "postgres:postgres", "/var/lib/postgresql/data"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except Exception:
            pass

    def _regenerate_nginx_tenant_configs(self):
        """Regenerate nginx gateway configs for all existing tenant projects."""
        from pathlib import Path
        import time

        template_path = Path(__file__).parent / "templates" / "nginx" / "gateway.conf.template"
        if not template_path.exists():
            print("⚠️  Nginx-Template nicht gefunden, überspringe Config-Generierung")
            return

        tenants_dir = Path(__file__).parent / "shared" / "volumes" / "nginx" / "tenants"
        tenants_dir.mkdir(parents=True, exist_ok=True)
        template = template_path.read_text(encoding='utf-8')

        projects_dir = Path(__file__).parent / "projects"
        if not projects_dir.exists():
            return

        generated = []
        for project_dir in sorted(projects_dir.iterdir()):
            env_path = project_dir / ".env"
            if not env_path.exists():
                continue
            tenant = project_dir.name
            env = {}
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, _, v = line.partition('=')
                    env[k.strip()] = v.strip()

            gateway_port = env.get('GATEWAY_PORT') or env.get('KONG_HTTP_PORT', '8000')
            anon_key = env.get('ANON_KEY', '')
            service_key = env.get('SERVICE_ROLE_KEY', '')
            if not anon_key or not service_key:
                continue

            config = template
            config = config.replace('{{TENANT_NAME}}', tenant)
            config = config.replace('{{TENANT_ID}}', tenant.replace('-', '_'))
            config = config.replace('{{ANON_KEY}}', anon_key)
            config = config.replace('{{SERVICE_ROLE_KEY}}', service_key)
            config = config.replace('{{GATEWAY_PORT}}', gateway_port)
            config = config.replace('{{TIMESTAMP}}', str(time.time()))
            config = config.replace('{{SECURITY_HTTP_DIRECTIVES}}', '')
            config = config.replace('{{SECURITY_SERVER_DIRECTIVES}}', '')
            (tenants_dir / f'{tenant}.conf').write_text(config, encoding='utf-8')
            generated.append(f"{tenant} (:{gateway_port})")

        if generated:
            print(f"🔧 Nginx-Configs generiert: {', '.join(generated)}")
            # Reload nginx if running
            import subprocess as sp
            r = sp.run(['docker', 'exec', 'multibase-nginx-gateway', 'nginx', '-s', 'reload'],
                       capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                print("✅ Nginx-Gateway neu geladen")
            else:
                print("   Nginx-Gateway noch nicht gestartet (wird beim nächsten Start geladen)")
        else:
            print("   Keine Tenant-Projekte gefunden, nginx-Configs übersprungen")

    def ensure_postgres_auth_users_compat(self):
        """Ensure postgres.auth.users has modern columns expected by Studio/pg-meta."""
        compat_sql = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new character varying;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change text;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change_token character varying;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_current character varying;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS reauthentication_token character varying;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS reauthentication_sent_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_sso_user boolean;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean;
        ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
    END IF;
END $$;
"""

        result = self._run_sql_as_admin(compat_sql, database="postgres")
        if result.returncode == 0:
            print("✅ auth.users Kompatibilitäts-Patch geprüft (postgres)")
        else:
            print(f"⚠️  auth.users Kompatibilitäts-Patch Warnung: {result.stderr}")
    
    def stop(self):
        """Stop the shared infrastructure stack."""
        print("⏹️  Stoppe Shared Infrastructure...")
        cmd = self._compose_args() + ["down"]
        result = subprocess.run(cmd, cwd=str(self.shared_dir))
        return result.returncode
    
    def status(self):
        """Show status of shared infrastructure."""
        cmd = self._compose_args() + [
            "ps", "--format", "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
        ]
        subprocess.run(cmd, cwd=str(self.shared_dir))

    def _compose_args(self):
        """Return Compose arguments including the generated tenant override."""
        args = ["docker", "compose", "-f", str(self.compose_file)]
        override_file = self.shared_dir / "docker-compose.override.yml"
        if override_file.exists():
            args.extend(["-f", str(override_file)])
        args.extend(["--env-file", str(self.env_file)])
        return args

    def add_tenant_port(self, gateway_port: int) -> bool:
        """Register a new tenant gateway port in .env.shared and regenerate
        docker-compose.override.yml, then recreate only nginx-gateway so the
        new port mapping is active without downtime for other services.

        Returns True if the port was newly added, False if it was already registered.
        """
        env = self._get_shared_env()

        # Collect all existing NGINX_PORT_N entries
        existing_ports = []
        i = 1
        while f'NGINX_PORT_{i}' in env:
            existing_ports.append(int(env[f'NGINX_PORT_{i}']))
            i += 1

        if gateway_port in existing_ports:
            return False  # already registered

        # Append new NGINX_PORT_N to .env.shared
        new_index = len(existing_ports) + 1
        with open(self.env_file, 'a', encoding='utf-8') as f:
            f.write(f'\nNGINX_PORT_{new_index}={gateway_port}\n')

        # Regenerate docker-compose.override.yml with all ports
        all_ports = existing_ports + [gateway_port]
        self._write_compose_override(all_ports)

        # Apply new port mapping – recreates only nginx-gateway
        cmd = self._compose_args() + [
            'up', '-d', '--no-deps', 'nginx-gateway'
        ]
        result = subprocess.run(cmd, cwd=str(self.shared_dir),
                                capture_output=True, text=True)
        if result.returncode != 0:
            print(f"WARNING: nginx-gateway restart failed: {result.stderr}")
        else:
            print(f"Port {gateway_port} registered and nginx-gateway updated.")
        return True

    def _write_compose_override(self, ports: list):
        """Write docker-compose.override.yml with port bindings for all
        tenant gateway ports. Called by add_tenant_port() after every new tenant.

        Bind address is controlled by NGINX_BIND_HOST in .env.shared:
          127.0.0.1  – Linux default (localhost only)
          0.0.0.0    – Windows/Docker Desktop (accessible from host)
        """
        env = self._get_shared_env()
        bind_host = env.get('NGINX_BIND_HOST', '127.0.0.1').strip()
        port_lines = '\n'.join(
            f'      - "{bind_host}:{p}:{p}/tcp"' for p in sorted(ports)
        )
        content = (
            "# Auto-generated by setup_shared.py – DO NOT EDIT MANUALLY\n"
            f"# Regenerated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            "services:\n"
            "  nginx-gateway:\n"
            "    ports:\n"
            f"{port_lines}\n"
        )
        override_path = self.shared_dir / 'docker-compose.override.yml'
        write_with_unix_newlines(str(override_path), content)

    def _get_shared_env(self) -> dict:
        """Read shared .env file and return as dict."""
        env = {}
        if self.env_file.exists():
            for line in self.env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip()
        return env
    
    def _run_sql(self, sql, database="postgres"):
        """Execute SQL on the shared PostgreSQL cluster."""
        env = self._get_shared_env()
        password = env.get('SHARED_POSTGRES_PASSWORD', '')
        port = env.get('SHARED_PG_PORT', '5432')
        
        cmd = [
            "docker", "exec", "-i", "multibase-db",
            "psql", "-U", "postgres", "-d", database, "-c", sql
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result
    
    def _run_sql_file(self, sql_file, database):
        """Execute a SQL file on the shared PostgreSQL cluster."""
        cmd = [
            "docker", "exec", "-i", "multibase-db",
            "psql", "-U", "postgres", "-d", database
        ]
        with open(sql_file, 'r') as f:
            result = subprocess.run(cmd, stdin=f, capture_output=True, text=True)
        return result
    
    def _run_sql_as_admin(self, sql, database="postgres"):
        """Execute SQL as supabase_admin (superuser) on the shared cluster."""
        cmd = [
            "docker", "exec", "-i", "multibase-db",
            "psql", "-U", "supabase_admin", "-d", database, "-c", sql
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result

    def create_project_db(self, project_name):
        """Create a new project database in the shared cluster."""
        db_name = f"project_{project_name}".replace('-', '_')
        
        print(f"📦 Erstelle Projekt-Datenbank: {db_name}")
        
        # 1. Create the database
        result = self._run_sql(f"CREATE DATABASE {db_name};")
        if result.returncode != 0:
            if "already exists" in result.stderr:
                print(f"⚠️  Datenbank {db_name} existiert bereits")
            else:
                print(f"❌ Fehler: {result.stderr}")
                return False
        
        # 2. Initialize Supabase schemas in the new database
        init_sql = """
-- Extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;

-- Auth schema (owned by supabase_auth_admin - used by GoTrue)
CREATE SCHEMA IF NOT EXISTS auth;
ALTER SCHEMA auth OWNER TO supabase_auth_admin;

-- Storage schema (owned by supabase_storage_admin)
CREATE SCHEMA IF NOT EXISTS storage;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;

-- Realtime schemas
CREATE SCHEMA IF NOT EXISTS realtime;
ALTER SCHEMA realtime OWNER TO supabase_admin;
CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;

-- GraphQL schemas
CREATE SCHEMA IF NOT EXISTS graphql;
CREATE SCHEMA IF NOT EXISTS graphql_public;
ALTER SCHEMA graphql OWNER TO supabase_admin;
ALTER SCHEMA graphql_public OWNER TO supabase_admin;

-- Vault schema
CREATE SCHEMA IF NOT EXISTS vault;
ALTER SCHEMA vault OWNER TO supabase_admin;

-- JWT settings for this project DB
ALTER DATABASE {db} SET "app.settings.jwt_secret" TO '{jwt_secret}';
ALTER DATABASE {db} SET "app.settings.jwt_exp" TO '{jwt_exp}';

-- Public schema grants
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- supabase_auth_admin permissions
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA auth GRANT ALL ON TABLES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA auth GRANT ALL ON ROUTINES TO supabase_auth_admin;

-- supabase_storage_admin permissions
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;

-- Storage table/sequence grants (for after storage container runs migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT USAGE ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- Database-level grants for service roles (needed for migrations)
GRANT ALL PRIVILEGES ON DATABASE {db} TO supabase_admin;
GRANT ALL PRIVILEGES ON DATABASE {db} TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON DATABASE {db} TO supabase_storage_admin;
"""
        env = self._get_shared_env()
        jwt_secret = env.get('SHARED_JWT_SECRET', '')
        jwt_exp = env.get('SHARED_JWT_EXPIRY', '3600')
        init_sql = init_sql.format(db=db_name, jwt_secret=jwt_secret, jwt_exp=jwt_exp)
        
        result = self._run_sql_as_admin(init_sql, database=db_name)
        if result.returncode != 0:
            print(f"⚠️  Schema-Init Warnung: {result.stderr}")
        
        # 3. Run webhooks setup on the new DB
        webhooks_file = self.shared_dir / "volumes" / "db" / "init" / "98-webhooks.sql"
        if webhooks_file.exists():
            result = self._run_sql_file(str(webhooks_file), db_name)
            if result.returncode != 0:
                print(f"⚠️  Webhooks-Init Warnung: {result.stderr}")
        
        print(f"✅ Projekt-Datenbank {db_name} erstellt und initialisiert!")
        return True
    
    def drop_project_db(self, project_name):
        """Drop a project database from the shared cluster."""
        db_name = f"project_{project_name}".replace('-', '_')
        
        print(f"🗑️  Lösche Projekt-Datenbank: {db_name}")
        
        # Terminate active connections first
        self._run_sql(f"""
            SELECT pg_terminate_backend(pid) 
            FROM pg_stat_activity 
            WHERE datname = '{db_name}' AND pid <> pg_backend_pid();
        """)
        
        result = self._run_sql(f"DROP DATABASE IF EXISTS {db_name};")
        if result.returncode == 0:
            print(f"✅ Datenbank {db_name} gelöscht")
            return True
        else:
            print(f"❌ Fehler: {result.stderr}")
            return False
    
    def list_project_dbs(self):
        """List all project databases in the shared cluster."""
        result = self._run_sql(
            "SELECT datname, pg_size_pretty(pg_database_size(datname)) as size "
            "FROM pg_database WHERE datname LIKE 'project_%' ORDER BY datname;"
        )
        if result.returncode == 0:
            print(result.stdout)
        else:
            print(f"❌ Fehler: {result.stderr}")


def main():
    parser = argparse.ArgumentParser(description="Multibase Shared Infrastructure Manager")
    subparsers = parser.add_subparsers(dest="command", help="Verfügbare Befehle")
    
    # Init
    init_parser = subparsers.add_parser("init", help="Shared Infrastructure initialisieren")
    init_parser.add_argument("--force", "-f", action="store_true", help="Bestehende Config überschreiben")
    
    # Start/Stop/Status
    subparsers.add_parser("start", help="Shared Stack starten")
    subparsers.add_parser("stop", help="Shared Stack stoppen")
    subparsers.add_parser("status", help="Status anzeigen")
    
    # Database management
    create_db = subparsers.add_parser("create-db", help="Projekt-Datenbank erstellen")
    create_db.add_argument("name", help="Projektname")
    
    drop_db = subparsers.add_parser("drop-db", help="Projekt-Datenbank löschen")
    drop_db.add_argument("name", help="Projektname")
    
    subparsers.add_parser("list-dbs", help="Alle Projekt-Datenbanken auflisten")
    
    args = parser.parse_args()
    manager = SharedInfraManager()
    
    if args.command == "init":
        manager.init(force=args.force)
    elif args.command == "start":
        manager.start()
    elif args.command == "stop":
        manager.stop()
    elif args.command == "status":
        manager.status()
    elif args.command == "create-db":
        manager.create_project_db(args.name)
    elif args.command == "drop-db":
        manager.drop_project_db(args.name)
    elif args.command == "list-dbs":
        manager.list_project_dbs()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
