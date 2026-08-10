const fs = require('fs');
const path = require('path');

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

// Send classification request to local model with retry logic
async function classifyRequest(userMessage, localApiUrl, localApiKey, localModel) {
  const tasksConfig = loadTasks();

  // Fast keyword-based pre-check
  const keywordMatch = quickKeywordMatch(userMessage, tasksConfig);
  const alwaysLocalMatch = quickAlwaysLocalMatch(userMessage, tasksConfig);

  // If it matches always_local, force local regardless of other matches
  if (alwaysLocalMatch) {
    return {
      route: 'local',
      reason: `always_local match: ${alwaysLocalMatch}`,
      category: null
    };
  }

  // If it matches an openrouter category, route there
  if (keywordMatch) {
    return {
      route: 'openrouter',
      reason: `keyword match: ${keywordMatch}`,
      category: keywordMatch
    };
  }

  // Default to local
  return {
    route: 'local',
    reason: 'no complex task pattern matched',
    category: null
  };
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
