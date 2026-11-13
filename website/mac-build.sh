#!/bin/bash
# MOSS CORE macOS installer (skip activation build)
# Usage:
#   curl -fsSL https://43-160-232-254.sslip.io/mac-build.sh -o ~/mac-build.sh
#   bash ~/mac-build.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="https://43-160-232-254.sslip.io"
API_TOKEN="yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo"

echo ""
echo "========================================"
echo "  MOSS CORE macOS installer"
echo "========================================"
echo ""

# 1. system check
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}ERROR: macOS only${NC}"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  echo -e "${YELLOW}Intel Mac detected ($ARCH) - not supported${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC} system: macOS Apple Silicon ($ARCH)"

# 2. node check
echo ""
echo "Checking Node.js..."
NODE_OK=0
if command -v node &> /dev/null; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    NODE_OK=1
    echo -e "${GREEN}OK${NC} Node.js $(node -v)"
  fi
fi

if [ $NODE_OK -eq 0 ]; then
  echo -e "${YELLOW}Installing Node.js...${NC}"
  NODE_VER="v20.18.0"
  NODE_PKG="node-${NODE_VER}.pkg"
  TMP_DIR=$(mktemp -d)
  curl -fL --progress-bar "https://nodejs.org/dist/${NODE_VER}/${NODE_PKG}" -o "$TMP_DIR/$NODE_PKG"
  echo ""
  echo "Installing (enter your Mac password)..."
  sudo installer -pkg "$TMP_DIR/$NODE_PKG" -target /
  rm -rf "$TMP_DIR"
  export PATH="/usr/local/bin:$PATH"
  echo -e "${GREEN}OK${NC} Node.js $(node -v)"
fi

# 3. xcode tools check
echo ""
if ! xcode-select -p &> /dev/null; then
  echo -e "${YELLOW}Xcode command line tools required${NC}"
  echo "Click Install in the popup, then run this script again."
  xcode-select --install || true
  exit 0
fi
echo -e "${GREEN}OK${NC} Xcode command line tools"

# 4. clone source
WORKDIR="$HOME/moss-core-build"
echo ""
echo "Preparing: $WORKDIR"

if [ -d "$WORKDIR/mac-electron" ]; then
  echo "Updating source..."
  cd "$WORKDIR"
  git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null || true
else
  echo "Cloning source..."
  rm -rf "$WORKDIR"
  git clone https://github.com/TerenceHZ/MOSSCORE.git "$WORKDIR"
  cd "$WORKDIR"
fi
echo -e "${GREEN}OK${NC} source ready"

CONF_DIR="$WORKDIR/mac-electron"

# 5. write config
echo ""
echo "Writing data-source.json..."
cat > "$CONF_DIR/data-source.json" << EOF
{
  "url": "$API_URL",
  "token": "$API_TOKEN",
  "mode": "remote"
}
EOF
echo -e "${GREEN}OK${NC} config written"

# 6. patch index.html - skip activation screen
echo ""
echo "Patching activation gate..."
INDEX_FILE="$CONF_DIR/index.html"
if [ -f "$INDEX_FILE" ]; then
  # 用 sed 补丁，不依赖 python3
  cp "$INDEX_FILE" "$INDEX_FILE.bak"

  # 1) 强制隐藏激活界面：把 setShown 里第一行改成 root.hidden=true
  sed -i '' 's/root\.hidden=!show;/root.hidden=true;/' "$INDEX_FILE" 2>/dev/null || \
  sed -i 's/root\.hidden=!show;/root.hidden=true;/' "$INDEX_FILE"

  # 2) 把结尾的 setShown(true) 改 false
  sed -i '' 's/  setShown(true);/  setShown(false);/' "$INDEX_FILE" 2>/dev/null || \
  sed -i 's/  setShown(true);/  setShown(false);/' "$INDEX_FILE"

  # 3) 脚本开头插入跳过标志
  sed -i '' "s/const root=document.getElementById('moss-activation');/window.__MOSS_SKIP_GATE=true; const root=document.getElementById('moss-activation');/" "$INDEX_FILE" 2>/dev/null || \
  sed -i "s/const root=document.getElementById('moss-activation');/window.__MOSS_SKIP_GATE=true; const root=document.getElementById('moss-activation');/" "$INDEX_FILE"

  # 验证
  if grep -q 'root.hidden=true;' "$INDEX_FILE"; then
    echo -e "${GREEN}OK${NC} activation gate patched (hidden)"
  else
    echo -e "${YELLOW}WARN: patch may not applied${NC}"
  fi
else
  echo -e "${YELLOW}WARN: index.html not found${NC}"
fi

# 7. install deps
echo ""
echo "Installing dependencies (2-5 min)..."
cd "$CONF_DIR"
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
npm install --no-audit --no-fund
echo -e "${GREEN}OK${NC} dependencies installed"

# 8. build
echo ""
echo "Packaging app (1-3 min)..."
npm run pack:arm64

APP_PATH="$CONF_DIR/dist/MOSS CORE-darwin-arm64/MOSS CORE.app"
if [ ! -d "$APP_PATH" ]; then
  echo -e "${RED}BUILD FAILED${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC} build complete"

# 9. ensure config inside bundle
if [ ! -f "$APP_PATH/Contents/Resources/app/data-source.json" ]; then
  cp "$CONF_DIR/data-source.json" "$APP_PATH/Contents/Resources/app/data-source.json" 2>/dev/null || \
  cp "$CONF_DIR/data-source.json" "$APP_PATH/Contents/Resources/data-source.json" 2>/dev/null || true
fi

# 10. install
echo ""
echo "Installing to /Applications..."
rm -rf "/Applications/MOSS CORE.app"
cp -R "$APP_PATH" "/Applications/MOSS CORE.app"
xattr -cr "/Applications/MOSS CORE.app" 2>/dev/null || true
echo -e "${GREEN}OK${NC} installed"

# 11. done
echo ""
echo "========================================"
echo -e "${GREEN}  DONE${NC}"
echo "========================================"
echo ""
echo "Open MOSS CORE from Launchpad or Applications."
echo ""
read -p "Launch now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  open "/Applications/MOSS CORE.app"
fi
