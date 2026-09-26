// RAG retrieval pipeline: embeds a question, queries Pinecone, and hydrates matches
// with full chunk content. Dependencies are injected so this module has no top-level
// side effects and can be unit tested with mocked clients.
function createRagPipeline({ openai, index, config, chunkMap, extractReferenceText, getMetaType, getMetaLabel }) {
  async function retrieveContext(question) {
    const embeddingResponse = await openai.embeddings.create({
      model: config.embeddingModel,
      input: question,
    });
    const queryVector = embeddingResponse.data[0].embedding;

    const results = await index.query({
      vector: queryVector,
      topK: config.topK,
      includeMetadata: true,
    });

    const matches = (results.matches || []).filter((m) => m.score >= config.scoreThreshold);

    return matches.map((match) => {
      const fullChunk = chunkMap.get(match.id);
      if (!fullChunk) return { id: match.id, score: match.score, text: '(not found)' };

      const chunkText = fullChunk.text || extractReferenceText(fullChunk);
      const meta = match.metadata || {};
      return {
        id: match.id,
        score: match.score,
        type: getMetaType(meta, fullChunk),
        label: getMetaLabel(meta, fullChunk),
        text: chunkText,
      };
    });
  }

  function buildContextText(chunks) {
    return chunks.map((c, i) => `[${i + 1}] ${c.id} (score: ${c.score.toFixed(3)})\n${c.text}`).join('\n\n---\n\n');
  }

  return { retrieveContext, buildContextText };
}

module.exports = { createRagPipeline };
