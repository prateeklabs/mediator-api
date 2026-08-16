// Live config store — env defaults + runtime overrides persisted to ./data/config.json
// Allows changing models/config at runtime via /api/admin without container restart.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.MEDIATOR_DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Config fields exposed via admin API
// type: string | select
// secret: never returned to clients (only "set"/"unset")
const SCHEMA = {
  localModel:        { label: 'Local model (LM Studio)',        type: 'string',  envKey: 'LOCAL_MODEL' },
  localApiUrl:       { label: 'Local API URL',                  type: 'string',  envKey: 'LOCAL_API_URL' },
  openrouterModel:   { label: 'Paid model (OpenRouter)',        type: 'string',  envKey: 'OPENROUTER_MODEL' },
  openrouterBaseUrl: { label: 'OpenRouter base URL',            type: 'string',  envKey: 'OPENROUTER_BASE_URL' },
  classifierMode:    { label: 'Classifier mode',                type: 'select',  envKey: 'CLASSIFIER_MODE', options: ['keyword', 'hybrid', 'llm'] },
  fetchTimeoutMs:    { label: 'Fetch timeout (ms)',             type: 'number',  envKey: 'FETCH_TIMEOUT_MS' }
};

const SECRET_KEYS = ['OPENROUTER_API_KEY', 'LOCAL_API_KEY'];

let overrides = {};

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      overrides = raw.overrides || {};
      console.log(`   [config] Loaded runtime overrides: ${Object.keys(overrides).join(', ') || '(none)'}`);
    }
  } catch (err) {
    console.error(`   [config] WARNING: could not read ${CONFIG_FILE}: ${err.message}`);
    overrides = {};
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { version: 1, updatedAt: new Date().toISOString(), overrides };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    console.error(`   [config] WARNING: could not persist config: ${err.message}`);
    return false;
  }
}

function envValue(key) {
  return process.env[key];
}

// Current effective value for a config field
function get(field) {
  const meta = SCHEMA[field];
  if (!meta) return undefined;
  if (overrides[field] !== undefined && overrides[field] !== '') return overrides[field];
  const env = envValue(meta.envKey);
  return env !== undefined && env !== '' ? env : undefined;
}

function set(field, value) {
  const meta = SCHEMA[field];
  if (!meta) throw new Error(`Unknown config field: ${field}`);

  if (meta.type === 'select' && meta.options && !meta.options.includes(value)) {
    throw new Error(`Invalid value for ${field}: must be one of ${meta.options.join(', ')}`);
  }
  if (meta.type === 'number') {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 1000) throw new Error(`Invalid number for ${field}`);
    value = String(n);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Empty value for ${field}`);
  }

  overrides[field] = value.trim();
  save();
  console.log(`   [config] ${field} → ${value}`);
}

function reset(field) {
  if (!SCHEMA[field]) throw new Error(`Unknown config field: ${field}`);
  delete overrides[field];
  save();
}

function resetAll() {
  overrides = {};
  save();
}

// Public view — secrets masked
function publicView() {
  const view = {};
  for (const [field, meta] of Object.entries(SCHEMA)) {
    const value = get(field);
    const envVal = envValue(meta.envKey);
    const overridden = overrides[field] !== undefined;
    view[field] = {
      label: meta.label,
      type: meta.type,
      options: meta.options || null,
      value: value ?? '',
      hasEnvDefault: envVal !== undefined && envVal !== '',
      overridden,
      secret: false
    };
  }
  // Secret fields: report set/unset + override state only
  for (const key of SECRET_KEYS) {
    const set2 = !!(envValue(key) || (process.env[key] !== undefined));
    view[key.toLowerCase().replace(/_/g, '')] = { label: key, secret: true, set: set2 };
  }
  return view;
}

// Validate a model id against the local API (best-effort, non-fatal)
async function listLocalModels() {
  try {
    const url = get('localApiUrl') || 'http://localhost:1234/v1';
    const key = envValue('LOCAL_API_KEY') || 'lm-studio';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/models`, {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(m => m.id);
  } catch {
    return [];
  }
}

module.exports = { get, set, reset, resetAll, publicView, listLocalModels, SCHEMA, load, save };
