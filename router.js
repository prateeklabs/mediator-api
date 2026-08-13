// Fetch timeout in ms — configurable via env, default 120s
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT_MS || '120000', 10);

// Normalize tool_choice for local LM Studio backend
// LM Studio only accepts string values: "none", "auto", "required"
// OpenAI/OpenRouter also accept object form: { type: "function", function: { name: "..." } }
function normalizeToolChoiceForLocal(body) {
  if (!body.tool_choice) return body;

  // Already a string — fine
  if (typeof body.tool_choice === 'string') return body;

  // Object form — normalize to string
  const tc = body.tool_choice;
  if (typeof tc === 'object') {
    const tcType = (tc.type || '').toLowerCase();
    if (tcType === 'none') return { ...body, tool_choice: 'none' };
    if (tcType === 'auto') return { ...body, tool_choice: 'auto' };
    if (tcType === 'required') return { ...body, tool_choice: 'required' };
    if (tcType === 'function' && tc.function && tc.function.name) {
      // Forced tool — LM Studio doesn't support named forcing, use "required"
      return { ...body, tool_choice: 'required' };
    }
    // Unknown object form — safest fallback
    return { ...body, tool_choice: 'auto' };
  }

  return body;
}

// Forward request to a target API and stream the response back
// Transparent proxy: preserves the full incoming request body, only overrides model
async function forwardToApi(targetUrl, apiKey, model, requestBody, isLocal = false) {
  const url = `${targetUrl}/chat/completions`;

  let body = {
    ...requestBody,
    model
  };

  // Normalize tool_choice for local backend (LM Studio doesn't accept object form)
  if (isLocal) {
    body = normalizeToolChoiceForLocal(body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${model} API error (${response.status}): ${errText}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Convert OpenRouter stream to OpenAI-compatible SSE format
async function streamToSSE(response, res) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;

      if (trimmed.startsWith('data: ')) {
        // Pass through as-is — OpenRouter SSE is compatible with OpenAI format
        res.write(`data: ${trimmed.slice(6)}\n\n`);
      }
    }
  }

  res.write('data: [DONE]\n\n');
}

// Non-streaming response passthrough
async function passthroughJson(response, res) {
  const data = await response.json();
  res.json(data);
}

module.exports = { forwardToApi, streamToSSE, passthroughJson };
