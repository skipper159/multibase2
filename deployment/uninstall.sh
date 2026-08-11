#!/bin/bash
# =============================================================================
# Multibase Dashboard - Complete Uninstaller
# =============================================================================
# Removes EVERYTHING that install.sh added:
#   - PM2 processes + PM2 startup config
#   - All Docker containers (shared stack, Redis, project instances)
#   - Docker images pulled by Multibase
#   - Nginx vhosts + SSL certificates
#   - Systemd services
#   - Sudoers config
#   - Swap file (if created by installer)
#   - UFW rules
#   - System user (multibase)
#   - Installation directory (/opt/multibase)
#   - Log file
#   - Python venv
#
# Usage:
#   sudo bash uninstall.sh                  # Full removal
#   sudo bash uninstall.sh --keep-data      # Keep project data + database
#   sudo bash uninstall.sh --yes            # Skip confirmation prompt
# =============================================================================

set -uo pipefail

# --- Configuration (must match install.sh) ---
INSTALL_DIR="/opt/multibase"
INSTALL_USER="multibase"
REDIS_CONTAINER="multibase-redis"
PM2_APP_NAME="multibase-backend"
LOG_FILE="/var/log/multibase-install.log"
STATE_FILE="/opt/multibase/.installer-state"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- Parse Arguments ---
KEEP_DATA=false
AUTO_YES=false
DEL_ALL=false
for arg in "$@"; do
    case "$arg" in
        --keep-data) KEEP_DATA=true ;;
        --yes|-y)    AUTO_YES=true ;;
        --del-all)   DEL_ALL=true ;;
        --help|-h)
            echo "Multibase Uninstaller"
            echo ""
            echo "Usage:"
            echo "  sudo bash uninstall.sh                Full removal"
            echo "  sudo bash uninstall.sh --keep-data    Keep project data + database"
            echo "  sudo bash uninstall.sh --del-all      Also remove system packages (Node, Docker, Nginx, PM2, Certbot)"
            echo "  sudo bash uninstall.sh --yes          Skip confirmation"
            echo ""
            exit 0
            ;;
    esac
done

# --- Must be root ---
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}ERROR: This script must be run as root (use sudo)${NC}" >&2
    exit 1
fi

# --- Load domains from state/env for SSL cert cleanup ---
FRONTEND_DOMAIN=""
BACKEND_DOMAIN=""
if [ -f "$STATE_FILE" ]; then
    FRONTEND_DOMAIN=$(grep -m1 "^FRONTEND_DOMAIN=" "$STATE_FILE" 2>/dev/null | cut -d= -f2- || true)
    BACKEND_DOMAIN=$(grep -m1 "^BACKEND_DOMAIN=" "$STATE_FILE" 2>/dev/null | cut -d= -f2- || true)
elif [ -f "$INSTALL_DIR/dashboard/backend/.env" ]; then
    FRONTEND_DOMAIN=$(grep -m1 "^FRONTEND_DOMAIN=" "$INSTALL_DIR/dashboard/backend/.env" 2>/dev/null | cut -d= -f2- || true)
    BACKEND_DOMAIN=$(grep -m1 "^BACKEND_DOMAIN=" "$INSTALL_DIR/dashboard/backend/.env" 2>/dev/null | cut -d= -f2- || true)
fi

# --- Banner ---
echo ""
echo -e "${CYAN}======================================================${NC}"
echo -e "  ${BOLD}Multibase Dashboard — Complete Uninstaller${NC}"
echo -e "${CYAN}======================================================${NC}"
echo ""

echo -e "  The following will be ${RED}permanently removed${NC}:"
echo ""
echo -e "  ${BOLD}Processes & Containers${NC}"
echo "    - PM2 process: ${PM2_APP_NAME}"
echo "    - PM2 startup service"
echo "    - Redis container: ${REDIS_CONTAINER}"
echo "    - Shared infrastructure containers (multibase-*)"
echo "    - All project instance containers"
echo ""
echo -e "  ${BOLD}Configuration${NC}"
echo "    - Nginx vhosts (multibase-frontend, multibase-backend)"
echo "    - SSL certificates (${FRONTEND_DOMAIN:-n/a}, ${BACKEND_DOMAIN:-n/a})"
echo "    - Systemd service: multibase-shared.service"
echo "    - Sudoers: /etc/sudoers.d/multibase"
echo "    - UFW rules added by installer"
echo ""
echo -e "  ${BOLD}Files & Directories${NC}"
echo "    - ${INSTALL_DIR} (entire installation)"
echo "    - /home/${INSTALL_USER} (user home)"
echo "    - ${LOG_FILE}"
echo ""
echo -e "  ${BOLD}System User${NC}"
echo "    - ${INSTALL_USER}"
echo ""

if [ "$KEEP_DATA" = true ]; then
    echo -e "  ${YELLOW}--keep-data: Project data and database will be preserved in ${INSTALL_DIR}${NC}"
    echo ""
fi

if [ "$DEL_ALL" = true ]; then
    echo -e "  ${RED}${BOLD}--del-all: System packages will also be removed!${NC}"
    echo -e "  ${RED}  Node.js, Docker, Nginx, PM2, Certbot, Python3-venv${NC}"
else
    echo -e "  ${DIM}NOT removed (system packages): Node.js, Docker, Nginx, Python3${NC}"
    echo -e "  ${DIM}Use --del-all to also remove these packages${NC}"
fi
echo ""

if [ "$AUTO_YES" != true ]; then
    echo -ne "  ${RED}${BOLD}Are you sure?${NC} Type ${BOLD}YES${NC} to confirm: "
    read -r confirm < /dev/tty 2>/dev/null || read -r confirm
    if [ "$confirm" != "YES" ]; then
        echo ""
        echo -e "  ${YELLOW}Uninstall cancelled.${NC}"
        echo ""
        exit 0
    fi
fi

echo ""
echo -e "${BOLD}Starting removal...${NC}"
echo ""

ok()   { echo -e "  ${GREEN}[OK]${NC}   $1"; }
skip() { echo -e "  ${DIM}[SKIP]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }

# =========================================================================
# 1. Stop PM2 processes
# =========================================================================
echo -e "${CYAN}[1/12]${NC} ${BOLD}Stopping PM2 processes...${NC}"
if id "$INSTALL_USER" &>/dev/null && command -v pm2 &>/dev/null; then
    sudo -u "$INSTALL_USER" pm2 delete all 2>/dev/null || true
    sudo -u "$INSTALL_USER" pm2 save --force 2>/dev/null || true
    sudo -u "$INSTALL_USER" pm2 kill 2>/dev/null || true
    ok "PM2 processes stopped and killed"
else
    skip "PM2 or user not found"
fi

# Remove PM2 startup service
if [ -f /etc/systemd/system/pm2-${INSTALL_USER}.service ]; then
    systemctl stop "pm2-${INSTALL_USER}" 2>/dev/null || true
    systemctl disable "pm2-${INSTALL_USER}" 2>/dev/null || true
    rm -f "/etc/systemd/system/pm2-${INSTALL_USER}.service"
    ok "PM2 startup service removed"
else
    skip "PM2 startup service not found"
fi

# =========================================================================
# 2. Stop & remove shared infrastructure
# =========================================================================
echo ""
echo -e "${CYAN}[2/12]${NC} ${BOLD}Stopping shared infrastructure...${NC}"
if [ -f /etc/systemd/system/multibase-shared.service ]; then
    systemctl stop multibase-shared 2>/dev/null || true
    systemctl disable multibase-shared 2>/dev/null || true
    rm -f /etc/systemd/system/multibase-shared.service
    ok "multibase-shared.service removed"
else
    skip "multibase-shared.service not found"
fi

# Bring down shared docker-compose stack
if [ -f "$INSTALL_DIR/shared/docker-compose.shared.yml" ]; then
    shared_compose_args=(-f "$INSTALL_DIR/shared/docker-compose.shared.yml")
    if [ -f "$INSTALL_DIR/shared/docker-compose.override.yml" ]; then
        shared_compose_args+=(-f "$INSTALL_DIR/shared/docker-compose.override.yml")
    fi
    if [ -f "$INSTALL_DIR/shared/.env.shared" ]; then
        shared_compose_args+=(--env-file "$INSTALL_DIR/shared/.env.shared")
    fi
    docker compose "${shared_compose_args[@]}" --project-name multibase-shared down -v 2>/dev/null || true
    docker rm -f multibase-docker-proxy 2>/dev/null || true
    ok "Shared stack containers removed (with volumes)"
else
    # Fallback: remove any containers with multibase prefix
    for cid in $(docker ps -aq --filter "name=multibase-" 2>/dev/null); do
        docker rm -f "$cid" 2>/dev/null || true
    done
    ok "Multibase containers removed (fallback)"
fi

# =========================================================================
# 3. Stop & remove Redis
# =========================================================================
echo ""
echo -e "${CYAN}[3/12]${NC} ${BOLD}Removing Redis container...${NC}"
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${REDIS_CONTAINER}$"; then
    docker stop "$REDIS_CONTAINER" 2>/dev/null || true
    docker rm -v "$REDIS_CONTAINER" 2>/dev/null || true
    ok "Redis container removed"
else
    skip "Redis container not found"
fi

# =========================================================================
# 4. Remove project instance containers
# =========================================================================
echo ""
echo -e "${CYAN}[4/12]${NC} ${BOLD}Removing project instance containers...${NC}"
if [ -d "$INSTALL_DIR/projects" ]; then
    local_count=0
    for project_dir in "$INSTALL_DIR/projects"/*/; do
        [ -d "$project_dir" ] || continue
        project_name=$(basename "$project_dir")
        if [ -f "$project_dir/docker-compose.yml" ]; then
            docker compose -f "$project_dir/docker-compose.yml" \
                --project-name "$project_name" down -v 2>/dev/null || true
            local_count=$((local_count + 1))
        fi
    done
    ok "${local_count} project instance(s) removed"
else
    skip "No projects directory found"
fi

# =========================================================================
# 5. Clean up Docker images
# =========================================================================
echo ""
echo -e "${CYAN}[5/12]${NC} ${BOLD}Removing Docker images used by Multibase...${NC}"
# Remove supabase images and redis image
images_removed=0
for img in $(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E 'supabase/|redis:.*alpine' || true); do
    docker rmi "$img" 2>/dev/null && images_removed=$((images_removed + 1))
done
if [ "$images_removed" -gt 0 ]; then
    ok "${images_removed} Docker image(s) removed"
else
    skip "No Multibase Docker images found"
fi
# Prune dangling images
docker image prune -f 2>/dev/null || true

# =========================================================================
# 6. Remove Nginx vhosts
# =========================================================================
echo ""
echo -e "${CYAN}[6/12]${NC} ${BOLD}Removing Nginx configuration...${NC}"
removed_nginx=false
for vhost in multibase-frontend multibase-backend; do
    if [ -f "/etc/nginx/sites-enabled/$vhost" ] || [ -f "/etc/nginx/sites-available/$vhost" ]; then
        rm -f "/etc/nginx/sites-enabled/$vhost"
        rm -f "/etc/nginx/sites-available/$vhost"
        ok "Removed vhost: $vhost"
        removed_nginx=true
    fi
done
if [ "$removed_nginx" = true ]; then
    # Restore default site if nothing else remains
    if [ -f /etc/nginx/sites-available/default ] && [ ! -f /etc/nginx/sites-enabled/default ]; then
        ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default 2>/dev/null || true
    fi
    nginx -t &>/dev/null && systemctl reload nginx 2>/dev/null || true
    ok "Nginx reloaded"
else
    skip "No Multibase Nginx vhosts found"
fi

# =========================================================================
# 7. Remove SSL certificates
# =========================================================================
echo ""
echo -e "${CYAN}[7/12]${NC} ${BOLD}Removing SSL certificates...${NC}"
if command -v certbot &>/dev/null; then
    certs_removed=0
    for domain in "$FRONTEND_DOMAIN" "$BACKEND_DOMAIN"; do
        [ -z "$domain" ] && continue
        if [ -d "/etc/letsencrypt/live/$domain" ]; then
            certbot delete --cert-name "$domain" --non-interactive 2>/dev/null || true
            ok "SSL certificate removed: $domain"
            certs_removed=$((certs_removed + 1))
        fi
    done
    # Also check for wildcard certs
    for cert_dir in /etc/letsencrypt/live/*/; do
        [ -d "$cert_dir" ] || continue
        cert_name=$(basename "$cert_dir")
        # Check if the cert's domain matches our domains
        if [ -n "$BACKEND_DOMAIN" ]; then
            base_domain=$(echo "$BACKEND_DOMAIN" | awk -F. 'NF>=2{print $(NF-1)"."$NF}')
            if [ "$cert_name" = "$base_domain" ]; then
                certbot delete --cert-name "$cert_name" --non-interactive 2>/dev/null || true
                ok "Wildcard SSL certificate removed: $cert_name"
                certs_removed=$((certs_removed + 1))
            fi
        fi
    done
    [ "$certs_removed" -eq 0 ] && skip "No Multibase SSL certificates found"
else
    skip "Certbot not installed"
fi

# =========================================================================
# 8. Remove sudoers config
# =========================================================================
echo ""
echo -e "${CYAN}[8/12]${NC} ${BOLD}Removing sudoers configuration...${NC}"
if [ -f /etc/sudoers.d/multibase ]; then
    rm -f /etc/sudoers.d/multibase
    ok "Sudoers config removed"
else
    skip "No sudoers config found"
fi

# =========================================================================
# 9. Remove swap file (if created by installer)
# =========================================================================
echo ""
echo -e "${CYAN}[9/12]${NC} ${BOLD}Checking swap file...${NC}"
if [ -f /swapfile ] && grep -q '/swapfile' /etc/fstab 2>/dev/null; then
    swapoff /swapfile 2>/dev/null || true
    rm -f /swapfile
    sed -i '\|/swapfile|d' /etc/fstab
    ok "Swap file removed"
else
    skip "No installer-created swap file found"
fi

# =========================================================================
# 10. Remove installation directory
# =========================================================================
echo ""
echo -e "${CYAN}[10/12]${NC} ${BOLD}Removing installation directory...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    if [ "$KEEP_DATA" = true ]; then
        # Preserve project data and database
        data_backup=$(mktemp -d)
        cp -a "$INSTALL_DIR/projects" "$data_backup/" 2>/dev/null || true
        cp -a "$INSTALL_DIR/dashboard/backend/data" "$data_backup/" 2>/dev/null || true
        cp -a "$INSTALL_DIR/backups" "$data_backup/" 2>/dev/null || true

        rm -rf "$INSTALL_DIR"

        mkdir -p "$INSTALL_DIR/projects" "$INSTALL_DIR/dashboard/backend/data" "$INSTALL_DIR/backups"
        cp -a "$data_backup/projects"/. "$INSTALL_DIR/projects/" 2>/dev/null || true
        cp -a "$data_backup/data"/. "$INSTALL_DIR/dashboard/backend/data/" 2>/dev/null || true
        cp -a "$data_backup/backups"/. "$INSTALL_DIR/backups/" 2>/dev/null || true
        rm -rf "$data_backup"

        ok "Application removed, data preserved in ${INSTALL_DIR}"
    else
        rm -rf "$INSTALL_DIR"
        ok "Installation directory removed: ${INSTALL_DIR}"
    fi
else
    skip "Installation directory not found"
fi

# =========================================================================
# 11. Remove system user
# =========================================================================
echo ""
echo -e "${CYAN}[11/12]${NC} ${BOLD}Removing system user...${NC}"
if id "$INSTALL_USER" &>/dev/null; then
    # Kill any remaining processes
    pkill -u "$INSTALL_USER" 2>/dev/null || true
    sleep 1
    userdel -r "$INSTALL_USER" 2>/dev/null || true
    ok "User '${INSTALL_USER}' removed (including home directory)"
else
    skip "User '${INSTALL_USER}' not found"
fi

# =========================================================================
# 12. Cleanup
# =========================================================================
echo ""
echo -e "${CYAN}[12/12]${NC} ${BOLD}Final cleanup...${NC}"

# Remove log file
rm -f "$LOG_FILE" 2>/dev/null && ok "Log file removed: ${LOG_FILE}" || skip "No log file"

# Remove temp files
rm -f /tmp/multibase-create-admin.js 2>/dev/null || true

# Reload systemd
systemctl daemon-reload 2>/dev/null || true

# Docker network prune (only multibase networks)
for net in $(docker network ls --format '{{.Name}}' 2>/dev/null | grep -i multibase || true); do
    docker network rm "$net" 2>/dev/null || true
done

ok "Cleanup complete"

# =========================================================================
# 13. Remove system packages (--del-all)
# =========================================================================
if [ "$DEL_ALL" = true ]; then
    echo ""
    echo -e "${CYAN}[13/13]${NC} ${BOLD}Removing system packages...${NC}"

    # PM2 (global npm package)
    if command -v pm2 &>/dev/null; then
        npm uninstall -g pm2 2>/dev/null || true
        ok "PM2 removed"
    else
        skip "PM2 not installed"
    fi

    # Certbot
    if dpkg -s certbot &>/dev/null 2>&1; then
        apt-get remove -y --purge certbot python3-certbot-nginx 2>/dev/null || true
        ok "Certbot removed"
    else
        skip "Certbot not installed"
    fi

    # Nginx
    if dpkg -s nginx &>/dev/null 2>&1; then
        systemctl stop nginx 2>/dev/null || true
        apt-get remove -y --purge nginx nginx-common 2>/dev/null || true
        rm -rf /etc/nginx 2>/dev/null || true
        ok "Nginx removed"
    else
        skip "Nginx not installed"
    fi

    # Node.js
    if dpkg -s nodejs &>/dev/null 2>&1; then
        apt-get remove -y --purge nodejs 2>/dev/null || true
        # Remove nodesource list if present
        rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true
        rm -f /etc/apt/keyrings/nodesource.gpg 2>/dev/null || true
        ok "Node.js removed"
    else
        skip "Node.js not installed"
    fi

    # Docker
    if dpkg -s docker-ce &>/dev/null 2>&1; then
        systemctl stop docker 2>/dev/null || true
        apt-get remove -y --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
        rm -rf /var/lib/docker /var/lib/containerd 2>/dev/null || true
        rm -f /etc/apt/sources.list.d/docker.list 2>/dev/null || true
        rm -f /etc/apt/keyrings/docker.gpg 2>/dev/null || true
        ok "Docker removed (including all data)"
    else
        skip "Docker not installed"
    fi

    # Python venv package
    if dpkg -s python3-venv &>/dev/null 2>&1; then
        apt-get remove -y --purge python3-venv 2>/dev/null || true
        ok "python3-venv removed"
    else
        skip "python3-venv not installed"
    fi

    # Autoremove orphaned dependencies
    apt-get autoremove -y 2>/dev/null || true
    ok "Orphaned dependencies cleaned up"
fi

# =========================================================================
# Done
# =========================================================================
echo ""
echo -e "${CYAN}======================================================${NC}"
echo -e "  ${GREEN}${BOLD}Uninstall complete!${NC}"
echo -e "${CYAN}======================================================${NC}"
echo ""

if [ "$KEEP_DATA" = true ]; then
    echo -e "  ${YELLOW}Preserved data:${NC}"
    echo "    - ${INSTALL_DIR}/projects/"
    echo "    - ${INSTALL_DIR}/dashboard/backend/data/"
    echo "    - ${INSTALL_DIR}/backups/"
    echo ""
fi

if [ "$DEL_ALL" = true ]; then
    echo -e "  ${GREEN}All system packages have been removed.${NC}"
    echo ""
else
    echo -e "  ${DIM}System packages NOT removed (use --del-all to include):${NC}"
    echo "    Node.js, Docker, Nginx, PM2, Certbot"
    echo ""
fi
