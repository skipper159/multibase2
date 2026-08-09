#!/usr/bin/env python3
"""
Multibase Cloud Version - Project Manager

CLI for managing lightweight Supabase tenant projects.
Uses shared infrastructure (PostgreSQL, Studio, Analytics, Vector, imgproxy, Meta, Pooler).

Commands:
  shared-start   - Start shared infrastructure
  shared-stop    - Stop shared infrastructure
  shared-status  - Show shared infrastructure status
  create         - Create new tenant project
  start          - Start tenant project
  stop           - Stop tenant project
  reset          - Reset tenant project
  status         - Check tenant project status
  list           - List all projects
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path
try:
    import psutil
except ImportError:
    psutil = None
import json

# Base directory (where this script lives)
BASE_DIR = Path(__file__).parent.resolve()

try:
    from supabase_setup import SupabaseProjectGenerator
except ImportError:
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("supabase_setup", str(BASE_DIR / "supabase_setup.py"))
        if spec and spec.loader:
            supabase_setup = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(supabase_setup)
            SupabaseProjectGenerator = supabase_setup.SupabaseProjectGenerator
        else:
            raise ImportError("Could not load supabase_setup.py")
    except Exception as e:
        print(f"Error loading supabase_setup.py: {e}")
        sys.exit(1)

try:
    from setup_shared import SharedInfraManager
except ImportError:
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("setup_shared", str(BASE_DIR / "setup_shared.py"))
        if spec and spec.loader:
            setup_shared_mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(setup_shared_mod)
            SharedInfraManager = setup_shared_mod.SharedInfraManager
        else:
            SharedInfraManager = None
    except Exception:
        SharedInfraManager = None

def find_used_ports():
    """Find all currently used ports."""
    used_ports = set()
    if not psutil:
        return used_ports

    try:
        # Check listening ports using psutil
        for conn in psutil.net_connections(kind='inet'):
            if conn.status == 'LISTEN':
                try:
                    # Try different approaches to get the port
                    if isinstance(conn.laddr, tuple) and len(conn.laddr) >= 2:
                        # Handle as tuple (ip, port)
                        port = conn.laddr[1]
                        used_ports.add(port)
                    elif hasattr(conn.laddr, 'port'):
                        # Handle as object with port attribute
                        port = conn.laddr.port  # type: ignore
                        used_ports.add(port)
                    # Skip if we can't determine the port
                except (IndexError, AttributeError, TypeError):
                    # Skip this connection if we can't get the port
                    continue
    except Exception as e:
        # If psutil fails, log the error but continue
        print(f"Warning: Error getting used ports: {e}")
    
    return used_ports

def check_project_exists(project_path):
    """Check if a project directory exists."""
    project_dir = Path(project_path)
    return project_dir.exists() and project_dir.is_dir()

def is_shared_running():
    """Check if shared infrastructure is running."""
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", "multibase-db"],
            capture_output=True, text=True
        )
        return result.returncode == 0 and "true" in result.stdout.lower()
    except Exception:
        return False

def shared_start(args):
    """Start shared infrastructure."""
    shared_dir = BASE_DIR / "shared"
    if not (shared_dir / "docker-compose.shared.yml").exists():
        print("Error: shared/docker-compose.shared.yml nicht gefunden.")
        print("Bitte zuerst 'python setup_shared.py init' ausfuehren.")
        return 1
    
    if not (shared_dir / ".env.shared").exists():
        if SharedInfraManager:
            print("Initialisiere Shared Infrastructure...")
            mgr = SharedInfraManager()
            mgr.init()
        else:
            print("Error: setup_shared.py nicht gefunden.")
            return 1
    
    print("Starte Shared Infrastructure...")
    compose_args = ["docker", "compose", "-f", "docker-compose.shared.yml"]
    if (shared_dir / "docker-compose.override.yml").exists():
        compose_args += ["-f", "docker-compose.override.yml"]
    compose_args += ["--env-file", ".env.shared"]
    result = subprocess.run(
        compose_args + ["up", "-d"],
        cwd=str(shared_dir)
    )
    if result.returncode == 0:
        print("\nShared Infrastructure gestartet!")
        print("Services: PostgreSQL, Studio, Analytics, Vector, imgproxy, Meta, Pooler")
    return result.returncode

def shared_stop(args):
    """Stop shared infrastructure."""
    shared_dir = BASE_DIR / "shared"
    if not (shared_dir / "docker-compose.shared.yml").exists():
        print("Error: shared/docker-compose.shared.yml nicht gefunden.")
        return 1
    
    print("Stoppe Shared Infrastructure...")
    compose_args = ["docker", "compose", "-f", "docker-compose.shared.yml"]
    if (shared_dir / "docker-compose.override.yml").exists():
        compose_args += ["-f", "docker-compose.override.yml"]
    compose_args += ["--env-file", ".env.shared"]
    result = subprocess.run(
        compose_args + ["down"],
        cwd=str(shared_dir)
    )
    if result.returncode == 0:
        print("Shared Infrastructure gestoppt.")
    return result.returncode

def shared_status(args):
    """Show shared infrastructure status."""
    shared_dir = BASE_DIR / "shared"
    if not (shared_dir / "docker-compose.shared.yml").exists():
        print("Shared Infrastructure nicht konfiguriert.")
        return 1
    
    running = is_shared_running()
    print(f"Shared Infrastructure: {'RUNNING' if running else 'STOPPED'}")
    print("-" * 60)
    
    if running:
        compose_args = ["docker", "compose", "-f", "docker-compose.shared.yml"]
        if (shared_dir / "docker-compose.override.yml").exists():
            compose_args += ["-f", "docker-compose.override.yml"]
        compose_args += ["--env-file", ".env.shared"]
        result = subprocess.run(
            compose_args + ["ps"],
            cwd=str(shared_dir)
        )
        
        # List project databases
        if SharedInfraManager:
            print("\nProjekt-Datenbanken:")
            mgr = SharedInfraManager()
            mgr.list_project_dbs()
    
    return 0

def create_project(args):
    """Create a new lightweight Supabase tenant project."""
    # Check shared infra
    if not is_shared_running():
        print("WARNING: Shared Infrastructure laeuft nicht!")
        print("Starte zuerst mit: python supabase_manager.py shared-start")
        response = input("Trotzdem fortfahren? (y/N): ").strip().lower()
        if response != 'y':
            return 1
    
    # Define projects directory
    projects_dir = str(BASE_DIR / "projects")
    project_path = os.path.join(projects_dir, args.project_name)
    
    # Create projects directory if it doesn't exist
    os.makedirs(projects_dir, exist_ok=True)
    
    if check_project_exists(project_path):
        print(f"Error: Project directory '{project_path}' already exists.")
        return 1

    # Create lightweight tenant project
    try:
        generator = SupabaseProjectGenerator(project_path, args.base_port)
        generator.run()
        print(f"\nTenant '{args.project_name}' erstellt (6 Container, Cloud Version)")
        return 0
    except Exception as e:
        print(f"Error creating project: {e}")
        return 1

def start_project(args):
    """Start an existing Supabase tenant project."""
    # Check shared infra
    if not is_shared_running():
        print("WARNING: Shared Infrastructure laeuft nicht!")
        print("Starte mit: python supabase_manager.py shared-start")
        response = input("Shared Infrastructure jetzt starten? (Y/n): ").strip().lower()
        if response != 'n':
            shared_start(args)
    
    projects_dir = str(BASE_DIR / "projects")
    project_path = os.path.join(projects_dir, args.project_name)
    
    if not check_project_exists(project_path):
        print(f"Error: Project directory '{project_path}' does not exist.")
        return 1

    # Change to the project directory
    os.chdir(project_path)

    # Run docker compose up
    try:
        cmd = ["docker", "compose", "up", "-d"]
        if args.verbose:
            subprocess.run(cmd)
        else:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        print(f"Tenant '{args.project_name}' gestartet (6 Container).")
        
        # Load port information from the .env file
        env_path = Path(".env")
        if env_path.exists():
            ports = {}
            with open(env_path, 'r') as f:
                for line in f:
                    if "PORT=" in line:
                        try:
                            key, value = line.strip().split('=', 1)
                            if key == "KONG_HTTP_PORT":
                                ports["api"] = value
                        except ValueError:
                            continue
            
            if "api" in ports:
                print(f"\nAPI endpoint: http://localhost:{ports['api']}")
                print(f"Studio: Shared (siehe shared-status)")
        return 0
    except Exception as e:
        print(f"Error starting project: {e}")
        return 1

def stop_project(args):
    """Stop a running Supabase tenant project (shared infra bleibt laufen)."""
    projects_dir = str(BASE_DIR / "projects")
    project_path = os.path.join(projects_dir, args.project_name)
    
    if not check_project_exists(project_path):
        print(f"Error: Project directory '{project_path}' does not exist.")
        return 1

    os.chdir(project_path)

    try:
        cmd = ["docker", "compose", "down"]
        if not args.volumes:
            cmd.append("-v")
        
        if args.verbose:
            subprocess.run(cmd)
        else:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        print(f"Tenant '{args.project_name}' gestoppt.")
        print("Shared Infrastructure laeuft weiter (stop mit: shared-stop)")
        return 0
    except Exception as e:
        print(f"Error stopping project: {e}")
        return 1

def reset_project(args):
    """Reset a Supabase tenant project (Container + optional DB Reset)."""
    projects_dir = str(BASE_DIR / "projects")
    project_path = os.path.join(projects_dir, args.project_name)
    
    if not check_project_exists(project_path):
        print(f"Error: Project directory '{project_path}' does not exist.")
        return 1

    os.chdir(project_path)

    try:
        # Stop containers
        print("Stopping tenant containers...")
        subprocess.run(["docker", "compose", "down", "-v", "--remove-orphans"], 
                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        # Clear storage
        storage_dir = Path("volumes/storage")
        if storage_dir.exists():
            import shutil
            for item in storage_dir.iterdir():
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        
        print(f"Tenant '{args.project_name}' zurueckgesetzt.")
        
        # Optional: reset database
        response = input("Auch die Datenbank zuruecksetzen? (y/N): ").strip().lower()
        if response == 'y' and SharedInfraManager:
            mgr = SharedInfraManager()
            mgr.drop_project_db(args.project_name)
            mgr.create_project_db(args.project_name)
            print("Datenbank zurueckgesetzt.")
        
        print(f"Neustart mit: python supabase_manager.py start {args.project_name}")
        return 0
    except Exception as e:
        print(f"Error resetting project: {e}")
        return 1

def status_project(args):
    """Check the status of a Supabase tenant project."""
    projects_dir = str(BASE_DIR / "projects")
    project_path = os.path.join(projects_dir, args.project_name)
    
    if not check_project_exists(project_path):
        print(f"Error: Project directory '{project_path}' does not exist.")
        return 1

    os.chdir(project_path)

    try:
        # Show shared infra status first
        shared_running = is_shared_running()
        print(f"Shared Infrastructure: {'RUNNING' if shared_running else 'STOPPED'}")
        print(f"Tenant: {args.project_name}")
        print("-" * 80)
        
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True, text=True
        )
        
        if result.returncode != 0:
            print(f"Error: {result.stderr}")
            return 1
        
        containers = []
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            try:
                container = json.loads(line)
                containers.append(container)
            except json.JSONDecodeError:
                pass
        
        print(f"{'Service':<30} {'Status':<15} {'Health':<15} {'Ports':<20}")
        print("-" * 80)
        
        for container in containers:
            name = container.get('Name', 'unknown').replace(f"{args.project_name}-", "")
            status = container.get('State', 'unknown')
            health = container.get('Health', 'N/A')
            ports = container.get('Ports', '')
            print(f"{name:<30} {status:<15} {health:<15} {ports:<20}")
        
        if not containers:
            print("Keine Container laufen.")
        else:
            print(f"\nTenant Container: {len(containers)}/6")
        
        return 0
    except Exception as e:
        print(f"Error: {e}")
        return 1

def list_projects(args):
    """List all Supabase tenant projects."""
    projects = []
    projects_dir = str(BASE_DIR / "projects")
    
    if not os.path.exists(projects_dir):
        print("Keine Projekte gefunden.")
        return 0
    
    for item in os.listdir(projects_dir):
        item_path = os.path.join(projects_dir, item)
        if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path, 'docker-compose.yml')):
            projects.append(item)
    
    if not projects:
        print("Keine Tenant-Projekte gefunden.")
        return 0
    
    # Show shared status
    shared_running = is_shared_running()
    print(f"Shared Infrastructure: {'RUNNING' if shared_running else 'STOPPED'}")
    print(f"\nTenant-Projekte ({len(projects)}):")
    print("-" * 60)
    print(f"{'Name':<25} {'Status':<12} {'Container':<12} {'API Port':<10}")
    print("-" * 60)
    
    for project in sorted(projects):
        project_path = os.path.join(projects_dir, project)
        
        # Check running status
        try:
            result = subprocess.run(
                ["docker", "compose", "ps", "--services", "--filter", "status=running"],
                cwd=project_path, capture_output=True, text=True
            )
            running_services = [s for s in result.stdout.strip().split('\n') if s]
            status = "Running" if running_services else "Stopped"
            container_count = f"{len(running_services)}/6"
        except Exception:
            status = "Unknown"
            container_count = "?"
        
        # Get API port
        api_port = "?"
        env_path = os.path.join(project_path, ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("KONG_HTTP_PORT="):
                        api_port = line.strip().split("=", 1)[1]
                        break
        
        print(f"{project:<25} {status:<12} {container_count:<12} {api_port:<10}")
    
    # Summary
    print(f"\nGesamt: {len(projects)} Tenants, "
          f"~{len(projects) * 6} Tenant-Container + 9 Shared Container")
    
    return 0

def setup_parser():
    """Set up the argument parser."""
    parser = argparse.ArgumentParser(
        description="Multibase Cloud Version - Supabase Tenant Manager",
        epilog="Shared Infrastructure muss laufen bevor Tenants gestartet werden."
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Shared Infrastructure commands
    subparsers.add_parser("shared-start", help="Start shared infrastructure (DB, Studio, Analytics, etc.)")
    subparsers.add_parser("shared-stop", help="Stop shared infrastructure")
    subparsers.add_parser("shared-status", help="Show shared infrastructure status")
    
    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new lightweight tenant project")
    create_parser.add_argument("project_name", help="Name for the new project")
    create_parser.add_argument("--base-port", "-p", type=int, help="Base port for services")
    
    # Start command
    start_parser = subparsers.add_parser("start", help="Start a tenant project")
    start_parser.add_argument("project_name", help="Name of the project to start")
    start_parser.add_argument("--verbose", "-v", action="store_true", help="Show verbose output")
    
    # Stop command
    stop_parser = subparsers.add_parser("stop", help="Stop a tenant project")
    stop_parser.add_argument("project_name", help="Name of the project to stop")
    stop_parser.add_argument("--keep-volumes", "-k", dest="volumes", action="store_true",
                           help="Keep volumes when stopping")
    stop_parser.add_argument("--verbose", "-v", action="store_true", help="Show verbose output")
    
    # Reset command
    reset_parser = subparsers.add_parser("reset", help="Reset a tenant project")
    reset_parser.add_argument("project_name", help="Name of the project to reset")
    
    # Status command
    status_parser = subparsers.add_parser("status", help="Check status of a tenant project")
    status_parser.add_argument("project_name", help="Name of the project to check")
    
    # List command
    subparsers.add_parser("list", help="List all tenant projects")
    
    return parser

def main():
    """Main entry point for the Multibase Cloud Version manager."""
    parser = setup_parser()
    args = parser.parse_args()
    
    if args.command == "shared-start":
        return shared_start(args)
    elif args.command == "shared-stop":
        return shared_stop(args)
    elif args.command == "shared-status":
        return shared_status(args)
    elif args.command == "create":
        return create_project(args)
    elif args.command == "start":
        return start_project(args)
    elif args.command == "stop":
        return stop_project(args)
    elif args.command == "reset":
        return reset_project(args)
    elif args.command == "status":
        return status_project(args)
    elif args.command == "list":
        return list_projects(args)
    else:
        parser.print_help()
        return 0

if __name__ == "__main__":
    sys.exit(main())
