#!/bin/bash
# ============================================================
# MOSS CORE macOS DMG 打包脚本
# 在 Mac 上运行，生成可直接分发的 .dmg 安装包
#
# 用法：
#   bash make-dmg.sh              # 正式版
#   bash make-dmg.sh dev          # 测试版（DEV 图标）
#
# 产物：
#   ~/moss-core-build/out/MOSS-CORE-mac-arm64-v<版本>.dmg
#   ~/moss-core-build/out/MOSS-CORE-mac-arm64-v<版本>-dev.dmg
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

API_URL="https://43-160-232-254.sslip.io"
API_TOKEN="yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo"
WORKDIR="$HOME/moss-core-build"
REPO_URL="https://github.com/TerenceHZ/MOSSCORE.git"

# ---- 通道 ----
CHANNEL="release"
if [[ "$1" == "dev" ]]; then
  CHANNEL="dev"
fi

if [[ "$CHANNEL" == "dev" ]]; then
  APP_NAME="MOSS CORE DEV"
  SCRIPT_NAME="pack:arm64:dev"
  ICON_FILE="icon-dev.png"
  OUT_SUB="dist-dev"
  DMG_SUFFIX="-dev"
else
  APP_NAME="MOSS CORE"
  SCRIPT_NAME="pack:arm64"
  ICON_FILE="icon.png"
  OUT_SUB="dist"
  DMG_SUFFIX=""
fi

echo ""
echo "========================================"
echo -e "  MOSS CORE DMG Builder ${CYAN}[$CHANNEL]${NC}"
echo "========================================"
echo ""

# ---- 1. 系统检查 ----
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}错误：必须在 macOS 上运行${NC}"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  echo -e "${RED}错误：仅支持 Apple Silicon (arm64)，当前 $ARCH${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} 系统：macOS Apple Silicon"

# ---- 2. 检查工具 ----
for cmd in git node npm hdiutil; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}错误：缺少 $cmd${NC}"
    exit 1
  fi
done
echo -e "${GREEN}✓${NC} 工具齐全（git/node/npm/hdiutil）"

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}错误：Node.js 需要 18+，当前 $(node -v)${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

if ! xcode-select -p &>/dev/null; then
  echo -e "${YELLOW}需要安装 Xcode 命令行工具${NC}"
  echo "正在打开安装窗口，装完后重新运行本脚本"
  xcode-select --install || true
  exit 0
fi
echo -e "${GREEN}✓${NC} Xcode 命令行工具"

# ---- 3. 拉取源码 ----
echo ""
echo "拉取源码..."
if [ -d "$WORKDIR/mac-electron" ]; then
  cd "$WORKDIR"
  git fetch origin main 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || true
else
  rm -rf "$WORKDIR"
  git clone "$REPO_URL" "$WORKDIR"
  cd "$WORKDIR"
fi
echo -e "${GREEN}✓${NC} 源码就绪"

CONF_DIR="$WORKDIR/mac-electron"
VERSION=$(node -p "require('$CONF_DIR/package.json').version")
echo -e "${GREEN}✓${NC} 版本 v$VERSION"

# ---- 4. 写入云端配置 ----
cat > "$CONF_DIR/data-source.json" << EOF
{
  "url": "$API_URL",
  "token": "$API_TOKEN",
  "mode": "remote"
}
EOF
echo -e "${GREEN}✓${NC} 云端配置已写入"

# ---- 5. 图标检查 ----
if [ ! -f "$CONF_DIR/$ICON_FILE" ]; then
  echo -e "${YELLOW}警告：$ICON_FILE 不存在，回退到 icon.png${NC}"
  ICON_FILE="icon.png"
fi
echo -e "${GREEN}✓${NC} 图标：$ICON_FILE"

# ---- 6. 安装依赖 ----
echo ""
echo "安装依赖（首次约 2-5 分钟）..."
cd "$CONF_DIR"
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
npm install --no-audit --no-fund 2>&1 | tail -5
echo -e "${GREEN}✓${NC} 依赖安装完成"

# ---- 7. 打包 .app ----
echo ""
echo "打包应用（1-3 分钟）..."
rm -rf "$CONF_DIR/$OUT_SUB"
npm run "$SCRIPT_NAME" 2>&1 | tail -10

APP_PATH="$CONF_DIR/$OUT_SUB/$APP_NAME-darwin-arm64/$APP_NAME.app"
if [ ! -d "$APP_PATH" ]; then
  echo -e "${RED}打包失败，找不到 $APP_PATH${NC}"
  ls -la "$CONF_DIR/$OUT_SUB" 2>/dev/null || true
  exit 1
fi
echo -e "${GREEN}✓${NC} .app 生成完成"

# ---- 8. 内嵌配置 ----
RES_DIR="$APP_PATH/Contents/Resources"
if [ -d "$RES_DIR/app" ]; then
  cp "$CONF_DIR/data-source.json" "$RES_DIR/app/data-source.json"
else
  cp "$CONF_DIR/data-source.json" "$RES_DIR/data-source.json"
fi
echo -e "${GREEN}✓${NC} 配置已内嵌"

# ---- 9. 移除 quarantine ----
xattr -cr "$APP_PATH" 2>/dev/null || true
echo -e "${GREEN}✓${NC} 已清除隔离标记"

# ---- 10. 生成 DMG ----
echo ""
echo "生成 DMG..."

OUT_DIR="$WORKDIR/out"
mkdir -p "$OUT_DIR"

DMG_NAME="MOSS-CORE-mac-arm64-v${VERSION}${DMG_SUFFIX}.dmg"
DMG_PATH="$OUT_DIR/$DMG_NAME"

# 清理旧文件
rm -f "$DMG_PATH"

# 准备临时目录
STAGE=$(mktemp -d)
cp -R "$APP_PATH" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# 创建 DMG（UDZO = 压缩可读写）
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  -fs HFS+ \
  "$DMG_PATH" >/dev/null

rm -rf "$STAGE"

if [ ! -f "$DMG_PATH" ]; then
  echo -e "${RED}DMG 生成失败${NC}"
  exit 1
fi

SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo -e "${GREEN}✓${NC} DMG 生成完成：$DMG_NAME ($SIZE)"

# ---- 11. 自签名（可选，绕过部分 Gatekeeper 提示）----
echo ""
echo "尝试自签名..."
if codesign --force --deep --sign - "$APP_PATH" 2>/dev/null; then
  echo -e "${GREEN}✓${NC} 已自签名（ad-hoc）"
else
  echo -e "${YELLOW}⚠${NC} 自签名跳过（不影响使用）"
fi

# ---- 12. 完成 ----
echo ""
echo "========================================"
echo -e "${GREEN}  打包完成${NC}"
echo "========================================"
echo ""
echo "文件：$DMG_PATH"
echo "大小：$SIZE"
echo "通道：$CHANNEL"
echo "图标：$ICON_FILE"
echo ""
echo "下一步："
echo "  1. 上传到服务器："
echo "     scp \"$DMG_PATH\" ubuntu@43.160.232.254:/tmp/"
echo "     ssh ubuntu@43.160.232.254 'sudo mv /tmp/$DMG_NAME /var/www/moss-site/downloads/ && sudo chown caddy:caddy /var/www/moss-site/downloads/*.dmg'"
echo ""
echo "  2. 或直接在本机安装测试："
echo "     open \"$DMG_PATH\""
echo ""
read -p "现在打开 DMG 试试？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  open "$DMG_PATH"
fi
