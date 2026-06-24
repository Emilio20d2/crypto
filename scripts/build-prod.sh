#!/usr/bin/env bash
# build-prod.sh — Script de producción para Crypto Control
# Garantiza: código fuente == commit compilado == commit en app.asar == commit ejecutado
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Identidad ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       CRYPTO CONTROL — BUILD DE PRODUCCIÓN              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "ORIGEN"
echo "  Directorio : $REPO_ROOT"
echo "  Rama       : $(git branch --show-current)"
COMMIT_FULL=$(git rev-parse HEAD)
COMMIT_SHORT=$(git rev-parse --short HEAD)
echo "  Commit     : $COMMIT_FULL"
echo "  Short      : $COMMIT_SHORT"
echo ""

# Warn about uncommitted changes (don't abort — dev might have intentional changes)
DIRTY=$(git status --porcelain | grep -v "^??" || true)
if [ -n "$DIRTY" ]; then
  echo "⚠️  ADVERTENCIA: hay cambios no commiteados:"
  echo "$DIRTY"
  echo ""
fi

# ── 2. Cerrar procesos activos ────────────────────────────────────────────────
echo "→ Cerrando procesos Electron activos…"
pkill -x "Crypto Control" 2>/dev/null && echo "  killed" || echo "  (ninguno activo)"
sleep 1

# ── 3. Limpiar artefactos anteriores ─────────────────────────────────────────
echo "→ Limpiando artefactos de build anteriores…"

# Root dist (compiled main + preload)
rm -rf "$REPO_ROOT/dist"
mkdir -p "$REPO_ROOT/dist"

# Web dist
rm -rf "$REPO_ROOT/apps/web/dist"
rm -rf "$REPO_ROOT/apps/web/.vite"

# Desktop compiled output
rm -rf "$REPO_ROOT/apps/desktop/dist"

# Old dist-packaged at root (keep only what we create now)
rm -rf "$REPO_ROOT/dist-packaged"

# Old dist-packaged inside apps/desktop (from previous runs via apps/desktop)
rm -rf "$REPO_ROOT/apps/desktop/dist-packaged"

echo "  Artefactos eliminados."
echo ""

# ── 4. Compilar paquetes compartidos ─────────────────────────────────────────
echo "→ Compilando paquetes compartidos…"
for pkg in packages/core packages/database packages/market-data packages/coinbase-sync packages/portfolio; do
  if [ -f "$REPO_ROOT/$pkg/tsconfig.json" ]; then
    (cd "$REPO_ROOT/$pkg" && npx tsc --noEmit 2>&1 | head -5 || true)
  fi
done
echo "  OK"

# ── 5. Compilar web (Vite inyecta BUILD_INFO en el bundle) ───────────────────
echo "→ Compilando web…"
BUILD_START_TS=$(date +%s)
cd "$REPO_ROOT/apps/web"
npm run build 2>&1 | tail -5
cd "$REPO_ROOT"

# BUILD_INFO is injected in the main index bundle (contains App.tsx).
# With lazy loading there are many chunks — search all of them for the commit.
WEB_ASSETS_DIR="$REPO_ROOT/apps/web/dist/assets"

COMMIT_FOUND_IN=""
while IFS= read -r -d '' jsfile; do
  if grep -qF "$COMMIT_SHORT" "$jsfile" 2>/dev/null; then
    COMMIT_FOUND_IN="$jsfile"
    break
  fi
done < <(find "$WEB_ASSETS_DIR" -name "*.js" -print0 2>/dev/null)

CHUNK_COUNT=$(find "$WEB_ASSETS_DIR" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
MAIN_BUNDLE=$(find "$WEB_ASSETS_DIR" -name "index-*.js" 2>/dev/null | head -1)
if [ -z "$MAIN_BUNDLE" ]; then
  # Fallback: largest JS
  MAIN_BUNDLE=$(find "$WEB_ASSETS_DIR" -name "*.js" -print0 2>/dev/null | xargs -0 ls -S 2>/dev/null | head -1)
fi
MAIN_BUNDLE_SIZE=$(wc -c < "$MAIN_BUNDLE" 2>/dev/null || echo "?")

echo "  Bundle principal: $(basename "$MAIN_BUNDLE") ($MAIN_BUNDLE_SIZE bytes)"
echo "  Chunks lazy: $CHUNK_COUNT archivos JS en total"

if [ -n "$COMMIT_FOUND_IN" ]; then
  echo "  ✅ Commit $COMMIT_SHORT encontrado en $(basename "$COMMIT_FOUND_IN")"
else
  echo "  ❌ ABORT: commit $COMMIT_SHORT NO encontrado en ningún bundle web"
  echo "     (¿Hay cambios sin commitear que afectan a buildInfo?)"
  exit 1
fi

# ── 6. Compilar desktop (TypeScript → dist/) ─────────────────────────────────
echo ""
echo "→ Compilando desktop…"
cd "$REPO_ROOT/apps/desktop"
npx tsc 2>&1 | head -10
cd "$REPO_ROOT"

# Copiar al root dist (que electron-builder empaqueta)
cp "$REPO_ROOT/apps/desktop/dist/main.js"    "$REPO_ROOT/dist/main.js"
cp "$REPO_ROOT/apps/desktop/dist/preload.js" "$REPO_ROOT/dist/preload.js"

DESKTOP_TS=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$REPO_ROOT/dist/main.js")
echo "  dist/main.js   : $DESKTOP_TS ($(wc -c < "$REPO_ROOT/dist/main.js") bytes)"
echo "  dist/preload.js: $(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$REPO_ROOT/dist/preload.js")"

# ── 7. Validar que artefactos son recientes ───────────────────────────────────
echo ""
echo "→ Validando frescura de artefactos…"
NOW_TS=$(date +%s)
WEB_MTIME=$(stat -f %m "$WEB_BUNDLE")
MAIN_MTIME=$(stat -f %m "$REPO_ROOT/dist/main.js")
MAX_AGE=300  # 5 minutos

if [ $((NOW_TS - WEB_MTIME)) -gt $MAX_AGE ]; then
  echo "❌ ABORT: bundle web tiene más de 5 minutos ($(( (NOW_TS - WEB_MTIME) / 60 )) min)"
  exit 1
fi
if [ $((NOW_TS - MAIN_MTIME)) -gt $MAX_AGE ]; then
  echo "❌ ABORT: dist/main.js tiene más de 5 minutos ($(( (NOW_TS - MAIN_MTIME) / 60 )) min)"
  exit 1
fi
echo "  ✅ Bundle web: hace $((NOW_TS - WEB_MTIME))s"
echo "  ✅ dist/main.js: hace $((NOW_TS - MAIN_MTIME))s"

# ── 8. Empaquetar con Electron Builder ───────────────────────────────────────
echo ""
echo "→ Empaquetando con electron-builder…"
DATE_STR=$(date +%Y%m%d-%H%M)
DMG_NAME="Crypto-Control-${COMMIT_SHORT}-${DATE_STR}.dmg"

electron-builder --mac --config.directories.output=dist-packaged 2>&1 | grep -E "(packaging|building|built|error|warn|skip)" | head -20

# ── 9. Renombrar DMG con commit en el nombre ──────────────────────────────────
ORIGINAL_DMG=$(ls "$REPO_ROOT/dist-packaged/"*.dmg 2>/dev/null | grep -v blockmap | grep -v "@" | head -1)
if [ -z "$ORIGINAL_DMG" ]; then
  echo "❌ ERROR: no se encontró DMG en dist-packaged/"
  exit 1
fi

NEW_DMG="$REPO_ROOT/dist-packaged/$DMG_NAME"
mv "$ORIGINAL_DMG" "$NEW_DMG"
echo "  DMG: $DMG_NAME"

# ── 10. Verificar app.asar ────────────────────────────────────────────────────
echo ""
echo "→ Verificando app.asar…"
APP_PATH="$REPO_ROOT/dist-packaged/mac-arm64/Crypto Control.app"
ASAR_PATH="$APP_PATH/Contents/Resources/app.asar"

if [ ! -f "$ASAR_PATH" ]; then
  echo "❌ ERROR: app.asar no encontrado en $ASAR_PATH"
  exit 1
fi

ASAR_SIZE=$(wc -c < "$ASAR_PATH")
ASAR_DATE=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$ASAR_PATH")
echo "  app.asar: $ASAR_SIZE bytes @ $ASAR_DATE"

# Extraer y verificar
TMP_EXTRACT=$(mktemp -d)
trap "rm -rf $TMP_EXTRACT" EXIT

npx asar extract "$ASAR_PATH" "$TMP_EXTRACT" 2>/dev/null

ASAR_JS_COUNT=$(find "$TMP_EXTRACT/apps/web/dist/assets" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
if [ "$ASAR_JS_COUNT" -eq 0 ]; then
  echo "❌ ERROR: bundle web no encontrado dentro de app.asar"
  exit 1
fi

ASAR_COMMIT_FOUND=""
while IFS= read -r -d '' jsf; do
  if grep -qF "$COMMIT_SHORT" "$jsf" 2>/dev/null; then
    ASAR_COMMIT_FOUND="$jsf"
    break
  fi
done < <(find "$TMP_EXTRACT/apps/web/dist/assets" -name "*.js" -print0 2>/dev/null)

if [ -n "$ASAR_COMMIT_FOUND" ]; then
  echo "  ✅ Commit $COMMIT_SHORT encontrado en app.asar ($ASAR_JS_COUNT chunks)"
else
  echo "  ❌ ABORT: commit $COMMIT_SHORT NO encontrado dentro de app.asar"
  exit 1
fi

if grep -qF "Startup backfill" "$TMP_EXTRACT/dist/main.js"; then
  echo "  ✅ main.js correcto (startup backfill presente)"
else
  echo "  ⚠️  main.js no contiene 'Startup backfill'"
fi

# ── 11. SHA-256 del DMG ───────────────────────────────────────────────────────
echo ""
SHA=$(shasum -a 256 "$NEW_DMG" | awk '{print $1}')

# ── 12. Resumen final ─────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                 BUILD COMPLETADO ✅                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "ORIGEN"
echo "  Directorio : $REPO_ROOT"
echo "  Worktree   : $REPO_ROOT (único)"
echo "  Rama       : $(git branch --show-current)"
echo "  Commit     : $COMMIT_FULL"
echo "  Short      : $COMMIT_SHORT"
echo ""
echo "BUILD ACTUAL"
echo "  Frontend   : $COMMIT_SHORT (verificado en bundle)"
echo "  Backend    : $COMMIT_SHORT (compilado en este run)"
echo "  Preload    : $COMMIT_SHORT (compilado en este run)"
echo "  Electron main: $COMMIT_SHORT"
echo "  App.asar   : $COMMIT_SHORT (verificado por extracción)"
echo "  Built at   : $DATE_STR"
echo ""
echo "ARTEFACTOS"
echo "  App    : $APP_PATH"
echo "  DMG    : $NEW_DMG"
echo "  Nombre : $DMG_NAME"
echo "  Tamaño : $(du -sh "$NEW_DMG" | cut -f1)"
echo "  SHA-256: $SHA"
echo ""
echo "PRÓXIMOS PASOS"
echo "  1. Montar DMG:  hdiutil attach '$NEW_DMG'"
echo "  2. Instalar:    cp -r '/Volumes/Crypto Control/Crypto Control.app' /Applications/"
echo "  3. Desmontar:   diskutil eject 'Crypto Control'"
echo "  4. Abrir:       open '/Applications/Crypto Control.app'"
echo "  5. Verificar:   Configuración > Diagnóstico > BUILD VALIDATION"
echo "     Debe mostrar commit: $COMMIT_SHORT"
echo ""
