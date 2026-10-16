import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const bootstrap = scripts.find((m) => !m[1].includes('module') && /theme/.test(m[2]));
function initialize(saved, unavailable = false, darkSystem = false) {
  const meta = {}, storageCalls = [], listeners = {}, systemListeners = {}, windowListeners = {};
  const root = { dataset: {}, style: {} };
  const control = { value: '', matches: () => true };
  const document = { documentElement: root, querySelector: () => meta,
    querySelectorAll: () => [control], addEventListener: (name, callback) => { listeners[name] = callback; } };
  const values = new Map(saved == null ? [] : [['eth-evidence-theme', saved]]);
  const storage = {
    getItem: (key) => { storageCalls.push(key); if (unavailable) throw new Error('Storage disabled'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (unavailable) throw new Error('Storage disabled'); values.set(key, value); },
    removeItem: (key) => { if (unavailable) throw new Error('Storage disabled'); values.delete(key); },
  };
  const system = { matches: darkSystem, addEventListener: (name, callback) => { systemListeners[name] = callback; } };
  const context = { document, localStorage: storage, window: { matchMedia: () => system,
    addEventListener: (name, callback) => { windowListeners[name] = callback; } }, console };
  assert.ok(bootstrap, 'early inline theme bootstrap exists');
  vm.runInNewContext(bootstrap[2], context, { timeout: 1000 });
  return { root, system, storageCalls, meta, values, control, windowListeners,
    get theme() { return root.dataset.theme; },
    choose(value) { control.value = value; listeners.change({ target: control }); },
    changeSystem(dark) { system.matches = dark; systemListeners.change(); },
  };
}
test('theme initializes before styles and React', () => {
  assert.ok(bootstrap.index < html.indexOf('<style>'));
  assert.ok(bootstrap.index < html.indexOf('type="module"'));
});
test('new visitors follow the system without persisting a forced preference', () => {
  for (const dark of [false, true]) {
    const page = initialize(null, false, dark);
    assert.equal(page.theme, dark ? 'dark' : 'light');
    assert.equal(page.root.dataset.themePreference, 'system');
    assert.equal(page.values.size, 0);
  }
});
test('saved light choice is applied before rendering', () => assert.equal(initialize('light', false, true).theme, 'light'));
test('saved dark choice survives initialization', () => assert.equal(initialize('dark').theme, 'dark'));
test('invalid stored values fall back to the system', () => {
  for (const value of ['', 'system', 'unknown', '<script>']) assert.equal(initialize(value).theme, 'light');
});
test('blocked storage still allows changing the theme', () => {
  const page = initialize(null, true);
  page.choose('dark');
  assert.equal(page.theme, 'dark');
  page.choose('system');
  assert.equal(page.theme, 'light');
});
test('explicit choice persists, System clears it and resumes system changes', () => {
  const page = initialize(null);
  page.changeSystem(true);
  assert.equal(page.theme, 'dark');
  page.choose('light');
  assert.equal(page.values.get('eth-evidence-theme'), 'light');
  page.changeSystem(true);
  assert.equal(page.theme, 'light');
  page.choose('system');
  assert.equal(page.values.size, 0);
  assert.equal(page.theme, 'dark');
  page.changeSystem(false);
  assert.equal(page.theme, 'light');
});
test('another tab can update or clear the saved preference', () => {
  const page = initialize(null);
  page.values.set('eth-evidence-theme', 'dark');
  page.windowListeners.storage({ key: 'eth-evidence-theme' });
  assert.equal(page.theme, 'dark');
  assert.equal(page.control.value, 'dark');
  page.values.clear();
  page.windowListeners.storage({ key: null });
  assert.equal(page.theme, 'light');
  assert.equal(page.control.value, 'system');
});
test('theme changes never use color inversion', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /filter\s*:\s*invert/i);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /:root\[data-theme="light"\]/);
});

function palette(block, base = {}) {
  const out = { ...base };
  for (const [, key, value] of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) out[key] = value;
  return out;
}
function luminance(hex) {
  const c = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
test('both semantic palettes meet normal-text WCAG contrast', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const rootBlocks = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
  const dark = rootBlocks.reduce((v, m) => palette(m[1], v), {});
  const light = palette(css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1], dark);
  const pairs = [ ['--ink','--paper'], ['--secondary','--surface'], ['--muted','--canvas'], ['--muted','--surface'], ['--muted','--paper'], ['--green','--green-soft'], ['--blue','--blue-soft'], ['--amber','--amber-soft'], ['--red','--red-soft'], ['--neutral','--neutral-soft'], ['--link','--paper'], ['--hero-muted','--hero-background'], ['--hero-accent','--hero-card'], ['--selected-ink','--green'] ];
  for (const [name, colors] of [['dark', dark], ['light', light]]) for (const [fg, bg] of pairs) {
    assert.ok(colors[fg] && colors[bg], `${name}: ${fg}/${bg} declared`);
    const a=luminance(colors[fg]), b=luminance(colors[bg]);const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(ratio >= 4.5, `${name}: ${fg}/${bg} contrast ${ratio.toFixed(2)} below 4.5`);
  }
});
