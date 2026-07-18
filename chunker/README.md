# BABOK Chunk Generator

Parses BABOK HTML chapter files and outputs semantic JSONL chunks for vector database embedding.

**Output:** `chunker/embeddings-chunks.jsonl` -- 410 chunks, one JSON object per line.

For the RAG pipeline (uploading to Pinecone, querying, chat server), see [`trainer/README.md`](../trainer/README.md).

---

## Quick Start

```bash
cd chunker
npm install
node chunker/chunker.js        # run from project root
```

**Requires:** Node.js. No external API keys needed.

---

## Chunk Types

| Type | Count | Source |
|------|-------|--------|
| `task` | 30 | `chapters/03-08-*.html` -- knowledge area task sections (H2) |
| `technique` | 36 | `chapters/techniques/10-*.html` |
| `concept` | 22 | `chapters/02-business-analysis-key-concepts.html` |
| `glossary_term` | varies | `chapters/glossary.html` |
| `perspective` | 58 | `chapters/11-*.html` (sections, KA impacts, tables) |

---

## JSONL Schema

Every chunk shares these base fields:

```json
{
  "chunk_id": "ch6_s1_analyze_current_state",
  "type": "task",
  "chapter": 6,
  "chapter_title": "Strategy Analysis",
  "section_id": "analyze-current-state",
  "title": "Analyze Current State",
  "text": "Full text for embedding..."
}
```

Additional fields by type:

**`task`** -- also includes: `purpose`, `description`, `inputs[]`, `outputs[]`, `elements[]`, `techniques[]`, `stakeholders[]`, `guidelines_and_tools[]`

**`technique`** -- also includes: `purpose`, `description`, `elements[]`, `usage_considerations.strengths[]`, `usage_considerations.limitations[]`

**`concept`** -- also includes: `concept_type` (`baccm` | `key_term` | `stakeholder_role` | etc.), `description`

**`glossary_term`** -- also includes: `term`, `definition`, `aliases[]`, `see_also[]`

**`perspective`** -- also includes: `perspective` (agile/bi/it/ba/bpm), `section_type` (`section` | `ka_impact` | `table`)

---

## HTML Source Structure

All chapter files follow this wrapper:
```html
<body style="counter-reset: h1counter N;">
  <header><nav>...</nav><h1>Title</h1></header>
  <main><!-- content --></main>
</body>
```
**Chapter number formula:** `display_number = counter_value + 1` (zero-indexed)

**Task sections** (chapters 3-8): Each `<h2 id="task-id">` starts a task. H3 subsections in order: Purpose > Description > Inputs > [Diagram] > Elements > Guidelines and Tools > Techniques > Stakeholders > Outputs.

**Glossary:** Terms split across multiple `<ul>` elements (one per letter group). Use `main > ul > li` selector -- do NOT assume a single list. Some entries lack a colon separator; use flexible regex.

**Techniques:** One file per technique in `chapters/techniques/10-*.html`. Subsections match task structure; ends with Usage Considerations (H3) > Strengths and Limitations (H4).

---

## Configuration

Edit `CONFIG` at the top of `chunker.js` to add chapters, change paths, or adjust chunk sizing:

```js
const CONFIG = {
  chapters: [ /* knowledge area chapter paths and numbers */ ],
  techniquesDir: 'chapters/techniques/',
  conceptsFile:  'chapters/02-business-analysis-key-concepts.html',
  glossaryFile:  'chapters/glossary.html',
  outputFile:    'chunker/embeddings-chunks.jsonl',
  targetChunkTokens: 1200,   // ~1200 tokens per chunk
  charsPerToken:     4,      // rough estimate
};
```

---

BABOK(R) is copyrighted by IIBA(R). This tool is for personal, non-commercial study only.