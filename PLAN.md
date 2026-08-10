# Mediator API — Plan

## Overview

A lightweight proxy/mediator API that sits between the user (Hermes Agent) and the LLM backends. The local model evaluates every incoming request and decides:

- **Simple tasks** → routed directly to the **local API** (current default model)
- **Complex tasks** → forwarded to **OpenRouter**, which dispatches to the appropriate premium model (Grok, OpenAI, Claude)

The goal: keep everyday queries fast and free on the local model, but offload hard thinking to stronger models without the user having to manage multiple endpoints.

---

## Architecture

```
User (Hermes Agent)
       │
       ▼
  ┌─────────────┐
  │  Mediator   │   Express/Fastify server on localhost
  │    API      │
  └──────┬──────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 Local    OpenRouter
  API      API
 (qwen)   (Grok / OpenAI / Claude)
```

---

## Components

### 1. Mediator Server
- Lightweight Node.js HTTP server (Express or Fastify)
- Listens on a local port (e.g., `localhost:3000`)
- Accepts chat completions in OpenAI-compatible format (so Hermes can point to it as its API endpoint)

### 2. Router Logic (the "brain")
- Every incoming prompt is first sent to the **local model** with a system prompt that asks it to classify the request
- Classification output: `{ "route": "local" | "openrouter", "reason": "...", "suggestedModel": "..." }`
- If `local` → mediator forwards the original request to the local API and streams back the response
- If `openrouter` → mediator forwards to OpenRouter with the appropriate model selected

### 3. Model Selection Heuristics
- The classification prompt tells the local model which OpenRouter model to pick based on task type:
  - **Code generation / debugging** → Claude (strong reasoning + code)
  - **Creative writing / brainstorming** → Grok or Claude
  - **Complex reasoning / math / analysis** → Claude or OpenAI
  - **General knowledge / factual** → OpenAI or Grok
- Exact model mappings will be refined once API details are provided

### 4. Streaming Support
- Both local and OpenRouter support streaming — the mediator pipes the stream back to Hermes so the user sees tokens in real-time

---

## Request Flow

```
1. User sends message to mediator API
2. Mediator extracts the user prompt
3. Mediator sends prompt + classification system prompt → Local Model
4. Local Model returns { route, reason, suggestedModel }
5. Mediator routes:
   a. "local"     → forward original request to local API
   b. "openrouter" → forward original request to OpenRouter with selected model
6. Stream response back to user
```

---

## API Contract

### Endpoint
```
POST /v1/chat/completions
```

### Request (OpenAI-compatible)
```json
{
  "model": "mediator",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

### Response
Standard SSE stream of chat completion chunks — identical format to OpenAI streaming so Hermes doesn't need to change.

---

## Configuration

Externalized config file (`config.json` or `.env`):

| Setting | Description |
|---|---|
| `LOCAL_API_URL` | URL of the local model API |
| `LOCAL_API_KEY` | API key for local model (if any) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_BASE_URL` | OpenRouter endpoint (`https://openrouter.ai/api/v1`) |
| `MODEL_ROUTING` | Map of task categories → OpenRouter model IDs |
| `CLASSIFICATION_MODEL` | Which local model handles classification (default: same as local) |

---

## Task Categories for OpenRouter Routing

*(To be filled in by user — pending list of complex tasks)*

Examples to consider:
- Multi-step reasoning / chain-of-thought
- Code review, architecture design, debugging complex bugs
- Data analysis, math, statistics
- Creative writing, long-form content generation
- Research / synthesis across multiple topics
- Translation of nuanced/technical content
- Any explicit user request like "use Claude" or "use a stronger model"

---

## Implementation Plan

### Phase 1 — MVP
- [ ] Set up Node.js project with Express
- [ ] Implement `/v1/chat/completions` endpoint
- [ ] Build classification logic (send to local model for routing decision)
- [ ] Wire up local API forwarding
- [ ] Wire up OpenRouter forwarding
- [ ] Streaming support for both paths

### Phase 2 — Smart Routing
- [ ] Refine classification system prompt with user's task list
- [ ] Model selection logic per task category
- [ ] Fallback: if OpenRouter fails, retry on local model
- [ ] Request/response logging

### Phase 3 — Polish
- [ ] Cost tracking / token counting for OpenRouter calls
- [ ] Rate limiting
- [ ] Health check endpoint
- [ ] Graceful degradation (circuit breaker if OpenRouter is down)
- [ ] Metrics: how many requests routed where, latency comparison

---

## API Configuration (Confirmed)

| Setting | Local API | OpenRouter |
|---|---|---|
| **Base URL** | `http://localhost:1234/v1` | `https://openrouter.ai/api/v1` |
| **API Key** | `lm-studio` | `OPENROUTER_API_KEY` (env var) |
| **Model** | `qwen/qwen3.6-27b` | `x-ai/grok-4.5` |

## Task Routing

Routing decisions are driven by a `tasks.json` config file that lists keyword/category strings. The mediator sends the user's prompt + this task list to the local classification model, which matches the request against the configured patterns and decides whether to route locally or to OpenRouter.

See `tasks.json` for the current routing rules. regardless of complexity

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express (lightweight, simple)
- **HTTP client**: `fetch` (native) or `axios`
- **Streaming**: SSE pass-through via Node streams
- **Config**: `.env` via `dotenv`
