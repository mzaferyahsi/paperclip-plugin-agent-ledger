#!/usr/bin/env bash
# Disposable, isolated Paperclip instance for plugin QA.
# Usage: pc-test-instance.sh up | install <plugin-dir> | cli <cmd...> | status | down
set -euo pipefail
STATE="${PC_TEST_STATE:-/home/paperclip/orgusage-qa-state}"   # pid, url, datadir pointers
cmd="${1:-}"; shift || true
case "$cmd" in
up)
  if [ -f "$STATE/pid" ] && kill -0 "$(cat "$STATE/pid")" 2>/dev/null; then echo "already running: $(cat "$STATE/url")"; exit 0; fi
  rm -rf "$STATE"; mkdir -p "$STATE"
  # Clean env: only a dummy key is passed; nothing from the live instance. test-drive also strips PAPERCLIP_*, DATABASE_URL, PORT.
  # No --data-dir on purpose: an auto-created temp dir skips the service-manager refusal and gets its own embedded DB and free port.
  env -i HOME=/home/paperclip/orgusage-qa-home PATH="$PATH" TMPDIR=/home/paperclip/orgusage-qa-tmp ANTHROPIC_API_KEY="sk-ant-dummy-not-a-real-key" \
    node /home/paperclip/.paperclip/cli/installs/npm/2026.1012.0/node_modules/paperclipai/dist/index.js test-drive --no-browser --company-name "QA Throwaway" --agent-name CEO > "$STATE/log" 2>&1 &
  echo $! > "$STATE/pid"
  for i in $(seq 1 150); do
    grep -q "Paperclip is ready at" "$STATE/log" 2>/dev/null && break
    kill -0 "$(cat "$STATE/pid")" 2>/dev/null || { echo "failed:"; tail -20 "$STATE/log"; exit 1; }
    sleep 2
  done
  sed 's/\x1b\[[0-9;]*m//g' "$STATE/log" > "$STATE/log.clean"
  grep -o 'http://127.0.0.1:[0-9]*' "$STATE/log.clean" | tail -1 > "$STATE/url"
  grep -o 'Data directory: .*' "$STATE/log.clean" | head -1 | sed 's/Data directory: //' > "$STATE/datadir"
  echo "up: $(cat "$STATE/url")  data: $(cat "$STATE/datadir")"
  ;;
install)
  # env -i: never forward the live instance's PAPERCLIP_API_KEY/RUN_ID to the test instance
  env -i HOME=/home/paperclip/orgusage-qa-home PATH="$PATH" node /home/paperclip/.paperclip/cli/installs/npm/2026.1012.0/node_modules/paperclipai/dist/index.js plugin install --local "$1" --api-base "$(cat "$STATE/url")" -d "$(cat "$STATE/datadir")" --no-verify-target
  ;;
cli)   # any paperclipai command aimed at the test instance, e.g.: cli plugin list
  c="$1"; shift
  env -i HOME=/home/paperclip/orgusage-qa-home PATH="$PATH" node /home/paperclip/.paperclip/cli/installs/npm/2026.1012.0/node_modules/paperclipai/dist/index.js "$c" "$@" --api-base "$(cat "$STATE/url")" -d "$(cat "$STATE/datadir")"
  ;;
status)
  curl -s "$(cat "$STATE/url")/api/health"; echo
  ;;
down)
  D="$(cat "$STATE/datadir" 2>/dev/null || true)"
  [ -f "$STATE/pid" ] && kill "$(cat "$STATE/pid")" 2>/dev/null || true
  sleep 4
  case "$D" in /home/paperclip/orgusage-qa-tmp/paperclip-test-drive-*) pkill -f "$D" 2>/dev/null || true; sleep 1; rm -rf "$D";; esac
  rm -rf "$STATE"; echo "torn down"
  ;;
*) echo "usage: $0 up|install <dir>|cli <cmd...>|status|down"; exit 2;;
esac
