# WB 代理管理器

把 WB 桌面客户端里已登录账号的模型，以本地 OpenAI / Anthropic 兼容接口暴露出来，
供 Codex、Claude Code 等命令行 agent 直接调用。

**零额外凭据** —— 不注册、不申请 API Key，复用桌面客户端自己的登录态。

---

## 用起来就三步

1. 安装并登录 WB 桌面客户端
2. 运行本程序（绿色版，免安装），点「启动」
3. 在 agent 里填上界面显示的地址，模型填 `workbuddy`；回到本程序选实际要用的模型

界面里还能看：模型倍率排序、免费/限时免费/限额状态、世界排名、实时积分消耗、历史每日柱状图。

---

## 先说清楚（重要）

- **本仓库不含 WB 客户端本体。** WB 是闭源商业软件，本仓库不分发其任何文件、二进制、凭据或数据，用户需自行安装登录。
- **依赖非官方接口。** 上游一旦改协议，本程序即失效。
- **仅供个人学习研究**，用于你自己账号在本机调用。这类做法**可能不符合 WB 的服务条款**，存在账号被限制或封禁的风险，由使用者自行判断并承担。
- 不要用于商业经营，不要转售，不要把接口地址暴露到公网。

---

## 许可

**MIT**。第三方代码来源与归属见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) —— 该文件**必须**随本仓库一并保留。

其中：国际版协议参数移植自 `dsh-workbuddy-connect`（MIT，`© 2026 Corrine Hu`），按许可要求保留版权声明。

分发二进制时，还必须附带 Chromium / Electron 的许可证文件（构建产物 `win-unpacked/` 下的
`LICENSES.chromium.html` 与 `LICENSE.electron.txt`）。

---

## 构建

```bash
cd electron-app
npm install
npm run dist
```

产出在 `dist-portable*/` 下。

更完整的上游技术文档见 [`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md)。
