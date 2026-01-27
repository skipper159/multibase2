#!/bin/bash
#
# Nginx Configuration Migration Script for Multibase
#
# This script updates existing Supabase instance Nginx configurations to include
# authentication features. It reads instance details from the projects directory
# and generates updated Nginx configs with auth_request directives.
#
# Usage:
#   ./migrate_nginx_configs.sh [OPTIONS]
#
# Options:
#   --dry-run           Show what would be done without making changes
#   --skip-reload       Don't reload Nginx after updating configs
#   --skip-ssl          Don't run Certbot for SSL certificates
#   --projects-dir DIR  Custom projects directory (default: ../projects)
#   --nginx-dir DIR     Custom nginx config directory (default: ../nginx/sites-enabled)
#   --help              Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_DIR="${SCRIPT_DIR}/../projects"
NGINX_DIR="${SCRIPT_DIR}/../nginx/sites-enabled"
DRY_RUN=false
SKIP_RELOAD=false
SKIP_SSL=false
DOMAIN="backend.tyto-design.de"
DASHBOARD_URL="https://multibase.lafftale.online"
BACKEND_URL="https://backend.tyto-design.de"
CERTBOT_EMAIL="notification@tyto-design.de"

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Migrate existing Supabase instance Nginx configurations to include authentication.

Options:
    --dry-run           Show what would be done without making changes
    --skip-reload       Don't reload Nginx after updating configs
    --skip-ssl          Don't run Certbot for SSL certificates
    --projects-dir DIR  Custom projects directory (default: ../projects)
    --nginx-dir DIR     Custom nginx config directory (default: ../nginx/sites-enabled)
    --help              Show this help message

Examples:
    # Dry run to see what would happen
    $0 --dry-run

    # Migrate configs without reloading Nginx
    $0 --skip-reload

    # Migrate configs without SSL setup
    $0 --skip-ssl

    # Full migration with all features
    $0

EOF
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-reload)
            SKIP_RELOAD=true
            shift
            ;;
        --skip-ssl)
            SKIP_SSL=true
            shift
            ;;
        --projects-dir)
            # Validate argument exists
            if [ -z "$2" ]; then
                echo "Error: Missing argument for --projects-dir"
                usage
            fi
            # Try to resolve to absolute path, keep original if it doesn't exist yet
            PROJECTS_DIR="$(cd "$2" 2>/dev/null && pwd)" || PROJECTS_DIR="$2"
            shift 2
            ;;
        --nginx-dir)
            # Validate argument exists
            if [ -z "$2" ]; then
                echo "Error: Missing argument for --nginx-dir"
                usage
            fi
            NGINX_DIR="$2"
            shift 2
            ;;
        --help)
            usage
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            usage
            ;;
    esac
done

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running with sufficient permissions
check_permissions() {
    if [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    # Check if nginx directory exists
    if [ ! -d "$NGINX_DIR" ]; then
        log_warning "Nginx directory doesn't exist yet. Will attempt to create it."
        return 0
    fi
    
    # Check if nginx directory is writable
    if [ ! -w "$NGINX_DIR" ]; then
        log_error "Nginx directory is not writable: ${NGINX_DIR}"
        log_info "You may need to run this script with sudo or adjust permissions"
        return 1
    fi
}

# Extract port from .env file
get_port_from_env() {
    local env_file="$1"
    local port_var="$2"
    local default="$3"
    
    # Validate port_var name (only alphanumeric and underscore allowed)
    if ! [[ "$port_var" =~ ^[A-Z0-9_]+$ ]]; then
        log_error "Invalid port variable name: $port_var"
        echo "$default"
        return
    fi
    
    if [ -f "$env_file" ]; then
        # Use grep to safely extract the value
        local value=$(grep "^${port_var}=" "$env_file" 2>/dev/null | cut -d'=' -f2 | tr -d '[:space:]' | tr -d '"' | tr -d "'")
        
        # Validate that value is a number
        if [ -n "$value" ] && [[ "$value" =~ ^[0-9]+$ ]]; then
            echo "$value"
        else
            echo "$default"
        fi
    else
        echo "$default"
    fi
}

# Generate Nginx configuration for an instance
generate_nginx_config() {
    local instance_name="$1"
    local kong_port="$2"
    local studio_port="$3"
    
    cat << EOF
# Auto-generated config for ${instance_name} with authentication
server {
    listen 80;
    server_name ${instance_name}.${DOMAIN};
    client_max_body_size 100M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Auth subrequest to dashboard backend
    location = /auth-check {
        internal;
        proxy_pass ${BACKEND_URL}/api/auth/verify-instance-access;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Instance-Name "${instance_name}";
        proxy_set_header X-Original-URI \$request_uri;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Health check endpoint (without auth for monitoring)
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Storage endpoint with authentication
    location /storage/ {
        # Require authentication
        auth_request /auth-check;
        
        # On auth failure, redirect to login
        error_page 401 = @error401;
        error_page 403 = @error403;

        proxy_pass http://127.0.0.1:${kong_port}/storage/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # Main location with authentication
    location / {
        # Require authentication
        auth_request /auth-check;
        
        # On auth failure, redirect to login
        error_page 401 = @error401;
        error_page 403 = @error403;

        proxy_pass http://127.0.0.1:${studio_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Error handler for 401 Unauthorized
    location @error401 {
        return 302 ${DASHBOARD_URL}/login?redirect=\$scheme://\$host\$request_uri&reason=auth_required;
    }

    # Error handler for 403 Forbidden
    location @error403 {
        return 302 ${DASHBOARD_URL}/login?redirect=\$scheme://\$host\$request_uri&reason=access_denied;
    }
}

server {
    listen 80;
    server_name ${instance_name}-api.${DOMAIN};
    client_max_body_size 100M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Auth subrequest to dashboard backend
    location = /auth-check {
        internal;
        proxy_pass ${BACKEND_URL}/api/auth/verify-instance-access;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header X-Instance-Name "${instance_name}";
        proxy_set_header X-Original-URI \$request_uri;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Health check endpoint (without auth for monitoring)
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Main API location with authentication
    location / {
        # Require authentication
        auth_request /auth-check;
        
        # On auth failure, redirect to login
        error_page 401 = @error401;
        error_page 403 = @error403;

        proxy_pass http://127.0.0.1:${kong_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts for API requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Error handler for 401 Unauthorized
    location @error401 {
        return 302 ${DASHBOARD_URL}/login?redirect=\$scheme://\$host\$request_uri&reason=auth_required;
    }

    # Error handler for 403 Forbidden
    location @error403 {
        return 302 ${DASHBOARD_URL}/login?redirect=\$scheme://\$host\$request_uri&reason=access_denied;
    }
}
EOF
}

# Main migration function
migrate_instance() {
    local instance_dir="$1"
    local instance_name="$(basename "$instance_dir")"
    
    # Validate instance name (only alphanumeric, hyphens, and underscores)
    if ! [[ "$instance_name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log_warning "Invalid instance name: ${instance_name} (contains unsafe characters), skipping..."
        return 1
    fi
    
    local env_file="${instance_dir}/.env"
    
    log_info "Processing instance: ${instance_name}"
    
    # Check if .env file exists
    if [ ! -f "$env_file" ]; then
        log_warning "No .env file found for ${instance_name}, skipping..."
        return 1
    fi
    
    # Extract port information
    local kong_port=$(get_port_from_env "$env_file" "KONG_HTTP_PORT" "8000")
    local studio_port=$(get_port_from_env "$env_file" "STUDIO_PORT" "3000")
    
    log_info "  Kong port: ${kong_port}"
    log_info "  Studio port: ${studio_port}"
    
    # Generate new config
    local config_content=$(generate_nginx_config "$instance_name" "$kong_port" "$studio_port")
    local config_file="${NGINX_DIR}/${instance_name}.conf"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "  [DRY RUN] Would create/update: ${config_file}"
        return 0
    fi
    
    # Create nginx directory if it doesn't exist
    mkdir -p "$NGINX_DIR"
    
    # Backup existing config if it exists
    if [ -f "$config_file" ]; then
        local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "  Backing up existing config to: ${backup_file}"
        cp "$config_file" "$backup_file"
    fi
    
    # Write new config
    echo "$config_content" > "$config_file"
    log_success "  Created Nginx config: ${config_file}"
    
    return 0
}

# Main script execution
main() {
    log_info "Starting Nginx configuration migration"
    log_info "Projects directory: ${PROJECTS_DIR}"
    log_info "Nginx directory: ${NGINX_DIR}"
    
    if [ "$DRY_RUN" = true ]; then
        log_warning "Running in DRY RUN mode - no changes will be made"
    fi
    
    # Check if projects directory exists
    if [ ! -d "$PROJECTS_DIR" ]; then
        log_error "Projects directory not found: ${PROJECTS_DIR}"
        log_info "Please specify the correct path with --projects-dir option"
        exit 1
    fi
    
    # Check permissions
    if ! check_permissions; then
        exit 1
    fi
    
    # Check sudo access if needed for nginx/certbot operations
    if [ "$DRY_RUN" = false ] && { [ "$SKIP_RELOAD" = false ] || [ "$SKIP_SSL" = false ]; }; then
        if ! sudo -n true 2>/dev/null; then
            log_warning "This script requires sudo access to reload Nginx and run Certbot"
            log_info "You may be prompted for your password, or configure passwordless sudo"
        fi
    fi
    
    # Count instances
    local instance_count=0
    local success_count=0
    local failed_count=0
    
    # Check if projects directory has any subdirectories
    local has_instances=false
    for item in "$PROJECTS_DIR"/*; do
        if [ -d "$item" ]; then
            has_instances=true
            break
        fi
    done
    
    if [ "$has_instances" = false ]; then
        log_warning "No instance directories found in ${PROJECTS_DIR}"
        exit 0
    fi
    
    # Process each instance directory
    for instance_dir in "$PROJECTS_DIR"/*; do
        if [ -d "$instance_dir" ]; then
            instance_count=$((instance_count + 1))
            if migrate_instance "$instance_dir"; then
                success_count=$((success_count + 1))
            else
                failed_count=$((failed_count + 1))
            fi
        fi
    done
    
    # Summary
    echo ""
    log_info "Migration Summary:"
    log_info "  Total instances found: ${instance_count}"
    log_success "  Successfully migrated: ${success_count}"
    if [ $failed_count -gt 0 ]; then
        log_warning "  Failed/Skipped: ${failed_count}"
    fi
    
    # Reload Nginx if not in dry-run mode and not skipped
    if [ "$DRY_RUN" = false ] && [ "$SKIP_RELOAD" = false ] && [ $success_count -gt 0 ]; then
        echo ""
        log_info "Reloading Nginx to apply changes..."
        
        # Test configuration first
        nginx_test_output=$(sudo nginx -t 2>&1)
        nginx_test_exit=$?
        
        if [ $nginx_test_exit -eq 0 ]; then
            log_success "Nginx configuration test passed"
            
            # Reload nginx
            nginx_reload_output=$(sudo nginx -s reload 2>&1)
            nginx_reload_exit=$?
            
            if [ $nginx_reload_exit -eq 0 ]; then
                log_success "Nginx reloaded successfully"
            else
                log_error "Failed to reload Nginx"
                log_error "Output: ${nginx_reload_output}"
                log_warning "Please check the Nginx error logs and reload manually"
            fi
        else
            log_error "Nginx configuration test failed"
            log_error "Output: ${nginx_test_output}"
            log_warning "Please check the configuration files and fix any errors"
            exit 1
        fi
    fi
    
    # Run Certbot for SSL if not skipped
    if [ "$DRY_RUN" = false ] && [ "$SKIP_SSL" = false ] && [ $success_count -gt 0 ]; then
        echo ""
        log_info "Setting up SSL certificates with Certbot..."
        log_warning "This may take a few minutes..."
        
        for instance_dir in "$PROJECTS_DIR"/*; do
            if [ -d "$instance_dir" ]; then
                local instance_name="$(basename "$instance_dir")"
                local env_file="${instance_dir}/.env"
                
                if [ -f "$env_file" ]; then
                    local studio_domain="${instance_name}.${DOMAIN}"
                    local api_domain="${instance_name}-api.${DOMAIN}"
                    
                    log_info "  Setting up SSL for: ${studio_domain} and ${api_domain}"
                    
                    certbot_output=$(sudo certbot --nginx -d "$studio_domain" -d "$api_domain" \
                        --non-interactive --agree-tos --redirect --email "$CERTBOT_EMAIL" 2>&1)
                    certbot_exit=$?
                    
                    if [ $certbot_exit -eq 0 ]; then
                        log_success "  SSL configured for ${instance_name}"
                    else
                        log_warning "  SSL setup failed for ${instance_name} (can be configured manually later)"
                        log_info "  Certbot output: ${certbot_output}"
                    fi
                fi
            fi
        done
    fi
    
    echo ""
    if [ "$DRY_RUN" = true ]; then
        log_info "Dry run completed. Run without --dry-run to apply changes."
    else
        log_success "Migration completed successfully!"
        echo ""
        log_info "Next steps:"
        log_info "  1. Verify Nginx configurations in: ${NGINX_DIR}"
        log_info "  2. Check Nginx logs: sudo tail -f /var/log/nginx/error.log"
        log_info "  3. Test your instances by accessing them in a browser"
    fi
}

# Run main function
main
