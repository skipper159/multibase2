#!/bin/bash
# =============================================================================
# Multibase Dashboard - Automated Installer v2.0
# =============================================================================
# Usage:
#   curl -sSL https://raw.githubusercontent.com/skipper159/multibase2/main/deployment/install.sh | sudo bash
#   sudo bash install.sh              # Fresh install
#   sudo bash install.sh --update     # Update existing installation
#   sudo bash install.sh --uninstall  # Remove installation
#   sudo bash install.sh --uninstall --keep-data  # Remove but keep data
# =============================================================================

set -euo pipefail

# --- Configuration ---
INSTALL_DIR="/opt/multibase"
INSTALL_USER="multibase"
REPO_URL="https://github.com/skipper159/multibase2.git"
REPO_BRANCH="${REPO_BRANCH:-Feature_Roadmap}"
case "${REPO_BRANCH}" in
  "Feature_Roadmap") SCRIPT_VERSION="3.1.10" ;;
  "cloud-version")   SCRIPT_VERSION="2.0.0" ;;
  *)                 SCRIPT_VERSION="1.0.0" ;;
esac
LOG_FILE="/var/log/multibase-install.log"
NODE_MAJOR=20
REDIS_CONTAINER="multibase-redis"
PM2_APP_NAME="multibase-backend"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'
# Multibase brand colors (matching frontend)
MB_GREEN='\033[38;2;62;207;142m'    # #3ecf8e - Supabase/Multibase Green
MB_GREEN_BOLD='\033[1;38;2;62;207;142m'
MB_DARK='\033[38;2;163;163;163m'    # #a3a3a3 - muted foreground
MB_WHITE='\033[38;2;237;237;237m'   # #ededed - base text

# --- State Variables (populated by wizard) ---
DEPLOY_MODE=""          # single, split-frontend, split-backend
FRONTEND_DOMAIN=""
BACKEND_DOMAIN=""
BACKEND_URL=""          # Full URL for split-frontend mode
FRONTEND_URL=""         # Full URL for split-backend mode
ADMIN_USER="admin"
ADMIN_EMAIL=""
ADMIN_PASS=""
SSL_ENABLED="y"
SSL_EMAIL=""
SSL_TYPE="per-tenant"
UFW_ENABLED="y"
SWAP_ENABLED="y"
TOTAL_STEPS=14
SKIP_WIZARD=0      # set to 1 when re-running with existing config loaded directly
STATE_FILE="/opt/multibase/.installer-state"   # written right after wizard completes
CURRENT_STEP=0

# =============================================================================
# Utility Functions
# =============================================================================

log() {
    echo -e "${DIM}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo ""
    echo -e "${MB_GREEN}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} ${BOLD}$1${NC}"
    log "STEP ${CURRENT_STEP}/${TOTAL_STEPS}: $1"
}

step_ok() {
    echo -e "        ${GREEN}[OK]${NC} $1"
    log "  OK: $1"
}

step_new() {
    echo -e "        ${YELLOW}[NEW]${NC} $1"
    log "  NEW: $1"
}

step_skip() {
    echo -e "        ${DIM}[SKIP]${NC} $1"
    log "  SKIP: $1"
}

step_fail() {
    echo -e "        ${RED}[FAIL]${NC} $1"
    log "  FAIL: $1"
}

error_exit() {
    echo ""
    echo -e "${RED}ERROR: $1${NC}" >&2
    log "ERROR: $1"
    exit 1
}

# Read from /dev/tty if available, otherwise fall back to stdin.
# Usage: tty_read [-s] VAR [DEFAULT]
tty_read() {
    local _silent=0
    if [ "${1:-}" = "-s" ]; then _silent=1; shift; fi
    local _var="$1"
    local _default="${2:-}"
    local _val=""
    if [ -c /dev/tty ] && { true < /dev/tty; } 2>/dev/null; then
        if [ "$_silent" = "1" ]; then
            IFS= read -rs _val < /dev/tty || true
        else
            IFS= read -r _val < /dev/tty || true
        fi
    else
        # No TTY available – use default silently
        _val=""
    fi
    _val="${_val:-$_default}"
    eval "$_var=\$_val"
}

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default="${3:-}"
    local value=""

    if [ -n "$default" ]; then
        echo -ne "  ${prompt_text} ${DIM}[${default}]${NC}: "
    else
        echo -ne "  ${prompt_text}: "
    fi

    tty_read value "$default"
    printf -v "$var_name" '%s' "$value"
}

prompt_password() {
    local var_name="$1"
    local prompt_text="$2"
    local value=""

    echo -ne "  ${prompt_text} ${DIM}(Enter for auto-generated)${NC}: "
    tty_read -s value ""
    echo ""

    if [ -z "$value" ]; then
        value=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
        echo -e "  ${DIM}Auto-generated password${NC}"
    fi
    printf -v "$var_name" '%s' "$value"
}

prompt_yn() {
    local var_name="$1"
    local prompt_text="$2"
    local default="${3:-y}"
    local value=""

    echo -ne "  ${prompt_text} (y/n) ${DIM}[${default}]${NC}: "
    tty_read value "$default"
    value=$(echo "$value" | tr '[:upper:]' '[:lower:]')
    printf -v "$var_name" '%s' "$value"
}

separator() {
    echo -e "${DIM}------------------------------------------------------${NC}"
}

generate_secret() {
    openssl rand -base64 48 | tr -d '/+=' | head -c 64
}

# =============================================================================
# Pre-Flight Checks
# =============================================================================

preflight_checks() {
    # Must be root
    if [ "$(id -u)" -ne 0 ]; then
        error_exit "This script must be run as root (use sudo)"
    fi

    # Check OS
    if [ ! -f /etc/os-release ]; then
        error_exit "Cannot determine OS. This script supports Ubuntu/Debian."
    fi

    source /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        echo -e "${YELLOW}WARNING: This script is designed for Ubuntu/Debian. Your OS: ${ID}${NC}"
        echo -ne "  Continue anyway? (y/n) [n]: "
        tty_read cont "n"
        if [ "$cont" != "y" ]; then
            exit 0
        fi
    fi

    # Check minimum RAM (1 GB)
    local total_ram
    total_ram=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$total_ram" -lt 1024 ]; then
        error_exit "Minimum 1 GB RAM required. Detected: ${total_ram} MB"
    fi

    # Check disk space (5 GB minimum)
    local free_disk
    free_disk=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')
    if [ "$free_disk" -lt 5 ]; then
        error_exit "Minimum 5 GB free disk space required. Available: ${free_disk} GB"
    fi

    # Initialize log file
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "=== Multibase Installer v${SCRIPT_VERSION} - $(date) ===" > "$LOG_FILE"
}

# =============================================================================
# Banner
# =============================================================================

show_banner() {
    echo ""
    echo -e "${MB_GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${MB_GREEN}║${NC}                                                      ${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}    __  __       _ _   _ _                        ${NC}${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}   |  \/  |_   _| | |_(_) |__   __ _ ___  ___     ${NC}${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}   | |\/| | | | | | __| | '_ \ / _\` / __|/ _ \\   ${NC}${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}   | |  | | |_| | | |_| | |_) | (_| \__ \  __/   ${NC}${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}   |_|  |_|\__,_|_|\__|_|_.__/ \__,_|___/\___|   ${NC}${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}                                                      ${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_DARK}  Dashboard Installer v${SCRIPT_VERSION}${NC}                       ${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${MB_WHITE}Welcome! This script will set up Multibase on your server.${NC}"
    echo ""
    echo -ne "  Press ${BOLD}Enter${NC} to continue..."
    tty_read _ack ""
}

# =============================================================================
# Interactive Wizard
# =============================================================================

wizard_deployment_mode() {
    echo ""
    separator
    echo -e "  ${BOLD}STEP 1/6 -- Deployment Mode${NC}"
    separator
    echo ""
    echo "  How should Multibase be installed?"
    echo ""
    echo -e "  ${BOLD}[1]${NC} Single Server"
    echo -e "      ${DIM}Frontend + Backend on this server${NC}"
    echo ""
    echo -e "  ${BOLD}[2]${NC} Split VPS -- Frontend Only"
    echo -e "      ${DIM}Static frontend, backend runs elsewhere${NC}"
    echo ""
    echo -e "  ${BOLD}[3]${NC} Split VPS -- Backend Only"
    echo -e "      ${DIM}API + Docker, frontend runs elsewhere${NC}"
    echo ""

    local choice=""
    local default_choice="1"
    case "$DEPLOY_MODE" in
        single)         default_choice="1" ;;
        split-frontend) default_choice="2" ;;
        split-backend)  default_choice="3" ;;
    esac
    prompt choice "Choice" "$default_choice"

    case "$choice" in
        1) DEPLOY_MODE="single" ;;
        2) DEPLOY_MODE="split-frontend" ;;
        3) DEPLOY_MODE="split-backend" ;;
        *) DEPLOY_MODE="single" ;;
    esac
}

wizard_domains() {
    echo ""
    separator
    echo -e "  ${BOLD}STEP 2/6 -- Domains${NC}"
    separator
    echo ""

    case "$DEPLOY_MODE" in
        single)
            prompt FRONTEND_DOMAIN "Frontend domain (e.g. dashboard.example.com)" "${FRONTEND_DOMAIN:-}"
            [ -z "$FRONTEND_DOMAIN" ] && error_exit "Frontend domain is required"
            echo ""
            prompt BACKEND_DOMAIN "Backend domain (e.g. api.example.com)" "${BACKEND_DOMAIN:-}"
            [ -z "$BACKEND_DOMAIN" ] && error_exit "Backend domain is required"
            BACKEND_URL="https://${BACKEND_DOMAIN}"
            FRONTEND_URL="https://${FRONTEND_DOMAIN}"
            ;;
        split-frontend)
            prompt FRONTEND_DOMAIN "Frontend domain (this server)" "${FRONTEND_DOMAIN:-}"
            [ -z "$FRONTEND_DOMAIN" ] && error_exit "Frontend domain is required"
            echo ""
            prompt BACKEND_URL "Backend URL (remote server, incl. https://)" "${BACKEND_URL:-}"
            [ -z "$BACKEND_URL" ] && error_exit "Backend URL is required"
            # Extract domain from URL
            BACKEND_DOMAIN=$(echo "$BACKEND_URL" | sed 's|https\?://||' | sed 's|/.*||')
            FRONTEND_URL="https://${FRONTEND_DOMAIN}"
            ;;
        split-backend)
            prompt BACKEND_DOMAIN "Backend domain (this server)" "${BACKEND_DOMAIN:-}"
            [ -z "$BACKEND_DOMAIN" ] && error_exit "Backend domain is required"
            echo ""
            prompt FRONTEND_URL "Frontend URL (remote server, for CORS)" "${FRONTEND_URL:-}"
            [ -z "$FRONTEND_URL" ] && error_exit "Frontend URL is required"
            BACKEND_URL="https://${BACKEND_DOMAIN}"
            # Extract domain from URL
            FRONTEND_DOMAIN=$(echo "$FRONTEND_URL" | sed 's|https\?://||' | sed 's|/.*||')
            ;;
    esac
}

wizard_admin() {
    # Skip for frontend-only installations
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    echo ""
    separator
    echo -e "  ${BOLD}STEP 3/6 -- Admin Account${NC}"
    separator
    echo ""

    prompt ADMIN_USER "Username" "${ADMIN_USER:-admin}"
    prompt ADMIN_EMAIL "Email" "${ADMIN_EMAIL:-}"
    [ -z "$ADMIN_EMAIL" ] && error_exit "Admin email is required"

    if [ -n "${ADMIN_PASS:-}" ] && [ "${ADMIN_PASS:-}" != "__existing__" ]; then
        echo -e "  ${DIM}Password: keeping existing (leave blank to auto-generate new one)${NC}"
        local _newpass=""
        echo -ne "  New password ${DIM}(Enter to keep existing)${NC}: "
        tty_read -s _newpass ""
        echo ""
        if [ -n "$_newpass" ]; then
            ADMIN_PASS="$_newpass"
        fi
    elif [ "${ADMIN_PASS:-}" = "__existing__" ]; then
        echo -e "  ${DIM}Password: keeping existing database password (leave blank to auto-generate new one)${NC}"
        local _newpass=""
        echo -ne "  New password ${DIM}(Enter to keep existing)${NC}: "
        tty_read -s _newpass ""
        echo ""
        if [ -n "$_newpass" ]; then
            ADMIN_PASS="$_newpass"
        fi
    else
        prompt_password ADMIN_PASS "Password"
    fi
}

wizard_ssl() {
    echo ""
    separator
    echo -e "  ${BOLD}STEP 4/6 -- SSL Certificate${NC}"
    separator
    echo ""

    prompt_yn SSL_ENABLED "Set up SSL via Let's Encrypt?" "${SSL_ENABLED:-y}"

    if [ "$SSL_ENABLED" = "y" ]; then
        prompt SSL_EMAIL "Email for Let's Encrypt" "${ADMIN_EMAIL:-}"
        [ -z "$SSL_EMAIL" ] && error_exit "SSL email is required"

        echo ""
        echo -e "  ${BOLD}Certificate type:${NC}"
        echo -e "  ${GREEN}[per-domain]${NC} Fully automatic — certbot proves ownership via HTTP."
        echo -e "              No manual steps. Works with any DNS provider. ${BOLD}(recommended)${NC}"
        echo ""
        echo -e "  ${YELLOW}[wildcard]${NC}   Covers *.domain.com automatically, but ${BOLD}requires a manual step:${NC}"
        echo -e "              The installer will PAUSE and ask you to add a DNS TXT record"
        echo -e "              at your DNS provider (Hetzner, Cloudflare, etc.), then press Enter."
        echo -e "              ${DIM}DNS propagation can take up to 60 seconds.${NC}"
        echo ""
        local _wildcard="n"
        [ "$SSL_TYPE" = "wildcard" ] && _wildcard="y"
        prompt_yn _wildcard "Use wildcard certificate? (manual DNS step required)" "$_wildcard"
        [ "$_wildcard" = "y" ] && SSL_TYPE="wildcard" || SSL_TYPE="per-tenant"
    fi
}

wizard_extras() {
    echo ""
    separator
    echo -e "  ${BOLD}STEP 5/6 -- Additional Options${NC}"
    separator
    echo ""

    prompt_yn UFW_ENABLED "Configure UFW firewall?" "${UFW_ENABLED:-y}"

    local total_ram
    total_ram=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$total_ram" -lt 4096 ]; then
        local current_swap
        current_swap=$(free -m | awk '/^Swap:/{print $2}')
        if [ "$current_swap" -lt 512 ]; then
            prompt_yn SWAP_ENABLED "Create 2 GB swap file? (recommended, ${total_ram} MB RAM)" "y"
        else
            SWAP_ENABLED="n"
            echo -e "  ${DIM}Swap already configured (${current_swap} MB)${NC}"
        fi
    else
        SWAP_ENABLED="n"
        echo -e "  ${DIM}Sufficient RAM detected (${total_ram} MB), swap not needed${NC}"
    fi
}

wizard_confirm() {
    echo ""
    separator
    echo -e "  ${BOLD}STEP 6/6 -- Summary${NC}"
    separator
    echo ""
    echo -e "  Mode:             ${BOLD}${DEPLOY_MODE}${NC}"

    case "$DEPLOY_MODE" in
        single)
            echo -e "  Frontend Domain:  ${BOLD}${FRONTEND_DOMAIN}${NC}"
            echo -e "  Backend Domain:   ${BOLD}${BACKEND_DOMAIN}${NC}"
            ;;
        split-frontend)
            echo -e "  Frontend Domain:  ${BOLD}${FRONTEND_DOMAIN}${NC}"
            echo -e "  Backend URL:      ${BOLD}${BACKEND_URL}${NC}"
            ;;
        split-backend)
            echo -e "  Backend Domain:   ${BOLD}${BACKEND_DOMAIN}${NC}"
            echo -e "  Frontend URL:     ${BOLD}${FRONTEND_URL}${NC}"
            ;;
    esac

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        echo -e "  Admin:            ${BOLD}${ADMIN_USER}${NC} (${ADMIN_EMAIL})"
    fi
    local _ssl_label
    if [ "$SSL_ENABLED" = "y" ]; then
        [ "$SSL_TYPE" = "wildcard" ] && _ssl_label="Yes (wildcard)" || _ssl_label="Yes (per-tenant)"
    else
        _ssl_label="No"
    fi
    echo -e "  SSL:              ${BOLD}${_ssl_label}${NC}"
    echo -e "  Firewall:         ${BOLD}$([ "$UFW_ENABLED" = "y" ] && echo "Yes (UFW)" || echo "No")${NC}"
    echo -e "  Swap:             ${BOLD}$([ "$SWAP_ENABLED" = "y" ] && echo "2 GB" || echo "No")${NC}"
    echo ""

    local confirm=""
    prompt_yn confirm "Start installation?" "y"
    if [ "$confirm" != "y" ]; then
        echo ""
        echo -e "  ${YELLOW}Installation cancelled.${NC}"
        exit 0
    fi
}

# =============================================================================
# Save Installer State (right after wizard, before any install steps)
# =============================================================================

save_installer_state() {
    mkdir -p "$(dirname "$STATE_FILE")"
    cat > "$STATE_FILE" <<EOF
# Multibase installer state — saved $(date)
INSTALLER_DEPLOY_MODE=${DEPLOY_MODE}
INSTALLER_ADMIN_USER=${ADMIN_USER}
INSTALLER_ADMIN_EMAIL=${ADMIN_EMAIL}
INSTALLER_SSL_ENABLED=${SSL_ENABLED}
INSTALLER_UFW_ENABLED=${UFW_ENABLED}
FRONTEND_DOMAIN=${FRONTEND_DOMAIN}
BACKEND_DOMAIN=${BACKEND_DOMAIN}
FRONTEND_URL=${FRONTEND_URL}
BACKEND_URL=${BACKEND_URL}
SSL_EMAIL=${SSL_EMAIL}
SSL_TYPE=${SSL_TYPE:-per-tenant}
CORS_ORIGIN=${FRONTEND_URL}
EOF
    chmod 600 "$STATE_FILE"
}

# =============================================================================
# Load Existing Config (re-run detection)
# =============================================================================

load_existing_config() {
    # Prefer the lightweight state file (written immediately after wizard)
    # Fall back to backend .env (written by generate_configs)
    local env_file=""
    if [ -f "$STATE_FILE" ]; then
        env_file="$STATE_FILE"
    elif [ -f "$INSTALL_DIR/dashboard/backend/.env" ]; then
        env_file="$INSTALL_DIR/dashboard/backend/.env"
    else
        return 0
    fi

    local _get
    _get() { grep -m1 "^${1}=" "$env_file" 2>/dev/null | cut -d= -f2- || true; }

    local prev_mode prev_admin prev_email prev_ssl prev_ufw
    prev_mode=$(_get INSTALLER_DEPLOY_MODE)
    prev_admin=$(_get INSTALLER_ADMIN_USER)
    prev_email=$(_get INSTALLER_ADMIN_EMAIL)
    prev_ssl=$(_get INSTALLER_SSL_ENABLED)
    prev_ufw=$(_get INSTALLER_UFW_ENABLED)

    [ -z "$prev_mode" ] && return

    # Load all values silently first
    [ -n "$prev_mode" ]  && DEPLOY_MODE="$prev_mode"
    [ -n "$prev_admin" ] && ADMIN_USER="$prev_admin"
    [ -n "$prev_email" ] && ADMIN_EMAIL="$prev_email"
    [ -n "$prev_ssl" ]   && SSL_ENABLED="$prev_ssl"
    [ -n "$prev_ufw" ]   && UFW_ENABLED="$prev_ufw"
    local prev_frontend prev_backend prev_ssl_email prev_ssl_type prev_backend_url prev_frontend_url
    prev_frontend=$(_get FRONTEND_DOMAIN)
    prev_backend=$(_get BACKEND_DOMAIN)
    prev_ssl_email=$(_get SSL_EMAIL)
    prev_ssl_type=$(_get SSL_TYPE)
    prev_backend_url=$(_get BACKEND_URL)
    prev_frontend_url=$(_get CORS_ORIGIN)
    prev_admin_pass=$(_get DEFAULT_ADMIN_PASSWORD)
    [ -n "$prev_frontend" ]     && FRONTEND_DOMAIN="$prev_frontend"
    [ -n "$prev_backend" ]      && BACKEND_DOMAIN="$prev_backend"
    [ -n "$prev_ssl_email" ]    && SSL_EMAIL="$prev_ssl_email"
    [ -n "$prev_ssl_type" ]     && SSL_TYPE="$prev_ssl_type"
    [ -n "$prev_backend_url" ]  && BACKEND_URL="$prev_backend_url"
    [ -n "$prev_frontend_url" ] && FRONTEND_URL="$prev_frontend_url"
    
    if [ -n "$prev_admin_pass" ]; then
        ADMIN_PASS="$prev_admin_pass"
    else
        ADMIN_PASS="__existing__"
    fi

    # Ask user what to do
    echo ""
    separator
    echo -e "  ${YELLOW}Previous installation detected${NC}"
    separator
    echo ""
    echo -e "  ${DIM}Mode:    ${BOLD}${prev_mode}${NC}"
    echo -e "  ${DIM}Domain:  ${BOLD}${BACKEND_DOMAIN:-${FRONTEND_DOMAIN}}${NC}"
    echo -e "  ${DIM}Admin:   ${BOLD}${prev_admin}${NC} ${DIM}(${prev_email})${NC}"
    echo -e "  ${DIM}SSL:     ${BOLD}${prev_ssl}${NC}  |  UFW: ${BOLD}${prev_ufw}${NC}"
    echo ""
    echo -e "  ${BOLD}[1]${NC} Use these settings and start installation directly"
    echo -e "  ${BOLD}[2]${NC} Edit settings (go through wizard with pre-filled defaults)"
    echo ""
    local _choice=""
    prompt _choice "Choice" "1"
    if [ "$_choice" != "2" ]; then
        SKIP_WIZARD=1
        echo ""
        echo -e "  ${GREEN}OK — resuming installation with existing settings.${NC}"
        echo ""
    fi
}

run_wizard() {
    load_existing_config

    if [ "$SKIP_WIZARD" = "1" ]; then
        # Just set TOTAL_STEPS based on loaded DEPLOY_MODE, skip all wizard steps
        case "$DEPLOY_MODE" in
            single)         TOTAL_STEPS=19 ;;
            split-frontend) TOTAL_STEPS=9  ;;
            split-backend)  TOTAL_STEPS=18 ;;
        esac
        return
    fi

    wizard_deployment_mode
    wizard_domains
    wizard_admin
    wizard_ssl
    wizard_extras
    wizard_confirm

    # Adjust total steps based on mode
    case "$DEPLOY_MODE" in
        single)         TOTAL_STEPS=19 ;;
        split-frontend) TOTAL_STEPS=9  ;;
        split-backend)  TOTAL_STEPS=18 ;;
    esac
}

# =============================================================================
# Dependency Installation
# =============================================================================

install_dependencies() {
    step "Installing dependencies..."

    # Update package lists
    apt-get update -qq >> "$LOG_FILE" 2>&1

    # Base tools
    local base_pkgs="curl wget git openssl build-essential software-properties-common"
    for pkg in $base_pkgs; do
        if dpkg -s "$pkg" &>/dev/null; then
            step_ok "$pkg (already installed)"
        else
            apt-get install -y -qq "$pkg" >> "$LOG_FILE" 2>&1
            step_new "$pkg (installed)"
        fi
    done

    # Node.js
    if command -v node &>/dev/null; then
        local node_ver
        node_ver=$(node -v)
        step_ok "Node.js ${node_ver} (already installed)"
    else
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >> "$LOG_FILE" 2>&1
        apt-get install -y -qq nodejs >> "$LOG_FILE" 2>&1
        step_new "Node.js $(node -v) (installed)"
    fi

    # Docker (only for single + split-backend)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        if command -v docker &>/dev/null; then
            step_ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') (already installed)"
        else
            curl -fsSL https://get.docker.com | bash >> "$LOG_FILE" 2>&1
            systemctl enable docker >> "$LOG_FILE" 2>&1
            systemctl start docker >> "$LOG_FILE" 2>&1
            step_new "Docker $(docker --version | awk '{print $3}' | tr -d ',') (installed)"
        fi

        # Docker Compose plugin
        if docker compose version &>/dev/null; then
            step_ok "Docker Compose (already installed)"
        else
            apt-get install -y -qq docker-compose-plugin >> "$LOG_FILE" 2>&1
            step_new "Docker Compose (installed)"
        fi

        # Docker log rotation (prevent unbounded log growth)
        if [ ! -f /etc/docker/daemon.json ] || ! grep -q "max-size" /etc/docker/daemon.json 2>/dev/null; then
            cat > /etc/docker/daemon.json << 'DAEMON_EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "20"
  }
}
DAEMON_EOF
            systemctl reload docker >> "$LOG_FILE" 2>&1 || true
            step_new "Docker log rotation configured (50m × 20 = 1GB max per container)"
        else
            step_ok "Docker log rotation (already configured)"
        fi

        # Python 3
        if command -v python3 &>/dev/null; then
            step_ok "Python $(python3 --version | awk '{print $2}') (already installed)"
        else
            apt-get install -y -qq python3 python3-pip python3-venv >> "$LOG_FILE" 2>&1
            step_new "Python $(python3 --version | awk '{print $2}') (installed)"
        fi
        # venv must always be installed, even if python3 was pre-installed
        # Ubuntu 24.04+ ships python3.12 without the venv module by default
        local py_ver
        py_ver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        apt-get install -y -qq python3-venv "python${py_ver}-venv" >> "$LOG_FILE" 2>&1 || \
            apt-get install -y -qq python3-venv >> "$LOG_FILE" 2>&1
        step_ok "Python venv (python${py_ver}-venv installed)"
    fi

    # Nginx
    if command -v nginx &>/dev/null; then
        step_ok "Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}') (already installed)"
    else
        apt-get install -y -qq nginx >> "$LOG_FILE" 2>&1
        systemctl enable nginx >> "$LOG_FILE" 2>&1
        step_new "Nginx (installed)"
    fi

    # Certbot
    if [ "$SSL_ENABLED" = "y" ]; then
        if command -v certbot &>/dev/null; then
            step_ok "Certbot (already installed)"
        else
            apt-get install -y -qq certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
            step_new "Certbot (installed)"
        fi
    fi

    # PM2 (only for single + split-backend)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        if command -v pm2 &>/dev/null; then
            step_ok "PM2 $(pm2 -v) (already installed)"
        else
            npm install -g pm2 >> "$LOG_FILE" 2>&1
            step_new "PM2 $(pm2 -v) (installed)"
        fi
    fi
}

# =============================================================================
# User & Directory Setup
# =============================================================================

setup_user_dirs() {
    step "Creating user and directories..."

    # Create system user
    if id "$INSTALL_USER" &>/dev/null; then
        step_ok "User '$INSTALL_USER' already exists"
    else
        useradd -r -m -s /bin/bash "$INSTALL_USER"
        step_new "User '$INSTALL_USER' created"
    fi

    # Add to docker group (backend modes only)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        if getent group docker &>/dev/null; then
            usermod -aG docker "$INSTALL_USER" 2>/dev/null || true
            step_ok "User added to docker group"
        fi
    fi

    # Create directories
    local dirs=(
        "$INSTALL_DIR"
        "$INSTALL_DIR/logs"
        "$INSTALL_DIR/nginx/sites-enabled"
    )

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        dirs+=(
            "$INSTALL_DIR/projects"
            "$INSTALL_DIR/backups"
        )
    fi

    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
        step_ok "Created $dir"
    done

    chown -R "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR"
}

# =============================================================================
# Git Clone
# =============================================================================

clone_repo() {
    step "Cloning repository..."

    if [ -d "$INSTALL_DIR/.git" ]; then
        step_ok "Repository already exists, pulling latest..."
        cd "$INSTALL_DIR"
        sudo -u "$INSTALL_USER" git pull origin "$REPO_BRANCH" >> "$LOG_FILE" 2>&1
        step_ok "Repository updated"
    else
        # Clone into a temp dir first, then move contents
        local tmp_dir
        tmp_dir=$(mktemp -d)
        git clone --branch "$REPO_BRANCH" "$REPO_URL" "$tmp_dir" >> "$LOG_FILE" 2>&1

        # Move contents (preserving dirs we already created)
        cp -a "$tmp_dir"/. "$INSTALL_DIR"/
        rm -rf "$tmp_dir"

        chown -R "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR"
        chmod 755 "$INSTALL_DIR"
        usermod -aG "$INSTALL_USER" www-data 2>/dev/null || true
        step_ok "Repository cloned to $INSTALL_DIR"
    fi
}

# =============================================================================
# Python Environment
# =============================================================================

setup_python() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Setting up Python environment..."

    # Ensure pip is available (may be missing even if python3 is installed)
    if ! python3 -m pip --version &>/dev/null; then
        apt-get install -y -qq python3-pip >> "$LOG_FILE" 2>&1
    fi

    local venv_dir="$INSTALL_DIR/venv"

    # Check if venv exists AND is functional (not just the directory)
    if [ -d "$venv_dir" ] && "$venv_dir/bin/python3" -c "import sys" &>/dev/null; then
        step_ok "Virtual environment already exists and is functional"
    else
        if [ -d "$venv_dir" ]; then
            step "Virtual environment broken, recreating..."
            rm -rf "$venv_dir"
        fi
        sudo -u "$INSTALL_USER" python3 -m venv "$venv_dir"
        step_new "Virtual environment created"
    fi

    # Install requirements
    if [ -f "$INSTALL_DIR/requirements.txt" ]; then
        sudo -u "$INSTALL_USER" "$venv_dir/bin/pip" install -r "$INSTALL_DIR/requirements.txt" >> "$LOG_FILE" 2>&1
        step_ok "Python requirements installed (psutil, requests, pyjwt)"
    else
        step_skip "No requirements.txt found"
    fi
}

# =============================================================================
# Build Backend
# =============================================================================

build_backend() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Building backend..."

    cd "$INSTALL_DIR/dashboard/backend"

    sudo -u "$INSTALL_USER" npm ci >> "$LOG_FILE" 2>&1
    step_ok "Dependencies installed"

    sudo -u "$INSTALL_USER" npx prisma generate >> "$LOG_FILE" 2>&1
    step_ok "Prisma client generated"

    sudo -u "$INSTALL_USER" npm run build >> "$LOG_FILE" 2>&1
    step_ok "Backend built"
    # Note: npm prune --omit=dev is intentionally done in run_db_migrations()
    # AFTER migrations run, because prisma CLI is a devDependency and is needed
    # for 'npx prisma migrate deploy'.

    # Ensure data directory exists for SQLite
    mkdir -p "$INSTALL_DIR/dashboard/backend/data"
    chown -R "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR/dashboard/backend/data"
}

# =============================================================================
# Database Migrations (after generate_configs so DATABASE_URL exists in .env)
# =============================================================================

run_db_migrations() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return 0
    fi

    step "Applying database migrations..."

    cd "$INSTALL_DIR/dashboard/backend"

    # Prisma reads DATABASE_URL from .env automatically when run in the project directory.
    # Do NOT extract and re-pass DATABASE_URL manually – grep/cut leaves literal quotes in
    # the value (e.g. "file:./data/multibase.db") which causes Prisma P1003 errors.
    if ! sudo -u "$INSTALL_USER" npx prisma migrate deploy >> "$LOG_FILE" 2>&1; then
        echo -e "${RED}ERROR: Database migration failed. Check $LOG_FILE for details.${NC}" >&2
        tail -20 "$LOG_FILE" >&2
        exit 1
    fi
    step_ok "Database migrations applied"

    # Prune devDependencies omitted to prevent empty node_modules under NPM 10+
    # cd "$INSTALL_DIR/dashboard/backend"
    # sudo -u "$INSTALL_USER" npm prune --omit=dev >> "$LOG_FILE" 2>&1
    step_ok "Backend dependencies preserved"
}

# =============================================================================
# Build Frontend
# =============================================================================

build_frontend() {
    if [ "$DEPLOY_MODE" = "split-backend" ]; then
        return
    fi

    step "Building frontend..."

    cd "$INSTALL_DIR/dashboard/frontend"

    sudo -u "$INSTALL_USER" npm ci >> "$LOG_FILE" 2>&1
    step_ok "Dependencies installed"

    sudo -u "$INSTALL_USER" npm run build >> "$LOG_FILE" 2>&1
    step_ok "Frontend built"
}

# =============================================================================
# Generate Configuration Files
# =============================================================================

generate_configs() {
    step "Generating configuration files..."

    # Preserve SESSION_SECRET and REDIS_PASSWORD on re-run to avoid
    # invalidating all user sessions and restarting Redis unnecessarily.
    local existing_session_secret=""
    local existing_redis_password=""
    if [ -f "$INSTALL_DIR/dashboard/backend/.env" ]; then
        existing_session_secret=$(grep -m1 '^SESSION_SECRET=' "$INSTALL_DIR/dashboard/backend/.env" | cut -d= -f2- | tr -d '"' || true)
        existing_redis_password=$(grep -m1 '^REDIS_URL=' "$INSTALL_DIR/dashboard/backend/.env" | sed -n 's|.*://:\([^@]*\)@.*|\1|p' || true)
    fi

    local session_secret
    session_secret=${existing_session_secret:-$(generate_secret)}
    local redis_password
    redis_password=${existing_redis_password:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}

    # Preserve existing admin password when re-running (ADMIN_PASS="__existing__")
    local effective_admin_pass="${ADMIN_PASS}"
    if [ "$ADMIN_PASS" = "__existing__" ] || [ -z "$ADMIN_PASS" ]; then
        local prev_pass
        prev_pass=$(grep -m1 '^DEFAULT_ADMIN_PASSWORD=' "$INSTALL_DIR/dashboard/backend/.env" 2>/dev/null | cut -d= -f2- || true)
        if [ -n "$prev_pass" ] && [ "$prev_pass" != "__existing__" ]; then
            effective_admin_pass="$prev_pass"
        else
            effective_admin_pass=""
        fi
    fi

    # ROOT_DOMAIN: 2nd-level base domain for instance subdomains.
    # backend.tyto-design.de  → tyto-design.de
    # tyto-design.de          → tyto-design.de  (already base)
    local root_domain
    root_domain=$(echo "${BACKEND_DOMAIN}" | awk -F. 'NF>=3{print $(NF-1)"."$NF; next} {print}')

    # Backend .env (only for single + split-backend)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        cat > "$INSTALL_DIR/dashboard/backend/.env" <<EOF
# Multibase Backend Configuration
# Generated by installer v${SCRIPT_VERSION} on $(date)

# Server
PORT=3001
NODE_ENV=production

# Database (SQLite)
DATABASE_URL="file:./data/multibase.db"

# Redis
REDIS_URL=redis://:${redis_password}@localhost:6379

# Docker
DOCKER_HOST=tcp://127.0.0.1:2375
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Paths
PROJECTS_PATH=${INSTALL_DIR}/projects
PYTHON_PATH=${INSTALL_DIR}/venv/bin/python3
BACKUP_PATH=${INSTALL_DIR}/backups
SHARED_DIR=${INSTALL_DIR}/shared

# Domains
BACKEND_DOMAIN=${BACKEND_DOMAIN}
ROOT_DOMAIN=${root_domain}
FRONTEND_DOMAIN=${FRONTEND_DOMAIN:-${BACKEND_DOMAIN}}
DASHBOARD_URL=https://${FRONTEND_DOMAIN:-${BACKEND_DOMAIN}}
BACKEND_URL=https://${BACKEND_DOMAIN}
COOKIE_DOMAIN=.${root_domain}

# SSL / Certbot
SSL_EMAIL=${SSL_EMAIL}
CERTBOT_EMAIL=${SSL_EMAIL}
SSL_TYPE=${SSL_TYPE:-per-tenant}

# App URLs
APP_URL=https://${FRONTEND_DOMAIN:-${BACKEND_DOMAIN}}
DASHBOARD_URL=https://${FRONTEND_DOMAIN:-${BACKEND_DOMAIN}}

# CORS
CORS_ORIGIN=${FRONTEND_URL}

# Logging
LOG_LEVEL=info

# Metrics
METRICS_INTERVAL=15000
HEALTH_CHECK_INTERVAL=10000
ALERT_CHECK_INTERVAL=60000

# Session
SESSION_SECRET=${session_secret}

# Update Security Gate
# Image updates stay blocked until an operator explicitly approves the
# reviewed image matrix in the environment.
IMAGE_UPDATE_SECURITY_GATE=${IMAGE_UPDATE_SECURITY_GATE:-blocked}

# Initial admin credentials (used by backend on first start if no admin exists)
DEFAULT_ADMIN_USERNAME=${ADMIN_USER}
DEFAULT_ADMIN_EMAIL=${ADMIN_EMAIL}
DEFAULT_ADMIN_PASSWORD=${effective_admin_pass}

# Installer metadata (used for re-run detection)
INSTALLER_DEPLOY_MODE=${DEPLOY_MODE}
INSTALLER_ADMIN_USER=${ADMIN_USER}
INSTALLER_ADMIN_EMAIL=${ADMIN_EMAIL}
INSTALLER_SSL_ENABLED=${SSL_ENABLED}
INSTALLER_UFW_ENABLED=${UFW_ENABLED}
EOF
        chown "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR/dashboard/backend/.env"
        chmod 600 "$INSTALL_DIR/dashboard/backend/.env"
        step_ok "Backend .env created"
    fi

    # Frontend .env (only for single + split-frontend)
    if [ "$DEPLOY_MODE" != "split-backend" ]; then
        cat > "$INSTALL_DIR/dashboard/frontend/.env" <<EOF
# Multibase Frontend Configuration
# Generated by installer v${SCRIPT_VERSION} on $(date)
VITE_API_URL=${BACKEND_URL}
VITE_ROOT_DOMAIN=${root_domain}
EOF
        chown "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR/dashboard/frontend/.env"
        chmod 600 "$INSTALL_DIR/dashboard/frontend/.env"
        step_ok "Frontend .env created (VITE_API_URL=${BACKEND_URL})"

        # .env.production has higher Vite priority than .env — overwrite it too
        # to prevent a stale repo value from overriding the installer-generated URL.
        cat > "$INSTALL_DIR/dashboard/frontend/.env.production" <<EOF
# Generated by installer v${SCRIPT_VERSION} on $(date)
VITE_PORT=5173
VITE_API_URL=${BACKEND_URL}
VITE_ROOT_DOMAIN=${root_domain}
EOF
        chown "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR/dashboard/frontend/.env.production"
        chmod 600 "$INSTALL_DIR/dashboard/frontend/.env.production"
        step_ok "Frontend .env.production updated (VITE_API_URL=${BACKEND_URL})"
    fi

    # PM2 ecosystem (only for single + split-backend)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        cat > "$INSTALL_DIR/ecosystem.config.js" <<EOF
module.exports = {
  apps: [{
    name: '${PM2_APP_NAME}',
    cwd: '${INSTALL_DIR}/dashboard/backend',
    script: 'dist/server.js',
    exec_mode: 'fork',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    autorestart: true,
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '${INSTALL_DIR}/logs/backend-error.log',
    out_file: '${INSTALL_DIR}/logs/backend-out.log'
  }]
};
EOF
        chown "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR/ecosystem.config.js"
        step_ok "PM2 ecosystem.config.js created"
    fi
}

# =============================================================================
# Sudoers – nginx reload + certbot without password prompt
# =============================================================================

setup_sudoers() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Configuring sudoers for nginx and certbot..."

    cat > /etc/sudoers.d/multibase <<EOF
# Multibase: allow backend service to reload nginx and run certbot without password
${INSTALL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx -s reload
${INSTALL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
${INSTALL_USER} ALL=(ALL) NOPASSWD: /usr/bin/certbot certonly *
${INSTALL_USER} ALL=(ALL) NOPASSWD: /usr/bin/certbot install *
${INSTALL_USER} ALL=(ALL) NOPASSWD: /usr/bin/certbot renew --no-random-sleep-on-renew
${INSTALL_USER} ALL=(ALL) NOPASSWD: /snap/bin/certbot certonly *
${INSTALL_USER} ALL=(ALL) NOPASSWD: /snap/bin/certbot install *
${INSTALL_USER} ALL=(ALL) NOPASSWD: /snap/bin/certbot renew --no-random-sleep-on-renew
EOF
    chmod 440 /etc/sudoers.d/multibase
    visudo -c -f /etc/sudoers.d/multibase >> "$LOG_FILE" 2>&1
    step_ok "sudoers configured for ${INSTALL_USER} (nginx + certbot)"
}

# =============================================================================
# Shared Infrastructure Setup
# =============================================================================

setup_shared_infra() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Setting up Shared Infrastructure..."

    local shared_dir="${INSTALL_DIR}/shared"
    local python="${INSTALL_DIR}/venv/bin/python3"

    # 1. Generate .env.shared with secure secrets (only if not present)
    if [ ! -f "${shared_dir}/.env.shared" ]; then
        sudo -u "$INSTALL_USER" "$python" "${INSTALL_DIR}/setup_shared.py" init >> "$LOG_FILE" 2>&1
        step_ok ".env.shared generated with secure secrets"
    else
        step_ok ".env.shared already exists – skipping generation"
    fi

    # 2. Patch SHARED_PUBLIC_URL to the configured backend domain
    if [ -n "$BACKEND_DOMAIN" ]; then
        sed -i "s|SHARED_PUBLIC_URL=.*|SHARED_PUBLIC_URL=https://${BACKEND_DOMAIN}|" \
            "${shared_dir}/.env.shared"
    fi

    local compose_file="${shared_dir}/docker-compose.shared.yml"
    local env_file="${shared_dir}/.env.shared"

    # 3. Pull images — show per-image progress (first install ~8 GB, can take 10–20 min)
    echo ""
    echo -e "        ${DIM}[1/2] Pulling Docker images (first install ~8 GB, may take 10–20 min)...${NC}"
    local images
    images=$(docker compose --file "$compose_file" --env-file "$env_file" \
        --project-name multibase-shared config --images 2>/dev/null || true)
    for img in $images; do
        if docker image inspect "$img" &>/dev/null; then
            echo -e "        ${GREEN}✓${NC} ${DIM}${img} (already cached)${NC}"
            log "  Image cached: $img"
        else
            echo -e "        ${YELLOW}↓${NC} ${DIM}Pulling ${img}...${NC}"
            if docker pull "$img" >> "$LOG_FILE" 2>&1; then
                echo -e "        ${GREEN}✓${NC} ${DIM}${img} pulled${NC}"
                log "  Image pulled: $img"
            else
                echo -e "        ${RED}✗${NC} ${DIM}Failed to pull ${img}${NC}"
                log "  ERROR pulling image: $img"
            fi
        fi
    done
    echo ""

    # 4. Start shared stack and show per-container status
    # Future option: Force Docker to re-apply updated port bindings (e.g. 127.0.0.1) immediately on update:
    # docker compose --file "$compose_file" --env-file "$env_file" --project-name multibase-shared up -d --force-recreate
    sudo -u "$INSTALL_USER" "$python" "${INSTALL_DIR}/setup_shared.py" start >> "$LOG_FILE" 2>&1
    # Print status of each container
    docker compose --file "$compose_file" --env-file "$env_file" \
        --project-name multibase-shared ps \
        --format "table {{.Name}}\t{{.Status}}" 2>/dev/null | tail -n +2 | \
        while IFS=$'\t' read -r name status; do
            if echo "$status" | grep -qi "up\|running\|healthy"; then
                echo -e "        ${GREEN}✓${NC} ${DIM}${name} — ${status}${NC}"
            elif echo "$status" | grep -qi "starting\|health"; then
                echo -e "        ${YELLOW}⏳${NC} ${DIM}${name} — ${status}${NC}"
            else
                echo -e "        ${RED}✗${NC} ${DIM}${name} — ${status}${NC}"
            fi
        done
    echo ""
    step_ok "Shared stack started"

    # 5. Wait for PostgreSQL to be ready (max 60 s)
    step "Waiting for PostgreSQL to be ready..."
    local retries=0
    until docker exec multibase-db pg_isready -U postgres -q 2>/dev/null; do
        retries=$((retries + 1))
        if [ "$retries" -ge 60 ]; then
            step_fail "PostgreSQL did not become ready within 60 seconds"
            error_exit "Shared PostgreSQL failed to start — check 'docker logs multibase-db'"
        fi
        sleep 1
    done
    step_ok "PostgreSQL is ready"

    # 6. Fix postgres data directory ownership so TCP connections work
    #    The supabase/postgres image runs as UID 105 (postgres user inside container)
    #    but Docker volume dirs may be created as root or INSTALL_USER. Fix it now.
    local db_data_dir="${INSTALL_DIR}/shared/volumes/db/data"
    if [ -d "$db_data_dir" ]; then
        chown -R 105:106 "$db_data_dir" >> "$LOG_FILE" 2>&1 || true
        log "Fixed postgres data directory ownership to 105:106"
    fi
}

# =============================================================================
# Redis Container
# =============================================================================

start_redis() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Starting Redis..."

    # Always read password from .env - single source of truth
    local redis_pass
    redis_pass=$(grep -m1 '^REDIS_URL=' "$INSTALL_DIR/dashboard/backend/.env" | sed -n 's|.*://:\([^@]*\)@.*|\1|p')

    if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
        # Container is running - verify the password matches to catch re-install drift
        local current_pass
        current_pass=$(docker inspect "$REDIS_CONTAINER" 2>/dev/null \
            | python3 -c "import sys,json; c=json.load(sys.stdin)[0]; args=' '.join(c['Args']); idx=args.find('--requirepass'); print(args[idx:].split()[1] if idx>=0 else '')" 2>/dev/null || true)

        if [ "$current_pass" = "$redis_pass" ]; then
            step_ok "Redis container already running (password matches)"
        else
            step "Redis password mismatch - restarting with updated password..."
            docker rm -f "$REDIS_CONTAINER" &>/dev/null || true
            docker run -d \
                --name "$REDIS_CONTAINER" \
                --restart unless-stopped \
                -p 127.0.0.1:6379:6379 \
                redis:7-alpine \
                redis-server --requirepass "$redis_pass" >> "$LOG_FILE" 2>&1
            step_new "Redis container restarted with new password"
        fi
    else
        # Remove stopped container if exists
        docker rm -f "$REDIS_CONTAINER" &>/dev/null || true

        docker run -d \
            --name "$REDIS_CONTAINER" \
            --restart unless-stopped \
            -p 127.0.0.1:6379:6379 \
            redis:7-alpine \
            redis-server --requirepass "$redis_pass" >> "$LOG_FILE" 2>&1

        step_new "Redis container started"
    fi
}

start_docker_proxy() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Starting Docker Socket Proxy..."

    local proxy_container="multibase-docker-proxy"
    if docker ps --format '{{.Names}}' | grep -q "^${proxy_container}$"; then
        step_ok "Docker Socket Proxy already running"
    else
        docker rm -f "$proxy_container" &>/dev/null || true
        docker run -d \
            --name "$proxy_container" \
            --restart unless-stopped \
            -p 127.0.0.1:2375:2375 \
            -v /var/run/docker.sock:/var/run/docker.sock:ro \
            -e CONTAINERS=1 \
            -e POST=1 \
            -e IMAGES=1 \
            -e NETWORKS=1 \
            -e INFO=1 \
            -e VERSION=1 \
            -e PING=1 \
            -e EVENTS=1 \
            -e VOLUMES=0 \
            -e BUILD=0 \
            -e PRIVILEGED=0 \
            tecnativa/docker-socket-proxy >> "$LOG_FILE" 2>&1
        step_new "Docker Socket Proxy started on 127.0.0.1:2375"
    fi
}

# =============================================================================
# Nginx Configuration
# =============================================================================

configure_nginx() {
    step "Configuring Nginx..."

    # Frontend vhost (single + split-frontend)
    if [ "$DEPLOY_MODE" != "split-backend" ]; then
        cat > /etc/nginx/sites-available/multibase-frontend <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${FRONTEND_DOMAIN};
    root ${INSTALL_DIR}/dashboard/frontend/dist;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # HTTPS redirect
    if (\$scheme != "https") {
        rewrite ^ https://\$host\$request_uri permanent;
    }

    # Let's Encrypt challenge
    location ~ /.well-known {
        auth_basic off;
        allow all;
    }

    # API Proxy to backend
    location /api {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host ${BACKEND_DOMAIN};
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # WebSocket proxy (Socket.IO for realtime logs)
    location /socket.io {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host ${BACKEND_DOMAIN};
        proxy_read_timeout 3600s;
    }

    # Static asset caching
    location ~* ^.+\.(css|js|jpg|jpeg|gif|png|ico|svg|woff|woff2|ttf|otf|eot|webp|mp4|ogg|webm|zip)$ {
        add_header Access-Control-Allow-Origin "*";
        expires max;
        access_log off;
    }

    # React Router SPA fallback
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
        ln -sf /etc/nginx/sites-available/multibase-frontend /etc/nginx/sites-enabled/
        step_ok "Frontend vhost created (${FRONTEND_DOMAIN})"
    fi

    # Backend vhost (single + split-backend)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        cat > /etc/nginx/sites-available/multibase-backend <<EOF
server {
    server_name ${BACKEND_DOMAIN};
    listen 80;
    client_max_body_size 100M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # API proxy
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 3600s;
    }
}

# Include dynamic instance configs
include ${INSTALL_DIR}/nginx/sites-enabled/*.conf;
EOF
        ln -sf /etc/nginx/sites-available/multibase-backend /etc/nginx/sites-enabled/
        step_ok "Backend vhost created (${BACKEND_DOMAIN})"
    fi

    # Remove default site if it exists
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    # Test and reload
    nginx -t >> "$LOG_FILE" 2>&1
    systemctl reload nginx
    step_ok "Nginx configuration tested and reloaded"
}

# =============================================================================
# Shared Infrastructure – Systemd Auto-Start
# =============================================================================

setup_shared_autostart() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Configuring Shared Infrastructure auto-start on boot..."

    cat > /etc/systemd/system/multibase-shared.service <<EOF
[Unit]
Description=Multibase Shared Infrastructure (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${INSTALL_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/venv/bin/python3 ${INSTALL_DIR}/setup_shared.py start
ExecStop=/usr/bin/docker compose \\
    -f ${INSTALL_DIR}/shared/docker-compose.shared.yml \\
    --env-file ${INSTALL_DIR}/shared/.env.shared down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable multibase-shared.service
    step_ok "multibase-shared.service enabled (auto-start on reboot)"
}

# =============================================================================
# PM2 Setup
# =============================================================================

start_pm2() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Starting backend via PM2..."

    # Stop existing if running
    su - "$INSTALL_USER" -s /bin/bash -c "pm2 delete '$PM2_APP_NAME'" 2>/dev/null || true

    # Start with ecosystem file (requires login shell for PM2 daemon spawn)
    cd "$INSTALL_DIR"
    su - "$INSTALL_USER" -s /bin/bash -c "cd '$INSTALL_DIR' && pm2 start ecosystem.config.js"  >> "$LOG_FILE" 2>&1
    step_ok "Backend started"

    # Save PM2 process list
    su - "$INSTALL_USER" -s /bin/bash -c "pm2 save" >> "$LOG_FILE" 2>&1
    step_ok "PM2 process list saved"

    # Setup PM2 startup script
    env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$INSTALL_USER" --hp "/home/$INSTALL_USER" >> "$LOG_FILE" 2>&1
    step_ok "PM2 startup configured (auto-start on reboot)"

    # Install log rotation
    su - "$INSTALL_USER" -s /bin/bash -c "pm2 install pm2-logrotate" >> "$LOG_FILE" 2>&1
    step_ok "PM2 log rotation enabled"
}

# =============================================================================
# SSL Setup
# =============================================================================

setup_ssl() {
    if [ "$SSL_ENABLED" != "y" ]; then
        return
    fi

    step "Setting up SSL certificates..."

    local domains=()

    if [ "$DEPLOY_MODE" != "split-backend" ]; then
        domains+=("$FRONTEND_DOMAIN")
    fi

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        domains+=("$BACKEND_DOMAIN")
    fi

    if [ "$SSL_TYPE" = "wildcard" ]; then
        # Wildcard: one cert per unique base domain via DNS-01 challenge
        local base_domains=()
        for domain in "${domains[@]}"; do
            # Strip one subdomain level to get base domain (e.g. api.example.com → example.com)
            local base
            base=$(echo "$domain" | awk -F. 'NF>=2{print $(NF-1)"."$NF}')
            local found=0
            for bd in "${base_domains[@]:-}"; do [ "$bd" = "$base" ] && found=1; done
            [ $found -eq 0 ] && base_domains+=("$base")
        done

        for base in "${base_domains[@]}"; do
            if [ -d "/etc/letsencrypt/live/${base}" ]; then
                # Cert exists but nginx config was just re-written (HTTP-only) — re-apply SSL
                for domain in "${domains[@]}"; do
                    local d_base
                    d_base=$(echo "$domain" | awk -F. 'NF>=2{print $(NF-1)"."$NF}')
                    if [ "$d_base" = "$base" ]; then
                        certbot install --nginx \
                            -d "$domain" \
                            --cert-name "${base}" \
                            --non-interactive >> "$LOG_FILE" 2>&1 || true
                    fi
                done
                step_ok "Wildcard SSL certificate for *.${base} re-applied to nginx"
            else
                echo ""
                echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "  ${YELLOW}ACTION REQUIRED — Wildcard SSL for *.${base}${NC}"
                echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                echo -e "  certbot will now show you a DNS TXT record to add."
                echo ""
                echo -e "  ${BOLD}IMPORTANT: Do NOT press Enter immediately!${NC}"
                echo -e "  After adding the TXT record at your DNS provider, verify"
                echo -e "  that it has propagated by running this command in another"
                echo -e "  terminal ${BOLD}before${NC} pressing Enter:"
                echo ""
                echo -e "  ${CYAN}  dig TXT _acme-challenge.${base} +short${NC}"
                echo -e "  ${DIM}  (or: nslookup -type=TXT _acme-challenge.${base} 8.8.8.8)${NC}"
                echo ""
                echo -e "  Only press Enter once the expected value appears in the output."
                echo -e "  DNS propagation typically takes 1–5 minutes."
                echo ""
                # certbot --manual is interactive: stdin must be /dev/tty (real terminal).
                # Do NOT pipe stdout/stderr — that breaks the interactive prompt.
                # This also fixes the EOFError when the installer runs via "curl | bash".
                log "Running interactive certbot for *.${base} ..."
                if ! certbot certonly \
                    --manual \
                    --preferred-challenges dns \
                    -d "*.${base}" \
                    --email "$SSL_EMAIL" \
                    --agree-tos \
                    < /dev/tty; then
                    echo -e "${RED}ERROR: certbot failed for *.${base}. See /var/log/letsencrypt/letsencrypt.log${NC}" >&2
                    log "ERROR: certbot certonly failed for *.${base}"
                    exit 1
                fi
                log "certbot certonly succeeded for *.${base}"
                # Install cert into nginx for each domain
                for domain in "${domains[@]}"; do
                    local d_base
                    d_base=$(echo "$domain" | awk -F. 'NF>=2{print $(NF-1)"."$NF}')
                    if [ "$d_base" = "$base" ]; then
                        certbot install \
                            --nginx \
                            -d "$domain" \
                            --cert-name "${base}" >> "$LOG_FILE" 2>&1 || true
                    fi
                done
                step_new "Wildcard SSL certificate obtained for *.${base}"
            fi
        done
    else
        for domain in "${domains[@]}"; do
            if [ -d "/etc/letsencrypt/live/$domain" ]; then
                # Cert exists but nginx config was just re-written (HTTP-only) — re-apply SSL
                certbot install --nginx \
                    -d "$domain" \
                    --cert-name "$domain" \
                    --non-interactive >> "$LOG_FILE" 2>&1
                step_ok "SSL certificate for $domain re-applied to nginx"
            else
                certbot --nginx \
                    -d "$domain" \
                    --email "$SSL_EMAIL" \
                    --agree-tos \
                    --non-interactive \
                    --redirect >> "$LOG_FILE" 2>&1
                step_new "SSL certificate obtained for $domain"
            fi
        done
    fi
}

# =============================================================================
# Firewall & Swap
# =============================================================================

setup_firewall_swap() {
    step "Configuring firewall and swap..."

    # UFW
    if [ "$UFW_ENABLED" = "y" ]; then
        ufw allow 22/tcp >> "$LOG_FILE" 2>&1
        ufw allow 80/tcp >> "$LOG_FILE" 2>&1
        ufw allow 443/tcp >> "$LOG_FILE" 2>&1
        ufw --force enable >> "$LOG_FILE" 2>&1
        step_ok "UFW firewall enabled (ports 22, 80, 443)"
    else
        step_skip "UFW firewall (disabled)"
    fi

    # Swap
    if [ "$SWAP_ENABLED" = "y" ]; then
        if [ ! -f /swapfile ]; then
            fallocate -l 2G /swapfile
            chmod 600 /swapfile
            mkswap /swapfile >> "$LOG_FILE" 2>&1
            swapon /swapfile
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
            step_new "2 GB swap file created"
        else
            step_ok "Swap file already exists"
        fi
    else
        step_skip "Swap file (disabled)"
    fi
}

# =============================================================================
# Admin User Creation
# =============================================================================

create_admin() {
    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        return
    fi

    step "Creating admin account..."

    cd "$INSTALL_DIR/dashboard/backend"

    # Check if a non-default admin already exists in the DB
    local existing_email
    existing_email=$(DATABASE_URL="file:./data/multibase.db" \
        sudo -u "$INSTALL_USER" -E node -e "
        const {PrismaClient}=require('/opt/multibase/dashboard/backend/node_modules/@prisma/client');
        const p=new PrismaClient();
        p.user.findFirst({where:{role:'admin'}}).then(u=>{process.stdout.write(u?u.email:'');p.\$disconnect();});
        " 2>/dev/null || echo '')

    if [ -n "$existing_email" ] && [ "$existing_email" != "admin@multibase.local" ]; then
        step_skip "Admin account (existing: ${existing_email})"
        return
    fi

    # No admin or only the hardcoded default exists — create/update with wizard credentials
    if [ -z "$ADMIN_PASS" ] || [ "$ADMIN_PASS" = "__existing__" ]; then
        step_skip "Admin account (no password provided — keeping existing credentials)"
        return
    fi

    cd "$INSTALL_DIR/dashboard/backend"

    # Create a temporary Node.js script to seed the admin user
    # Uses upsert: updates the default admin@multibase.local if it exists, otherwise creates new
    cat > /tmp/multibase-create-admin.js <<'SCRIPT'
const { PrismaClient } = require('/opt/multibase/dashboard/backend/node_modules/@prisma/client');
const bcrypt = require('/opt/multibase/dashboard/backend/node_modules/bcryptjs');

async function main() {
    const prisma = new PrismaClient();

    const username = process.env.ADMIN_USER;
    const email    = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASS;

    const hash = await bcrypt.hash(password, 12);

    // If the hardcoded default admin exists, update it with the real credentials
    const defaultAdmin = await prisma.user.findFirst({
        where: { email: 'admin@multibase.local' }
    });

    if (defaultAdmin) {
        await prisma.user.update({
            where: { id: defaultAdmin.id },
            data: { username, email, passwordHash: hash, isActive: true, isEmailVerified: true }
        });
        console.log(`Admin updated: ${email}`);
    } else {
        // Check if target email/username already exists (non-default)
        const existing = await prisma.user.findFirst({
            where: { OR: [{ email }, { username }] }
        });
        if (existing) {
            console.log(`Admin already exists: ${existing.email}`);
        } else {
            await prisma.user.create({
                data: { username, email, passwordHash: hash, role: 'admin', isActive: true, isEmailVerified: true }
            });
            console.log(`Admin created: ${email}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(e => {
    console.error('Error creating admin:', e.message);
    process.exit(1);
});
SCRIPT

    ADMIN_USER="$ADMIN_USER" \
    ADMIN_EMAIL="$ADMIN_EMAIL" \
    ADMIN_PASS="$ADMIN_PASS" \
    DATABASE_URL="file:./data/multibase.db" \
    sudo -u "$INSTALL_USER" -E node /tmp/multibase-create-admin.js >> "$LOG_FILE" 2>&1

    rm -f /tmp/multibase-create-admin.js
    step_ok "Admin account created ($ADMIN_USER)"
}

# =============================================================================
# Verification
# =============================================================================

verify_installation() {
    step "Verifying installation..."

    local all_ok=true

    # Check Nginx
    if systemctl is-active --quiet nginx; then
        step_ok "Nginx is running"
    else
        step_fail "Nginx is not running"
        all_ok=false
    fi

    # Check PM2 (backend modes only)
    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        if sudo -u "$INSTALL_USER" pm2 show "$PM2_APP_NAME" &>/dev/null; then
            step_ok "Backend is running via PM2"
        else
            step_fail "Backend is not running"
            all_ok=false
        fi

        # Check Redis
        if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
            step_ok "Redis container is running"
        else
            step_fail "Redis container is not running"
            all_ok=false
        fi
    fi

    # Check frontend files exist
    if [ "$DEPLOY_MODE" != "split-backend" ]; then
        if [ -f "$INSTALL_DIR/dashboard/frontend/dist/index.html" ]; then
            step_ok "Frontend build files exist"
        else
            step_fail "Frontend build files not found"
            all_ok=false
        fi
    fi

    if [ "$all_ok" = false ]; then
        echo ""
        echo -e "  ${YELLOW}Some checks failed. Review the log: ${LOG_FILE}${NC}"
    fi
}

# =============================================================================
# Completion Screen
# =============================================================================

show_completion() {
    echo ""
    echo -e "${MB_GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${MB_GREEN}║${NC}  ${MB_GREEN_BOLD}✓  Installation Complete!${NC}                           ${MB_GREEN}║${NC}"
    echo -e "${MB_GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    case "$DEPLOY_MODE" in
        single)
            echo -e "  Frontend:  ${BOLD}https://${FRONTEND_DOMAIN}${NC}"
            echo -e "  Backend:   ${BOLD}https://${BACKEND_DOMAIN}${NC}"
            ;;
        split-frontend)
            echo -e "  Frontend:  ${BOLD}https://${FRONTEND_DOMAIN}${NC}"
            echo -e "  Backend:   ${DIM}${BACKEND_URL} (remote)${NC}"
            ;;
        split-backend)
            echo -e "  Backend:   ${BOLD}https://${BACKEND_DOMAIN}${NC}"
            echo -e "  Frontend:  ${DIM}${FRONTEND_URL} (remote)${NC}"
            ;;
    esac

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        echo ""
        echo -e "  ${BOLD}Admin Login:${NC}"
        echo -e "    Username:  ${ADMIN_USER}"
        echo -e "    Email:     ${ADMIN_EMAIL}"
        echo -e "    Password:  ${ADMIN_PASS}"
        echo ""
        echo -e "  ${YELLOW}Save these credentials! They will not be shown again.${NC}"
    fi

    echo ""
    echo -e "  ${BOLD}Next Steps:${NC}"
    echo "    - Point your DNS records to this server's IP"

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        echo "    - Set up *.${BACKEND_DOMAIN} wildcard DNS"
        echo "      for Supabase instance subdomains"
    fi

    if [ "$DEPLOY_MODE" = "split-backend" ]; then
        echo "    - Run the installer on your frontend server"
        echo "      and choose option [2] Split VPS -- Frontend Only"
    fi

    if [ "$DEPLOY_MODE" = "split-frontend" ]; then
        echo "    - Make sure your backend server is running"
    fi

    echo "    - Log in and create your first Supabase instance"

    echo ""
    echo -e "  ${BOLD}Useful Commands:${NC}"

    if [ "$DEPLOY_MODE" != "split-frontend" ]; then
        echo ""
        echo -e "  ${BOLD}Service User:${NC}"
        echo -e "    The backend runs as system user ${CYAN}${INSTALL_USER}${NC}."
        echo -e "    This user has no password (security best practice)."
        echo -e "    To switch to this user for PM2/log access:"
        echo ""
        echo -e "    ${CYAN}sudo su - ${INSTALL_USER}${NC}"
        echo ""
        echo "    pm2 status                     -- Check backend status"
        echo "    pm2 logs multibase-backend     -- View backend logs"
        echo "    pm2 restart multibase-backend  -- Restart backend"
    fi

    echo "    sudo nginx -t                  -- Test Nginx config"
    echo "    sudo systemctl reload nginx    -- Reload Nginx"

    echo ""
    echo -e "  ${BOLD}Management:${NC}"
    echo "    Update:     sudo ${INSTALL_DIR}/deployment/install.sh --update"
    echo "    Uninstall:  sudo ${INSTALL_DIR}/deployment/install.sh --uninstall"

    echo ""
    echo -e "  ${DIM}Install log: ${LOG_FILE}${NC}"
    echo -e "${MB_GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# =============================================================================
# Update Mode
# =============================================================================

run_update() {
    echo ""
    echo -e "${CYAN}Multibase Dashboard -- Update${NC}"
    echo ""

    if [ ! -d "$INSTALL_DIR/.git" ]; then
        error_exit "No installation found at $INSTALL_DIR"
    fi

    TOTAL_STEPS=7
    CURRENT_STEP=0

    step "Pulling latest changes..."
    cd "$INSTALL_DIR"
    sudo -u "$INSTALL_USER" git fetch origin main >> "$LOG_FILE" 2>&1
    sudo -u "$INSTALL_USER" git reset --hard origin/main >> "$LOG_FILE" 2>&1
    step_ok "Repository updated"

    # Re-execute script if this is the first pass, ensuring updated install.sh runs cleanly from start
    if [ -z "$INSTALL_REEXEC" ]; then
        export INSTALL_REEXEC=1
        exec bash "$0" "$@"
    fi

    step "Installing workspace dependencies..."
    cd "$INSTALL_DIR"
    sudo -u "$INSTALL_USER" npm ci >> "$LOG_FILE" 2>&1
    step_ok "Workspace dependencies installed"

    step "Rebuilding backend..."
    cd "$INSTALL_DIR/dashboard/backend"
    sudo -u "$INSTALL_USER" npx prisma generate >> "$LOG_FILE" 2>&1
    sudo -u "$INSTALL_USER" npm run build >> "$LOG_FILE" 2>&1
    step_ok "Backend built"

    step "Running database migrations..."
    # Prisma reads DATABASE_URL from .env automatically – do not extract manually.
    if ! sudo -u "$INSTALL_USER" npx prisma migrate deploy >> "$LOG_FILE" 2>&1; then
        echo -e "${RED}ERROR: Database migration failed. Check $LOG_FILE for details.${NC}" >&2
        tail -20 "$LOG_FILE" >&2
        exit 1
    fi
    step_ok "Migrations applied"

    step "Rebuilding frontend..."
    cd "$INSTALL_DIR/dashboard/frontend"
    # Update VITE_API_URL in .env.production from existing backend config
    # (git pull may have overwritten .env.production with the repo placeholder)
    local _backend_url _root_domain
    _backend_url=$(grep -m1 '^BACKEND_URL=' "$INSTALL_DIR/dashboard/backend/.env" 2>/dev/null | cut -d= -f2- || true)
    _root_domain=$(grep -m1 '^ROOT_DOMAIN=' "$INSTALL_DIR/dashboard/backend/.env" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$_backend_url" ]; then
        cat > "$INSTALL_DIR/dashboard/frontend/.env.production" <<ENVEOF
# Generated by installer --update on $(date)
VITE_PORT=5173
VITE_API_URL=${_backend_url}
VITE_ROOT_DOMAIN=${_root_domain}
ENVEOF
        step_ok "Frontend .env.production updated (VITE_API_URL=${_backend_url})"
    fi
    sudo -u "$INSTALL_USER" npm run build >> "$LOG_FILE" 2>&1
    step_ok "Frontend built"

    step "Restarting services..."
    if docker ps --format '{{.Names}}' | grep -q '^multibase-db$'; then
        docker exec -u 0 multibase-db chown -R postgres:postgres /var/lib/postgresql/data >> "$LOG_FILE" 2>&1 || true
    fi
    if [ -f "$INSTALL_DIR/ecosystem.config.js" ]; then
        sudo -u "$INSTALL_USER" -H pm2 startOrReload "$INSTALL_DIR/ecosystem.config.js" --update-env >> "$LOG_FILE" 2>&1
    elif sudo -u "$INSTALL_USER" -H pm2 describe "$PM2_APP_NAME" &>/dev/null; then
        sudo -u "$INSTALL_USER" -H pm2 restart "$PM2_APP_NAME" --update-env >> "$LOG_FILE" 2>&1
    else
        log "pm2 process not found, creating fresh process..."
        cd "$INSTALL_DIR/dashboard/backend"
        PORT=3001 NODE_ENV=production sudo -u "$INSTALL_USER" -H -E pm2 start dist/server.js --name "$PM2_APP_NAME" >> "$LOG_FILE" 2>&1
    fi
    sudo -u "$INSTALL_USER" -H pm2 save >> "$LOG_FILE" 2>&1
    step_ok "Backend restarted"
    nginx -t >> "$LOG_FILE" 2>&1
    systemctl reload nginx
    step_ok "Nginx reloaded"

    step "Verifying..."
    if curl -sI http://127.0.0.1:3001/api/health 2>/dev/null | grep -q "200"; then
        step_ok "Backend is running (online)"
    elif sudo -u "$INSTALL_USER" -H pm2 describe "$PM2_APP_NAME" 2>/dev/null | grep -qi "online"; then
        step_ok "Backend is running (online)"
    else
        step_fail "Backend is not running"
    fi

    echo ""
    echo -e "  ${GREEN}${BOLD}Update complete!${NC}"
    echo ""
}

# =============================================================================
# Uninstall Mode
# =============================================================================

run_uninstall() {
    local keep_data=false
    if [[ "${2:-}" == "--keep-data" ]]; then
        keep_data=true
    fi

    echo ""
    echo -e "${CYAN}Multibase Dashboard -- Uninstall${NC}"
    echo ""
    echo "  The following will be removed:"
    echo "    - PM2 processes (${PM2_APP_NAME})"
    echo "    - Nginx vhosts (multibase-frontend, multibase-backend)"
    echo "    - SSL certificates (via certbot)"
    echo "    - Redis container (${REDIS_CONTAINER})"
    echo "    - Install directory (${INSTALL_DIR})"
    echo "    - UFW rules"
    echo "    - System user (${INSTALL_USER})"
    echo ""
    echo "  NOT removed (system packages):"
    echo "    - Node.js, Docker, Nginx, Python3, PM2"

    if [ "$keep_data" = true ]; then
        echo ""
        echo -e "  ${YELLOW}--keep-data: Projects and database will be preserved${NC}"
    fi

    echo ""
    local confirm=""
    prompt_yn confirm "Continue with uninstall?" "n"

    if [ "$confirm" != "y" ]; then
        echo "  Uninstall cancelled."
        exit 0
    fi

    echo ""

    # Stop PM2
    echo -e "  Stopping PM2 processes..."
    sudo -u "$INSTALL_USER" pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
    sudo -u "$INSTALL_USER" pm2 save --force 2>/dev/null || true
    echo -e "  ${GREEN}[OK]${NC} PM2 processes stopped"

    # Remove Nginx vhosts
    echo -e "  Removing Nginx vhosts..."
    rm -f /etc/nginx/sites-enabled/multibase-frontend
    rm -f /etc/nginx/sites-enabled/multibase-backend
    rm -f /etc/nginx/sites-available/multibase-frontend
    rm -f /etc/nginx/sites-available/multibase-backend
    nginx -t &>/dev/null && systemctl reload nginx
    echo -e "  ${GREEN}[OK]${NC} Nginx vhosts removed"

    # Remove SSL certificates
    echo -e "  Removing SSL certificates..."
    for cert_dir in /etc/letsencrypt/live/*/; do
        local cert_name
        cert_name=$(basename "$cert_dir")
        if [[ "$cert_name" == *"multibase"* ]] || [[ "$cert_name" == "$FRONTEND_DOMAIN" ]] || [[ "$cert_name" == "$BACKEND_DOMAIN" ]]; then
            certbot delete --cert-name "$cert_name" --non-interactive 2>/dev/null || true
        fi
    done
    echo -e "  ${GREEN}[OK]${NC} SSL certificates removed"

    # Stop Redis container
    echo -e "  Stopping Redis container..."
    docker stop "$REDIS_CONTAINER" 2>/dev/null || true
    docker rm "$REDIS_CONTAINER" 2>/dev/null || true
    echo -e "  ${GREEN}[OK]${NC} Redis container removed"

    # Remove installation directory
    if [ "$keep_data" = true ]; then
        echo -e "  Preserving data directories..."
        # Keep projects and db, remove everything else
        local data_backup
        data_backup=$(mktemp -d)
        cp -a "$INSTALL_DIR/projects" "$data_backup/" 2>/dev/null || true
        cp -a "$INSTALL_DIR/dashboard/backend/data" "$data_backup/" 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        mkdir -p "$INSTALL_DIR/projects" "$INSTALL_DIR/dashboard/backend/data"
        cp -a "$data_backup/projects"/. "$INSTALL_DIR/projects/" 2>/dev/null || true
        cp -a "$data_backup/data"/. "$INSTALL_DIR/dashboard/backend/data/" 2>/dev/null || true
        rm -rf "$data_backup"
        echo -e "  ${GREEN}[OK]${NC} Data preserved, application removed"
    else
        rm -rf "$INSTALL_DIR"
        echo -e "  ${GREEN}[OK]${NC} Installation directory removed"
    fi

    # Remove user
    echo -e "  Removing system user..."
    userdel -r "$INSTALL_USER" 2>/dev/null || true
    echo -e "  ${GREEN}[OK]${NC} User removed"

    echo ""
    echo -e "  ${GREEN}${BOLD}Uninstall complete.${NC}"
    echo ""
}

# =============================================================================
# Cleanup Trap
# =============================================================================

cleanup() {
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}Installation failed. Check the log for details: ${LOG_FILE}${NC}"
        echo ""
    fi
    rm -f /tmp/multibase-create-admin.js 2>/dev/null || true
}

trap cleanup EXIT

# =============================================================================
# Main
# =============================================================================

main() {
    # Handle flags
    case "${1:-}" in
        --update)
            preflight_checks
            run_update
            exit 0
            ;;
        --uninstall)
            preflight_checks
            run_uninstall "$@"
            exit 0
            ;;
        --version)
            echo "Multibase Installer v${SCRIPT_VERSION}"
            exit 0
            ;;
        --help|-h)
            echo "Multibase Dashboard Installer v${SCRIPT_VERSION}"
            echo ""
            echo "Usage:"
            echo "  sudo bash install.sh              Fresh installation"
            echo "  sudo bash install.sh --update     Update existing installation"
            echo "  sudo bash install.sh --uninstall  Remove installation"
            echo "  sudo bash install.sh --uninstall --keep-data  Remove but keep data"
            echo ""
            exit 0
            ;;
    esac

    # Fresh installation
    preflight_checks
    show_banner
    run_wizard
    save_installer_state

    echo ""
    echo -e "${BOLD}Starting installation...${NC}"
    echo ""

    install_dependencies
    setup_user_dirs
    setup_sudoers
    clone_repo
    setup_python
    generate_configs
    build_backend
    setup_shared_infra
    build_frontend
    run_db_migrations
    start_docker_proxy
    start_redis
    configure_nginx
    start_pm2
    setup_shared_autostart
    setup_ssl
    setup_firewall_swap
    create_admin
    verify_installation
    show_completion
}

main "$@"
