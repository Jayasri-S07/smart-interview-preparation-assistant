const mistralEmbeddingsUrl = 'https://api.mistral.ai/v1/embeddings';

export async function embedTexts(texts: string[], apiKey: string, model = 'mistral-embed'): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  const response = await fetch(mistralEmbeddingsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Mistral embedding request failed (${response.status}): ${message.slice(0, 240)}`);
  }

  const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
  if (!payload.data || payload.data.length !== texts.length) {
    throw new Error('Mistral returned an incomplete embedding response');
  }

  return [...payload.data].sort((left, right) => left.index - right.index).map((item) => item.embedding);
}
