# Wineclouds Interview Assistant

**简体中文** · [English](README.en.md)

实时面试学习与复盘助手，提供语音转写、AI 参考回答、截图审题、个人知识库、简历优化和求职看板。支持 Electron 桌面窗口及局域网浏览器访问。

[![Version](https://img.shields.io/badge/version-v1.3.0-6D597A)](desktop/package.json)
[![License](https://img.shields.io/badge/license-CC%20BY--NC%204.0-284B63)](LICENSE)

## 当前源码更新

2026-10-04：同步全项目审查确认的 13 项修复，并完成 Windows 最新入口的实际启动验证。

- 配置保存保护：钥匙串暂时不可用时保留原密钥；写盘失败会返回错误并保留原内存配置，配置和模型排序入口都能正确反馈失败。
- 知识库文件边界：上传、删除和索引拒绝目录穿越、Windows 驱动器相对路径、NTFS 数据流及指向库外的目录链接。
- 日志脱敏：覆盖 WebSocket 握手、访问日志、协议子 logger 和应用文件日志中的 URL 令牌。
- 会话与复盘：摘要失败保留历史，新面试独立归档；复盘分析失败可以重试，已成功的题目分析会复用。
- 候选人语音：最终识别等待共享 Whisper 推理锁，同批多个 VAD 片段均会消费，并保留各段的问题归属。
- 手机与桌面：HTTP 局域网页面能够新增待办；截图、纠错检查和上传写盘不阻塞事件循环；修复桌面退出兜底、二维码端口和 Windows CMD 入口编码/换行问题。

本次本地验证：后端 **128 项**、前端与桌面 **9 项**测试全部通过；Ruff、ESLint、TypeScript、Vite 构建和桌面 JavaScript 语法检查通过。Windows 桌面实际启动后，后端 `/api/options` 返回 HTTP 200。

## 仓库内容

仓库保存源码、依赖声明与锁文件、测试、CI、使用文档及运行必需的图标和音频自检样本。

不提供预编译安装包或前端构建产物，也不提交虚拟环境、`node_modules`、模型缓存、个人配置、密钥、数据库、简历、面试记录、日志、截图、演示视频及未使用的头像素材。首次下载必须安装依赖并构建前端。

## 功能

| 模块 | 能力 |
| --- | --- |
| 实时辅助 | 转写面试官与候选人语音，生成参考回答，维护问答上下文与候选人回答归属。 |
| 截图答题 | 服务端截图、多图题目和笔试链路自检。 |
| 模型设置 | 多模型配置、队列调度、识图模型与复盘模型选择。 |
| 个人知识库 | 文本、Markdown、DOCX、PDF 的上传、索引、检索与引用。 |
| 面试复盘 | 分场保存问答，生成逐题分析和整场总结，失败后可重试。 |
| 简历与求职 | 简历历史与优化、投递看板、跟进待办和 Offer 管理。 |
| 桌面协同 | 全局快捷键、问答悬浮窗、托盘与移动端二维码。 |

## 快速开始

需要 Python **3.10+**、Node.js **20+** 与 npm。本次本地使用 Python 3.12 和 Node.js 24.19.0。Linux 音频依赖 PortAudio，macOS 音频采集还需相应系统权限。CPU 可以运行本地 Whisper，NVIDIA GPU 依赖可按需安装。

### Windows：首次安装

在 PowerShell 中执行：

```powershell
git clone https://github.com/Wineclouds04/wineclouds-interview-assistant.git
cd wineclouds-interview-assistant

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\config.example.json backend\config.json

npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix desktop ci

.\启动最新版.cmd
```

完成首次安装后，双击根目录的 **[启动最新版.cmd](启动最新版.cmd)** 即可打开桌面应用。入口调用 `launch-latest.ps1`，使用当前项目的 Python 环境和 Electron，输出日志写入 `log/`。CMD 使用纯 ASCII 命令和 CRLF 换行，支持包含空格或中文的项目路径。

更新源码后先退出旧应用，重新执行 `npm --prefix frontend run build`，再使用该入口；依赖声明变更时也需重新安装对应依赖。旧的本地配置和数据可继续保留。

`启动.bat` / `quick-start.py` 是安装与构建辅助入口，会检查依赖并重新构建前端；已完成安装时可使用上面的最新入口直接启动。

### macOS / Linux

```bash
git clone https://github.com/Wineclouds04/wineclouds-interview-assistant.git
cd wineclouds-interview-assistant
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/config.example.json backend/config.json
npm --prefix frontend ci
npm --prefix desktop ci
python start.py --mode desktop --rebuild
```

Linux 在安装/运行音频依赖前需提供 PortAudio，例如 Ubuntu：

```bash
sudo apt-get install libportaudio2
```

### 浏览器与手机访问

前端构建完成后可只启动浏览器模式，无须启动 Electron：

```powershell
.\.venv\Scripts\python.exe start.py --mode network --port 18080 --no-build
```

其他系统在已激活虚拟环境中使用 `python start.py --mode network --port 18080 --no-build`。

本机访问 [http://127.0.0.1:18080](http://127.0.0.1:18080)。手机连接同一局域网后，使用设置页二维码；局域网访问默认需要令牌，本机同源访问可免令牌。改变 `--port` 后，二维码使用对应端口。

## 配置与数据

启动后在设置页填写模型 API 地址、模型名称和 API Key，再选择识图/复盘模型及音频设备。API Key 默认存入系统钥匙串；读取异常时保存会被阻止，解锁后可重试。需要明文存储时可显式设置 `IA_SECRET_STORE=plaintext`。

| 路径 | 内容 |
| --- | --- |
| `backend/config.example.json` | 仓库中的配置模板。 |
| `backend/config.json` | 本机配置，不提交。 |
| `backend/data/` | 知识库、简历和面试/求职数据，不提交。 |
| `log/` | 应用、转写、错误与桌面启动日志，不提交。 |
| `frontend/dist/` | 本机构建的前端，不提交。 |

Whisper 首次使用需要下载模型。GPU 加速为可选配置：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-gpu.txt
```

详见 [配置说明](docs/配置说明.md)、[API 密钥与模型](docs/API密钥与模型.md)、[音频配置](docs/音频配置.md)、[豆包语音识别](docs/豆包语音识别.md) 和 [Moonlight 链路部署](docs/Moonlight链路部署.md)。

## 开发与验证

后端：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest backend/tests -q
.\.venv\Scripts\python.exe -m ruff check backend start.py quick-start.py scripts
.\.venv\Scripts\python.exe scripts/check_versions.py
```

前端与桌面回归：

```powershell
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend test
```

浏览器测试使用独立无头浏览器。Windows/macOS 可以使用已安装的 Chrome/Edge；也可在 `frontend` 中执行 `npx playwright install chromium` 安装 Playwright 浏览器，或通过 `IA_TEST_BROWSER_PATH` 指定浏览器程序。CI 会安装浏览器并运行这组测试。

后端测试使用临时配置、临时数据库及外部服务替身，不读取真实密钥、截图或音频设备，也不调用付费模型。合成音频测试使用真实 VAD 与推理锁路径；硬件采集质量和远程模型质量需在实际环境中验证。

## 源码结构

```text
wineclouds-interview-assistant/
├── start.py / quick-start.py     # 启动与依赖检查
├── 启动最新版.cmd               # Windows 最新桌面入口
├── launch-latest.ps1             # 桌面启动与日志重定向
├── backend/
│   ├── api/                     # 公共、实时、辅助、知识库、复盘等 API
│   ├── core/                    # 配置、鉴权、日志与会话
│   ├── services/                # 音频、STT、LLM、知识库、存储等
│   ├── tests/                   # 后端回归测试
│   └── config.example.json      # 无真实凭证的配置模板
├── frontend/src/                # React + TypeScript 界面
├── frontend/tests/              # 前端与桌面回归测试
├── desktop/                     # Electron 源码
├── docs/                        # 配置与部署文档
└── .github/workflows/ci.yml      # 自动检查
```

## 来源与许可

本项目在 [powAu3/interview-assistant](https://github.com/powAu3/interview-assistant) 基础上修改，主要补强密钥与路径保护、语音链路、会话归属、复盘恢复和桌面入口。保留原有 [CC BY-NC 4.0 许可](LICENSE)，供学习研究使用。
