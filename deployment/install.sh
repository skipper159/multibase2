#!/bin/bash
#
# Multibase Dashboard - Automated Installation Script
# =====================================================
# This script automates the complete installation of the Multibase Dashboard
# on a fresh Ubuntu/Debian server.
#
# Usage:
#   curl -sSL https://your-repo.com/install.sh | sudo bash
#   OR
#   sudo ./install.sh
#
# Supported OS: Ubuntu 20.04+, Debian 11+
#

set -e

# =============================================================================
# CONFIGURATION - Modify these variables as needed
# =============================================================================

INSTALL_DIR="/opt/multibase"
MULTIBASE_USER="multibase"
DOMAIN=""  # Will be prompted if empty
DB_PASSWORD=""  # Will be auto-generated if empty
JWT_SECRET=""  # Will be auto-generated if empty
REPO_URL="https://github.com/your-org/multibase.git"  # Change to your repo
BRANCH="main"

# =============================================================================
# COLORS AND HELPERS
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

generate_password() {
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32
}

# =============================================================================
# PRE-FLIGHT CHECKS
# =============================================================================

preflight_checks() {
    print_header "Pre-Flight Checks"
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
    print_step "Running as root"
    
    # Check OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VERSION=$VERSION_ID
    else
        print_error "Cannot detect OS. This script requires Ubuntu/Debian."
        exit 1
    fi
    
    if [[ ! "$ID" =~ ^(ubuntu|debian)$ ]]; then
        print_error "Unsupported OS: $OS. This script requires Ubuntu or Debian."
        exit 1
    fi
    print_step "Operating System: $OS $VERSION"
    
    # Check available memory
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$TOTAL_MEM" -lt 2048 ]; then
        print_warning "Low memory detected: ${TOTAL_MEM}MB. Recommended: 4GB+"
    else
        print_step "Memory: ${TOTAL_MEM}MB"
    fi
    
    # Check available disk space
    AVAILABLE_DISK=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    if [ "$AVAILABLE_DISK" -lt 10 ]; then
        print_warning "Low disk space: ${AVAILABLE_DISK}GB. Recommended: 20GB+"
    else
        print_step "Disk Space: ${AVAILABLE_DISK}GB available"
    fi
    
    # Interactive prompts
    if [ -z "$DOMAIN" ]; then
        echo ""
        read -p "Enter your domain name (e.g., multibase.example.com): " DOMAIN
        if [ -z "$DOMAIN" ]; then
            print_error "Domain name is required"
            exit 1
        fi
    fi
    print_step "Domain: $DOMAIN"
    
    # Generate passwords if not set
    if [ -z "$DB_PASSWORD" ]; then
        DB_PASSWORD=$(generate_password)
    fi
    if [ -z "$JWT_SECRET" ]; then
        JWT_SECRET=$(generate_password)
    fi
    print_step "Credentials generated"
}

# =============================================================================
# INSTALL DEPENDENCIES
# =============================================================================

install_dependencies() {
    print_header "Installing Dependencies"
    
    # Update package lists
    print_info "Updating package lists..."
    apt-get update -qq
    
    # Install basic dependencies
    print_info "Installing basic dependencies..."
    apt-get install -y -qq \
        curl \
        wget \
        git \
        gnupg \
        ca-certificates \
        lsb-release \
        software-properties-common \
        build-essential \
        openssl
    print_step "Basic dependencies installed"
    
    # Install Node.js 20
    if ! command -v node &> /dev/null; then
        print_info "Installing Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y -qq nodejs
    fi
    NODE_VERSION=$(node -v)
    print_step "Node.js installed: $NODE_VERSION"
    
    # Install Docker
    if ! command -v docker &> /dev/null; then
        print_info "Installing Docker..."
        curl -fsSL https://get.docker.com | bash
        systemctl enable docker
        systemctl start docker
    fi
    DOCKER_VERSION=$(docker --version | cut -d ' ' -f 3 | tr -d ',')
    print_step "Docker installed: $DOCKER_VERSION"
    
    # Install Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_info "Installing Docker Compose..."
        apt-get install -y -qq docker-compose-plugin
    fi
    print_step "Docker Compose installed"
    
    # Install PostgreSQL
    if ! command -v psql &> /dev/null; then
        print_info "Installing PostgreSQL..."
        apt-get install -y -qq postgresql postgresql-contrib
        systemctl enable postgresql
        systemctl start postgresql
    fi
    PSQL_VERSION=$(psql --version | cut -d ' ' -f 3)
    print_step "PostgreSQL installed: $PSQL_VERSION"
    
    # Install Redis
    if ! command -v redis-cli &> /dev/null; then
        print_info "Installing Redis..."
        apt-get install -y -qq redis-server
        systemctl enable redis-server
        systemctl start redis-server
    fi
    print_step "Redis installed"
    
    # Install Nginx
    if ! command -v nginx &> /dev/null; then
        print_info "Installing Nginx..."
        apt-get install -y -qq nginx
        systemctl enable nginx
    fi
    print_step "Nginx installed"
    
    # Install Certbot
    if ! command -v certbot &> /dev/null; then
        print_info "Installing Certbot..."
        apt-get install -y -qq certbot python3-certbot-nginx
    fi
    print_step "Certbot installed"
}

# =============================================================================
# CREATE USER AND DIRECTORIES
# =============================================================================

setup_user_and_dirs() {
    print_header "Setting Up User and Directories"
    
    # Create multibase user if not exists
    if ! id "$MULTIBASE_USER" &>/dev/null; then
        useradd -r -m -s /bin/bash "$MULTIBASE_USER"
        print_step "User '$MULTIBASE_USER' created"
    else
        print_step "User '$MULTIBASE_USER' already exists"
    fi
    
    # Add user to docker group
    usermod -aG docker "$MULTIBASE_USER"
    print_step "User added to docker group"
    
    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/projects"
    mkdir -p "$INSTALL_DIR/backups"
    mkdir -p "$INSTALL_DIR/logs"
    
    chown -R "$MULTIBASE_USER:$MULTIBASE_USER" "$INSTALL_DIR"
    print_step "Directories created at $INSTALL_DIR"
}

# =============================================================================
# SETUP DATABASE
# =============================================================================

setup_database() {
    print_header "Setting Up PostgreSQL Database"
    
    # Create database user and database
    sudo -u postgres psql -c "CREATE USER multibase WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || true
    sudo -u postgres psql -c "CREATE DATABASE multibase OWNER multibase;" 2>/dev/null || true
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE multibase TO multibase;" 2>/dev/null || true
    
    print_step "Database 'multibase' created"
    print_step "Database user 'multibase' created"
}

# =============================================================================
# CLONE AND BUILD APPLICATION
# =============================================================================

clone_and_build() {
    print_header "Cloning and Building Application"
    
    # Clone repository
    if [ -d "$INSTALL_DIR/.git" ]; then
        print_info "Repository exists, pulling latest changes..."
        cd "$INSTALL_DIR"
        sudo -u "$MULTIBASE_USER" git pull origin "$BRANCH"
    else
        print_info "Cloning repository..."
        # For now, we'll assume the code is already uploaded or will be
        # In production, uncomment this:
        # sudo -u "$MULTIBASE_USER" git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        print_warning "Repository cloning skipped - please upload your code to $INSTALL_DIR"
    fi
    
    # If dashboard directory doesn't exist, skip build
    if [ ! -d "$INSTALL_DIR/dashboard" ]; then
        print_warning "Dashboard directory not found. Please upload your code first."
        print_warning "Expected structure: $INSTALL_DIR/dashboard/backend and $INSTALL_DIR/dashboard/frontend"
        return
    fi
    
    # Build Backend
    print_info "Building backend..."
    cd "$INSTALL_DIR/dashboard/backend"
    
    # Create .env file
    cat > .env << EOF
# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL="postgresql://multibase:${DB_PASSWORD}@localhost:5432/multibase"

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN=7d

# Docker
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Projects path
PROJECTS_PATH=${INSTALL_DIR}/projects

# CORS
CORS_ORIGIN=https://${DOMAIN},http://localhost:5173

# Monitoring
METRICS_INTERVAL=15000
HEALTH_CHECK_INTERVAL=10000
EOF
    chown "$MULTIBASE_USER:$MULTIBASE_USER" .env
    chmod 600 .env
    print_step "Backend .env created"
    
    # Install and build backend
    sudo -u "$MULTIBASE_USER" npm ci --production=false
    sudo -u "$MULTIBASE_USER" npx prisma generate
    sudo -u "$MULTIBASE_USER" npm run build
    sudo -u "$MULTIBASE_USER" npx prisma migrate deploy
    sudo -u "$MULTIBASE_USER" npm prune --production
    print_step "Backend built successfully"
    
    # Build Frontend
    print_info "Building frontend..."
    cd "$INSTALL_DIR/dashboard/frontend"
    
    # Create frontend .env
    cat > .env << EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_WS_URL=wss://${DOMAIN}
EOF
    chown "$MULTIBASE_USER:$MULTIBASE_USER" .env
    
    sudo -u "$MULTIBASE_USER" npm ci
    sudo -u "$MULTIBASE_USER" npm run build
    print_step "Frontend built successfully"
}

# =============================================================================
# CONFIGURE NGINX
# =============================================================================

configure_nginx() {
    print_header "Configuring Nginx"
    
    # Create Nginx config
    cat > /etc/nginx/sites-available/multibase << EOF
# Multibase Dashboard - Nginx Configuration
# Generated by install.sh

upstream multibase_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name ${DOMAIN};
    
    # For initial setup - will be replaced by Certbot
    location / {
        root ${INSTALL_DIR}/dashboard/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://multibase_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    location /socket.io {
        proxy_pass http://multibase_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/multibase /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test and reload
    nginx -t
    systemctl reload nginx
    print_step "Nginx configured"
}

# =============================================================================
# CONFIGURE SYSTEMD
# =============================================================================

configure_systemd() {
    print_header "Configuring Systemd Service"
    
    # Create systemd service file
    cat > /etc/systemd/system/multibase-backend.service << EOF
[Unit]
Description=Multibase Dashboard Backend
After=network.target postgresql.service redis.service docker.service
Wants=postgresql.service redis.service docker.service

[Service]
Type=simple
User=${MULTIBASE_USER}
Group=${MULTIBASE_USER}
WorkingDirectory=${INSTALL_DIR}/dashboard/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload and enable
    systemctl daemon-reload
    systemctl enable multibase-backend
    systemctl start multibase-backend
    
    print_step "Systemd service created and started"
}

# =============================================================================
# SETUP SSL
# =============================================================================

setup_ssl() {
    print_header "Setting Up SSL Certificate"
    
    print_info "Obtaining SSL certificate from Let's Encrypt..."
    print_warning "Make sure your domain ($DOMAIN) is pointing to this server!"
    
    read -p "Proceed with SSL certificate? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || {
            print_warning "SSL setup failed. You can run 'certbot --nginx -d $DOMAIN' later."
        }
        print_step "SSL certificate obtained"
    else
        print_warning "SSL setup skipped. Run 'certbot --nginx -d $DOMAIN' when ready."
    fi
}

# =============================================================================
# CREATE ADMIN USER
# =============================================================================

create_admin_user() {
    print_header "Creating Admin User"
    
    ADMIN_PASSWORD=$(generate_password | head -c 16)
    
    # Hash password using Node.js bcrypt
    HASHED_PASSWORD=$(cd "$INSTALL_DIR/dashboard/backend" && node -e "
        const bcrypt = require('bcryptjs');
        console.log(bcrypt.hashSync('$ADMIN_PASSWORD', 10));
    ")
    
    # Insert admin user
    sudo -u postgres psql -d multibase -c "
        INSERT INTO \"User\" (id, username, email, password, role, \"createdAt\", \"updatedAt\")
        VALUES (gen_random_uuid(), 'admin', 'admin@$DOMAIN', '$HASHED_PASSWORD', 'admin', NOW(), NOW())
        ON CONFLICT (username) DO NOTHING;
    " 2>/dev/null || true
    
    print_step "Admin user created"
    echo ""
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ADMIN CREDENTIALS - SAVE THESE!                               ║${NC}"
    echo -e "${YELLOW}╠════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${YELLOW}║  Username: admin                                               ║${NC}"
    echo -e "${YELLOW}║  Password: ${ADMIN_PASSWORD}                                   ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
}

# =============================================================================
# VERIFICATION
# =============================================================================

verify_installation() {
    print_header "Verifying Installation"
    
    # Check backend
    sleep 3
    if curl -s http://localhost:3001/api/ping > /dev/null 2>&1; then
        print_step "Backend is running"
    else
        print_error "Backend is not responding"
    fi
    
    # Check frontend
    if curl -s http://localhost:80 > /dev/null 2>&1; then
        print_step "Frontend is accessible"
    else
        print_error "Frontend is not accessible"
    fi
    
    # Check PostgreSQL
    if sudo -u postgres psql -c "SELECT 1" > /dev/null 2>&1; then
        print_step "PostgreSQL is running"
    else
        print_error "PostgreSQL is not responding"
    fi
    
    # Check Redis
    if redis-cli ping > /dev/null 2>&1; then
        print_step "Redis is running"
    else
        print_warning "Redis is not responding (optional)"
    fi
    
    # Check Docker
    if docker info > /dev/null 2>&1; then
        print_step "Docker is running"
    else
        print_error "Docker is not responding"
    fi
}

# =============================================================================
# PRINT SUMMARY
# =============================================================================

print_summary() {
    print_header "Installation Complete!"
    
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          MULTIBASE DASHBOARD INSTALLATION SUMMARY              ║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║  Dashboard URL:    https://${DOMAIN}                           ${NC}"
    echo -e "${GREEN}║  Install Path:     ${INSTALL_DIR}                              ${NC}"
    echo -e "${GREEN}║  Projects Path:    ${INSTALL_DIR}/projects                     ${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║  Services:                                                     ║${NC}"
    echo -e "${GREEN}║    - Backend:      systemctl status multibase-backend          ║${NC}"
    echo -e "${GREEN}║    - Nginx:        systemctl status nginx                      ║${NC}"
    echo -e "${GREEN}║    - PostgreSQL:   systemctl status postgresql                 ║${NC}"
    echo -e "${GREEN}║    - Redis:        systemctl status redis-server               ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║  Logs:                                                         ║${NC}"
    echo -e "${GREEN}║    journalctl -u multibase-backend -f                          ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  1. Visit https://$DOMAIN and log in with admin credentials"
    echo "  2. Create your first Supabase instance"
    echo "  3. Configure alert rules and webhooks"
    echo ""
    
    # Save credentials to file
    cat > "$INSTALL_DIR/CREDENTIALS.txt" << EOF
Multibase Dashboard Credentials
================================
Generated: $(date)

Dashboard URL: https://${DOMAIN}
Admin Username: admin
Admin Password: [see terminal output above]

Database:
  Host: localhost
  Port: 5432
  Database: multibase
  User: multibase
  Password: ${DB_PASSWORD}

JWT Secret: ${JWT_SECRET}

IMPORTANT: Delete this file after saving credentials securely!
EOF
    chmod 600 "$INSTALL_DIR/CREDENTIALS.txt"
    chown root:root "$INSTALL_DIR/CREDENTIALS.txt"
    
    print_warning "Credentials saved to $INSTALL_DIR/CREDENTIALS.txt - DELETE AFTER SAVING!"
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                                                   ║${NC}"
    echo -e "${CYAN}║     ███╗   ███╗██╗   ██╗██╗  ████████╗██╗██████╗  █████╗ ███████╗ ║${NC}"
    echo -e "${CYAN}║     ████╗ ████║██║   ██║██║  ╚══██╔══╝██║██╔══██╗██╔══██╗██╔════╝ ║${NC}"
    echo -e "${CYAN}║     ██╔████╔██║██║   ██║██║     ██║   ██║██████╔╝███████║███████╗ ║${NC}"
    echo -e "${CYAN}║     ██║╚██╔╝██║██║   ██║██║     ██║   ██║██╔══██╗██╔══██║╚════██║ ║${NC}"
    echo -e "${CYAN}║     ██║ ╚═╝ ██║╚██████╔╝███████╗██║   ██║██████╔╝██║  ██║███████║ ║${NC}"
    echo -e "${CYAN}║     ╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚═╝   ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝ ║${NC}"
    echo -e "${CYAN}║                                                                   ║${NC}"
    echo -e "${CYAN}║              Automated Installation Script v1.0                   ║${NC}"
    echo -e "${CYAN}║                                                                   ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    preflight_checks
    install_dependencies
    setup_user_and_dirs
    setup_database
    clone_and_build
    configure_nginx
    configure_systemd
    setup_ssl
    create_admin_user
    verify_installation
    print_summary
}

# Run main function
main "$@"
