require('dotenv').config();

// ── Single source of truth for dashboard auth ───────────────────────────────
// Credentials live in /root/.hermes/.env (HERMES_DASHBOARD_BASIC_AUTH_*) —
// the same file the Hermes dashboard uses. Mounted read-only as
// /hermes-auth.env. One rotation there updates BOTH dashboards.
// (DASH_AUTH_USERNAME / DASH_AUTH_PASSWORD in the app .env still work as an
// explicit override, e.g. for dev containers.)
try {
  const fs = require('fs');
  if (!process.env.DASH_AUTH_USERNAME || !process.env.DASH_AUTH_PASSWORD) {
    const hermesEnv = fs.readFileSync('/hermes-auth.env', 'utf8');
    const get = (k) => {
      const m = hermesEnv.match(new RegExp(`^${k}=([^\\r\\n]*)`, 'm'));
      return m ? m[1].trim() : '';
    };
    const u = get('HERMES_DASHBOARD_BASIC_AUTH_USERNAME');
    const p = get('HERMES_DASHBOARD_BASIC_AUTH_PASSWORD');
    if (u) process.env.DASH_AUTH_USERNAME = u;
    if (p) process.env.DASH_AUTH_PASSWORD = p;
  }
} catch (err) {
  console.warn(`⚠ Could not load shared hermes auth env (${err.message}) — falling back to DASH_AUTH_* in app .env`);
}

const express = require('express');
const { timingSafeEqual, createHash } = require('crypto');
const { classifyRequest } = require('./classifier');
const { forwardToApi, streamToSSE, passthroughJson } = require('./router');
const config = require('./config-store');

config.load(); // load persisted runtime overrides before startup

const app = express();
app.use(express.json({ limit: process.env.BODY_LIMIT || '100mb' }));

// Config from environment (runtime overrides via config-store take precedence)
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not set in .env');
  process.exit(1);
}

// ── Admin auth — HTTP Basic (same credentials as hermes.buildwithprateek.com) ──
const AUTH_USER = process.env.DASH_AUTH_USERNAME || '';
const AUTH_PASS = process.env.DASH_AUTH_PASSWORD || '';

function adminAuthorized(req) {
  if (!AUTH_USER || !AUTH_PASS) return false;
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Basic\s+([A-Za-z0-9+/=]+)/i);
  if (!m) return false;
  let user = '', pass = '';
  try {
    [user, pass] = Buffer.from(m[1], 'base64').toString('utf8').split(':', 2);
  } catch (_) { return false; }
  const h = (s) => createHash('sha256').update(String(s)).digest('hex');
  if (user.length !== AUTH_USER.length || pass.length !== AUTH_PASS.length) return false;
  return timingSafeEqual(Buffer.from(h(user)), Buffer.from(h(AUTH_USER)))
    && timingSafeEqual(Buffer.from(h(pass)), Buffer.from(h(AUTH_PASS)));
}

function requireAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) {
    return res.status(503).json({ ok: false, error: 'Dashboard auth not configured (set DASH_AUTH_USERNAME / DASH_AUTH_PASSWORD)' });
  }
  if (adminAuthorized(req)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Mediator Config", charset="UTF-8"');
  if (req.accepts('html')) {
    return res.status(401).type('html').send('<h1>401 — Authentication required</h1><p>Enter the same credentials you use on <code>hermes.buildwithprateek.com</code>.</p>');
  }
  return res.status(401).json({ ok: false, error: 'Authentication required (username + password)' });
}

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mediator: 'running' });
});

// ── Admin API ───────────────────────────────────────────────────────────────
app.get('/api/admin/config', requireAuth, (req, res) => {
  res.json({ config: config.publicView(), version: process.env.npm_package_version || '1.x' });
});

app.post('/api/admin/config', requireAuth, (req, res) => {
  const { field, value } = req.body || {};
  if (!field || value === undefined) {
    return res.status(400).json({ error: 'body must include { field, value }' });
  }
  try {
    config.set(field, String(value));
    res.json({ ok: true, field, value: config.get(field) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/config/reset', requireAuth, (req, res) => {
  const { field } = req.body || {};
  if (field) {
    try {
      config.reset(field);
      res.json({ ok: true, field, value: config.get(field) ?? null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  } else {
    config.resetAll();
    res.json({ ok: true, all: true });
  }
});

app.get('/api/admin/models/local', requireAuth, async (req, res) => {
  const models = await config.listLocalModels();
  res.json({ models, source: config.get('localApiUrl') });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mediator Config</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --text:#e6edf3; --dim:#8b949e; --accent:#2f81f7; --ok:#3fb950; --warn:#d29922; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); }
  .wrap { max-width:720px; margin:0 auto; padding:32px 20px 60px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--dim); font-size:13px; margin-bottom:24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:18px 20px; margin-bottom:14px; }
  .card label { display:block; font-size:12px; color:var(--dim); margin-bottom:6px; text-transform:uppercase; letter-spacing:.4px; }
  .card .val { font-size:14px; margin-top:10px; word-break:break-all; }
  .row { display:flex; gap:8px; margin-top:10px; }
  input,select { flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); border-radius:6px; padding:8px 10px; font-size:14px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:6px; padding:8px 14px; font-size:13px; cursor:pointer; }
  button.secondary { background:transparent; border:1px solid var(--border); color:var(--dim); }
  .badge { display:inline-block; font-size:11px; padding:2px 8px; border-radius:10px; background:#21262d; color:var(--dim); margin-left:8px; vertical-align:middle; }
  .badge.over { background:rgba(63,185,80,.15); color:var(--ok); }
  .ok { color:var(--ok); } .err { color:#f85149; }
  .hidden { display:none; }
  .secret-val { color:var(--dim); font-style:italic; }
  .token-box { display:flex; gap:8px; margin-bottom:20px; }
  .token-box input { flex:1; }
  hr { border:none; border-top:1px solid var(--border); margin:24px 0; }
  .footer { color:var(--dim); font-size:12px; text-align:center; margin-top:30px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>⚙️ Mediator Config</h1>
  <div class="sub">api.buildwithprateek.com — live routing config (changes apply immediately, persist across restarts)</div>

  <div class="card" id="authCard">
    <label>Authentication</label>
    <div id="authMsg" class="val">…</div>
  </div>

  <div id="configArea" class="hidden">
    <div class="card" id="localCard">
      <label>Local model <span class="badge" id="b-localModel"></span></label>
      <div class="row">
        <select id="s-localModel"></select>
        <input type="text" id="i-localModel" placeholder="or type model id">
      </div>
      <div class="val" id="v-localModel"></div>
      <div class="row"><button onclick="save('localModel')">Save</button><button class="secondary" onclick="resetField('localModel')">Reset to env</button></div>
    </div>

    <div class="card">
      <label>Local API URL <span class="badge" id="b-localApiUrl"></span></label>
      <div class="row"><input type="text" id="i-localApiUrl"></div>
      <div class="val" id="v-localApiUrl"></div>
      <div class="row"><button onclick="save('localApiUrl')">Save</button><button class="secondary" onclick="resetField('localApiUrl')">Reset to env</button></div>
    </div>

    <hr>

    <div class="card">
      <label>Paid model (OpenRouter) <span class="badge" id="b-openrouterModel"></span></label>
      <div class="row"><input type="text" id="i-openrouterModel" placeholder="e.g. x-ai/grok-4.5"></div>
      <div class="val" id="v-openrouterModel"></div>
      <div class="row"><button onclick="save('openrouterModel')">Save</button><button class="secondary" onclick="resetField('openrouterModel')">Reset to env</button></div>
    </div>

    <div class="card">
      <label>OpenRouter base URL <span class="badge" id="b-openrouterBaseUrl"></span></label>
      <div class="row"><input type="text" id="i-openrouterBaseUrl"></div>
      <div class="val" id="v-openrouterBaseUrl"></div>
      <div class="row"><button onclick="save('openrouterBaseUrl')">Save</button><button class="secondary" onclick="resetField('openrouterBaseUrl')">Reset to env</button></div>
    </div>

    <div class="card">
      <label>Classifier mode <span class="badge" id="b-classifierMode"></span></label>
      <div class="val" id="v-classifierMode"></div>
      <div class="row">
        <select id="s-classifierMode">
          <option value="keyword">keyword — fast, no LLM calls</option>
          <option value="hybrid">hybrid — keywords + LLM fallback</option>
          <option value="llm">llm — always LLM classify</option>
        </select>
        <button onclick="save('classifierMode')">Save</button>
        <button class="secondary" onclick="resetField('classifierMode')">Reset to env</button>
      </div>
    </div>

    <div class="card">
      <label>Fetch timeout (ms) <span class="badge" id="b-fetchTimeoutMs"></span></label>
      <div class="row"><input type="number" id="i-fetchTimeoutMs" min="1000" step="1000"></div>
      <div class="val" id="v-fetchTimeoutMs"></div>
      <div class="row"><button onclick="save('fetchTimeoutMs')">Save</button><button class="secondary" onclick="resetField('fetchTimeoutMs')">Reset to env</button></div>
    </div>

    <div class="card">
      <label>OpenRouter API key</label>
      <div class="val secret-val" id="v-orkey"></div>
    </div>

    <div class="row" style="margin-top:18px">
      <button class="secondary" onclick="resetAll()">Reset all overrides</button>
      <button class="secondary" onclick="loadConfig()">↻ Refresh</button>
    </div>
  </div>

  <div class="footer">Mediator API — model routing dashboard</div>
</div>

<script>
function hdr() { return { 'Content-Type': 'application/json' }; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function loadConfig() {
  const msg = document.getElementById('authMsg');
  try {
    const r = await fetch('/api/admin/config', { headers: hdr() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const c = d.config;

    document.getElementById('authCard').style.opacity = '0.7';
    msg.innerHTML = '<span class="ok">✓ Connected</span>';
    document.getElementById('configArea').classList.remove('hidden');

    // local model — fetch available models from LM Studio
    try {
      const m = await fetch('/api/admin/models/local', { headers: hdr() });
      if (m.ok) {
        const md = await m.json();
        const sel = document.getElementById('s-localModel');
        sel.innerHTML = md.models.map(id => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('');
        sel.value = c.localModel.value;
        sel.onchange = () => { document.getElementById('i-localModel').value = sel.value; save('localModel'); };
      }
    } catch {}

    for (const f of ['localModel','localApiUrl','openrouterModel','openrouterBaseUrl','fetchTimeoutMs']) {
      const field = c[f];
      document.getElementById('i-' + f).value = field.value;
      document.getElementById('v-' + f).textContent = field.overridden
        ? 'runtime override — env default: ' + (field.hasEnvDefault ? 'yes' : 'none')
        : (field.hasEnvDefault ? 'from env (.env)' : (field.codeDefault ? 'code default' : 'unset'));
      document.getElementById('b-' + f).textContent = field.overridden ? 'override' : (field.hasEnvDefault ? 'env' : 'unset');
      document.getElementById('b-' + f).className = 'badge' + (field.overridden ? ' over' : '');
    }
    document.getElementById('s-classifierMode').value = c.classifierMode.value;
    document.getElementById('v-classifierMode').textContent = c.classifierMode.overridden ? 'runtime override' : 'from env (.env)';
    document.getElementById('b-classifierMode').textContent = c.classifierMode.overridden ? 'override' : 'env';
    document.getElementById('b-classifierMode').className = 'badge' + (c.classifierMode.overridden ? ' over' : '');

    const ork = c.openrouterapikey;
    document.getElementById('v-orkey').textContent = ork.set ? '✓ set (value hidden)' : '✗ not set';
  } catch (e) {
    msg.innerHTML = '<span class="err">✗ ' + esc(e.message) + (e.message.includes('401') ? ' — wrong credentials' : '') + '</span>';
  }
}

async function save(field) {
  let value;
  if (field === 'localModel') {
    const sel = document.getElementById('s-localModel').value;
    const txt = document.getElementById('i-localModel').value.trim();
    value = txt || sel;
  } else if (field === 'classifierMode') {
    value = document.getElementById('s-classifierMode').value;
  } else {
    value = document.getElementById('i-' + field).value.trim();
  }
  try {
    const r = await fetch('/api/admin/config', { method:'POST', headers: hdr(), body: JSON.stringify({ field, value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    flash('Saved: ' + value);
    loadConfig();
  } catch (e) {
    flash('✗ ' + e.message);
  }
}

async function resetField(field) {
  try {
    await fetch('/api/admin/config/reset', { method:'POST', headers: hdr(), body: JSON.stringify({ field }) });
    flash('Reset ' + field + ' to env default');
    loadConfig();
  } catch (e) { flash('✗ ' + e.message); }
}

async function resetAll() {
  if (!confirm('Reset ALL runtime overrides back to .env defaults?')) return;
  try {
    await fetch('/api/admin/config/reset', { method:'POST', headers: hdr(), body: JSON.stringify({}) });
    flash('All overrides reset');
    loadConfig();
  } catch (e) { flash('✗ ' + e.message); }
}

loadConfig();

let flashTimer;
function flash(msg) {
  const el = document.querySelector('.footer');
  const old = el.textContent;
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = old; }, 2500);
}
</script>
</body></html>`;

app.get('/config', requireAuth, (req, res) => {
  res.type('html').send(DASHBOARD_HTML);
});

// ── Main chat completions endpoint (OpenAI-compatible) ─────────────────────
app.post('/v1/chat/completions', async (req, res) => {
  const { messages } = req.body;
  const stream = req.body.stream !== false; // default to true

  // Live config
  const localApiUrl = config.get('localApiUrl') || 'http://localhost:1234/v1';
  const localApiKey = process.env.LOCAL_API_KEY || 'lm-studio';
  const localModel = config.get('localModel') || 'qwen/qwen3.8-27b';
  const openrouterBaseUrl = config.get('openrouterBaseUrl') || 'https://openrouter.ai/api/v1';
  const openrouterModel = config.get('openrouterModel') || 'x-ai/grok-4.5';
  const classifierMode = config.get('classifierMode') || 'keyword';

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request: "messages" array is required' });
  }

  // Extract the last user message for classification
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    return res.status(400).json({ error: 'No user message found in messages array' });
  }

  const userContent = typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content);

  console.log(`\n📨 Incoming request [${new Date().toISOString()}]`);
  console.log(`   Preview: ${userContent.slice(0, 100)}...`);
  console.log(`   Tools supplied: ${!!req.body.tools}, count: ${req.body.tools?.length || 0}`);
  console.log(`   Tool choice: ${JSON.stringify(req.body.tool_choice)}`);

  // Step 1: Classify the request
  let classification;
  try {
    classification = await classifyRequest(userContent, localApiUrl, localApiKey, localModel, classifierMode);
  } catch (err) {
    console.error(`❌ Classification failed: ${err.message}`);
    classification = { route: 'local', reason: 'classification error, fallback', category: null };
  }

  console.log(`   Route: ${classification.route} (${classification.reason})`);

  // Sanitize user message if classifier detected explicit model request
  let finalMessages = messages;
  if (classification.sanitizedContent) {
    console.log(`   → Sanitized message (stripped routing instruction)`);
    finalMessages = messages.map(m => {
      if (m === lastUserMessage) {
        return { ...m, content: classification.sanitizedContent };
      }
      return m;
    });
  }

  // Step 2: Route to the appropriate backend
  let targetUrl, apiKey, model;

  if (classification.route === 'openrouter') {
    targetUrl = openrouterBaseUrl;
    apiKey = OPENROUTER_API_KEY;
    model = openrouterModel;
    console.log(`   → Forwarding to OpenRouter (${model})`);
  } else {
    targetUrl = localApiUrl;
    apiKey = localApiKey;
    model = localModel;
    console.log(`   → Handling locally (${model})`);
  }

  try {
    // Force backend stream mode to match our client-facing mode —
    // LM Studio defaults to NON-streaming, so without this a client that
    // omits "stream" gets JSON back and streamToSSE writes nothing.
    const finalBody = {
      ...req.body,
      messages: finalMessages,
      stream: !!stream
    };

    const isLocal = classification.route === 'local';
    const apiResponse = await forwardToApi(targetUrl, apiKey, model, finalBody, isLocal);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      await streamToSSE(apiResponse, res);
      res.end();
    } else {
      await passthroughJson(apiResponse, res);
    }

    console.log(`   ✅ Response sent`);
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error(`   ❌ Backend error: ${isTimeout ? `TIMEOUT after ${process.env.FETCH_TIMEOUT_MS || 120000}ms` : err.message}`);

    // Attempt fallback: if OpenRouter failed, try local
    if (classification.route === 'openrouter' && localApiUrl) {
      console.log(`   🔄 Falling back to local model...`);
      try {
        const fallbackBody = {
          ...req.body,
          messages: finalMessages,
          stream: !!stream
        };
        const fallbackResponse = await forwardToApi(localApiUrl, localApiKey, localModel, fallbackBody, true);

        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          await streamToSSE(fallbackResponse, res);
          res.end();
        } else {
          await passthroughJson(fallbackResponse, res);
        }
        console.log(`   ✅ Fallback response sent`);
        return;
      } catch (fallbackErr) {
        console.error(`   ❌ Fallback also failed: ${fallbackErr.message}`);
      }
    }

    if (!res.headersSent) {
      res.status(502).json({
        error: 'Backend unavailable',
        message: isTimeout ? `Request timed out after ${process.env.FETCH_TIMEOUT_MS || 120000}ms` : err.message,
        routedTo: classification.route
      });
    }
  }
});

// ── Start server ────────────────────────────────────────────────────────────
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  const localModel = config.get('localModel') || 'qwen/qwen3.8-27b';
  const openrouterModel = config.get('openrouterModel') || 'x-ai/grok-4.5';
  const classifierMode = config.get('classifierMode') || 'keyword';
  console.log(`
╔══════════════════════════════════════════════════╗
║          Mediator API is running                 ║
╠══════════════════════════════════════════════════╣
║  Port:          ${String(PORT).padEnd(32)}║
║  Local API:     ${String(config.get('localApiUrl') || '(unset)').padEnd(32)}║
║  Local Model:   ${String(localModel).padEnd(32)}║
║  OpenRouter:    ${String(config.get('openrouterBaseUrl') || '(unset)').padEnd(32)}║
║  OR Model:      ${String(openrouterModel).padEnd(32)}║
║  Classifier:    ${String(classifierMode).padEnd(32)}║
║  Config UI:     /config ${AUTH_USER && AUTH_PASS ? '(basic auth ✓)' : '(⚠ no DASH_AUTH_* — admin API disabled)'}
╚══════════════════════════════════════════════════╝
  `);
});
