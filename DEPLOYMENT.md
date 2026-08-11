# Mediator API — Deployment Reference

## GitHub Repository
- **Repo:** https://github.com/prateeklabs/mediator-api
- **Branch:** `main`
- **License:** Public

## Architecture
```
Hermes Agent → Mediator API (pve1:3000)
                   ├── Local: Qwen3.6-27B via LM Studio → LM Link → RTX 3090
                   └── Remote: Grok 4.5 via OpenRouter
```

Keyword-based routing. Simple/everyday tasks → local. Complex reasoning → OpenRouter.

## Proxmox Cluster

| Node | IP | Role |
|------|----|------|
| pve1 | 192.168.1.201 | Mediator API (Docker), LM Studio |
| pve2 | 192.168.1.202 | Proxmox node |
| pve3 | 192.168.1.203 | Proxmox node |
| pve4 | 192.168.1.204 | Proxmox node |

- **OS:** Debian 13 (Trixie)
- **Network:** `vmbr0` bridge
- **SSH:** `root@192.168.1.201`
- **Docker:** v29.7.2

## Deployment Location
```
/opt/mediator-api/
├── .env              # Credentials (chmod 600)
├── docker-compose.yml
├── Dockerfile
├── classifier.js
├── index.js
├── router.js
└── tasks.json
```

## Docker Configuration
- **Network mode:** `host` (container shares host network — needed because LM Studio binds to `127.0.0.1`)
- **Container name:** `mediator-api`
- **Port:** `3000` (direct, no port mapping)
- **Restart policy:** `unless-stopped`
- **Health check:** `wget http://localhost:3000/health` every 30s

## .env Variables
```
PORT=3000
LOCAL_API_URL=http://localhost:1234/v1
LOCAL_API_KEY=lm-studio
LOCAL_MODEL=qwen/qwen3.6-27b
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=x-ai/grok-4.5
```

## LM Studio / LM Link
- Installed on **pve1**
- Connects via **LM Link** (cloud relay) to RTX 3090 machine
- Model: `qwen/qwen3.6-27b`
- Binds to `127.0.0.1:1234` (localhost only)
- Mediator reaches it via host networking

## Common Commands

### Check status
```bash
ssh root@192.168.1.201 "docker ps --filter name=mediator-api"
```

### View logs
```bash
ssh root@192.168.1.201 "docker logs mediator-api --tail 50"
```

### Follow logs in real-time
```bash
ssh root@192.168.1.201 "docker logs mediator-api -f"
```

### Restart
```bash
ssh root@192.168.1.201 "cd /opt/mediator-api && docker compose restart"
```

### Rebuild + restart (after code changes)
```bash
ssh root@192.168.1.201 "cd /opt/mediator-api && docker compose down && docker compose up -d --build"
```

### Health check
```bash
curl http://192.168.1.201:3000/health
```

### Test local routing
```bash
curl -s -X POST http://192.168.1.201:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is 2+2?"}],"stream":false}'
```

### Test OpenRouter routing
```bash
curl -s -X POST http://192.168.1.201:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"use grok: Write a poem"}],"stream":false}'
```

### Test tool calling
```bash
curl -s -X POST http://192.168.1.201:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is the weather in Bengaluru?"}],
       "tools":[{"type":"function","function":{"name":"get_weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
       "tool_choice":"auto","stream":false}'
```

## Routing Configuration
Edit `/opt/mediator-api/tasks.json` on pve1, then restart the container.

### Routing Logic
1. Check `always_local` keywords → Local (Qwen)
2. Check OpenRouter category keywords → Remote (Grok)
3. No match → Local (default fallback)

### Explicit Grok Triggers
`"use grok"`, `"use openrouter"`, `"use a stronger model"`, `"use a better model"`, `"route to grok"`, `"try a smarter model"`, `"use a more capable model"`, `"i need a better answer"`, `"use the paid model"`

### Always-Local Categories
Python, AWS, Docker, Kubernetes, ML, debugging, data science, DevOps, Linux, Git, bash, SQL, system design, code review, and more (see `tasks.json`)

## Updating from GitHub
```bash
ssh root@192.168.1.201 "cd /opt/mediator-api && git pull && docker compose down && docker compose up -d --build"
```

## Hermes Agent Configuration
Point Hermes to the mediator instead of the local API directly:
```yaml
api_base: http://192.168.1.201:3000/v1
```

## Notes
- `api_details.txt` is excluded from git (contains credentials)
- `.env` on pve1 has the real OpenRouter API key
- Mediator is a transparent proxy — passes through all OpenAI request fields (tools, temperature, max_tokens, etc.)
- Only the model name is overridden during routing
