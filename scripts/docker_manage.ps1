# Docker Management & Clean-up Utility for BTC Quant Terminal
param (
    [ValidateSet("status", "clean", "clean-deep", "rebuild", "down", "up", "logs")]
    [string]$Action = "status"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Docker Maintenance & Cleanup Manager" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

switch ($Action) {
    "status" {
        Write-Host "`n[+] Docker Disk & Resource Usage:" -ForegroundColor Yellow
        docker system df
        Write-Host "`n[+] Active Containers:" -ForegroundColor Yellow
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    }

    "clean" {
        Write-Host "`n[+] Safely removing dangling images and build cache..." -ForegroundColor Yellow
        docker image prune -f
        docker builder prune -f --filter "until=24h"
        Write-Host "`n[✓] Safe cleanup completed!" -ForegroundColor Green
        docker system df
    }

    "clean-deep" {
        Write-Host "`n[!] Performing Deep Cleanup (all unused images and full build cache)..." -ForegroundColor Magenta
        Write-Host "    (Active databases and named volumes will NOT be deleted)" -ForegroundColor DarkGray
        docker image prune -a -f --filter "until=48h"
        docker builder prune -a -f
        docker container prune -f
        Write-Host "`n[✓] Deep cleanup completed!" -ForegroundColor Green
        docker system df
    }

    "rebuild" {
        Write-Host "`n[+] Rebuilding btc-terminal container cleanly..." -ForegroundColor Yellow
        docker compose build --no-cache
        docker compose up -d
        docker image prune -f
        docker builder prune -f
        Write-Host "`n[✓] Clean rebuild finished and running!" -ForegroundColor Green
    }

    "up" {
        docker compose up -d
        Write-Host "[✓] Containers started in background." -ForegroundColor Green
    }

    "down" {
        docker compose down
        Write-Host "[✓] Containers stopped." -ForegroundColor Green
    }

    "logs" {
        docker compose logs -f btc-terminal
    }
}
