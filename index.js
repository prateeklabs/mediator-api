require('dotenv').config();
const express = require('express');
const { classifyRequest } = require('./classifier');
const { forwardToApi, streamToSSE, passthroughJson } = require('./router');

const app = express();
app.use(express.json({ limit: process.env.BODY_LIMIT || '100mb' }));

// Config from environment
const PORT = process.env.PORT || 3000;
const LOCAL_API_URL = process.env.LOCAL_API_URL || 'http://localhost:1234/v1';
const LOCAL_API_KEY = process.env.LOCAL_API_KEY || 'lm-studio';
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'qwen/qwen3.6-27b';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.5';

// Validate required config
if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not set in .env');
  process.exit(1);
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mediator: 'running' });
});

// Main chat completions endpoint (OpenAI-compatible)
app.post('/v1/chat/completions', async (req, res) => {
  const { messages } = req.body;
  const stream = req.body.stream !== false; // default to true

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
  console.log(`   Tool choice: ${req.body.tool_choice}`);

  // Step 1: Classify the request
  let classification;
  try {
    classification = await classifyRequest(userContent, LOCAL_API_URL, LOCAL_API_KEY, LOCAL_MODEL);
  } catch (err) {
    console.error(`❌ Classification failed: ${err.message}`);
    // Fallback to local on classification error
    classification = { route: 'local', reason: 'classification error, fallback', category: null };
  }

  console.log(`   Route: ${classification.route} (${classification.reason})`);

  // Step 2: Route to the appropriate backend
  let targetUrl, apiKey, model;

  if (classification.route === 'openrouter') {
    targetUrl = OPENROUTER_BASE_URL;
    apiKey = OPENROUTER_API_KEY;
    model = OPENROUTER_MODEL;
    console.log(`   → Forwarding to OpenRouter (${model})`);
  } else {
    targetUrl = LOCAL_API_URL;
    apiKey = LOCAL_API_KEY;
    model = LOCAL_MODEL;
    console.log(`   → Handling locally (${model})`);
  }

  try {
    const isLocal = classification.route === 'local';
    const apiResponse = await forwardToApi(targetUrl, apiKey, model, req.body, isLocal);

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
    if (classification.route === 'openrouter' && LOCAL_API_URL) {
      console.log(`   🔄 Falling back to local model...`);
      try {
        const fallbackResponse = await forwardToApi(LOCAL_API_URL, LOCAL_API_KEY, LOCAL_MODEL, req.body, true);

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

    // Return error to client
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Backend unavailable',
        message: isTimeout ? `Request timed out after ${process.env.FETCH_TIMEOUT_MS || 120000}ms` : err.message,
        routedTo: classification.route
      });
    }
  }
});

// Start server — bind to 0.0.0.0 so it's reachable from other machines on the network
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════╗
║       Mediator API is running            ║
╠══════════════════════════════════════════╣
║  Port:       ${String(PORT).padEnd(25)}║
║  Local API:  ${String(LOCAL_API_URL).padEnd(22)}║
║  Local Model: ${String(LOCAL_MODEL).padEnd(21)}║
║  OpenRouter: ${String(OPENROUTER_BASE_URL).padEnd(20)}║
║  OR Model:   ${String(OPENROUTER_MODEL).padEnd(21)}║
╚══════════════════════════════════════════╝
  `);
});
