// Forward request to a target API and stream the response back
async function forwardToApi(targetUrl, apiKey, model, messages, stream = true) {
  const url = `${targetUrl}/chat/completions`;

  const body = {
    model: model,
    messages: messages,
    stream: stream
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${model} API error (${response.status}): ${errText}`);
  }

  return response;
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
