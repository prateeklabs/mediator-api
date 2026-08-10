# Mediator API

A lightweight, OpenAI-compatible proxy that intelligently routes LLM requests between a **local model** (free, fast) and **Grok 4.5 via OpenRouter** (paid, more capable). The goal: minimize paid API calls while still accessing stronger reasoning when you actually need it.

## Architecture

```
User (Hermes Agent / any OpenAI client)
         │
         ▼
   ┌─────────────┐
   │  Mediator   │  Express server on localhost:3000
   │    API      │  OpenAI-compatible endpoint
   └──────┬──────┘
          │
     ┌────┴────┐
     │         │
     ▼         ▼
  Local     OpenRouter
  (Qwen)    (Grok 4.5)
  Free      Paid
```

## How It Works

Every incoming request to `/v1/chat/completions` is classified by **keyword matching** against rules in `tasks.json`:

1. **`always_local` keywords** checked first — common dev/ML tasks (Python, AWS, Docker, debugging) stay local regardless
2. **OpenRouter category keywords** — complex reasoning, research, advanced math, architecture design → Grok 4.5
3. **Nothing matched** → defaults to local (Qwen)

No extra API calls for classification. Decisions are instant and deterministic.

## Quick Start

```bash
# Clone
git clone https://github.com/prateeklabs/mediator-api.git
cd mediator-api

# Install
npm install

# Configure — edit .env with your OpenRouter API key
cp .env.example .env  # or create .env manually

# Run
npm start
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Mediator server port |
| `LOCAL_API_URL` | `http://localhost:1234/v1` | Local LLM API endpoint |
| `LOCAL_API_KEY` | `lm-studio` | Local API auth key |
| `LOCAL_MODEL` | `qwen/qwen3.6-27b` | Local model identifier |
| `OPENROUTER_API_KEY` | *(required)* | Your OpenRouter API key |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter endpoint |
| `OPENROUTER_MODEL` | `x-ai/grok-4.5` | Remote model to use |

## Routing Rules

Edit `tasks.json` to customize routing without touching code:

| Category | Routes to Grok when prompt contains... |
|---|---|
| `complex_multi_step_reasoning` | Deep reasoning, novel problem solving, high-stakes accuracy |
| `research_and_synthesis` | Literature reviews, research papers, cross-domain analysis |
| `complex_architecture_design` | System architecture, scalability, distributed systems |
| `advanced_math_and_science` | Competition math, graduate-level proofs, advanced physics |
| `high_quality_creative_writing` | Stakeholder docs, grant proposals, polished prose |
| `explicit_model_request` | "use grok", "use a stronger model", etc. |

**Force any request to Grok:** Just add `"use grok"` anywhere in your prompt.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |

## Design Philosophy

- **Default to local** — Qwen handles ~80-90% of daily tasks perfectly fine
- **Grok is expensive** — only routed for tasks genuinely outside Qwen's capability ceiling
- **Tool calling is not the mediator's job** — that's handled by the client (e.g., Hermes Agent)
- **Zero classification overhead** — pure keyword matching, no extra model calls

## License

MIT
