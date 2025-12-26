#!/bin/bash
#
# Multibase Dashboard - Uninstall Script
# ========================================
# Removes the Multibase Dashboard and all its components
#
# Usage: sudo ./uninstall.sh [--keep-data]
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/opt/multibase"
MULTIBASE_USER="multibase"
KEEP_DATA=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
    esac
done

echo -e "${YELLOW}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           MULTIBASE DASHBOARD UNINSTALLER                      ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  This will remove:                                             ║"
echo "║    - Systemd service                                           ║"
echo "║    - Nginx configuration                                       ║"
if [ "$KEEP_DATA" = false ]; then
echo "║    - PostgreSQL database (multibase)                           ║"
echo "║    - Installation directory ($INSTALL_DIR)                     ║"
else
echo "║    - (Data will be preserved with --keep-data)                 ║"
fi
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

read -p "Are you sure you want to continue? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo ""
echo -e "${GREEN}[1/5]${NC} Stopping services..."
systemctl stop multibase-backend 2>/dev/null || true
systemctl disable multibase-backend 2>/dev/null || true

echo -e "${GREEN}[2/5]${NC} Removing systemd service..."
rm -f /etc/systemd/system/multibase-backend.service
systemctl daemon-reload

echo -e "${GREEN}[3/5]${NC} Removing Nginx configuration..."
rm -f /etc/nginx/sites-enabled/multibase
rm -f /etc/nginx/sites-available/multibase
systemctl reload nginx 2>/dev/null || true

if [ "$KEEP_DATA" = false ]; then
    echo -e "${GREEN}[4/5]${NC} Removing database..."
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS multibase;" 2>/dev/null || true
    sudo -u postgres psql -c "DROP USER IF EXISTS multibase;" 2>/dev/null || true
    
    echo -e "${GREEN}[5/5]${NC} Removing installation directory..."
    rm -rf "$INSTALL_DIR"
else
    echo -e "${YELLOW}[4/5]${NC} Keeping database (--keep-data)"
    echo -e "${YELLOW}[5/5]${NC} Keeping installation directory (--keep-data)"
fi

# Optionally remove user
read -p "Remove user '$MULTIBASE_USER'? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    userdel -r "$MULTIBASE_USER" 2>/dev/null || true
    echo -e "${GREEN}[✓]${NC} User removed"
fi

echo ""
echo -e "${GREEN}Uninstall complete!${NC}"
echo ""
echo "The following were NOT removed (installed as system packages):"
echo "  - Node.js"
echo "  - Docker"
echo "  - PostgreSQL"
echo "  - Redis"
echo "  - Nginx"
echo "  - Certbot"
echo ""
echo "To remove these, run: apt remove <package-name>"
