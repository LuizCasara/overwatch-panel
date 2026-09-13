#!/usr/bin/env bash
# Wrapper nao-destrutivo do statusLine: repassa o payload para overwatch.js
# (grava context_pct) e depois para o statusline-command.sh original,
# imprimindo a saida dele sem qualquer alteracao. Se o overwatch.js falhar
# por qualquer razao, a status line do terminal segue funcionando normalmente.
input=$(cat)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGINAL_CMD_FILE="$SCRIPT_DIR/statusline-original-command.txt"

echo "$input" | node "$SCRIPT_DIR/overwatch.js" statusline >/dev/null 2>&1 || true

if [ -f "$ORIGINAL_CMD_FILE" ]; then
  ORIGINAL_CMD=$(cat "$ORIGINAL_CMD_FILE")
else
  ORIGINAL_CMD="bash ~/.claude/statusline-command.sh"
fi

echo "$input" | eval "$ORIGINAL_CMD"
