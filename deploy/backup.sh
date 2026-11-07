#!/usr/bin/env bash
# Nightly Mongo backup: a dump on the server (14 days kept), and a copy in R2 under backups/.
# Installed by deploy/README.md as /etc/cron.d/sitetoapk-backup. Run by hand to test: sudo bash deploy/backup.sh
set -euo pipefail

ROOT=/opt/sitetoapk
DIR=/var/backups/sitetoapk
FILE="$DIR/sitetoapk-$(date +%F).gz"

install -d -m 0700 "$DIR"
cd "$ROOT/deploy"
SITE_ADDRESS=unused docker compose -f compose.prod.yml exec -T mongo mongodump --archive --gzip --db sitetoapk > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
[ -s "$FILE" ] || { echo "empty backup" >&2; exit 1; }

# Credentials come from .env.production without sourcing it, whose values may hold spaces.
cd "$ROOT"
env "$(grep -m1 '^R2_ENDPOINT=' .env.production)" "$(grep -m1 '^R2_BUCKET=' .env.production)" \
    "$(grep -m1 '^R2_ACCESS_KEY_ID=' .env.production)" "$(grep -m1 '^R2_SECRET_ACCESS_KEY=' .env.production)" \
    node deploy/upload-backup.mjs "$FILE" "backups/$(basename "$FILE")"

find "$DIR" -name 'sitetoapk-*.gz' -mtime +14 -delete
echo "Backup done: $(basename "$FILE"), $(du -h "$FILE" | cut -f1)"
