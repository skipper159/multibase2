# Multibase - Deep Technical Architecture

**Multibase** is a hybrid orchestration platform combining a Node.js management API with robust Python-based automation scripts. It is designed to act as a "Single Pane of Glass" for managing self-hosted Supabase instances, leveraging the standard Docker Compose runtime for reliability.

This document details the internal technical operations of the platform.

---

## 🏗️ Core Architecture & Tech Stack

The system is composed of three distinct layers:

### 1. The Management Layer (Dashboard)

The Dashboard serves as the central control plane.

- **Backend Runtime**: Node.js 20+ with Express.
- **Database**: SQLite (via Prisma ORM) stores metadata, user accounts, and audit logs. This lightweight choices ensures zero-dependency installation.
- **Interoperability**: The Node.js backend spawns Python 3 subprocesses to execute complex infrastructure tasks (like project generation), bridging the gap between the web UI and system-level scripts.
- **Docker Integration**: Uses the `dockerode` library to communicate directly with the Docker Socket (`/var/run/docker.sock`) for container lifecycle management and stats collection.

### 2. The Infrastructure Layer (Projects)

Every Supabase instance ("Project") is an isolated file-system based entity.

- **Directory Structure**: Located in `projects/<project-name>/`.
- **Configuration**: Each project has its own `.env` file containing unique credentials and port mappings, and a `docker-compose.yml` defining the service stack.
- **Data Persistence**: All state (Database, Storage, Logs) is stored in the `projects/<project-name>/volumes/` directory. This makes backups simple: creating a tarball of the project directory captures the entire state.

### 3. The Runtime Layer (Containers)

Instances run as standard Docker Compose stacks.

- **Networking**: Each instance is assigned a dedicated Docker Bridge Network to ensure isolation.
- **Ports**: The system manages a strict port registry to prevent conflicts.
- **Services**: A standard stack includes 7-9 containers:
  - `kong` (API Gateway)
  - `db` (PostgreSQL)
  - `auth` (GoTrue)
  - `rest` (PostgREST)
  - `realtime` (Elixir/Phoenix)
  - `storage`, `meta`, `analytics`, `function`.

---

## ⚙️ Detailed Operational Workflows

### 1. Instance Creation Lifecycle

The creation process is a hybrid operation involving both the Node.js API and Python scripts:

1.  **Request**: The Frontend sends a `POST /api/instances` request with the desired name.
2.  **Validation**: The `InstanceManager` service validates the name and checks for existing directories.
3.  **Port Allocation**: The system scans the `projects/` directory to identify used ports (Kong, DB, Studio). It assigns the next available block of 10 ports to the new instance.
4.  **Python Delegation**: The Node.js backend spawns a child process executing `python supabase_manager.py create <name> --base-port <port>`.
5.  **Generation**: The Python script:
    - Creates the directory structure.
    - Generates secure random secrets (JWTs, Database Passwords) using Python's `secrets` module.
    - Writes the custom `.env` and `docker-compose.yml`.
6.  **Registration**: Upon success, the Node.js backend registers the new instance in its SQLite database for tracking metrics and history.

### 2. Monitoring Pipeline

Multibase allows for real-time monitoring without external agents like Prometheus.

1.  **Polling**: The `DockerManager` service polls the Docker Engine stats API every 2-5 seconds.
2.  **Calculation**: It calculates CPU percentage by comparing the `cpu_usage` delta against `system_cpu_usage` (simulating the `docker stats` command). Memory is calculated from `memory_stats.usage`.
3.  **Broadcasting**: These metrics are pushed to the Frontend via a WebSocket connection (`socket.io`).
4.  **Visualization**: The Frontend subscribes to a specific "Room" (e.g., `instance:<id>`) to receive relevant updates, ensuring low bandwidth usage.

### 3. Backup & Recovery Mechanism

The backup system allows for automated "point-in-time" snapshots of the PostgreSQL database.

- **Trigger**: Can be manual (API request) or automated (Cron schedule via `node-schedule`).
- **Execution**: The backend uses `docker exec` to run `pg_dump` directly inside the target `db` container.
- **Storage**: The resulting SQL stream is piped to a compressed file in `backups/<instance-id>/<timestamp>.sql.gz`.
- **Direct I/O**: The dump data is streamed directly from the container to the disk, minimizing memory usage on the dashboard server.

### 4. Security & Authentication

- **Dashboard Access**: Protected by JWT authentication independent of the Supabase instances. First-party user management prevents unauthorized infrastructure access.
- **Instance Security**:
  - **JWT Secrets**: Unique `HS256` secrets are generated for every instance.
  - **API Gateway**: The `Kong` container is configured to strip internal headers and enforce CORS, preventing leakage of internal topology.
  - **Postgres**: The database is not exposed to the public internet by default; it is only accessible via the internal Docker network or the API Gateway.

---

## 📚 Documentation Library

A complete reference of all technical documentation available in this repository.

### 🗺️ Features & Roadmap (`/Markdowns`)

| Document                                              | Description                                             | Status      |
| :---------------------------------------------------- | :------------------------------------------------------ | :---------- |
| [**Feature Guide v1.0**](Markdowns/README.md)         | Complete manual for the current production version.     | ✅ Active   |
| [**Roadmap v1.1**](Markdowns/Readme1_1_feature.md)    | detailed task list for upcoming Q1 2026 release.        | 🚧 Planning |
| [**Vision v1.2**](Markdowns/Readme1_2_Feature.md)     | Future concepts for Multi-Tenancy and Billing.          | 🔮 Future   |
| [**Version Overview**](Markdowns/VERSION_OVERVIEW.md) | High-level summary of the update strategy.              | ℹ️ Info     |
| [**Scripts Reference**](Markdowns/SCRIPTS.md)         | Guide to the maintenance scripts in the root directory. | 🔧 Tech     |

### 🛠️ Deployment & Operations (`/deployment`, `/docs`)

| Document                                       | Description                                              | Context       |
| :--------------------------------------------- | :------------------------------------------------------- | :------------ |
| [**Deployment Guide**](deployment/README.md)   | Primary manual for automated server installation.        | 🚀 Production |
| [**AWS Deployment**](docs/AWS_DEPLOYMENT.md)   | Specific architectural guide for AWS VPC/EC2 setups.     | ☁️ Cloud      |
| [**Port Reference**](docs/PORT_REFERENCE.md)   | Complete list of all TCP/UDP ports used by the stack.    | 🌐 Network    |
| [**Realtime Config**](docs/REALTIME_CONFIG.md) | deep dive into WebSocket/Realtime service configuration. | 🔌 Config     |

### 🔍 Maintenance & Support (`/docs`)

| Document                                                  | Description                                             |
| :-------------------------------------------------------- | :------------------------------------------------------ |
| [**Troubleshooting**](docs/TROUBLESHOOTING.md)            | Solutions for common Docker, Kong, and Database issues. |
| [**Cleanup Guide**](Markdowns/CLEANUP_RECOMMENDATIONS.md) | Best practices for removing unused orphans and volumes. |

---

## 🚀 Quick Start & Installation

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

---

## 📁 Repository Structure

- **/dashboard**: The unified monorepo for the management UI.
  - **/backend**: Express.js API, Dockerode logic, SQLite DB.
  - **/frontend**: React SPA, Shadcn UI components.
- **/deployment**: Production infrastructure scripts (`install.sh`, `nginx.conf`).
- **/projects**: The data directory. **Git-Ignored**. Contains all running instances.
- **/templates**: Blueprints for `docker-compose.yml` and configuration files used during instance creation.
- **supabase_manager.py**: The legacy but robust CLI tool for scripting.

---

## 🔧 CLI Commands (Reference)

For headless management, you can bypass the Dashboard and use the Python CLI tools directly.

**Start an instance:**

```bash
python supabase_manager.py start <project_name>
```

**Create an instance:**

```bash
python supabase_manager.py create <project_name>
```

**List all instances:**

```bash
python supabase_manager.py list
```
