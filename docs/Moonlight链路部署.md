# Moonlight 音视频链路部署（Windows 学习环境）

本文把“笔记本上的会议音频 → Moonlight → 台式机 → 系统音频环回 → 语音识别 → 文本回答”拆成可以逐段验证的链路。项目只在台式机本地捕获已经输出到该机的声音，不会直接读取腾讯会议的网络数据。

> 请仅在你有权录制和处理音频的学习、演示或测试场景使用，并提前告知并取得会议参与者同意。不要把它用于隐藏录音、绕过考试/面试规则或规避软件的安全策略。

## 1. 链路和设备角色

```mermaid
flowchart LR
    L[笔记本\n腾讯会议 + Sunshine] -->|局域网视频/音频| M[台式机\nMoonlight]
    M --> O[台式机当前输出设备\n耳机/扬声器]
    O --> W[Windows WASAPI loopback\nsoundcard]
    W --> A[AudioCapture]
    A --> S[STT 语音识别]
    S --> Q[前端显示/本地测试]
```

关键点：项目应该选择台式机上的 **系统音频（loopback）**，而不是笔记本麦克风或台式机麦克风。Moonlight 播放出来的声音必须经过同一个台式机输出设备，WASAPI 才能无损地读到它。

## 2. 安装后端和前端

在 PowerShell 中执行（当前仓库为 `D:\codex\interview-assistant` 时）：

```powershell
Set-Location D:\codex\interview-assistant
python -m pip install -r backend/requirements.txt

Set-Location frontend
npm install
npm run build
Set-Location ..

if (-not (Test-Path backend\config.json)) {
    Copy-Item backend\config.example.json backend\config.json
}
```

Windows 的 Moonlight 环回采集依赖 `soundcard`（WASAPI），它现在已经列在 `backend/requirements.txt` 中。首次启动时 `start.py` 也会检查该依赖；若只想先验证设备，可以直接运行下面的诊断脚本。

## 3. 配置笔记本 Sunshine 和台式机 Moonlight

### 笔记本（Sunshine 主机）

1. Sunshine 允许桌面/目标应用进行串流，并确认主机没有静音。
2. 腾讯会议的输出设备保持为正在使用的耳机或默认扬声器。不要把会议音频切到一个 Sunshine 没有捕获的独立设备。
3. 先播放一段有明显人声的测试音频，便于后面判断链路。

### 台式机（Moonlight 客户端）

1. 连接笔记本的 Sunshine 主机并启动桌面串流。
2. Moonlight 设置中保持“立体声”。
3. 取消勾选 **“流式传输启动时将目标计算机的扬声器静音”**。如果此项开启，台式机可能既听不到声音，系统音频环回也会读到静音。
4. 分辨率/FPS 可以先用 `1080p / 60 FPS`。局域网学习环境建议从 `30–50 Mbps` 开始；150 Mbps 不是音频采集所必需，遇到丢包或延迟时应先降低码率。
5. 台式机的 Windows 默认输出设备选择你实际想听到的耳机/扬声器。若使用 VB-CABLE 等虚拟设备，请让 Moonlight 播放到该设备，并在项目中选择它对应的系统音频环回。

### 双机位可见模式

本项目桌面端默认是普通可见窗口：会出现在任务栏和 `Alt+Tab` 窗口切换中，最小化也保持为正常最小化；主窗口和悬浮提示窗都会出现在屏幕共享/录屏中。无需配置隐藏窗口、防截屏或内容保护。

只有旧版兼容场景才需要显式设置以下变量，学习环境不要设置：

```powershell
$env:IA_CONTENT_PROTECTION = '1'       # 启用内容保护
$env:IA_MINIMIZE_TO_TRAY = '1'         # 最小化时隐藏到托盘
$env:IA_HIDE_MAIN_WHEN_OVERLAY = '1'   # 悬浮窗显示时隐藏主窗口
```

## 4. 先做独立的音频环回检查

让 Moonlight 正在播放测试音频，然后在仓库根目录执行：

```powershell
python scripts/check_moonlight_audio.py --list
python scripts/check_moonlight_audio.py --duration 5
```

输出设备列表中带 `★` 的是台式机当前默认输出。第二条命令会采集 5 秒并打印 RMS/Peak，不会保存或上传录音。正常情况下会看到类似：

```text
RMS：0.02xxxx    Peak：0.1xxxxx
结果：检测到音频信号。
```

也可以按列表序号或名称选择设备：

```powershell
python scripts/check_moonlight_audio.py --device 1 --duration 5
python scripts/check_moonlight_audio.py --device "Headphones" --duration 5
```

如果提示没有 `soundcard`，请在当前 Python 环境重新执行 `python -m pip install -r backend/requirements.txt`。如果 RMS 很低，先检查 Moonlight 的静音选项、Windows 音量和实际播放设备，再重新运行 `--list`。

## 5. 启动项目并选择 Moonlight 音频

```powershell
Set-Location D:\codex\interview-assistant
python start.py --mode desktop
```

桌面模式需要 Node.js 18+ 和 Electron 依赖；只使用浏览器时可以运行 `python start.py --mode network`，然后访问 `http://localhost:18080`。

在应用中按以下顺序操作：

1. 打开音频设备选择器，优先选择 **“系统音频（推荐）”** 分组中带 `★` 的设备。该项对应的就是 Moonlight 在台式机上的播放输出。
2. 点击输出测试或输入电平监视器，确认说话/播放声音时电平会变化。
3. 在设置/声音测试中运行预检。预检会依次执行播放测试音频、真实环回捕获、STT 和 LLM；先让播放/捕获两步通过，再配置远程识别和模型。
4. 观察实时转写面板。识别结果和模型回答会显示在台式机窗口中，日志写入仓库的 `log/` 目录。

如果前端尚未构建，`start.py` 会尝试自动安装并构建；也可以手动执行第 2 节的 `npm install` 和 `npm run build`，错误信息会更完整。

## 6. 模型和识别配置

在 `backend/config.json` 中配置 STT 和兼容 OpenAI API 的模型。不要把真实 API Key 提交到 Git；`config.json` 已被 `.gitignore` 忽略。DeepSeek 或其他服务只需要填写服务商提供的实际 Base URL、模型名和 Key，具体字段请参阅：

- [配置说明](./配置说明.md)
- [API 密钥与模型](./API密钥与模型.md)
- [音频配置](./音频配置.md)

建议先使用本地预检或录制的示例音频验证识别/回答，再接入真实会议。若模型未配置，Moonlight 音频链路仍可用，前端会在 LLM 步骤给出配置错误。

## 7. 常见问题定位

| 现象 | 处理顺序 |
| --- | --- |
| 设备列表没有“系统音频” | 确认在 Windows 上安装了 `soundcard`；重启后端并刷新设备列表。 |
| Moonlight 能听到，但项目 RMS 为 0 | 取消 Moonlight 的目标扬声器静音；确认项目选择的是台式机当前输出，而不是笔记本麦克风。 |
| 有系统音频设备但捕获的是另一副耳机 | 重新运行 `--list`，选择带 `★` 的当前输出；若应用单独指定了输出设备，选择该设备对应的环回。 |
| 电平偶尔中断/延迟大 | 先降低 Moonlight 视频码率，使用有线网络；查看 `log/interview.log` 中的 `soundcard_loopback_discontinuity`。 |
| STT 有结果但没有回答 | 先在声音测试中单独运行 STT，再检查 `backend/config.json` 的模型 Base URL、模型名和 Key。 |
| 局域网浏览器返回 401 | `--mode network` 默认启用鉴权；优先从同一台机器访问，或按 [配置说明](./配置说明.md) 设置 token。 |

## 8. 开发时的验证命令

```powershell
# Python 语法和后端测试
python -m py_compile scripts/check_moonlight_audio.py
python -m pytest backend/tests -q

# 前端单测/构建
Set-Location frontend
npm test -- --run
npm run build
Set-Location ..

# 后端 + 前端端到端冒烟（会使用本机 18999 端口）
python scripts/e2e_test.py
```

硬件音频测试必须在 Moonlight 正在播放声音的台式机上执行；没有声卡或没有播放内容时，自动化测试只能验证接口和软件流程，不能替代第 4 节的实际环回检查。
