#!/bin/bash
# MOSS CORE macOS 一键构建脚本
# 用法：
#   curl -fsSL https://43-160-232-254.sslip.io/mac-build.sh -o ~/mac-build.sh
#   bash ~/mac-build.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="https://43-160-232-254.sslip.io"

echo ""
echo "========================================"
echo "  MOSS CORE macOS 安装程序"
echo "========================================"
echo ""

# 1. 系统检查
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}错误：此脚本只能在 macOS 上运行${NC}"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
  echo -e "${YELLOW}检测到 Intel Mac（$ARCH）${NC}"
  echo "当前只支持 Apple Silicon（M1/M2/M3/M4/M5）"
  exit 1
fi
echo -e "${GREEN}✓${NC} 系统检测通过：macOS Apple Silicon ($ARCH)"

# 2. 检查 Node.js
echo ""
echo "检查 Node.js..."
NODE_OK=0
if command -v node &> /dev/null; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    NODE_OK=1
    echo -e "${GREEN}✓${NC} Node.js $(node -v)"
  fi
fi

if [ $NODE_OK -eq 0 ]; then
  echo -e "${YELLOW}未检测到 Node.js 18+，正在自动安装...${NC}"
  echo ""
  NODE_VER="v20.18.0"
  NODE_PKG="node-${NODE_VER}.pkg"
  NODE_URL="https://nodejs.org/dist/${NODE_VER}/${NODE_PKG}"
  TMP_DIR=$(mktemp -d)
  echo "下载 Node.js ${NODE_VER}（约 60MB）..."
  echo ""
  if curl -fL --progress-bar "$NODE_URL" -o "$TMP_DIR/$NODE_PKG"; then
    echo ""
    echo "正在安装（需要输入你的 Mac 登录密码）..."
    echo ""
    sudo installer -pkg "$TMP_DIR/$NODE_PKG" -target /
    rm -rf "$TMP_DIR"
    export PATH="/usr/local/bin:$PATH"
    if ! command -v node &> /dev/null; then
      echo -e "${RED}Node.js 安装后仍不可用${NC}"
      exit 1
    fi
    echo -e "${GREEN}✓${NC} Node.js $(node -v) 安装成功"
  else
    rm -rf "$TMP_DIR"
    echo -e "${RED}下载失败，请手动安装：https://nodejs.org${NC}"
    exit 1
  fi
fi

# 3. 检查 Xcode 命令行工具（git 依赖）
echo ""
if ! xcode-select -p &> /dev/null; then
  echo -e "${YELLOW}需要安装 Xcode 命令行工具${NC}"
  echo "请在弹出窗口点「安装」，装完后重新运行本脚本。"
  xcode-select --install || true
  exit 0
fi
echo -e "${GREEN}✓${NC} Xcode 命令行工具已就绪"

# 4. 下载源码
WORKDIR="$HOME/moss-core-build"
echo ""
echo "准备构建目录：$WORKDIR"

if [ -d "$WORKDIR/mac-electron" ]; then
  echo "目录已存在，更新源码..."
  cd "$WORKDIR"
  git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null || true
else
  echo "下载源码中..."
  rm -rf "$WORKDIR"
  git clone https://github.com/TerenceHZ/MOSSCORE.git "$WORKDIR"
  cd "$WORKDIR"
fi
echo -e "${GREEN}✓${NC} 源码就绪"

# 5. 生成配置文件（关键：data-source.json 不在仓库里）
echo ""
echo "写入数据源配置..."
CONF_DIR="$WORKDIR/mac-electron"
cat > "$CONF_DIR/data-source.json" << 'EOF'
{
  "url": "https://43-160-232-254.sslip.io",
  "token": "yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo",
  "mode": "remote"
}
EOF
echo -e "${GREEN}✓${NC} 配置已写入"

# 6. 安装依赖
echo ""
echo "安装构建依赖（首次约 2-5 分钟）..."
cd "$CONF_DIR"
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
npm install --no-audit --no-fund
echo -e "${GREEN}✓${NC} 依赖安装完成"

# 7. 打包
echo ""
echo "正在打包 macOS 应用（约 1-3 分钟）..."
npm run pack:arm64

APP_PATH="$CONF_DIR/dist/MOSS CORE-darwin-arm64/MOSS CORE.app"
if [ ! -d "$APP_PATH" ]; then
  echo -e "${RED}打包失败${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} 打包完成"

# 8. 验证配置在包内
if [ ! -f "$APP_PATH/Contents/Resources/app/data-source.json" ]; then
  echo -e "${YELLOW}警告：包内未找到 data-source.json，尝试放入 Resources...${NC}"
  cp "$CONF_DIR/data-source.json" "$APP_PATH/Contents/Resources/data-source.json" 2>/dev/null || true
fi

# 9. 安装
echo ""
echo "安装到「应用程序」文件夹..."
rm -rf "/Applications/MOSS CORE.app"
cp -R "$APP_PATH" "/Applications/MOSS CORE.app"
xattr -cr "/Applications/MOSS CORE.app" 2>/dev/null || true
echo -e "${GREEN}✓${NC} 已安装到 /Applications/MOSS CORE.app"

# 10. 完成
echo ""
echo "========================================"
echo -e "${GREEN}  安装完成！${NC}"
echo "========================================"
echo ""
echo "从「启动台」或「应用程序」打开 MOSS CORE 即可。"
echo ""
read -p "现在启动 MOSS CORE？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  open "/Applications/MOSS CORE.app"
fi
