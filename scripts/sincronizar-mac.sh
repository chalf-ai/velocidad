#!/usr/bin/env bash
# Sincroniza el trabajo local del Mac con GitHub para que se vea desde el celular
# (Claude Code en la app y claude.ai/code solo ven lo que está en GitHub).
#
# Uso:
#   bash scripts/sincronizar-mac.sh            # solo diagnostica (no cambia nada)
#   bash scripts/sincronizar-mac.sh --push     # además sube las ramas con commits sin subir
#   bash scripts/sincronizar-mac.sh --push ~/Code ~/Desktop   # carpetas a revisar
#
# Reglas de seguridad:
#   - Nunca hace commit por ti: los cambios sin commit solo se listan.
#   - Nunca usa --force ni toca ramas ajenas; solo `git push -u origin <rama>`.
#   - Ramas sin remoto "origin" se reportan y se saltan.
# Compatible con el bash 3.2 que trae macOS.

set -u

PUSH=0
ROOTS=()
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) ROOTS+=("$arg") ;;
  esac
done
if [ ${#ROOTS[@]} -eq 0 ]; then
  ROOTS=("$HOME")
fi

repos_total=0
repos_pendientes=0
ramas_subidas=0
ramas_fallidas=0

revisar_repo() {
  local repo="$1"
  local pendiente=0
  local salida=""

  if ! git -C "$repo" remote get-url origin >/dev/null 2>&1; then
    printf '\n## %s\n  ! sin remoto "origin": no se puede sincronizar (crear repo en GitHub primero)\n' "$repo"
    repos_pendientes=$((repos_pendientes + 1))
    return
  fi

  git -C "$repo" fetch --quiet origin 2>/dev/null || salida+="  ! no se pudo hacer fetch (¿sin red o sin permisos?)\n"

  local cambios
  cambios=$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$cambios" != "0" ]; then
    pendiente=1
    salida+="  * $cambios archivo(s) con cambios SIN COMMIT (revisar y hacer commit a mano):\n"
    salida+="$(git -C "$repo" status --short 2>/dev/null | head -15 | sed 's/^/      /')\n"
  fi

  local rama upstream ahead nota
  while IFS= read -r rama; do
    [ -z "$rama" ] && continue
    nota=""
    upstream=$(git -C "$repo" rev-parse --abbrev-ref "$rama@{upstream}" 2>/dev/null || true)
    if [ -z "$upstream" ]; then
      if git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$rama" >/dev/null; then
        ahead=$(git -C "$repo" rev-list --count "origin/$rama..$rama")
      else
        ahead=$(git -C "$repo" rev-list --count "$rama" --not --remotes=origin)
        [ "$ahead" = "0" ] && continue
        nota=" (rama nueva, nunca subida)"
      fi
    else
      ahead=$(git -C "$repo" rev-list --count "$upstream..$rama")
    fi
    case "$ahead" in 0) continue ;; esac

    pendiente=1
    salida+="  * rama $rama: $ahead commit(s) sin subir$nota\n"
    if [ "$PUSH" = "1" ]; then
      if git -C "$repo" push --quiet -u origin "$rama" 2>/dev/null; then
        salida+="      -> subida OK\n"
        ramas_subidas=$((ramas_subidas + 1))
      else
        salida+="      -> FALLÓ el push (¿rama divergida? hacer pull y resolver a mano)\n"
        ramas_fallidas=$((ramas_fallidas + 1))
      fi
    fi
  done <<EOF
$(git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)
EOF

  if [ "$pendiente" = "1" ]; then
    repos_pendientes=$((repos_pendientes + 1))
    printf '\n## %s (%s)\n' "$repo" "$(git -C "$repo" remote get-url origin)"
    printf '%b' "$salida"
  fi
}

for root in "${ROOTS[@]}"; do
  while IFS= read -r gitdir; do
    [ -z "$gitdir" ] && continue
    repos_total=$((repos_total + 1))
    revisar_repo "$(dirname "$gitdir")"
  done <<EOF
$(find "$root" -maxdepth 5 -type d -name .git \
    -not -path '*/node_modules/*' -not -path '*/Library/*' -not -path '*/.Trash/*' 2>/dev/null)
EOF
done

printf '\n==== Resumen ====\n'
printf 'Repos revisados: %s\n' "$repos_total"
printf 'Repos con trabajo no sincronizado: %s\n' "$repos_pendientes"
if [ "$PUSH" = "1" ]; then
  printf 'Ramas subidas: %s · fallidas: %s\n' "$ramas_subidas" "$ramas_fallidas"
else
  printf 'Modo diagnóstico. Para subir las ramas: bash %s --push\n' "$0"
fi
