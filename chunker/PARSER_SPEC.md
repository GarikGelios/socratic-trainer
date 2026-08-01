# PARSER SPEC: BABOK HTML to Pinecone Chunks (DOM-Verified Blueprint)

This document defines a DOM-driven parsing blueprint for converting this repository's BABOK HTML content into structured JSON chunks for vector indexing.

Scope: specification only. No implementation code in this file.

---

## 1) Source File Inventory and Schema Classification

All discovered chapter HTML files under chapters/ are classified into one of the 8 schema families.

### 1.1 Schema Coverage Map

1. doc_type: task
- Source files:
  - chapters/03-business-analysis-planning-and-monitoring.html
  - chapters/04-elicitation-and-collaboration.html
  - chapters/05-requirements-life-cycle-management.html
  - chapters/06-strategy-analysis.html
  - chapters/07-requirements-analysis-and-design-definition.html
  - chapters/08-solution-evaluation.html

2. doc_type: technique
- Source files:
  - chapters/techniques/*.html (10-1 through 10-50)
- Index/list page (not a technique chunk source itself):
  - chapters/10-techniques.html

3. doc_type: technique_task_mapping
- Source file:
  - chapters/techniques-to-task-mapping.html

4. doc_type: task_task_mapping
- Source file:
  - chapters/task-relationship-mapping.html
- Upstream provenance note:
  - Page content is consolidated from task Input/Output diagrams in chapters 03..08.

5. doc_type: competency
- Source file:
  - chapters/09-underlying-competencies.html

6. doc_type: perspective
- Source files:
  - chapters/11-1-the-agile-perspective.html
  - chapters/11-2-the-business-intelligence-perspective.html
  - chapters/11-3-the-information-technology-perspective.html
  - chapters/11-4-the-business-architecture-perspective.html
  - chapters/11-5-the-business-process-management-perspective.html
- Perspective list page (context only):
  - chapters/11-perspectives.html

7. doc_type: glossary
- Source file:
  - chapters/glossary.html

8. doc_type: overview (or core_concept)
- Source files:
  - chapters/01-introduction.html
  - chapters/02-business-analysis-key-concepts.html  

---

## 2) Global DOM Cleanup and Normalization Rules

Apply cleanup before field extraction unless a rule states otherwise.

### 2.1 Remove/ignore selectors

- script
- style
- nav
- footer
- figure .arrow
- .arrow
- q (optional: retain as plain text if needed for semantic completeness)

Notes:
- Keep figure, table, section, article content because they carry mapping/task graph data.
- Do not remove abbr; flatten to visible text content.

### 2.2 Text normalization

- Decode HTML entities.
- Collapse repeated whitespace to single spaces, preserving paragraph/list boundaries.
- Strip empty anchors (a[href=""]) but keep anchor text.
- Convert ul/ol to bullet lines in text fields:
  - - item one
  - - item two
- Preserve heading boundaries as section delimiters.

### 2.3 List and table normalization

- Nested lists: flatten depth-first, prefix each leaf with "- ".
- Tables:
  - Keep caption as context when present.
  - For each row, normalize into key-value text using header names when available.

---

## 3) DOM Selector Mapping Matrix by doc_type

This matrix maps verified markup patterns in repository files to output fields.

## 3.1 doc_type: task

### 3.1.1 Chunk boundaries

- Task starts at each h2[id] in KA files.
- Task ends before next sibling h2[id] or end of main.
- Sub-chunks are generated per task subsection h3:
  - Purpose
  - Description
  - Inputs
  - Elements
  - Guidelines and Tools
  - Techniques
  - Stakeholders
  - Outputs

### 3.1.2 Field extraction

- chapter:
  - selector: header > h1
  - format: "{chapter_number}. {chapter_title}"
  - chapter_number from file name prefix (03..08) converted to integer.
- title:
  - selector: task-root h2[id]
- section_id (deterministic):
  - primary: first immediate figure after Inputs in same task block:
    - selector: figure article.task > span
    - extract regex: /(\d+\.\d+)\./
  - fallback A: first span inside "Tasks Using This Output" or local figure tasks section.
  - fallback B: derive by order within chapter: {chapter_number}.{1-based task index}.
- sub_section:
  - selector: task-root h3 exact text match.
- content:
  - collect text from current h3 until next h3 (or next h2 boundary).
- text:
  - "Task {section_id} {title}\nSection: {sub_section}\nContent: {content}"

### 3.1.3 Verified structural anchors in repository

- h2[id] task titles exist across chapters 03..08.
- h3 section headings are consistent across task pages.
- Relationship diagrams use figure + section.input/guidelines/tasks/outputs + article nodes.

---

## 3.2 doc_type: technique

### 3.2.1 Chunk boundaries

- One technique page per file under chapters/techniques/.
- Root starts at main > h2 (technique name).
- Sub-chunks per h3:
  - Purpose
  - Description
  - Elements
  - Usage Considerations
- Optional nested subheading chunks under h4 (for semantic enrichment):
  - Strengths
  - Limitations

### 3.2.2 Field extraction

- technique_name:
  - selector: main > h2
- technique_id:
  - primary: file name prefix after "10-" converted to decimal format.
  - rule:
    - 10-1-*.html => 10.1
    - 10-50-*.html => 10.50
- sub_section:
  - selector: h3 text (or h4 child chunk label when splitting Usage Considerations further).
- content:
  - collect text from target heading to next same-level heading boundary.
- text:
  - "Technique {technique_id} {technique_name}\nSection: {sub_section}\nContent: {content}"

### 3.2.3 Variability and fallback

- Some technique files are irregular (missing h3 Purpose in a few files).
- Fallback when expected h3 missing:
  - consume first prose block after h2 as Description.
  - still emit chunk with sub_section inferred from nearest heading.

---

## 3.3 doc_type: technique_task_mapping

### 3.3.1 Chunk boundaries

- In chapters/techniques-to-task-mapping.html:
  - each mapping block starts at h2.no-counter containing a technique id/title.
  - block ends before next h2.no-counter.

### 3.3.2 Field extraction

- technique_id:
  - from h2 text regex /(10\.\d+)/ after normalizing optional extra dot (e.g., "10.2.").
- technique_name:
  - from h2 text after id cleanup.
- knowledge_areas:
  - selectors: strong siblings inside same block.
  - regex: /^\d+\.\s+(.+)$/
- mapped_task_ids:
  - selectors: ul li in same block.
  - regex: /(\d+\.\d+)\./g
  - deduplicate, preserve source order.
- text:
  - readable summary including technique, KAs, and task IDs.

### 3.3.3 Important DOM reality

- This file is not a table; it is heading + strong + ul blocks.
- Parser must not require table/tr/td for this schema.

---

## 3.4 doc_type: task_task_mapping

### 3.4.1 Chunk boundaries

- In chapters/task-relationship-mapping.html:
  - chapter block starts at h2.no-counter (for example: "3. Business Analysis Planning and Monitoring").
  - task block starts at h3.no-counter containing task link text (for example: "3.1. Plan Business Analysis Approach").
  - task block ends before next h3.no-counter or next h2.no-counter.
- Emit chunks at two levels:
  - task-level mapping chunk (one per task).
  - entity-level mapping chunks (one per entity section under each task).

### 3.4.2 Field extraction

- task_id:
  - from h3.no-counter text via regex: /(\d+\.\d+)\./
- task_name:
  - from h3.no-counter link text after task_id prefix.
- chapter:
  - nearest previous h2.no-counter text.
- source_anchor:
  - selector: h3.no-counter > a[href]
  - keep relative href to original task section for traceability.
- inputs:
  - selector path inside task block:
    - li > strong text exactly "Inputs"
    - nested list: following sibling ul > li
- outputs:
  - selector path inside task block:
    - li > strong text exactly "Outputs"
    - nested list: following sibling ul > li
- guidelines_and_tools:
  - selector path inside task block:
    - li > strong text exactly "Guidelines and Tools"
    - nested list: following sibling ul > li
- downstream_task_ids:
  - selector path inside task block:
    - li > strong text exactly "Tasks Using This Output"
    - nested list: following sibling ul > li
  - normalized by extracting IDs with regex /(\d+\.\d+)/ where present.
- techniques:
  - selector path inside task block:
    - li > strong text exactly "Techniques"
    - nested list: following sibling ul > li
- text:
  - concise narrative containing:
    - chapter
    - task identity
    - inputs
    - guidelines/tools
    - outputs
    - downstream task links
    - techniques

### 3.4.3 Entity-level mapping chunks (required)

For each task block, additionally emit one chunk per entity section below:

- Inputs
- Task (identity chunk)
- Guidelines and Tools
- Outputs
- Tasks Using This Output
- Techniques

Required fields per entity chunk:

- task_id
- task_name
- chapter
- mapping_entity (enum: inputs | task | guidelines_and_tools | outputs | tasks_using_this_output | techniques)
- mapping_values (array of list values; for `task`, include single value "{task_id}. {task_name}")
- source_anchor
- text

Entity chunk text format:

- "Task Mapping {task_id} {task_name}\nEntity: {Entity Label}\nValues:\n- ..."

### 3.4.4 List-to-array transformation rules for mapping page

- Each entity section is represented as:
  - parent li containing strong label
  - child ul containing value li items
- Collect child list items in source order.
- Keep full value text as displayed (including markers like "(external)").
- Preserve duplicates only when semantically distinct by full string; otherwise deduplicate exact duplicates.
- If entity list contains "Not explicitly listed.", keep it as a literal value (do not convert to empty array).

### 3.4.5 Relationship to task pages

- task_task_mapping must parse only chapters/task-relationship-mapping.html as canonical mapping source.
- Do not re-derive this doc_type from chapters 03..08 during normal runs.
- Chapters 03..08 remain canonical for doc_type `task` chunks.

---

## 3.5 doc_type: competency

### 3.5.1 Chunk boundaries

- In chapters/09-underlying-competencies.html:
  - competency category starts at h2[id] (e.g., Analytical Thinking and Problem Solving).
  - competency item starts at h3 (e.g., Creative Thinking).
  - item ends before next h3 or next h2.
- Emit sub-chunks per h4 under each h3.

### 3.5.2 Field extraction

- competency_category:
  - nearest previous h2 text, prefixed with numeric sequence by order:
    - 9.1 .. 9.6 in document order.
- competency_name:
  - h3 text.
- sub_section:
  - h4 text, normalized:
    - Purpose
    - Definition
    - Description (accepted as Definition-equivalent fallback)
    - Effectiveness Measures
- content:
  - text between this h4 and next h4/h3 boundary.
- text:
  - "Competency: {competency_category} - {competency_name}\nSection: {sub_section}\nContent: {content}"

### 3.5.3 Variability

- Some competencies use h4 Description instead of h4 Definition.
- Treat Description as valid sub-section, not as parse failure.

---

## 3.6 doc_type: perspective

### 3.6.1 Chunk boundaries

- One perspective page per file in 11-1..11-5.
- perspective_name from main h2 page title.
- subsection chunks by h3.

### 3.6.2 Section heading variants (must support all)

Canonical schema sections and observed heading variants:

- Change Scope:
  - h3 Change Scope
- Business Analysis Scope:
  - h3 Business Analysis Scope
- Methodologies, Approaches, and Techniques:
  - h3 Approaches and Techniques
  - h3 Methodologies and Approaches
  - h3 Methodologies
  - h3 Frameworks, Methodologies, and Techniques
  - h3 Reference Models and Techniques
- Underlying Competencies:
  - h3 Underlying Competencies
- Impact on Knowledge Areas:
  - h3 Impact on Knowledge Areas

### 3.6.3 Field extraction

- perspective_name:
  - selector: main > h2
  - normalize by removing leading "The " and trailing " Perspective" for compact name if needed.
- sub_section:
  - canonicalized section label using variant map above.
- impacted_knowledge_areas:
  - only for Impact on Knowledge Areas section.
  - parse h4 headings under this section that match known KA names.
- content:
  - text span within each h3 section to next h3.
- text:
  - "Perspective: {perspective_name}\nSection: {sub_section}\nContent: {content}"

---

## 3.7 doc_type: glossary

### 3.7.1 Chunk boundaries

- In chapters/glossary.html:
  - each li is one glossary entry chunk.

### 3.7.2 Field extraction

- term:
  - primary: li > strong text.
- definition:
  - text in li after strong term token.
  - remove leading ":" when present.
- text:
  - "Glossary Term: {term}\nDefinition: {definition}"

### 3.7.3 Edge-case handling

- At least one entry is malformed without colon after strong (adaptive approach).
- Rule:
  - if pattern "<strong>term</strong>:" absent, split at strong closing tag and treat remaining text as definition.
- Keep "See ..." cross-reference definitions as-is.

---

## 3.8 doc_type: overview (or core_concept)

### 3.8.1 Field extraction

- chapter: "01. Introduction" or "02. Business Analysis Key Concepts"
- section_title: selector h2[id] or h3[id] (e.g., "The Business Analysis Core Concept Model™")
- content: text collected under section heading until next boundary
- text: "BABOK Overview [{chapter}] - {section_title}\nContent: {content}"

---

## 4) Deterministic Chunk ID Strategy

Use stable IDs to ensure upserts are deterministic.

1. task section chunk
- task-{section_id}-{slug(title)}-{slug(sub_section)}
- example: task-3.1-plan-business-analysis-approach-purpose

2. technique section chunk
- technique-{technique_id}-{slug(technique_name)}-{slug(sub_section)}
- example: technique-10.50-workshops-usage-considerations

3. technique_task_mapping chunk
- mapping-tech-{technique_id}-{slug(technique_name)}
- example: mapping-tech-10.50-workshops

4. task_task_mapping chunk
- mapping-task-{task_id}-{slug(task_name)}
- example: mapping-task-3.1-plan-business-analysis-approach

4a. task_task_mapping entity chunk
- mapping-task-{task_id}-{slug(task_name)}-{slug(mapping_entity)}
- examples:
  - mapping-task-3.1-plan-business-analysis-approach-inputs
  - mapping-task-3.1-plan-business-analysis-approach-guidelines-and-tools
  - mapping-task-3.1-plan-business-analysis-approach-task

5. competency chunk
- competency-{slug(competency_category)}-{slug(competency_name)}-{slug(sub_section)}

6. perspective chunk
- perspective-{slug(perspective_name)}-{slug(sub_section)}

7. glossary chunk
- glossary-{slug(term)}

8. overview (or core_concept)
- overview-{chapter_number}-{slug(section_title)}
- Example: overview-02-the-business-analysis-core-concept-model

Slug rules:
- lowercase
- alphanumeric + hyphen only
- collapse repeated hyphens

---

## 5) Parsing Fallback Policy (Required)

When expected structure is missing, follow deterministic fallback order.

1. Missing heading label
- Use nearest previous heading of same or higher level and infer section class by keyword map.

2. Missing section_id/task_id in task block
- Try figure article.task span.
- Else parse first local task reference pattern /(\d+\.\d+)\./.
- Else derive from chapter number + task ordinal.

2a. Missing task_id in task_task_mapping page
- Parse task_id from h3.no-counter text regex /(\d+\.\d+)\./.
- Else parse from h3.no-counter > a[href] anchor text.
- Else derive from chapter h2 prefix + task ordinal within that chapter block.

3. Missing list/table structures
- If list expected but prose provided, wrap sentence(s) as single-item array.

3a. Missing entity section in task_task_mapping page
- If one of Inputs/Guidelines and Tools/Outputs/Tasks Using This Output/Techniques is missing,
  emit entity chunk with mapping_values = ["Not explicitly listed."] and add parse warning if enabled.

4. Missing definition delimiter in glossary
- Use text after strong as definition.

5. Unknown heading variant in perspective
- Map by keyword groups:
  - methodologies|approaches|frameworks|reference models|techniques => canonical "Methodologies, Approaches, and Techniques".

6. Hard parse failure for a section
- Emit chunk with available fields and add parse_warnings metadata array (if metadata extension allowed).

---

## 6) Chunk Text Quality Rules for Embeddings

1. Prefix every chunk text with entity identity line (Task/Technique/Perspective/etc.).
2. Include section header line for local context.
3. Keep bullet structures in plain text bullets.
4. Remove decorative glyph-only nodes (for example arrows) from final content.
5. Keep domain abbreviations (KPI, SME, UAT, etc.) in output text.

---

## 7) Explicit Non-Goals

- Do not parse chapters/10-techniques.html and chapters/11-perspectives.html as primary knowledge chunks; they are index/context pages.
- Do not depend on CSS counters for numbering extraction.
- Do not assume mapping content is always tabular.
- Do not infer task_task_mapping by scraping figures from chapters 03..08 when chapters/task-relationship-mapping.html is present.

---

## 8) Verification Checklist

- [x] No executable code specified in this file.
- [x] Coverage for all 8 BABOK schemas.
- [x] Selectors and traversal rules validated against repository DOM patterns.
- [x] Table/list-to-array transformation rules explicitly documented.
- [x] Deterministic chunk ID strategy documented with examples.
