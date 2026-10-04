// Run the production source with controlled browser/process dependencies.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const draftSource = fs.readFileSync(path.join(root, 'frontend/src/components/job-tracker/applicationDraft.ts'), 'utf8');
const compiledDraft = ts.transpileModule(draftSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function draft(crypto, overrides = {}) {
  const exports = {};
  vm.runInNewContext(compiledDraft, {
    exports,
    crypto,
    require: (name) => name === './stageConfig' ? {} : require(name),
    ...overrides,
  });
  return exports;
}

test('todos can be created in a secure browser', () => {
  const api = draft(webcrypto);
  const todos = api.todosFromText('One\nTwo', []);
  assert.equal(todos.length, 2);
  assert.notEqual(todos[0].id, todos[1].id);
  assert.match(todos[0].id, /^[0-9a-f-]{36}$/);
});

test('LAN HTTP uses getRandomValues when randomUUID is unavailable', () => {
  const api = draft({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const todos = api.todosFromText('One\nTwo', []);
  assert.match(todos[0].id, /^todo-[0-9a-f]{32}$/);
  assert.notEqual(todos[0].id, todos[1].id);
});

test('IDs remain distinct without crypto even with a frozen clock and RNG', () => {
  const api = draft(undefined, { Date: { now: () => 1000 }, Math: { random: () => 0.5 } });
  const ids = Array.from({ length: 100 }, () => api.createTodoId());
  assert.equal(new Set(ids).size, 100);
});

test('editing and reordering todos preserves their existing state', () => {
  const api = draft(undefined);
  const current = [{ id: 'a', title: 'One', done: true, due: 123 }, { id: 'b', title: 'Two', done: false }];
  const todos = api.todosFromText('Two\nOne\nNew', current);
  assert.equal(todos[0].id, 'b');
  assert.equal(todos[1].id, 'a');
  assert.equal(todos[1].done, true);
  assert.equal(todos[1].due, 123);
  assert.ok(todos[2].id);
});

function desktop({ exitOn } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  const timers = new Map();
  let nextTimer = 1;
  child.kill = (signal) => {
    child.killed = true; // This says the signal was sent, not that the process exited.
    signals.push(signal);
    if (signal === exitOn) queueMicrotask(() => {
      child.signalCode = signal;
      child.emit('exit', null, signal);
      child.emit('close', null, signal);
    });
    return true;
  };
  const fakeHttp = {
    request: (url, options, callback) => {
      const req = new EventEmitter();
      req.end = () => {
        const res = new EventEmitter();
        res.resume = () => {};
        callback(res);
        res.emit('end');
      };
      return req;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'desktop/backendProcess.js'), 'utf8'), {
    module,
    require: (name) => {
      if (name === 'child_process') return { spawn: () => child };
      if (name === 'http') return fakeHttp;
      if (name === './windowOptions') return { relayChildOutput: () => {} };
      return require(name);
    },
    process,
    console: { log: () => {}, warn: () => {} },
    setTimeout: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const backend = module.exports.createBackend({ root, port: 18080, onUnexpectedExit: () => {}, isQuitting: () => true });
  backend.start();
  return {
    backend, child, signals, timers,
    expire: () => {
      const pending = Array.from(timers.values());
      timers.clear();
      for (const callback of pending) callback();
    },
  };
}

const nextTurn = () => new Promise(setImmediate);

test('SIGKILL is sent when SIGTERM was delivered but the child is alive', async () => {
  const { backend, child, signals, timers, expire } = desktop({ exitOn: 'SIGKILL' });
  const stopped = backend.gracefulStop();
  await nextTurn();
  assert.equal(child.killed, true);
  assert.equal(backend.isRunning(), true);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(timers.size, 1);
  expire();
  await stopped;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(backend.isRunning(), false);
});

test('an actual graceful exit cancels forced termination', async () => {
  const { backend, signals, timers } = desktop({ exitOn: 'SIGTERM' });
  await backend.gracefulStop();
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(timers.size, 0);
  assert.equal(backend.isRunning(), false);
});

test('timeout keeps a live child handle for last-resort cleanup', async () => {
  const { backend, signals, expire } = desktop();
  const stopped = backend.gracefulStop();
  assert.equal(backend.gracefulStop(), stopped);
  await nextTurn();
  expire();
  await stopped;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(backend.isRunning(), true);
  backend.killNow();
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL', 'SIGKILL']);
  assert.equal(backend.isRunning(), false);
});

test('a child that already exited does not receive another signal', async () => {
  const { backend, child, signals, timers } = desktop();
  child.exitCode = 0;
  await backend.gracefulStop();
  assert.deepEqual(signals, []);
  assert.equal(timers.size, 0);
  assert.equal(backend.isRunning(), false);
});

test('actual HTTP LAN browser can create and preserve todos', async () => {
  const { chromium } = require('playwright');
  const candidates = [
    process.env.IA_TEST_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>LAN regression</title>' }));
    await page.goto('http://192.0.2.1/');
    const result = await page.evaluate((compiled) => {
      const exports = {};
      new Function('exports', 'require', compiled)(exports, () => ({}));
      const todos = exports.todosFromText('Existing\nNew\nAnother', [{ id: 'keep', title: 'Existing', done: true, due: 123 }]);
      return { secure: window.isSecureContext, randomUUID: typeof window.crypto.randomUUID, todos };
    }, compiledDraft);
    assert.equal(result.secure, false);
    assert.equal(result.randomUUID, 'undefined');
    assert.equal(result.todos[0].id, 'keep');
    assert.equal(result.todos[0].done, true);
    assert.equal(result.todos[0].due, 123);
    assert.ok(result.todos[1].id && result.todos[2].id);
    assert.notEqual(result.todos[1].id, result.todos[2].id);
  } finally {
    await browser.close();
  }
});
