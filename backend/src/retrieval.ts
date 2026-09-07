export type RetrievalResult = {
  chunkId: string;
  documentId: string;
  filename: string;
  text: string;
  metadata: Record<string, unknown>;
  vectorScore?: number;
  bm25Score?: number;
  fusedScore: number;
};

const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'why', 'with']);

export function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function queryTerms(query: string): string[] {
  return normalizeQuery(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && !stopWords.has(term));
}

export function fuseResults(vectorResults: RetrievalResult[], bm25Results: RetrievalResult[], vectorWeight: number, bm25Weight: number, limit: number, query: string): RetrievalResult[] {
  const totalWeight = vectorWeight + bm25Weight;
  const safeVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.6;
  const safeBm25Weight = totalWeight > 0 ? bm25Weight / totalWeight : 0.4;
  const maxVector = Math.max(...vectorResults.map((result) => result.vectorScore ?? 0), 0);
  const maxBm25 = Math.max(...bm25Results.map((result) => result.bm25Score ?? 0), 0);
  const terms = queryTerms(query);
  const byChunk = new Map<string, RetrievalResult>();

  for (const result of [...vectorResults, ...bm25Results]) {
    const existing = byChunk.get(result.chunkId);
    if (existing) {
      existing.vectorScore ??= result.vectorScore;
      existing.bm25Score ??= result.bm25Score;
      continue;
    }
    byChunk.set(result.chunkId, { ...result });
  }

  return [...byChunk.values()]
    .map((result) => {
      const vectorPart = maxVector ? (result.vectorScore ?? 0) / maxVector : 0;
      const bm25Part = maxBm25 ? (result.bm25Score ?? 0) / maxBm25 : 0;
      const lexicalMatches = terms.filter((term) => result.text.toLowerCase().includes(term)).length;
      const rerankBoost = terms.length ? lexicalMatches / terms.length * 0.05 : 0;
      return { ...result, fusedScore: safeVectorWeight * vectorPart + safeBm25Weight * bm25Part + rerankBoost };
    })
    .sort((left, right) => right.fusedScore - left.fusedScore)
    .slice(0, limit);
}
