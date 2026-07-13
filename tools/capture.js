/**
 * Browser capture tool — Playwright CDP connection
 * Connects to running Chrome with CDP on port 9222
 *
 * Usage:
 *   node capture.js launch                     — Launch Chrome debug browser (persistent profile)
 *   node capture.js run screenshot <out.png>    — Take viewport screenshot
 *   node capture.js run screenshot-full <out>   — Take full-page screenshot
 *   node capture.js run goto <url>              — Navigate to URL
 *   node capture.js run click <selector>        — Click element
 *   node capture.js run resize <w> <h>          — Resize viewport
 *   node capture.js run type <selector> <text>  — Type into field
 *   node capture.js run url                     — Get current URL
 *   node capture.js run pages                   — List all tabs
 *   node capture.js run switch <index>          — Switch to tab
 *   node capture.js run eval <js>               — Evaluate JS in page
 *   node capture.js run wait <selector>         — Wait for element
 *   node capture.js run bbox <selector>         — Get element bounding box
 *   node capture.js run check-login             — Check if Shopify session is active
 *   node capture.js run scroll <x> <y>          — Scroll to position
 *   node capture.js run scroll-to <selector>    — Scroll element into view
 *
 * Stable capture + in-DOM annotation (A32):
 *   node capture.js run stabilize                       — Disable animations + wait fonts/images/aria-busy
 *   node capture.js run shot <selector> <out> [pad]     — Element screenshot (page coords clip + padding)
 *   node capture.js run shot-stable <out> [tries]       — Screenshot until 2 consecutive shots identical
 *   node capture.js run highlight <selector> [pad]      — Sketchy red box IN-DOM (rough-notation)
 *   node capture.js run cursor <selector> [position]    — Cursor overlay IN-DOM (default bottom-right)
 *   node capture.js run blur <selector>                 — Blur element(s) IN-DOM (PII)
 *   node capture.js run clear-annotations               — Remove all injected overlays/styles
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const ROUGH_NOTATION_IIFE = path.join(__dirname, 'node_modules/rough-notation/lib/rough-notation.iife.js');
const RED = '#E8364F';
// Same cursor path as annotate.js — visual consistency with older images
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="36" viewBox="-1 -1 15 26"><path d="M 0,0 L 0,21 L 4.5,17 L 8.5,24 L 11.5,22.5 L 7.5,15.5 L 13,15.5 Z" fill="white" stroke="#222222" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// ── Portability config (override via env; defaults preserve original behavior) ──
//   CDP_PORT               — CDP debugging port (default 9222). Change if 9222 is taken.
//   CHROME_DEBUG_PROFILE   — dedicated Chrome profile dir holding the Shopify login.
//                            Default ~/.chrome-debug-profile. The session lives HERE —
//                            log in once (`node capture.js launch`) and it persists.
//   CHROME_PATH            — path to the Chrome/Chromium binary. Auto-detected per OS if unset.
const CDP_PORT = parseInt(process.env.CDP_PORT, 10) || 9222;
const PROFILE_DIR = process.env.CHROME_DEBUG_PROFILE || path.join(os.homedir(), '.chrome-debug-profile');

// Cross-platform Chrome binary resolution (macOS / Linux / Windows).
function resolveChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = ({
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  })[process.platform] || [];
  for (const p of candidates) { if (fs.existsSync(p)) return p; }
  // Fallback to PATH lookup (spawn resolves bare command names).
  return process.platform === 'win32' ? 'chrome.exe' : 'google-chrome';
}

// ── Launch browser with persistent profile + CDP (foreground) ──

async function launch() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--start-maximized', `--remote-debugging-port=${CDP_PORT}`],
    viewport: null
  });

  console.log('BROWSER_READY');
  console.log(`CDP: http://localhost:${CDP_PORT}`);
  console.log('Profile: ' + PROFILE_DIR);
  console.log('Login to Shopify admin, then use capture commands.');

  // Keep alive
  await new Promise(() => {});
}

// ── Launch browser in background via native Chrome (non-blocking) ──

function launchBackground() {
  const chromePath = resolveChromePath();
  const proc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
}

// ── Sleep helper ──

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Check if CDP is available via http ──

function isCDPAvailable() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${CDP_PORT}/json`, { timeout: 2000 }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── Ensure browser is running, auto-launch if needed ──

async function ensureBrowser() {
  if (!(await isCDPAvailable())) {
    launchBackground();
    // Wait for Playwright Chromium to start (max 20s)
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (await isCDPAvailable()) break;
    }
  }
  return await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
}

// ── App-iframe helpers (A32) ──

// Frame object of the embedded app (evaluate/addScriptTag/addStyleTag work here).
function getAppFrame(page) {
  const byName = page.frame({ name: 'app-iframe' });
  if (byName) return byName;
  // OOPIF qua connectOverCDP có thể trả url() = "" — vẫn evaluate/locator được,
  // nên KHÔNG lọc theo /^https?:/ (verify thật trên Shopify Admin production 07-06)
  const kids = page.mainFrame().childFrames().filter(f => !f.url().includes('admin.shopify.com'));
  if (kids.length) return kids[0];
  return page.frames().find(f =>
    f !== page.mainFrame() && !f.url().includes('admin.shopify.com')
  ) || null;
}

// Locator for a selector — app iframe first, fallback to main page.
// frameLocator().boundingBox() returns PAGE coords (feedback_screenshot_bbox_no_offset).
async function findTarget(page, selector) {
  const frame = getAppFrame(page);
  if (frame) {
    // frame.locator hoạt động với MỌI app iframe (kể cả OOPIF không có name="app-iframe");
    // boundingBox() luôn trả PAGE coords (feedback_screenshot_bbox_no_offset)
    const inFrame = frame.locator(selector).first();
    if (await inFrame.count().catch(() => 0)) return { locator: inFrame, frame };
  }
  const onPage = page.locator(selector).first();
  if (await onPage.count().catch(() => 0)) return { locator: onPage, frame: null };
  return null;
}

// Contexts to inject into: main page + app frame (if any).
function injectTargets(page) {
  const frame = getAppFrame(page);
  return frame ? [page.mainFrame(), frame] : [page.mainFrame()];
}

// Disable animations/caret + wait until fonts loaded, images complete, no aria-busy.
async function stabilize(page, timeoutMs = 8000) {
  for (const f of injectTargets(page)) {
    await f.evaluate(() => {
      if (!document.querySelector('style[data-cap-stabilize]')) {
        const s = document.createElement('style');
        s.setAttribute('data-cap-stabilize', '1');
        s.textContent = `*, *::before, *::after {
          animation: none !important; transition: none !important;
          caret-color: transparent !important; scroll-behavior: auto !important;
        }`;
        document.head.appendChild(s);
      }
    }).catch(() => {});
  }
  const deadline = Date.now() + timeoutMs;
  let status = {};
  while (Date.now() < deadline) {
    const checks = await Promise.all(injectTargets(page).map(f =>
      f.evaluate(() => ({
        fonts: document.fonts.status === 'loaded',
        images: [...document.images].every(i => i.complete),
        busy: !!document.querySelector('[aria-busy="true"]'),
        skeleton: !!document.querySelector('.Polaris-SkeletonPage, .Polaris-SkeletonBodyText, .Polaris-SkeletonDisplayText'),
      })).catch(() => null)
    ));
    const live = checks.filter(Boolean);
    status = {
      fonts: live.every(c => c.fonts),
      images: live.every(c => c.images),
      busy: live.some(c => c.busy),
      skeleton: live.some(c => c.skeleton),
    };
    if (status.fonts && status.images && !status.busy && !status.skeleton) return { stable: true, ...status };
    await sleep(250);
  }
  return { stable: false, ...status };
}

// Screenshot repeatedly until two consecutive shots are byte-identical.
async function shotStable(page, out, maxTries = 8, intervalMs = 400) {
  let prev = null;
  const capture2x = async () => {
    // 2x retina qua raw CDP (page.screenshot headful = 1x); fallback Playwright 1x
    try {
      const client = await page.context().newCDPSession(page);
      const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const { data } = await client.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 2 },
      });
      await client.detach().catch(() => {});
      return Buffer.from(data, 'base64');
    } catch (e) { return page.screenshot(); }
  };
  for (let i = 1; i <= maxTries; i++) {
    const buf = await capture2x();
    if (prev && buf.equals(prev)) {
      fs.writeFileSync(out, buf);
      return { ok: true, path: out, tries: i, stable: true };
    }
    prev = buf;
    await sleep(intervalMs);
  }
  fs.writeFileSync(out, prev);
  return { ok: true, path: out, tries: maxTries, stable: false };
}

// ── Connect + execute command ──

async function run() {
  const browser = await ensureBrowser();
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[pages.length - 1];

  const action = process.argv[3];
  const arg1 = process.argv[4];
  const arg2 = process.argv[5];

  switch (action) {
    case 'screenshot': {
      const out = arg1 || '/tmp/screenshot.png';
      await page.screenshot({ path: out });
      console.log(JSON.stringify({ ok: true, path: out }));
      break;
    }
    case 'screenshot-full': {
      const out = arg1 || '/tmp/screenshot.png';
      await page.screenshot({ path: out, fullPage: true });
      console.log(JSON.stringify({ ok: true, path: out }));
      break;
    }
    case 'goto': {
      await page.goto(arg1, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log(JSON.stringify({ ok: true, url: page.url(), title: await page.title() }));
      break;
    }
    case 'click': {
      await page.click(arg1, { timeout: 5000 });
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ ok: true, clicked: arg1 }));
      break;
    }
    case 'resize': {
      const w = parseInt(arg1) || 1280;
      const h = parseInt(arg2) || 800;
      // Native Chrome doesn't support setViewportSize via CDP — ignore error
      await page.setViewportSize({ width: w, height: h }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ ok: true, width: w, height: h }));
      break;
    }
    case 'type': {
      await page.fill(arg1, arg2);
      console.log(JSON.stringify({ ok: true, typed: arg2, into: arg1 }));
      break;
    }
    case 'url': {
      console.log(JSON.stringify({ ok: true, url: page.url(), title: await page.title() }));
      break;
    }
    case 'pages': {
      const result = [];
      for (let i = 0; i < pages.length; i++) {
        result.push({ i, url: pages[i].url(), title: await pages[i].title() });
      }
      console.log(JSON.stringify({ ok: true, pages: result }));
      break;
    }
    case 'switch': {
      const idx = parseInt(arg1);
      if (idx >= 0 && idx < pages.length) {
        // Don't bringToFront — memory feedback says no focus steal
        console.log(JSON.stringify({ ok: true, url: pages[idx].url() }));
      } else {
        console.log(JSON.stringify({ ok: false, error: 'bad index' }));
      }
      break;
    }
    case 'wait': {
      const el = await page.waitForSelector(arg1, { timeout: 10000 }).catch(() => null);
      if (el) {
        const box = await el.boundingBox();
        console.log(JSON.stringify({ ok: true, selector: arg1, box }));
      } else {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${arg1}` }));
      }
      break;
    }
    case 'bbox': {
      const el = await page.$(arg1);
      if (el) {
        const box = await el.boundingBox();
        console.log(JSON.stringify({ ok: true, selector: arg1, box }));
      } else {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${arg1}` }));
      }
      break;
    }
    case 'eval': {
      const data = await page.evaluate(arg1);
      console.log(JSON.stringify({ ok: true, data }));
      break;
    }
    case 'scroll': {
      const x = parseInt(arg1) || 0;
      const y = parseInt(arg2) || 0;
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x, y });
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ ok: true, scrolled: { x, y } }));
      break;
    }
    case 'click-xy': {
      const x = parseInt(arg1);
      const y = parseInt(arg2);
      await page.mouse.click(x, y);
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ ok: true, clicked: { x, y } }));
      break;
    }
    case 'scroll-to': {
      const el = await page.$(arg1);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        console.log(JSON.stringify({ ok: true, scrolledTo: arg1 }));
      } else {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${arg1}` }));
      }
      break;
    }
    // ── Auth detection ──
    case 'iframe-eval': {
      // Execute JS in the app iframe via native WebSocket CDP
      // Get iframe target info
      const iframeTarget = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${CDP_PORT}/json/list`, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const targets = JSON.parse(data);
              resolve(targets.find(t => t.type === 'iframe' && t.url && !t.url.includes('admin.shopify.com') && /^https?:/.test(t.url)));
            } catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
      if (!iframeTarget) {
        console.log(JSON.stringify({ ok: false, error: 'App iframe target not found' }));
        break;
      }
      // Connect directly to iframe target via WebSocket
      const result = await new Promise((resolve, reject) => {
        const ws = new WebSocket(iframeTarget.webSocketDebuggerUrl);
        let msgId = 1;
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({
            id: msgId++,
            method: 'Runtime.evaluate',
            params: { expression: arg1, returnByValue: true, awaitPromise: false }
          }));
        });
        ws.addEventListener('message', (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === 1) {
            ws.close();
            resolve(msg.result);
          }
        });
        ws.addEventListener('error', reject);
        setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 10000);
      });
      console.log(JSON.stringify({ ok: true, result: result?.result?.value ?? result }));
      break;
    }
    case 'iframe-frames': {
      // List all CDP targets including iframes
      const targets = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${CDP_PORT}/json/list`, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });
      console.log(JSON.stringify({ ok: true, targets: targets.map(t => ({ type: t.type, url: t.url?.substring(0, 80) })) }));
      break;
    }
    case 'check-login': {
      const url = page.url();
      const isLoginPage = url.includes('accounts.shopify.com') || url.includes('/lookup') || url.includes('/login');
      console.log(JSON.stringify({ ok: true, loggedIn: !isLoginPage, url }));
      break;
    }
    // ── Shopify iframe helpers ──
    case 'iframe-screenshot': {
      const out = arg1 || '/tmp/screenshot.png';
      const frame = page.frameLocator('iframe[name="app-iframe"]');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: out });
      console.log(JSON.stringify({ ok: true, path: out, note: 'full page with iframe' }));
      break;
    }
    case 'iframe-click': {
      const frame = getAppFrame(page) || page.frameLocator('iframe[name="app-iframe"]');
      await frame.locator(arg1).first().click({ timeout: 8000 });
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ ok: true, clicked: arg1, context: 'iframe' }));
      break;
    }
    case 'iframe-wait': {
      const frame = getAppFrame(page) || page.frameLocator('iframe[name="app-iframe"]');
      await frame.locator(arg1).first().waitFor({ timeout: 10000 });
      console.log(JSON.stringify({ ok: true, selector: arg1, context: 'iframe' }));
      break;
    }
    case 'iframe-bbox': {
      const frame = getAppFrame(page) || page.frameLocator('iframe[name="app-iframe"]');
      // boundingBox() đã là PAGE coords — KHÔNG cộng iframe offset
      // (feedback_screenshot_bbox_no_offset)
      const box = await frame.locator(arg1).first().boundingBox();
      if (box) {
        console.log(JSON.stringify({ ok: true, selector: arg1, box }));
      } else {
        console.log(JSON.stringify({ ok: false, error: `Element not found in iframe: ${arg1}` }));
      }
      break;
    }
    // ── Stable capture + in-DOM annotation (A32) ──
    case 'stabilize': {
      const result = await stabilize(page);
      console.log(JSON.stringify({ ok: true, ...result }));
      break;
    }
    case 'shot': {
      // shot <selector> <out> [padding] — element screenshot, page-coords clip + padding
      // (clip-based so in-DOM highlight/cursor overlays near the edges are included)
      const selector = arg1;
      const out = process.argv[6] ? arg2 : (arg2 || '/tmp/shot.png');
      const padding = parseInt(process.argv[6]) || 24;
      await stabilize(page);
      const target = await findTarget(page, selector);
      if (!target) {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${selector}` }));
        break;
      }
      await target.locator.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      const box = await target.locator.boundingBox(); // page coords — KHÔNG cộng iframe offset
      if (!box) {
        console.log(JSON.stringify({ ok: false, error: `No bounding box: ${selector}` }));
        break;
      }
      const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const clip = {
        x: Math.max(0, box.x - padding),
        y: Math.max(0, box.y - padding),
      };
      clip.width = Math.min(vp.width, box.x + box.width + padding) - clip.x;
      clip.height = Math.min(vp.height, box.y + box.height + padding) - clip.y;
      // Chụp 2x (retina) qua raw CDP — page.screenshot của Playwright luôn ra 1x với headful CDP
      // (chuẩn ảnh docs = 2x; verify AV UG 07-06)
      try {
        const client = await page.context().newCDPSession(page);
        const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
        require('fs').writeFileSync(out, Buffer.from(data, 'base64'));
        await client.detach().catch(() => {});
      } catch (e) {
        await page.screenshot({ path: out, clip }); // fallback 1x
      }
      console.log(JSON.stringify({ ok: true, path: out, box, clip, scale: 2, context: target.frame ? 'iframe' : 'page' }));
      break;
    }
    case 'shot-stable': {
      const out = arg1 || '/tmp/shot.png';
      const tries = parseInt(arg2) || 8;
      await stabilize(page);
      const result = await shotStable(page, out, tries);
      console.log(JSON.stringify(result));
      break;
    }
    case 'highlight': {
      // highlight <selector> [padding] — sketchy red box vẽ TRONG DOM (rough-notation)
      const selector = arg1;
      const padding = parseInt(arg2) || 5;
      const target = await findTarget(page, selector);
      if (!target) {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${selector}` }));
        break;
      }
      const ctx = target.frame || page.mainFrame();
      // style: clean (default — box đỏ trơn stroke-only, chuẩn UG PO chốt 07-07) | sketchy (rough-notation)
      const hlStyle = (process.argv[6] || 'clean').toLowerCase();
      await target.locator.scrollIntoViewIfNeeded().catch(() => {});
      // đánh dấu element qua locator (hỗ trợ selector Playwright như :has-text)
      // rồi annotate qua attribute — KHÔNG querySelector lại selector gốc
      await target.locator.evaluate(el => el.setAttribute('data-cap-target', '1'));
      if (hlStyle === 'sketchy') {
        const hasLib = await ctx.evaluate(() => !!window.RoughNotation).catch(() => false);
        if (!hasLib) await ctx.addScriptTag({ path: ROUGH_NOTATION_IIFE });
        await ctx.evaluate(({ padding, color }) => {
          const el = document.querySelector('[data-cap-target]');
          if (!el) throw new Error('marked element vanished');
          el.removeAttribute('data-cap-target');
          const a = window.RoughNotation.annotate(el, {
            type: 'box', color, padding, strokeWidth: 2.5, animate: false, iterations: 2,
          });
          a.show();
          window.__capAnnotations = window.__capAnnotations || [];
          window.__capAnnotations.push(a);
        }, { padding, color: RED });
      } else {
        await ctx.evaluate(({ padding, color }) => {
          const el = document.querySelector('[data-cap-target]');
          if (!el) throw new Error('marked element vanished');
          el.removeAttribute('data-cap-target');
          const r = el.getBoundingClientRect();
          const d = document.createElement('div');
          d.setAttribute('data-cap-annotation', 'highlight');
          d.style.cssText = 'position:fixed;left:' + (r.left - padding) + 'px;top:' + (r.top - padding) +
            'px;width:' + (r.width + padding * 2) + 'px;height:' + (r.height + padding * 2) +
            'px;border:2.5px solid ' + color + ';border-radius:8px;z-index:2147483646;pointer-events:none;';
          document.body.appendChild(d);
        }, { padding, color: RED });
      }
      await page.waitForTimeout(200);
      console.log(JSON.stringify({ ok: true, highlighted: selector, context: target.frame ? 'iframe' : 'page' }));
      break;
    }
    case 'cursor': {
      // cursor <selector> [position] — cursor overlay TRONG DOM; default bottom-right (chuẩn UG)
      const selector = arg1;
      const position = arg2 || 'bottom-right';
      const target = await findTarget(page, selector);
      if (!target) {
        console.log(JSON.stringify({ ok: false, error: `Element not found: ${selector}` }));
        break;
      }
      const ctx = target.frame || page.mainFrame();
      await target.locator.scrollIntoViewIfNeeded().catch(() => {});
      await target.locator.evaluate(el => el.setAttribute('data-cap-target', '1'));
      await ctx.evaluate(({ position, svg }) => {
        const el = document.querySelector('[data-cap-target]');
        if (!el) throw new Error('marked element vanished');
        el.removeAttribute('data-cap-target');
        const r = el.getBoundingClientRect();
        const pos = {
          'bottom-right': [r.right + 6, r.bottom + 4],
          'bottom-left': [r.left - 8, r.bottom + 4],
          'top-right': [r.right + 6, r.top - 10],
          'top-left': [r.left - 8, r.top - 10],
          'center': [r.left + r.width / 2, r.top + r.height / 2],
        }[position] || [r.right + 6, r.bottom + 4];
        const d = document.createElement('div');
        d.setAttribute('data-cap-annotation', 'cursor');
        d.style.cssText = `position:fixed;left:${pos[0]}px;top:${pos[1]}px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35));`;
        d.innerHTML = svg;
        document.body.appendChild(d);
      }, { selector, position, svg: CURSOR_SVG });
      await page.waitForTimeout(100);
      console.log(JSON.stringify({ ok: true, cursor: selector, position, context: target.frame ? 'iframe' : 'page' }));
      break;
    }
    case 'blur': {
      // blur <selector> — che PII bằng CSS trong DOM (áp cho MỌI element khớp selector)
      const selector = arg1;
      for (const f of injectTargets(page)) {
        await f.evaluate((sel) => {
          const s = document.createElement('style');
          s.setAttribute('data-cap-annotation', 'blur');
          s.textContent = `${sel} { filter: blur(6px) !important; }`;
          document.head.appendChild(s);
        }, selector).catch(() => {});
      }
      await page.waitForTimeout(100);
      console.log(JSON.stringify({ ok: true, blurred: selector }));
      break;
    }
    case 'clear-annotations': {
      for (const f of injectTargets(page)) {
        await f.evaluate(() => {
          (window.__capAnnotations || []).forEach(a => { try { a.remove(); } catch (e) {} });
          window.__capAnnotations = [];
          document.querySelectorAll('[data-cap-annotation]').forEach(n => n.remove());
          document.querySelectorAll('style[data-cap-stabilize]').forEach(n => n.remove());
          document.querySelectorAll('.rough-annotation').forEach(n => n.remove());
        }).catch(() => {});
      }
      console.log(JSON.stringify({ ok: true, cleared: true }));
      break;
    }
    default:
      console.log('Commands: screenshot, screenshot-full, goto, click, resize, type, url, pages, switch, wait, bbox, eval, scroll, scroll-to, check-login, iframe-screenshot, iframe-click, iframe-wait, iframe-bbox, stabilize, shot, shot-stable, highlight, cursor, blur, clear-annotations');
  }

  process.exit(0);
}

// ── CLI router ──

const mode = process.argv[2];
if (mode === 'launch') {
  launch().catch(e => { console.error(e.message); process.exit(1); });
} else if (mode === 'run') {
  run().catch(e => { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
} else {
  console.log('Usage:');
  console.log('  node capture.js launch                      — Launch Chrome debug browser');
  console.log('  node capture.js run screenshot <out.png>    — Take screenshot');
  console.log('  node capture.js run screenshot-full <out>   — Full-page screenshot');
  console.log('  node capture.js run goto <url>              — Navigate');
  console.log('  node capture.js run click <selector>        — Click element');
  console.log('  node capture.js run resize <w> <h>          — Resize viewport');
  console.log('  node capture.js run type <sel> <text>       — Type text');
  console.log('  node capture.js run url                     — Get current URL');
  console.log('  node capture.js run pages                   — List all tabs');
  console.log('  node capture.js run switch <index>          — Switch tab');
  console.log('  node capture.js run wait <selector>         — Wait for element');
  console.log('  node capture.js run bbox <selector>         — Get bounding box');
  console.log('  node capture.js run eval <js>               — Evaluate JS');
  console.log('  node capture.js run scroll <x> <y>          — Scroll to coords');
  console.log('  node capture.js run scroll-to <selector>    — Scroll element into view');
  console.log('  node capture.js run check-login             — Check Shopify session');
  console.log('  node capture.js run iframe-screenshot <out> — Screenshot with iframe');
  console.log('  node capture.js run iframe-click <sel>      — Click inside app iframe');
  console.log('  node capture.js run iframe-wait <sel>       — Wait for element in iframe');
  console.log('  node capture.js run iframe-bbox <sel>       — Bounding box (page coords) in iframe');
}
