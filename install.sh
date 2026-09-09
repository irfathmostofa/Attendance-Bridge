#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo " Attendance Bridge - install essential software"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node.js 18+ then re-run."
  exit 1
fi

node setup.js
echo "Done."
