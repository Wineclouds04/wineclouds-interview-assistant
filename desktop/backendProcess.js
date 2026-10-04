// Lifecycle of the Python backend child process, plus small HTTP helpers for
// talking to it from the Electron main process. Requests go to 127.0.0.1 with
// no Origin header, which the backend's loopback auth bypass accepts.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { relayChildOutput } = require('./windowOptions');

// IA_PYTHON wins; otherwise prefer the project's virtualenv so the desktop app
// works without the venv being on PATH; fall back to the system interpreter.
function resolvePython(root, env = process.env, platform = process.platform) {
  if (env.IA_PYTHON) return env.IA_PYTHON;
  const venvPython = platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;
  return platform === 'win32' ? 'python' : 'python3';
}

function readJsonResponse(res, emptyValue, resolve, reject) {
  let raw = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { raw += chunk; });
  res.on('end', () => {
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      if (!raw) { resolve(emptyValue); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(emptyValue); }
      return;
    }
    reject(new Error(raw || res.statusMessage || `HTTP ${res.statusCode}`));
  });
}

/**
 * @param {object} opts
 * @param {string} opts.root        project root (contains start.py)
 * @param {number} opts.port
 * @param {(code: number|null) => void} opts.onUnexpectedExit  called when the
 *        process exits while the app is not quitting
 * @param {() => boolean} opts.isQuitting
 */
function createBackend({ root, port, onUnexpectedExit, isQuitting }) {
  const serverUrl = `http://127.0.0.1:${port}`;
  let proc = null;
  let stopPromise = null;

  function start() {
    proc = spawn(resolvePython(root), [
      path.join(root, 'start.py'),
      '--mode', 'network',
      '--no-build',
      '--port', String(port),
    ], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });
    relayChildOutput(proc.stdout, process.stdout, '[py] ');
    relayChildOutput(proc.stderr, process.stderr, '[py] ');
    proc.on('close', (code) => {
      console.log(`[py] exited with code ${code}`);
      proc = null;
      if (!isQuitting()) onUnexpectedExit(code);
    });
  }

  function waitForServer(timeout = 40000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const req = http.get(`${serverUrl}/api/options`, { timeout: 1000 }, (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        });
        req.on('error', retry);
        req.on('timeout', () => { req.destroy(); retry(); });
      };
      const retry = () => {
        if (Date.now() - startedAt > timeout) return reject(new Error('Server start timeout'));
        setTimeout(check, 300);
      };
      check();
    });
  }

  function post(pathname, body = '{}') {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `${serverUrl}${pathname}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => readJsonResponse(res, { ok: true }, resolve, reject),
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  function get(pathname) {
    return new Promise((resolve, reject) => {
      const req = http.request(`${serverUrl}${pathname}`, { method: 'GET' }, (res) => (
        readJsonResponse(res, {}, resolve, reject)
      ));
      req.on('error', reject);
      req.end();
    });
  }

  function requestAssistStop(timeoutMs = 12000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const req = http.request(`${serverUrl}/api/stop`, {
        method: 'POST',
        timeout: timeoutMs,
      }, (res) => {
        res.resume();
        res.on('end', finish);
        res.on('close', finish);
      });
      req.on('error', finish);
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) { /* ignore */ }
        finish();
      });
      req.end();
    });
  }

  // 优雅停止后端：先主动请求 assist stop，让复盘归档和 SQLite 刷盘完成；
  // 再发 SIGTERM，超时后兜底 SIGKILL。
  function gracefulStop(timeoutMs = 20000) {
    if (stopPromise) return stopPromise;
    const child = proc;
    if (!child) return Promise.resolve();
    let exited = child.exitCode != null || child.signalCode != null;
    stopPromise = new Promise((resolve) => {
      let settled = false;
      let escalationTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (escalationTimer) clearTimeout(escalationTimer);
        resolve();
      };
      const onExit = () => { exited = true; finish(); };
      child.once('exit', onExit);
      child.once('close', onExit);
      if (exited) { finish(); return; }
      const stopTimeoutMs = Math.max(1000, Math.min(15000, timeoutMs - 5000));
      requestAssistStop(stopTimeoutMs).then(() => {
        if (settled) return;
        try { child.kill('SIGTERM'); } catch (err) { console.warn('[py] SIGTERM failed:', err.message); }
        if (settled) return;
        escalationTimer = setTimeout(() => {
          if (settled) return;
          try {
            if (!exited && child.exitCode == null && child.signalCode == null) {
              console.warn('[py] graceful timeout, escalating to SIGKILL');
              child.kill('SIGKILL');
            }
          } catch (err) {
            console.warn('[py] SIGKILL failed:', err.message);
          }
          finish();
        }, Math.max(1000, timeoutMs - stopTimeoutMs));
      });
    }).then(() => {
      // A delivered signal is not an exit. Keep the handle for killNow() if
      // the process still hasn't emitted exit/close after the timeout.
      if (proc === child && (exited || child.exitCode != null || child.signalCode != null)) proc = null;
    });
    return stopPromise;
  }

  // Last-resort cleanup for abnormal quit paths.
  function killNow() {
    if (!proc) return;
    try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
    proc = null;
  }

  return {
    serverUrl,
    start,
    waitForServer,
    post,
    get,
    gracefulStop,
    killNow,
    isRunning: () => proc !== null,
    isStopping: () => stopPromise !== null,
  };
}

module.exports = { createBackend, resolvePython };
