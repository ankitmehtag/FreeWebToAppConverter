#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 x86-64 server for deploy/README.md: Docker, Node.js 22, git, swap and a firewall.
# Run once as root, and again whenever you like: every step checks first.
# Usage: sudo bash deploy/setup-server.sh
set -euo pipefail

SWAP_GB=4
NODE_MAJOR=22

[ "$(id -u)" -eq 0 ] || { echo 'Run as root: sudo bash deploy/setup-server.sh' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "This server is $(uname -m). The builder image needs x86-64." >&2; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Written for Ubuntu, found $ID." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw unattended-upgrades

# Docker Engine and the Compose plugin, from Docker's own repository.
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Node.js, for the worker.
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# Swap, so a build that needs a little more memory slows down instead of being killed.
if ! swapon --show | grep -q '^/swapfile'; then
  [ -f /swapfile ] || { fallocate -l "${SWAP_GB}G" /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl -q -p /etc/sysctl.d/99-swappiness.conf

# Only SSH, HTTP and HTTPS from outside. Mongo and Redis listen on 127.0.0.1 only (compose.prod.yml).
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# The folders the worker and the signing key use.
install -d -m 0755 /var/lib/sitetoapk/builds
install -d -m 0700 /etc/sitetoapk

echo
echo "Docker $(docker --version | cut -d' ' -f3 | tr -d ,), Compose $(docker compose version --short), Node $(node --version), $(free -g | awk '/Mem/{print $2}') GB memory, $(swapon --show=SIZE --noheadings | head -1) swap."
echo 'Next: the "First start" section of deploy/README.md.'
