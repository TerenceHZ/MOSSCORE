# MOSS CORE macOS

macOS 版使用 Electron，连接云端 HTTPS 快照，不需要 Tailscale，也不需要本机请求币安。

## 方式一：GitHub Actions（不用 Mac 电脑）

1. 在 GitHub 仓库 Settings → Secrets and variables → Actions 新建 secret：
   - 名称：`MOSS_DATA_SOURCE`
   - 值：本机 `C:\Users\ROG\MOSS CORE\data-source.json` 的完整内容
2. 打开 Actions → `Build macOS` → Run workflow
3. 构建完成后下载：
   - `MOSS-CORE-mac-arm64.zip`（Apple 芯片）
   - `MOSS-CORE-mac-x64.zip`（Intel Mac）

## 方式二：在 Mac 上直接构建

需要 Node.js 20+。

```bash
cd mac-electron
cp /path/to/data-source.json .
npm install
npm run pack:arm64     # Apple Silicon
npm run pack:x64       # Intel
```

输出：

```text
dist/MOSS CORE-darwin-arm64/MOSS CORE.app
dist/MOSS CORE-darwin-x64/MOSS CORE.app
```

## 首次打开

未签名版本首次打开：

```bash
xattr -dr com.apple.quarantine "/Applications/MOSS CORE.app"
```

或右键 App → 打开。

## 说明

- UI 与 Windows 版共用 `index.html`
- 数据来自 `https://43-160-232-254.sslip.io`
- 每 60 秒拉取一次云端快照
- 不需要 Tailscale
- data-source.json 含访问 token，不要提交到公开仓库
