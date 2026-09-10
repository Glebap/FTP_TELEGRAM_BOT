#!/bin/sh
# Boot sequence for the container.
#
# Migrations run here rather than in a Fly release command on purpose: release
# commands run on a temporary machine with no volume attached, so a SQLite
# database on /data would not be visible to them.
set -e

echo "→ applying migrations"
npx prisma migrate deploy

echo "→ seeding sports and quiz questions"
node dist/db/seed.js

echo "→ starting bot"
exec node dist/main.js
