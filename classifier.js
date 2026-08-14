const fs = require('fs');
const path = require('path');

// Classifier mode: keyword | hybrid | llm
// keyword = keyword matching only (fast, no LLM call)
// hybrid  = keyword fast path + LLM fallback for ambiguous requests
// llm     = always use LLM for classification
const CLASSIFIER_MODE = process.env.CLASSIFIER_MODE || 'hybrid';

// Load task routing config
function loadTasks() {
  const tasksPath = path.join(__dirname, 'tasks.json');
  const raw = fs.readFileSync(tasksPath, 'utf-8');
  return JSON.parse(raw);
}

// Build the classification system prompt from tasks.json
function buildClassificationPrompt(tasksConfig) {
  const categories = tasksConfig.categories.map(c =>
    `- ${c.name}: ${c.description}`
  ).join('\n');

  const allKeywords = tasksConfig.categories.flatMap(c => c.keywords).join(', ');

  return `You are a request router. Your ONLY job is to read a user's request and decide whether it should be handled by a basic local model or routed to a stronger model.

Task categories that require the stronger model:
${categories}

Keywords that indicate a complex task: ${allKeywords}

Respond ONLY with a JSON object in this exact format:
{
  "route": "local" or "openrouter",
  "reason": "brief reason for your decision",
  "category": "matched category name or null"
}

Rules:
- If the request matches ANY of the categories or keywords above, route to "openrouter"
- If the user explicitly asks for a stronger/better model, route to "openrouter"
- Keep it simple: short questions, casual chat, basic facts, simple instructions → "local"
- Do NOT add any text outside the JSON object`;
}

// Strip routing instructions (e.g. "use grok:", "use a stronger model to...")
// from the user message before forwarding to the target backend
function sanitizeMessage(userMessage) {
  // Patterns derived from explicit_model_request keywords in tasks.json
  const patterns = [
    /^(?:use\s+(?:grok|openrouter|a\s+(?:stronger|better|more\s+capable)\s+model|the\s+(?:paid|expensive)\s+model|a\s+smarter\s+model))[:.,!?]\s*/i,
    /^(?:route\s+to\s+grok)[:.,!?]\s*/i,
    /^(?:try\s+a\s+smarter\s+model)[:.,!?]\s*/i,
    /^(?:upgrade\s+(?:the\s+)?model)[:.,!?]\s*/i,
    /^(?:this\s+is\s+important\s+use\s+grok)[:.,!?]\s*/i,
    /^(?:i\s+need\s+(?:a\s+)?(?:better\s+answer|a\s+stronger\s+model|a\s+better\s+model))[:.,!?]\s*/i,
    /^(?:use\s+grok\s+for\s+this)[:.,!?]\s*/i,
  ];

  let sanitized = userMessage;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '');
    if (sanitized !== userMessage) break; // Stop after first match
  }

  return sanitized.trim();
}

// Ask local LLM to classify an ambiguous request
async function classifyWithLLM(userMessage, localApiUrl, localApiKey, localModel) {
  const prompt = `Classify this user request. Should it be handled by a capable local model or routed to a stronger remote model?

User request: ${userMessage}

Respond ONLY with JSON:
{"route":"local" or "openrouter","reason":"brief explanation"}

Use "openrouter" for: complex reasoning, research, creative writing, high-stakes tasks, or when the request seems to need more capability.
Use "local" for: coding, debugging, technical tasks, simple questions, everyday tasks.
Do NOT add any text outside the JSON object.`;

  const response = await fetch(`${localApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localApiKey}`
    },
    body: JSON.stringify({
      model: localModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 64,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`LLM classification failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Invalid LLM classification response: ${content.slice(0, 100)}`);
  }

  return JSON.parse(jsonMatch[0]);
}

// Send classification request to local model with retry logic
async function classifyRequest(userMessage, localApiUrl, localApiKey, localModel) {
  const tasksConfig = loadTasks();

  // 1. Explicit model request (e.g. "use grok") — highest priority, overrides everything
  const explicitRequestMatch = quickExplicitModelRequest(userMessage, tasksConfig);
  if (explicitRequestMatch) {
    const sanitized = sanitizeMessage(userMessage);
    return {
      route: 'openrouter',
      reason: `explicit model request: ${explicitRequestMatch}`,
      category: explicitRequestMatch,
      sanitizedContent: sanitized
    };
  }

  // 2. always_local — force local for simple/technical tasks
  const alwaysLocalMatch = quickAlwaysLocalMatch(userMessage, tasksConfig);
  if (alwaysLocalMatch) {
    return {
      route: 'local',
      reason: `always_local match: ${alwaysLocalMatch}`,
      category: null
    };
  }

  // 3. OpenRouter category keywords (complex reasoning, research, etc.)
  const keywordMatch = quickKeywordMatch(userMessage, tasksConfig);
  if (keywordMatch) {
    return {
      route: 'openrouter',
      reason: `keyword match: ${keywordMatch}`,
      category: keywordMatch
    };
  }

  // 4. No keyword match — use LLM classification if enabled
  if (CLASSIFIER_MODE === 'hybrid' || CLASSIFIER_MODE === 'llm') {
    try {
      console.log(`   → Keyword match inconclusive, asking local LLM to classify...`);
      const llmResult = await classifyWithLLM(userMessage, localApiUrl, localApiKey, localModel);
      console.log(`   → LLM classified as: ${llmResult.route} (${llmResult.reason})`);
      return {
        route: llmResult.route || 'local',
        reason: `LLM classification: ${llmResult.reason || 'unknown'}`,
        category: null
      };
    } catch (err) {
      console.error(`   ⚠️ LLM classification failed: ${err.message}, defaulting to local`);
    }
  }

  // Default to local
  return {
    route: 'local',
    reason: 'no complex task pattern matched',
    category: null
  };
}

// Fast keyword-based check for explicit model requests (e.g. "use grok")
// Checked FIRST — user intent to use a stronger model always wins
function quickExplicitModelRequest(userMessage, tasksConfig) {
  const lower = userMessage.toLowerCase();
  for (const category of tasksConfig.categories) {
    if (category.name !== 'explicit_model_request') continue;
    for (const keyword of category.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return category.name;
      }
    }
  }
  return null;
}

// Fast keyword-based pre-check for openrouter categories
function quickKeywordMatch(userMessage, tasksConfig) {
  const lower = userMessage.toLowerCase();
  for (const category of tasksConfig.categories) {
    for (const keyword of category.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return category.name;
      }
    }
  }
  return null;
}

// Fast keyword-based check for always-local tasks
function quickAlwaysLocalMatch(userMessage, tasksConfig) {
  if (!tasksConfig.always_local) return null;
  const lower = userMessage.toLowerCase();
  for (const keyword of tasksConfig.always_local.keywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

module.exports = { classifyRequest, loadTasks };
