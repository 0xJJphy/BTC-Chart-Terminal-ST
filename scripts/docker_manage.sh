#!/usr/bin/env bash
# Docker Management & Clean-up Utility for Linux / MacOS / VPS

ACTION=${1:-status}

echo -e "\033[36m==========================================================\033[0m"
echo -e "\033[36m  Docker Maintenance & Cleanup Manager (Linux/macOS)     \033[0m"
echo -e "\033[36m==========================================================\033[0m"

case "$ACTION" in
    status)
        echo -e "\n\033[33m[+] Docker Disk & Resource Usage:\033[0m"
        docker system df
        echo -e "\n\033[33m[+] Active Containers:\033[0m"
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        ;;
    clean)
        echo -e "\n\033[33m[+] Safely removing dangling images and builder cache...\033[0m"
        docker image prune -f
        docker builder prune -f --filter "until=24h"
        echo -e "\n\033[32m[✓] Safe cleanup completed!\033[0m"
        docker system df
        ;;
    clean-deep)
        echo -e "\n\033[35m[!] Performing Deep Cleanup (unused images & builder cache)...\033[0m"
        docker image prune -a -f --filter "until=48h"
        docker builder prune -a -f
        docker container prune -f
        echo -e "\n\033[32m[✓] Deep cleanup completed!\033[0m"
        docker system df
        ;;
    rebuild)
        echo -e "\n\033[33m[+] Rebuilding btc-terminal cleanly...\033[0m"
        docker compose build --no-cache
        docker compose up -d
        docker image prune -f
        docker builder prune -f
        echo -e "\n\033[32m[✓] Clean rebuild finished and running!\033[0m"
        ;;
    up)
        docker compose up -d
        ;;
    down)
        docker compose down
        ;;
    logs)
        docker compose logs -f btc-terminal
        ;;
    *)
        echo "Usage: $0 {status|clean|clean-deep|rebuild|up|down|logs}"
        exit 1
        ;;
esac
