# Multibase Dashboard - Quick Start & Deployment
# PowerShell script for Windows

param(
    [switch]$Production,
    [switch]$Build,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Success { param($Message) Write-Host $Message -ForegroundColor Green }
function Write-Info { param($Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host $Message -ForegroundColor Red }

# Configuration
$DASHBOARD_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $DASHBOARD_DIR "backend"
$FRONTEND_DIR = Join-Path $DASHBOARD_DIR "frontend"
$BACKEND_PORT = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3001" }
$FRONTEND_PORT = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }

Write-Info "╔══════════════════════════════════════════════╗"
Write-Info "║      Multibase Dashboard Launcher            ║"
Write-Info "╚══════════════════════════════════════════════╝"
Write-Host ""

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "✗ Node.js is not installed"
    Write-Host "Please install Node.js 20+ from https://nodejs.org/"
    exit 1
}

$nodeVersion = (node -v).Replace('v', '').Split('.')[0]
if ([int]$nodeVersion -lt 20) {
    Write-Error "✗ Node.js version 20+ is required (current: $(node -v))"
    exit 1
}
Write-Success "✓ Node.js $(node -v)"

# Check Docker
try {
    docker ps | Out-Null
    Write-Success "✓ Docker is running"
} catch {
    Write-Warning "⚠ Docker is not running or not accessible"
    Write-Host "The backend requires Docker to manage Supabase instances"
    $continue = Read-Host "Do you want to continue anyway? (y/N)"
    if ($continue -ne 'y' -and $continue -ne 'Y') {
        exit 1
    }
}

# Check Redis
try {
    redis-cli ping | Out-Null
    Write-Success "✓ Redis is running"
} catch {
    Write-Warning "⚠ Redis is not running"
    Write-Info "Starting Redis in Docker..."
    try {
        docker run -d --name multibase-redis -p 6379:6379 redis:alpine
        Start-Sleep -Seconds 2
        redis-cli ping | Out-Null
        Write-Success "✓ Redis started"
    } catch {
        Write-Error "✗ Failed to start Redis"
        Write-Host "Please start Redis manually: docker run -d -p 6379:6379 redis:alpine"
        exit 1
    }
}

# Install dependencies
Write-Host ""
Write-Info "Installing dependencies..."

# Backend
if (-not (Test-Path "$BACKEND_DIR\node_modules")) {
    Write-Info "→ Installing backend dependencies..."
    Push-Location $BACKEND_DIR
    npm install
    Pop-Location
    Write-Success "✓ Backend dependencies installed"
} else {
    Write-Success "✓ Backend dependencies already installed"
}

# Frontend
if (-not (Test-Path "$FRONTEND_DIR\node_modules")) {
    Write-Info "→ Installing frontend dependencies..."
    Push-Location $FRONTEND_DIR
    npm install
    Pop-Location
    Write-Success "✓ Frontend dependencies installed"
} else {
    Write-Success "✓ Frontend dependencies already installed"
}

# Initialize database
Write-Host ""
Write-Info "Setting up database..."
Push-Location $BACKEND_DIR

if (-not (Test-Path "$BACKEND_DIR\prisma\data\multibase.db")) {
    Write-Info "→ Generating Prisma client..."
    npx prisma generate
    Write-Info "→ Creating database..."
    npx prisma migrate dev --name init
    Write-Success "✓ Database initialized"
} else {
    npx prisma generate | Out-Null
    Write-Success "✓ Database ready"
}
Pop-Location

# Create projects directory
$PROJECTS_DIR = Join-Path $DASHBOARD_DIR "projects"
if (-not (Test-Path $PROJECTS_DIR)) {
    New-Item -ItemType Directory -Path $PROJECTS_DIR | Out-Null
    Write-Success "✓ Created projects directory"
}

# Create backend .env
if (-not (Test-Path "$BACKEND_DIR\.env")) {
    Write-Info "→ Creating backend .env file..."
    @"
# Server
PORT=$BACKEND_PORT
NODE_ENV=development

# Database
DATABASE_URL="file:./prisma/data/multibase.db"

# Redis
REDIS_URL=redis://localhost:6379

# Docker - Windows named pipe
DOCKER_SOCKET_PATH=//./pipe/docker_engine

# Multibase Projects
PROJECTS_PATH=$PROJECTS_DIR

# CORS
CORS_ORIGIN=http://localhost:$FRONTEND_PORT

# Intervals (milliseconds)
METRICS_INTERVAL=15000
HEALTH_CHECK_INTERVAL=10000
"@ | Out-File -FilePath "$BACKEND_DIR\.env" -Encoding utf8
    Write-Success "✓ Backend .env created"
}

# Create frontend .env
if (-not (Test-Path "$FRONTEND_DIR\.env")) {
    Write-Info "→ Creating frontend .env file..."
    @"
VITE_API_URL=http://localhost:$BACKEND_PORT
VITE_PORT=$FRONTEND_PORT
"@ | Out-File -FilePath "$FRONTEND_DIR\.env" -Encoding utf8
    Write-Success "✓ Frontend .env created"
}

# Build if requested
if ($Build -or $Production) {
    Write-Host ""
    Write-Info "Building application..."
    
    # Build backend
    Write-Info "→ Building backend..."
    Push-Location $BACKEND_DIR
    npm run build
    Pop-Location
    Write-Success "✓ Backend built"
    
    # Build frontend
    Write-Info "→ Building frontend..."
    Push-Location $FRONTEND_DIR
    npm run build
    Pop-Location
    Write-Success "✓ Frontend built"
}

# Stop if requested
if ($Stop) {
    Write-Host ""
    Write-Info "Stopping services..."
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*multibase*" } | Stop-Process -Force
    Write-Success "✓ Services stopped"
    exit 0
}

# Start services
Write-Host ""
Write-Info "╔══════════════════════════════════════════════╗"
Write-Info "║           Starting Services                  ║"
Write-Info "╚══════════════════════════════════════════════╝"
Write-Host ""

# Start backend
Write-Info "→ Starting backend on port $BACKEND_PORT..."
Push-Location $BACKEND_DIR

if ($Production) {
    $backendProcess = Start-Process -FilePath "node" -ArgumentList "dist/server.js" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$DASHBOARD_DIR\backend.log" -RedirectStandardError "$DASHBOARD_DIR\backend-error.log"
} else {
    $backendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$DASHBOARD_DIR\backend.log" -RedirectStandardError "$DASHBOARD_DIR\backend-error.log"
}
Pop-Location

Start-Sleep -Seconds 3

if ($backendProcess.HasExited) {
    Write-Error "✗ Backend failed to start"
    Write-Host "Check $DASHBOARD_DIR\backend-error.log for errors"
    exit 1
}
Write-Success "✓ Backend running (PID: $($backendProcess.Id))"

# Start frontend
Write-Info "→ Starting frontend on port $FRONTEND_PORT..."
Push-Location $FRONTEND_DIR

if ($Production) {
    # In production, serve built files with a simple server
    $frontendProcess = Start-Process -FilePath "npx" -ArgumentList "serve", "-s", "dist", "-l", $FRONTEND_PORT -PassThru -WindowStyle Hidden
} else {
    $frontendProcess = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$DASHBOARD_DIR\frontend.log" -RedirectStandardError "$DASHBOARD_DIR\frontend-error.log"
}
Pop-Location

Start-Sleep -Seconds 3

if ($frontendProcess.HasExited) {
    Write-Error "✗ Frontend failed to start"
    Write-Host "Check $DASHBOARD_DIR\frontend-error.log for errors"
    Stop-Process -Id $backendProcess.Id -Force
    exit 1
}
Write-Success "✓ Frontend running (PID: $($frontendProcess.Id))"

Write-Host ""
Write-Success "╔══════════════════════════════════════════════╗"
Write-Success "║     Dashboard is ready! 🎉                   ║"
Write-Success "╚══════════════════════════════════════════════╝"
Write-Host ""
Write-Host "  Frontend:  " -NoNewline; Write-Info "http://localhost:$FRONTEND_PORT"
Write-Host "  Backend:   " -NoNewline; Write-Info "http://localhost:$BACKEND_PORT"
Write-Host "  API Docs:  " -NoNewline; Write-Info "http://localhost:$BACKEND_PORT/api/ping"
Write-Host ""
Write-Warning "Logs:"
Write-Host "  Backend:  Get-Content $DASHBOARD_DIR\backend.log -Wait"
Write-Host "  Frontend: Get-Content $DASHBOARD_DIR\frontend.log -Wait"
Write-Host ""
Write-Warning "To stop services, run: .\start.ps1 -Stop"
Write-Host ""
Write-Host "Press any key to stop services and exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup
Write-Host ""
Write-Info "Shutting down services..."
Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
Write-Success "✓ Services stopped"
