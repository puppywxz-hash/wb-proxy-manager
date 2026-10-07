# WorkBuddy Proxy 管理面板 (GUI)

一个**零依赖、纯 Node.js** 的本地图形管理面板，用来启动/停止/监控
[banana770/workbuddy-proxy](https://github.com/banana770/workbuddy-proxy) 的四个代理实例，
并给出接入 **DSH / 任意 OpenAI 兼容客户端** 所需的 URL 与 API Key。

> 本面板只是把仓库自带的 `codex\proxy.ps1` / `zcode\proxy.ps1` 用图形按钮包了一层，
> 与你在 PowerShell 里手动跑完全等价。

---

## 它能做什么

| 功能 | 说明 |
|---|---|
| 四个实例管理 | Codex 国内版(8401) / ZCode 国内版(8400) / Codex 国际版(8403) / ZCode 国际版(8402) |
| 一键启动/停止 | 每个实例独立 启动 / 停止 按钮，状态实时刷新（绿点=运行中） |
| 自动拉起 | 勾选「随面板启动自动拉起」后，面板一开就自动把代理拉起来（默认拉起 Codex 国内版） |
| 健康检查 | 每 8 秒自动探活 `/healthz`，显示 `running / 未运行` |
| 日志查看 | 下拉选 `codex` / `zcode`，点「查看」读取对应 `proxy.log` 尾部 |
| DSH 接入配置 | 页面直接给出要填的 Base URL 与 API Key |

---

## 前置条件

- **Windows** + **Node.js ≥ 18**（已在 PATH 中）
- **WorkBuddy 桌面客户端已安装并登录**（代理读取其凭据文件）
- 本面板文件需放在**仓库根目录**，与 `codex/`、`zcode/` 同级

目录应长这样：

```
workbuddy-proxy-gui/
├── gui.mjs            ← 本面板
├── start-gui.ps1      ← 双击启动器
├── codex/proxy.ps1    ← 原仓库脚本（被调用）
├── zcode/proxy.ps1
├── ...
```

---

## 启动

**方式 A（推荐）**：双击 `start-gui.ps1`，会自动打开浏览器到 `http://127.0.0.1:8500`。

**方式 B（命令行）**：

```powershell
cd workbuddy-proxy-gui
node gui.mjs                 # 自动打开浏览器
node gui.mjs --no-open       # 不自动打开浏览器
node gui.mjs --port 8600     # 换端口
```

---

## 在 DSH 里怎么填

面板「DSH / OpenAI 兼容客户端 接入配置」卡片已直接给出：

- **Base URL**：`http://127.0.0.1:8401/v1`
- **API Key**：`sk-any`（或任意字符串，代理默认不校验 Bearer）

说明：

- **Codex 国内版 (8401)** 同时提供 `/v1/chat/completions`（标准 OpenAI）与 `/v1/responses`，
  所以 DSH 只要是 OpenAI 兼容模式，填上面 URL 即可，**协议没问题**。
- 如果 DSH 只认 **Anthropic / Claude** 协议，改用 **ZCode 国内版 (8400)** 的 `http://127.0.0.1:8400`。
- 若你给代理设了环境变量 `WB_PROXY_TOKEN`，则 API Key 填那个值（否则可留空/任意）。

### 端口对照

| 实例 | 端口 | 协议 | DSH URL |
|---|---|---|---|
| Codex 国内版 | 8401 | OpenAI Responses + Chat Completions | `http://127.0.0.1:8401/v1` |
| ZCode 国内版 | 8400 | Anthropic Messages | `http://127.0.0.1:8400` |
| Codex 国际版 | 8403 | OpenAI Responses + Chat Completions | `http://127.0.0.1:8403/v1` |
| ZCode 国际版 | 8402 | Anthropic Messages | `http://127.0.0.1:8402` |

---

## ⚠️ 重要避坑

- **不要在 WorkBuddy / DSH 会话内部启动代理**（包括在本面板所在的同一个受限会话里）。
  那样会拿到「受限令牌」，读凭据报 `EPERM`，症状是 `/v1/models` 能通、一发消息就 500。
  **用本面板（独立 PowerShell 窗口）启动即可**——面板本身就是独立进程。
- 国际版（workbuddy.ai）出网走代理是代码内兜底的，启动器不用拼长串 env。
- 代理崩了不会自动重启（刻意保持简单）。面板里点「停止」再「启动」即可。

---

## 停止 / 卸载

- 临时停止：面板里点对应实例的「停止」，或直接关掉 `start-gui.ps1` 窗口。
- 完全退出：关闭浏览器标签 + 关闭 PowerShell 窗口即可，无后台服务残留。
- 卸载：删除整个 `workbuddy-proxy-gui/` 目录即可，不影响 WorkBuddy 桌面客户端。

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `gui.mjs` | 面板主程序（HTTP 服务 + 页面 + 调用 proxy.ps1） |
| `start-gui.ps1` | Windows 双击启动器，自动开浏览器 |
| `gui-config.json` | 自动生成，记录「随启动自动拉起」的实例列表 |
