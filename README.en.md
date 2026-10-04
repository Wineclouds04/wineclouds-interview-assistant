# Wineclouds Interview Assistant

[简体中文](README.md) · **English**

A real-time interview learning and review assistant with speech transcription, AI reference answers, screenshot questions, a personal knowledge base, resume tools, and a job tracker. Use it through Electron or a LAN browser.

[![Version](https://img.shields.io/badge/version-v1.3.0-6D597A)](desktop/package.json)
[![License](https://img.shields.io/badge/license-CC%20BY--NC%204.0-284B63)](LICENSE)

## Current source update

2026-10-04: this source update includes fixes for all 13 confirmed project review findings, and the Windows launcher has been verified by starting the desktop application.

- Preserve stored credentials when the OS keychain cannot be read. Failed disk writes report an error and retain the active configuration; both configuration and model-layout endpoints report failures.
- Confine knowledge-base uploads, deletes, and indexing to their root, including Windows drive-relative paths, NTFS streams, and external directory links.
- Redact URL credentials from WebSocket handshakes, access logs, protocol child loggers, and application file logs.
- Keep conversation history when summarization fails; archive each interview independently. Failed review analysis can be retried, reusing successful turn analyses.
- Wait for the shared Whisper inference lock for final candidate speech. Consume every VAD flush and retain its original question association.
- Support todo creation on insecure LAN HTTP pages. Move blocking screenshot, correction-check, and upload work to a thread pool. Fix desktop shutdown escalation, QR ports, and Windows launcher encoding/line endings.

Local verification: **128 backend tests** and **9 frontend/desktop tests** passed, together with Ruff, ESLint, TypeScript, the Vite build, and desktop JavaScript syntax checks. The Windows application started successfully and `/api/options` returned HTTP 200.

## Repository contents

This repository contains source code, dependency manifests and lockfiles, tests, CI, documentation, and the icons/audio sample required by the application.

It excludes installers, compiled frontend output, virtual environments, `node_modules`, model caches, personal configuration, secrets, databases, resumes, interview records, logs, screenshots, demo videos, and unused avatar assets. Install dependencies and build the frontend after cloning.

## Features

| Module | Features |
| --- | --- |
| Live assistance | Interviewer/candidate transcription, reference answers, question context, and candidate answer association. |
| Screenshot questions | Server-side screenshots, multi-image questions, and written-exam diagnostics. |
| Models | Multiple providers, scheduling, vision models, and a review model. |
| Knowledge base | Upload, index, search, and cite text, Markdown, DOCX, and PDF documents. |
| Review | Per-interview archives, turn analysis, summaries, and retries. |
| Resume and jobs | Resume history/optimization, applications, follow-up tasks, and offers. |
| Desktop | Global shortcuts, answer overlay, tray, and mobile QR access. |

## Getting started

Requirements: Python **3.10+**, Node.js **20+**, and npm. Local verification used Python 3.12 and Node.js 24.19.0. Linux audio requires PortAudio; macOS capture requires appropriate system permissions. Whisper can run on CPU; NVIDIA GPU dependencies are optional.

### Windows: first installation

Run in PowerShell:

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

After installation, double-click **[启动最新版.cmd](启动最新版.cmd)**. It calls `launch-latest.ps1`, uses this project's Python environment and Electron, and writes desktop logs to `log/`. The CMD file uses ASCII commands and CRLF line endings and supports paths containing spaces or Chinese characters.

After updating source, close the old application and rebuild with `npm --prefix frontend run build` before launching. Reinstall dependencies when their manifests change. Keep your existing local configuration and data.

`启动.bat` / `quick-start.py` provide installation/build assistance and may reinstall dependencies and rebuild the frontend. Use the latest launcher above after setup.

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

Install the PortAudio runtime for Linux audio; for example, on Ubuntu:

```bash
sudo apt-get install libportaudio2
```

### Browser and mobile

Once the frontend is built, run browser mode without Electron:

```powershell
.\.venv\Scripts\python.exe start.py --mode network --port 18080 --no-build
```

On other systems use `python start.py --mode network --port 18080 --no-build` in the activated environment.

Open [http://127.0.0.1:18080](http://127.0.0.1:18080) locally. For a phone on the same LAN, scan the settings-page QR code. LAN access requires a token by default; same-origin loopback requests can bypass it. QR URLs follow the configured port.

## Configuration and data

Set API endpoints, model names, and keys in Settings, then select vision/review models and audio devices. Keys use the OS keychain by default. Saving is blocked on keychain read errors and can be retried after unlocking. Set `IA_SECRET_STORE=plaintext` explicitly if plaintext storage is needed.

| Path | Purpose |
| --- | --- |
| `backend/config.example.json` | Committed configuration template. |
| `backend/config.json` | Local configuration; excluded. |
| `backend/data/` | Knowledge, resume, interview, and job data; excluded. |
| `log/` | Application, transcript, error, and desktop logs; excluded. |
| `frontend/dist/` | Locally built frontend; excluded. |

Whisper downloads its model on first use. Optional GPU dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-gpu.txt
```

Additional guides: [configuration](docs/配置说明.md), [API keys and models](docs/API密钥与模型.md), [audio](docs/音频配置.md), [Doubao STT](docs/豆包语音识别.md), and [Moonlight deployment](docs/Moonlight链路部署.md).

## Development and checks

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest backend/tests -q
.\.venv\Scripts\python.exe -m ruff check backend start.py quick-start.py scripts
.\.venv\Scripts\python.exe scripts/check_versions.py
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend test
```

Browser tests use a fresh headless browser. They can use installed Chrome/Edge on Windows/macOS, Playwright Chromium (`npx playwright install chromium` inside `frontend`), or `IA_TEST_BROWSER_PATH`. CI installs the browser and runs these tests.

Backend tests use temporary configuration/databases and mocked external services. They do not read real secrets, capture screens/audio, or call paid models. Synthetic audio exercises the real VAD and inference-lock path; hardware capture and remote model quality need testing in the intended environment.

## Repository layout

```text
wineclouds-interview-assistant/
├── start.py / quick-start.py     # Launch and dependency checks
├── 启动最新版.cmd               # Latest Windows desktop entry
├── launch-latest.ps1             # Desktop launch/log redirection
├── backend/{api,core,services,tests}/
├── backend/config.example.json
├── frontend/{src,tests}/
├── desktop/                     # Electron source
├── docs/                        # Configuration/deployment guides
└── .github/workflows/ci.yml
```

## Attribution and license

Based on [powAu3/interview-assistant](https://github.com/powAu3/interview-assistant), with changes to credential/path protection, audio processing, interview ownership, review recovery, and desktop launching. The original [CC BY-NC 4.0 license](LICENSE) is retained for learning and research use.
