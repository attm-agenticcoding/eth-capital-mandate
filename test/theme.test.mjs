import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const bootstrap = scripts.find((m) => !m[1].includes('module') && /theme/.test(m[2]));
function initialize(saved, unavailable = false) {
  const attrs = {}, meta = {}, storageCalls = [];
  const root = { dataset: {}, style: {}, setAttribute: (k, v) => { attrs[k] = v; if (k === 'data-theme') root.dataset.theme = v; } };
  const document = { documentElement: root, querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }) };
  const storage = { getItem: (key) => { storageCalls.push(key); if (unavailable) throw new Error('Storage disabled'); return saved; }, setItem: () => {} };
  const context = { document, localStorage: storage, window: { localStorage: storage }, console };
  assert.ok(bootstrap, 'early inline theme bootstrap exists');
  vm.runInNewContext(bootstrap[2], context, { timeout: 1000 });
  return { theme: root.dataset.theme || attrs['data-theme'], scheme: root.style.colorScheme, storageCalls, meta };
}
test('theme initializes before React, with dark HTML fallback', () => {
  assert.match(html, /<html[^>]*data-theme="dark"/);
  assert.ok(bootstrap.index < html.indexOf('type="module"'));
});
test('new visitors default to the requested dark theme', () => assert.equal(initialize(null).theme, 'dark'));
test('saved light choice is applied before rendering', () => assert.equal(initialize('light').theme, 'light'));
test('saved dark choice survives initialization', () => assert.equal(initialize('dark').theme, 'dark'));
test('invalid stored values fall back to dark', () => {
  for (const value of ['', 'system', 'unknown', '<script>']) assert.equal(initialize(value).theme, 'dark');
});
test('blocked browser storage cannot break rendering', () => assert.equal(initialize(null, true).theme, 'dark'));
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
