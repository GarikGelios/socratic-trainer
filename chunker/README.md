# BABOK Chunk Generator

Converts BABOK® Guide HTML chapters into structured JSON chunks ready for Pinecone vector search. Each chunk maps to one section of one BABOK topic — fine-grained enough to retrieve exactly the right content in a RAG pipeline.

**Output:** `chunker/embeddings-chunks.jsonl` — one JSON object per line.  
**Next step:** Upload to Pinecone with `node trainer/pinecone-upload.js` (see [`trainer/README.md`](../trainer/README.md)).

---

## Quick Start

```bash
# 1. Install dependencies (run once)
cd chunker
npm install

# 2. Run the chunker from the project root
node chunker/chunker.js
```

The output file is written to **`chunker/embeddings-chunks.jsonl`** regardless of your working directory.

**Requires:** Node.js (no API keys needed).

---

## Prerequisites & File Dependencies

| What | Where |
|------|-------|
| Overview chapters | `chapters/01-introduction.html`, `chapters/02-business-analysis-key-concepts.html` |
| BABOK HTML chapters | `chapters/03-*.html` … `chapters/08-*.html` |
| Technique pages | `chapters/techniques/10-*.html` |
| Mapping pages | `chapters/techniques-to-task-mapping.html`, `chapters/task-relationship-mapping.html` |
| Competencies page | `chapters/09-underlying-competencies.html` |
| Glossary page | `chapters/glossary.html` |
| Perspectives pages | `chapters/11-1-*.html` … `chapters/11-5-*.html` |
| Node packages | `node-html-parser` (listed in `package.json`) |

If any source file is missing, the chunker logs a warning and skips that doc_type — it will not crash.

---

## Output Schema

Every chunk shares these base fields:

```json
{
  "id":           "task-3.1-plan-business-analysis-approach-purpose",
  "doc_type":     "task",
  "text":         "Task 3.1 Plan Business Analysis Approach\nSection: Purpose\nContent: ...",
  "source_file":  "chapters/03-business-analysis-planning-and-monitoring.html",
  "estimated_tokens": 240
}
```

Additional fields vary by `doc_type`:

| `doc_type` | Key extra fields |
|------------|-----------------|
| `task` | `chapter`, `section_id`, `title`, `sub_section`, `content` |
| `technique` | `technique_id`, `technique_name`, `sub_section`, `content` |
| `technique_task_mapping` | `technique_id`, `technique_name`, `knowledge_areas[]`, `mapped_task_ids[]` |
| `task_task_mapping` | `task_id`, `task_name`, `chapter`, `inputs[]`, `outputs[]`, `techniques[]`, `mapping_entity` (entity chunks only) |
| `competency` | `competency_category`, `competency_name`, `sub_section`, `content` |
| `perspective` | `perspective_name`, `sub_section`, `content`, `impacted_knowledge_areas[]` (Impact section only) |
| `glossary` | `term`, `definition` |
| `overview` | `chapter`, `section_title`, `content` |

For full field definitions, selector rules, and chunk-boundary logic, see **[`PARSER_SPEC.md`](./PARSER_SPEC.md)**.

---

## Requesting Changes or Updates

If the BABOK HTML structure changes, or you need to add a new chunk type:

1. **Update `PARSER_SPEC.md` first** — define the new selectors, fields, and chunk ID pattern there.
2. Then update `chunker.js` to implement what the spec says.
3. Re-run the chunker and verify the new chunks appear in the JSONL output.
4. Delete `trainer/embeddings-cache.json` so embeddings are regenerated on the next upload.

> Never modify `chunker.js` to match structure you observed in the HTML without first documenting it in `PARSER_SPEC.md`. The spec is the source of truth.

---

BABOK® is copyrighted by IIBA®. This tool is for personal, non-commercial study only.

---

## 🤖 AI Agent & Support Developer Context

> This section is for AI coding assistants (GitHub Copilot, ChatGPT, etc.) and developers onboarding to this codebase.

**What this module does:**  
`chunker/chunker.js` parses BABOK® Guide HTML source files and writes `chunker/embeddings-chunks.jsonl`. Each line is one JSON chunk representing a single section of BABOK content. The chunks are then embedded and uploaded to Pinecone by `trainer/pinecone-upload.js`.

**Strict rule:** All parsing logic must conform to [`PARSER_SPEC.md`](./PARSER_SPEC.md). Do not infer DOM structure from inspection alone — verify against the spec first.

**Key paths:**

| File | Role |
|------|------|
| `chunker/chunker.js` | Main script — parse & emit |
| `chunker/embeddings-chunks.jsonl` | Output consumed by upload script |
| `chunker/PARSER_SPEC.md` | Authoritative DOM + schema specification |
| `trainer/pinecone-upload.js` | Reads JSONL, generates embeddings, upserts to Pinecone |

**Target vector store:** Pinecone — dense vectors, `text-embedding-3-large` model (dimension 3072). Index name: `ba-training-large`.

**The 8 `doc_type` values** (defined in spec §1):

| `doc_type` | Source |
|------------|--------|
| `task` | KA chapters 03–08 |
| `technique` | `chapters/techniques/` |
| `technique_task_mapping` | `chapters/techniques-to-task-mapping.html` |
| `task_task_mapping` | `chapters/task-relationship-mapping.html` |
| `competency` | `chapters/09-underlying-competencies.html` |
| `perspective` | `chapters/11-1-*.html` … `11-5-*.html` |
| `glossary` | `chapters/glossary.html` |
| `overview` | `chapters/01-introduction.html`, `chapters/02-business-analysis-key-concepts.html` |

**Chunk ID format** (spec §4): `{doc_type-prefix}-{ids}-{slug(sub_section)}` using hyphens only, lowercase, no special characters.