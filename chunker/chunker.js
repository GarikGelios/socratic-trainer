// BABOK Vector Database Chunk Generator
// Crawls HTML files and creates optimized chunks for embedding into vector database
// Run: node chunker.js

const fs = require('fs').promises;
const path = require('path');
const { parse } = require('node-html-parser');

// Root of the BABOK HTML book source files.
// Set BOOK_PATH env var when running chunker from a separate repository.
// Default: parent of chunker/ — works in the current html-book repo layout.
const BOOK_ROOT = process.env.BOOK_PATH
  ? path.resolve(process.env.BOOK_PATH)
  : path.resolve(__dirname, '..');

// ============================================================================
// CONFIGURATION - Adjust these values when adding new content
// ============================================================================

const CONFIG = {
  // Knowledge Area chapters (6 core BABOK chapters)
  chapters: [
    { path: path.join(BOOK_ROOT, 'chapters/03-business-analysis-planning-and-monitoring.html'), num: 3, title: 'Business Analysis Planning and Monitoring' },
    { path: path.join(BOOK_ROOT, 'chapters/04-elicitation-and-collaboration.html'), num: 4, title: 'Elicitation and Collaboration' },
    { path: path.join(BOOK_ROOT, 'chapters/05-requirements-life-cycle-management.html'), num: 5, title: 'Requirements Life Cycle Management' },
    { path: path.join(BOOK_ROOT, 'chapters/06-strategy-analysis.html'), num: 6, title: 'Strategy Analysis' },
    { path: path.join(BOOK_ROOT, 'chapters/07-requirements-analysis-and-design-definition.html'), num: 7, title: 'Requirements Analysis and Design Definition' },
    { path: path.join(BOOK_ROOT, 'chapters/08-solution-evaluation.html'), num: 8, title: 'Solution Evaluation' },
  ],

  // Techniques chapter (auto-discovery from techniques/ subfolder)
  techniquesDir: path.join(BOOK_ROOT, 'chapters/techniques/'),

  // Key Concepts chapter
  conceptsFile: path.join(BOOK_ROOT, 'chapters/02-business-analysis-key-concepts.html'),

  // Glossary chapter
  glossaryFile: path.join(BOOK_ROOT, 'chapters/glossary.html'),

  // Perspectives chapters
  perspectives: [
    { path: path.join(BOOK_ROOT, 'chapters/11-1-the-agile-perspective.html'), num: '11.1', type: 'agile', name: 'Agile', shortCode: 'agile' },
    { path: path.join(BOOK_ROOT, 'chapters/11-2-the-business-intelligence-perspective.html'), num: '11.2', type: 'bi', name: 'Business Intelligence', shortCode: 'bi' },
    { path: path.join(BOOK_ROOT, 'chapters/11-3-the-information-technology-perspective.html'), num: '11.3', type: 'it', name: 'Information Technology', shortCode: 'it' },
    { path: path.join(BOOK_ROOT, 'chapters/11-4-the-business-architecture-perspective.html'), num: '11.4', type: 'ba', name: 'Business Architecture', shortCode: 'ba' },
    { path: path.join(BOOK_ROOT, 'chapters/11-5-the-business-process-management-perspective.html'), num: '11.5', type: 'bpm', name: 'Business Process Management', shortCode: 'bpm' },
  ],

  // Output file for embeddings — always written next to chunker.js regardless of CWD
  outputFile: path.join(__dirname, 'embeddings-chunks.jsonl'),

  // Token estimation (roughly 4 chars = 1 token)
  targetChunkTokens: 1200,
  charsPerToken: 4,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Load and parse HTML file into DOM object
 * @param {string} filePath - Path to HTML file
 * @returns {Promise<Document>} Parsed DOM document
 */
async function loadHtmlFile(filePath) {
  try {
    const html = await fs.readFile(filePath, 'utf-8');
    return parse(html);
  } catch (error) {
    console.error(`❌ Failed to load ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Extract clean text from DOM element, removing scripts, styles, and navigation
 * @param {Element} element - DOM element to extract from
 * @param {number} maxChars - Maximum characters to extract (0 = unlimited)
 * @returns {string} Clean text content
 */
function extractCleanText(element, maxChars = 0) {
  if (!element) return '';

  let text = element.text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return maxChars > 0 ? text.substring(0, maxChars) : text;
}

/**
 * Estimate token count based on character length
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CONFIG.charsPerToken);
}

/**
 * Convert text to URL-safe slug for chunk IDs
 * @param {string} text - Text to slugify
 * @returns {string} Slugified text
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Extract technique number from filename
 * e.g., "10-16-decision-analysis.html" → "10.16"
 * @param {string} filename - Technique HTML filename
 * @returns {string} Technique number like "10.16"
 */
function extractTechniqueNumber(filename) {
  const match = filename.match(/^(\d+)-(\d+)-/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return '';
}

/**
 * Find the H3 subsection header matching a name, starting from a task H2 header.
 * Searches forward through siblings until the next H2 or end of document.
 * @param {Element} taskHeader - The H2 task header element
 * @param {string} subsectionName - Name to match (case-insensitive partial match)
 * @returns {Element|null} The matching H3 element, or null
 */
function findSubsection(taskHeader, subsectionName) {
  let currentElement = taskHeader.nextElementSibling;

  while (currentElement && currentElement.tagName !== 'H2') {
    if (currentElement.tagName === 'H3' &&
        extractCleanText(currentElement).toLowerCase().includes(subsectionName.toLowerCase())) {
      return currentElement;
    }
    currentElement = currentElement.nextElementSibling;
  }

  return null;
}

/**
 * Extract text content from a subsection (H3) — collects all P and list content
 * until the next H3 or H2.
 * @param {Element} taskHeader - The H2 task header element
 * @param {string} subsectionName - Subsection name to find
 * @returns {string} Extracted text content
 */
function extractSubsectionText(taskHeader, subsectionName) {
  const h3 = findSubsection(taskHeader, subsectionName);
  if (!h3) return '';

  let content = '';
  let contentElement = h3.nextElementSibling;

  while (contentElement && !['H2', 'H3'].includes(contentElement.tagName)) {
    if (contentElement.tagName === 'P') {
      content += extractCleanText(contentElement) + '\n\n';
    } else if (contentElement.tagName === 'UL' || contentElement.tagName === 'OL') {
      contentElement.querySelectorAll('li').forEach(li => {
        content += '- ' + extractCleanText(li) + '\n';
      });
      content += '\n';
    }
    contentElement = contentElement.nextElementSibling;
  }

  return content.trim();
}

/**
 * Extract a task reference number from text (e.g., "4.3." from context)
 * @param {string} text - Text to extract from
 * @returns {string|null} Task reference or null
 */
function extractTaskReference(text) {
  const match = text.match(/(\d+\.\d+\.?)/);
  return match ? match[1] : null;
}

// ============================================================================
// TASK CHUNK EXTRACTION (Knowledge Area Chapters 3-8)
// Tasks are H2 sections with id attributes, containing H3 subsections:
//   Purpose, Description, Inputs, Elements (H4s), Guidelines and Tools,
//   Techniques, Stakeholders, Outputs
// ============================================================================

/**
 * Extract task chunks from a Knowledge Area chapter.
 * @param {string} filePath - Path to chapter HTML file
 * @param {number} chapterNum - Chapter number (3-8)
 * @param {string} chapterTitle - Chapter title
 * @returns {Promise<Array>} Array of task chunk objects
 */
async function extractTaskChunks(filePath, chapterNum, chapterTitle) {
  console.log(`📖 Processing Knowledge Area: ${chapterTitle}...`);

  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];

  const chunks = [];

  // Tasks are H2 elements with id attributes inside <main>
  const taskHeaders = doc.querySelectorAll('main > h2');

  taskHeaders.forEach((h2Element) => {
    const taskTitle = extractCleanText(h2Element);
    const taskId = h2Element.id || slugify(taskTitle);

    const chunk = {
      chunk_id: `ch${chapterNum}_${taskId.replace(/-/g, '_')}`,
      chunk_type: 'task',

      identification: {
        chapter_num: chapterNum,
        chapter_title: chapterTitle,
        task_id: taskId,
        task_title: taskTitle,
      },

      // Extract all structured subsections
      purpose: extractSubsectionText(h2Element, 'Purpose'),
      description: extractSubsectionText(h2Element, 'Description'),
      inputs: extractInputsList(h2Element),
      elements: extractElements(h2Element),
      guidelines_and_tools: extractGuidelinesAndTools(h2Element),
      techniques: extractTechniquesListFromTask(h2Element),
      stakeholders: extractStakeholdersList(h2Element),
      outputs: extractOutputsList(h2Element),
      diagram: extractTaskDiagram(h2Element),
    };

    // Cross-reference diagram inputs to populate source_task on inputs
    // The diagram figure contains task numbers (e.g. "3.2. Stakeholder Engagement Approach")
    // that aren't present in the <li> text of the Inputs section.
    if (chunk.diagram && chunk.diagram.inputs) {
      chunk.inputs.forEach(function(input) {
        if (input.source_task) return; // already has a reference
        for (var i = 0; i < chunk.diagram.inputs.length; i++) {
          var diagramInput = chunk.diagram.inputs[i];
          if (diagramInput.indexOf(input.title) !== -1) {
            var ref = extractTaskReference(diagramInput);
            if (ref) {
              input.source_task = ref;
              input.type = 'task';
            }
            break;
          }
        }
      });
    }

    // Calculate metadata
    const fullText = [
      chunk.purpose,
      chunk.description,
      ...chunk.elements.map(e => e.description),
      ...chunk.techniques.map(t => t.description),
      ...chunk.stakeholders.map(s => s.responsibility),
    ].join('\n');

    chunk.metadata = {
      source_file: filePath,
      section_type: 'knowledge_area_task',
      h2_header_id: h2Element.id || '',
      has_diagram: !!chunk.diagram,
      estimated_tokens: estimateTokens(fullText),
    };

    chunks.push(chunk);
  });

  console.log(`✅ Extracted ${chunks.length} tasks from ${chapterTitle}`);
  return chunks;
}

/**
 * Extract Elements (H4 subsections under the "Elements" H3).
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {element_id, title, description}
 */
function extractElements(taskHeader) {
  const elements = [];
  let currentElement = taskHeader.nextElementSibling;
  let inElementsSection = false;
  let elementCounter = 1;

  while (currentElement && currentElement.tagName !== 'H2') {
    // Find "Elements" H3 section
    if (currentElement.tagName === 'H3' &&
        extractCleanText(currentElement).toLowerCase().includes('element')) {
      inElementsSection = true;
      currentElement = currentElement.nextElementSibling;
      continue;
    }

    // Extract H4 elements within Elements section
    if (inElementsSection && currentElement.tagName === 'H4') {
      const elementTitle = extractCleanText(currentElement);

      // Collect content until next H4, H3, or H2
      let description = '';
      let contentElement = currentElement.nextElementSibling;

      while (contentElement && !['H2', 'H3', 'H4'].includes(contentElement.tagName)) {
        if (contentElement.tagName === 'P') {
          description += extractCleanText(contentElement) + '\n';
        } else if (contentElement.tagName === 'UL' || contentElement.tagName === 'OL') {
          contentElement.querySelectorAll('li').forEach(li => {
            description += '- ' + extractCleanText(li) + '\n';
          });
        }
        contentElement = contentElement.nextElementSibling;
      }

      elements.push({
        element_id: `e${elementCounter++}`,
        title: elementTitle,
        description: description.trim(),
      });
    }

    // Exit Elements section when we hit next H3 that isn't "Elements"
    if (inElementsSection && currentElement.tagName === 'H3' &&
        !extractCleanText(currentElement).toLowerCase().includes('element')) {
      break;
    }

    currentElement = currentElement.nextElementSibling;
  }

  return elements;
}

/**
 * Extract Inputs list from the "Inputs" H3 subsection.
 * Format: <li><strong>Title</strong>: description</li>
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {title, description, source_task, type}
 */
function extractInputsList(taskHeader) {
  const inputs = [];
  const inputsH3 = findSubsection(taskHeader, 'Inputs');
  if (!inputsH3) return inputs;

  // Find the <ul> after the Inputs H3
  let ul = inputsH3.nextElementSibling;
  while (ul && ul.tagName !== 'UL' && ul.tagName !== 'H3') {
    ul = ul.nextElementSibling;
  }

  if (ul && ul.tagName === 'UL') {
    ul.querySelectorAll('li').forEach(li => {
      const text = extractCleanText(li);
      const match = text.match(/^([^:]+):\s*(.+)$/);

      if (match) {
        var title = match[1].trim();
        var sourceTask = extractTaskReference(title);
        var type = title.indexOf('(external)') !== -1 ? 'external'
          : sourceTask ? 'task'
          : 'generic';
        inputs.push({
          title: title,
          description: match[2].trim(),
          source_task: sourceTask,
          type: type,
        });
      }
    });
  }

  return inputs;
}

/**
 * Extract Guidelines and Tools list.
 * Format: <li><strong>Title</strong>: description</li>
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {title, description}
 */
function extractGuidelinesAndTools(taskHeader) {
  const items = [];
  const h3 = findSubsection(taskHeader, 'Guidelines and Tools');
  if (!h3) return items;

  let ul = h3.nextElementSibling;
  while (ul && ul.tagName !== 'UL' && ul.tagName !== 'H3') {
    ul = ul.nextElementSibling;
  }

  if (ul && ul.tagName === 'UL') {
    ul.querySelectorAll('li').forEach(li => {
      const text = extractCleanText(li);
      const match = text.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        items.push({
          title: match[1].trim(),
          description: match[2].trim(),
        });
      }
    });
  }

  return items;
}

/**
 * Extract Techniques list from a task section.
 * Format: <li><a>Technique Name</a>: description</li>
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {title, description, reference_chunk_id}
 */
function extractTechniquesListFromTask(taskHeader) {
  const techniques = [];
  const techniquesH3 = findSubsection(taskHeader, 'Techniques');
  if (!techniquesH3) return techniques;

  let ul = techniquesH3.nextElementSibling;
  while (ul && ul.tagName !== 'UL') {
    ul = ul.nextElementSibling;
  }

  if (ul && ul.tagName === 'UL') {
    ul.querySelectorAll('li').forEach(li => {
      const text = extractCleanText(li);
      const link = li.querySelector('a');
      const techniqueName = link ? extractCleanText(link) : '';

      // Description is after the colon
      const match = text.match(/^[^:]+:\s*(.+)$/);
      const description = match ? match[1].trim() : '';

      if (techniqueName) {
        techniques.push({
          title: techniqueName,
          description: description,
          reference_chunk_id: `technique_${slugify(techniqueName)}`,
        });
      }
    });
  }

  return techniques;
}

/**
 * Extract Stakeholders list.
 * Format: <li><strong>Role</strong>: responsibility</li>
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {role, responsibility}
 */
function extractStakeholdersList(taskHeader) {
  const stakeholders = [];
  const h3 = findSubsection(taskHeader, 'Stakeholders');
  if (!h3) return stakeholders;

  let ul = h3.nextElementSibling;
  while (ul && ul.tagName !== 'UL') {
    ul = ul.nextElementSibling;
  }

  if (ul && ul.tagName === 'UL') {
    ul.querySelectorAll('li').forEach(li => {
      const text = extractCleanText(li);
      const match = text.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        stakeholders.push({
          role: match[1].trim(),
          responsibility: match[2].trim(),
        });
      }
    });
  }

  return stakeholders;
}

/**
 * Extract Outputs list.
 * Format: <li><strong>Title</strong>: definition</li>
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Array} Array of {title, definition, output_id, used_by_tasks}
 */
function extractOutputsList(taskHeader) {
  const outputs = [];
  const h3 = findSubsection(taskHeader, 'Outputs');
  if (!h3) return outputs;

  let ul = h3.nextElementSibling;
  while (ul && ul.tagName !== 'UL') {
    ul = ul.nextElementSibling;
  }

  if (ul && ul.tagName === 'UL') {
    ul.querySelectorAll('li').forEach((li, index) => {
      const text = extractCleanText(li);
      const match = text.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        outputs.push({
          title: match[1].trim(),
          definition: match[2].trim(),
          output_id: `${taskHeader.id || 'unknown'}_output${index + 1}`,
          used_by_tasks: [], // Populated in optional post-processing
        });
      }
    });
  } else {
    // Fallback: handle outputs in <p> tags (e.g. single-output tasks)
    let el = h3.nextElementSibling;
    let index = 0;
    while (el && el.tagName === 'P') {
      const text = extractCleanText(el);
      const match = text.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        outputs.push({
          title: match[1].trim(),
          definition: match[2].trim(),
          output_id: `${taskHeader.id || 'unknown'}_output${index + 1}`,
          used_by_tasks: [],
        });
        index++;
      }
      el = el.nextElementSibling;
    }
  }

  return outputs;
}

/**
 * Extract diagram data from a <figure> within a task section.
 * Looks for sections with CSS classes: .input, .guidelines, .outputs, .tasks
 * @param {Element} taskHeader - The H2 task header element
 * @returns {Object|null} Diagram data or null
 */
function extractTaskDiagram(taskHeader) {
  // Look for the task-specific figure (after the Inputs H3)
  const inputsH3 = findSubsection(taskHeader, 'Inputs');
  let currentElement = inputsH3 ? inputsH3.nextElementSibling : taskHeader.nextElementSibling;

  while (currentElement && !['H2', 'H3'].includes(currentElement.tagName)) {
    if (currentElement.tagName === 'FIGURE') {
      const figure = currentElement;

      const diagram = {
        has_diagram: true,
        diagram_type: 'input_output_flow',
        inputs: [],
        guidelines_tools: [],
        outputs: [],
      };

      // Extract inputs (section.input)
      const inputSection = figure.querySelector('section.input');
      if (inputSection) {
        inputSection.querySelectorAll('article').forEach(article => {
          diagram.inputs.push(extractCleanText(article));
        });
      }

      // Extract guidelines (section.guidelines)
      const guidelinesSection = figure.querySelector('section.guidelines');
      if (guidelinesSection) {
        guidelinesSection.querySelectorAll('article').forEach(article => {
          diagram.guidelines_tools.push(extractCleanText(article));
        });
      }

      // Extract outputs (section.outputs)
      const outputsSection = figure.querySelector('section.outputs');
      if (outputsSection) {
        outputsSection.querySelectorAll('article').forEach(article => {
          diagram.outputs.push(extractCleanText(article));
        });
      }

      // Summaries
      diagram.inputs_summary = diagram.inputs.join(', ');
      diagram.guidelines_summary = diagram.guidelines_tools.join(', ');
      diagram.outputs_summary = diagram.outputs.join(', ');

      return diagram;
    }
    currentElement = currentElement.nextElementSibling;
  }

  return null;
}

// ============================================================================
// TECHNIQUE CHUNK EXTRACTION (chapters/techniques/)
// Structure: H2 title → H3 Purpose, Description, Elements (H4s),
//            Usage Considerations (H4 Strengths, H4 Limitations)
// ============================================================================

/**
 * Extract technique chunks from individual technique files.
 * @returns {Promise<Array>} Array of technique chunk objects
 */
async function extractTechniqueChunks() {
  console.log(`🔧 Processing Techniques...`);

  const chunks = [];

  try {
    const files = await fs.readdir(CONFIG.techniquesDir);
    const htmlFiles = files.filter(f => f.endsWith('.html'));

    for (const filename of htmlFiles) {
      const filePath = path.join(CONFIG.techniquesDir, filename);
      const doc = await loadHtmlFile(filePath);
      if (!doc) continue;

      // Technique heading is H2 in actual BABOK structure
      const mainHeading = doc.querySelector('main > h2');
      const techniqueTitle = mainHeading ? extractCleanText(mainHeading) : '';
      const techniqueNum = extractTechniqueNumber(filename);

      const chunk = {
        chunk_id: `technique_${filename.replace(/\.html$/, '')}`,
        chunk_type: 'technique',

        identification: {
          technique_file: filename,
          technique_num: techniqueNum,
          technique_title: techniqueTitle,
        },

        purpose: mainHeading ? extractTechniqueSubsection(mainHeading, 'Purpose') : '',
        description: mainHeading ? extractTechniqueSubsection(mainHeading, 'Description') : '',
        elements: mainHeading ? extractTechniqueElements(mainHeading) : [],
        usage_considerations: mainHeading ? extractUsageConsiderations(mainHeading) : { strengths: [], limitations: [] },

        metadata: {
          source_file: path.join(CONFIG.techniquesDir, filename),
          section_type: 'technique_reference',
          h2_header_text: techniqueTitle,
          has_elements: false,
          has_usage_considerations: false,
          estimated_tokens: 0,
        },
      };

      chunk.metadata.has_elements = chunk.elements.length > 0;
      chunk.metadata.has_usage_considerations =
        chunk.usage_considerations.strengths.length > 0 ||
        chunk.usage_considerations.limitations.length > 0;

      // Calculate tokens
      const fullText = [
        chunk.purpose,
        chunk.description,
        ...chunk.elements.map(e => e.description),
        ...chunk.usage_considerations.strengths,
        ...chunk.usage_considerations.limitations,
      ].join('\n');

      chunk.metadata.estimated_tokens = estimateTokens(fullText);

      chunks.push(chunk);
    }

    console.log(`✅ Extracted ${chunks.length} techniques`);
  } catch (error) {
    console.error(`❌ Error processing techniques:`, error.message);
  }

  return chunks;
}

/**
 * Extract a subsection's text from a technique (H3 level under the H2 heading).
 * Collects paragraphs and lists until the next H3 or H2.
 * @param {Element} techniqueHeader - The H2 technique header element
 * @param {string} subsectionName - Subsection name to find
 * @returns {string} Extracted text content
 */
function extractTechniqueSubsection(techniqueHeader, subsectionName) {
  let currentElement = techniqueHeader.nextElementSibling;

  while (currentElement) {
    if (currentElement.tagName === 'H3' &&
        extractCleanText(currentElement).toLowerCase().includes(subsectionName.toLowerCase())) {

      let content = '';
      let contentElement = currentElement.nextElementSibling;

      while (contentElement && !['H2', 'H3'].includes(contentElement.tagName)) {
        if (contentElement.tagName === 'P') {
          content += extractCleanText(contentElement) + '\n\n';
        } else if (contentElement.tagName === 'UL' || contentElement.tagName === 'OL') {
          contentElement.querySelectorAll('li').forEach(li => {
            content += '- ' + extractCleanText(li) + '\n';
          });
          content += '\n';
        }
        contentElement = contentElement.nextElementSibling;
      }

      return content.trim();
    }
    currentElement = currentElement.nextElementSibling;
  }

  return '';
}

/**
 * Extract technique elements (H4 subsections under the "Elements" H3).
 * @param {Element} techniqueHeader - The H2 technique header element
 * @returns {Array} Array of {element_id, title, description}
 */
function extractTechniqueElements(techniqueHeader) {
  const elements = [];
  let currentElement = techniqueHeader.nextElementSibling;
  let inElementsSection = false;
  let elementCounter = 1;

  while (currentElement) {
    // Find "Elements" H3 section
    if (currentElement.tagName === 'H3' &&
        extractCleanText(currentElement).toLowerCase().includes('element')) {
      inElementsSection = true;
      currentElement = currentElement.nextElementSibling;
      continue;
    }

    // Extract H4 elements within Elements section
    if (inElementsSection && currentElement.tagName === 'H4') {
      const elementTitle = extractCleanText(currentElement);

      // Collect content until next H4, H3, or H2
      let description = '';
      let contentElement = currentElement.nextElementSibling;

      while (contentElement && !['H2', 'H3', 'H4'].includes(contentElement.tagName)) {
        if (contentElement.tagName === 'P') {
          description += extractCleanText(contentElement) + '\n';
        } else if (contentElement.tagName === 'UL' || contentElement.tagName === 'OL') {
          contentElement.querySelectorAll('li').forEach(li => {
            description += '- ' + extractCleanText(li) + '\n';
          });
        } else if (contentElement.tagName === 'TABLE') {
          const caption = contentElement.querySelector('caption');
          description += '[Table: ' + extractCleanText(caption) + ']\n';
        }
        contentElement = contentElement.nextElementSibling;
      }

      elements.push({
        element_id: `e${elementCounter++}`,
        title: elementTitle,
        description: description.trim(),
      });
    }

    // Exit Elements section when we hit next H3 that isn't "Elements"
    if (inElementsSection && currentElement.tagName === 'H3' &&
        !extractCleanText(currentElement).toLowerCase().includes('element')) {
      break;
    }

    // Exit if we hit H2
    if (currentElement.tagName === 'H2') break;

    currentElement = currentElement.nextElementSibling;
  }

  return elements;
}

/**
 * Extract Usage Considerations (strengths and limitations) from a technique.
 * Structure: H3 "Usage Considerations" → H4 "Strengths" → <ul>, H4 "Limitations" → <ul>
 * @param {Element} techniqueHeader - The H2 technique header element
 * @returns {Object} {strengths: string[], limitations: string[]}
 */
function extractUsageConsiderations(techniqueHeader) {
  const usageConsiderations = {
    strengths: [],
    limitations: [],
  };

  let currentElement = techniqueHeader.nextElementSibling;
  let inUsageSection = false;
  let currentSubsection = null;

  while (currentElement) {
    // Find "Usage Considerations" H3 section
    if (currentElement.tagName === 'H3' &&
        extractCleanText(currentElement).toLowerCase().includes('usage')) {
      inUsageSection = true;
      currentElement = currentElement.nextElementSibling;
      continue;
    }

    // Within Usage Considerations, find H4 subsections
    if (inUsageSection && currentElement.tagName === 'H4') {
      const subsectionTitle = extractCleanText(currentElement).toLowerCase();
      if (subsectionTitle.includes('strength')) {
        currentSubsection = 'strengths';
      } else if (subsectionTitle.includes('limitation')) {
        currentSubsection = 'limitations';
      }
      currentElement = currentElement.nextElementSibling;
      continue;
    }

    // Extract list items under current subsection
    if (inUsageSection && currentSubsection &&
        (currentElement.tagName === 'UL' || currentElement.tagName === 'OL')) {
      currentElement.querySelectorAll('li').forEach(li => {
        usageConsiderations[currentSubsection].push(extractCleanText(li));
      });
    }

    // Exit when we hit next H2 or H3 outside usage section
    if (currentElement.tagName === 'H2') break;
    if (inUsageSection && currentElement.tagName === 'H3' &&
        !extractCleanText(currentElement).toLowerCase().includes('usage')) break;

    currentElement = currentElement.nextElementSibling;
  }

  return usageConsiderations;
}

// ============================================================================
// KEY CONCEPTS CHUNK EXTRACTION (Chapter 2)
// Produces 5 distinct chunk types:
//   1. BACCM Core Concept Model (1 chunk)
//   2. Key Terms (8 chunks)
//   3. Requirements Classification Schema (1 chunk)
//   4. Stakeholder Roles (11 chunks)
//   5. Requirements and Designs (1 chunk)
// ============================================================================

/**
 * Main extraction function for Chapter 2
 * @param {string} filePath - Path to key concepts HTML file
 * @returns {Promise<Array>} Array of concept chunk objects
 */
async function extractKeyConceptsChunks(filePath) {
  console.log(`📘 Processing Business Analysis Key Concepts...`);

  const chunks = [];

  // 1. BACCM (1 chunk)
  const baccmChunk = await extractBACCMChunk(filePath);
  if (baccmChunk) chunks.push(baccmChunk);

  // 2. Key Terms (8 chunks)
  const keyTermChunks = await extractKeyTermChunks(filePath);
  chunks.push(...keyTermChunks);

  // 3. Requirements Classification Schema (1 chunk)
  const classificationChunk = await extractRequirementsClassificationChunk(filePath);
  if (classificationChunk) chunks.push(classificationChunk);

  // 4. Stakeholder Roles (11 chunks)
  const stakeholderChunks = await extractStakeholderRoleChunks(filePath);
  chunks.push(...stakeholderChunks);

  // 5. Requirements and Designs (1 chunk)
  const reqDesChunk = await extractRequirementsDesignsChunk(filePath);
  if (reqDesChunk) chunks.push(reqDesChunk);

  console.log(`✅ Extracted ${chunks.length} key concept chunks (expected: 1 BACCM + 8 terms + 1 schema + 11 roles + 1 explanation = 22)`);
  return chunks;
}

/**
 * Extract BACCM™ Core Concept Model as a single comprehensive chunk.
 * Structure: H2 → intro paragraphs → "can be used to:" UL → Table (6 concepts) → evaluation UL
 */
async function extractBACCMChunk(filePath) {
  const doc = await loadHtmlFile(filePath);
  if (!doc) return null;

  const baccmHeader = doc.querySelector('h2#the-business-analysis-core-concept-model');
  if (!baccmHeader) return null;

  const chunk = {
    chunk_id: 'baccm_core_model',
    chunk_type: 'conceptual_framework',
    title: extractCleanText(baccmHeader),
    core_concepts: [],
    how_to_use: [],
    evaluation_questions: [],
  };

  // Extract description from paragraphs before first list
  let currentElement = baccmHeader.nextElementSibling;
  const descriptionParagraphs = [];

  while (currentElement && currentElement.tagName === 'P') {
    descriptionParagraphs.push(extractCleanText(currentElement));
    currentElement = currentElement.nextElementSibling;
  }

  chunk.description = descriptionParagraphs.join(' ');

  // Find "can be used to:" list
  if (currentElement && currentElement.tagName === 'UL') {
    currentElement.querySelectorAll('li').forEach(li => {
      chunk.how_to_use.push(
        extractCleanText(li).replace(/,$/, '').replace(/,?\s*and\s*$/, '').trim()
      );
    });
    currentElement = currentElement.nextElementSibling;
  }

  // Find table with 6 core concepts
  while (currentElement && currentElement.tagName !== 'TABLE') {
    currentElement = currentElement.nextElementSibling;
  }

  if (currentElement && currentElement.tagName === 'TABLE') {
    const rows = currentElement.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const name = extractCleanText(cells[0]);
        const paragraphs = cells[1].querySelectorAll('p');

        const definition = paragraphs.length > 0 ? extractCleanText(paragraphs[0]) : '';
        let description = '';

        for (let i = 1; i < paragraphs.length; i++) {
          description += extractCleanText(paragraphs[i]) + ' ';
        }

        chunk.core_concepts.push({
          name: name,
          definition: definition,
          description: description.trim(),
        });
      }
    });
    currentElement = currentElement.nextElementSibling;
  }

  // Find evaluation questions list (after a paragraph about using concepts)
  while (currentElement && currentElement.tagName !== 'UL') {
    currentElement = currentElement.nextElementSibling;
  }

  if (currentElement && currentElement.tagName === 'UL') {
    currentElement.querySelectorAll('li').forEach(li => {
      const text = extractCleanText(li).replace(/\?$/, '').trim() + '?';
      chunk.evaluation_questions.push(text);
    });
  }

  chunk.metadata = {
    source_file: filePath,
    section_type: 'conceptual_framework',
    section_id: 'the-business-analysis-core-concept-model',
    has_table: true,
    has_diagram: true,
    estimated_tokens: estimateTokens(JSON.stringify(chunk)),
  };

  return chunk;
}

/**
 * Extract Key Terms as individual chunks (8 terms).
 * Structure: H2#key-terms → <strong>Term</strong> → <p> definition paragraphs
 */
async function extractKeyTermChunks(filePath) {
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];

  const keyTermsHeader = doc.querySelector('h2#key-terms');
  if (!keyTermsHeader) return [];

  const chunks = [];
  let currentElement = keyTermsHeader.nextElementSibling;

  while (currentElement && currentElement.tagName !== 'H2') {
    // <strong> tags at top level mark term names
    if (currentElement.tagName === 'STRONG') {
      const term = extractCleanText(currentElement);
      let definition = '';

      let nextElement = currentElement.nextElementSibling;

      // Collect all following <p> tags until next <strong> or <h2>
      while (nextElement &&
             nextElement.tagName !== 'STRONG' &&
             nextElement.tagName !== 'H2') {
        if (nextElement.tagName === 'P') {
          definition += extractCleanText(nextElement) + '\n\n';
        }
        nextElement = nextElement.nextElementSibling;
      }

      if (term && definition.trim()) {
        chunks.push({
          chunk_id: `keyterm_${slugify(term)}`,
          chunk_type: 'key_term',
          term: term,
          definition: definition.trim(),
          metadata: {
            source_file: filePath,
            section_type: 'key_term',
            parent_section: 'key-terms',
            estimated_tokens: estimateTokens(definition),
          },
        });
      }

      currentElement = nextElement;
    } else {
      currentElement = currentElement.nextElementSibling;
    }
  }

  return chunks;
}

/**
 * Extract Requirements Classification Schema as a single chunk.
 * Structure: H2 → description <p> → <ul> with nested <ul> for sub-types
 */
async function extractRequirementsClassificationChunk(filePath) {
  const doc = await loadHtmlFile(filePath);
  if (!doc) return null;

  const schemaHeader = doc.querySelector('h2#requirements-classification-schema');
  if (!schemaHeader) return null;

  const chunk = {
    chunk_id: 'requirements_classification_schema',
    chunk_type: 'classification_schema',
    title: extractCleanText(schemaHeader),
    requirement_types: [],
  };

  // Extract description paragraph
  let currentElement = schemaHeader.nextElementSibling;
  if (currentElement && currentElement.tagName === 'P') {
    chunk.description = extractCleanText(currentElement);
    currentElement = currentElement.nextElementSibling;
  }

  // Find the main UL
  while (currentElement && currentElement.tagName !== 'UL') {
    currentElement = currentElement.nextElementSibling;
  }

  if (currentElement && currentElement.tagName === 'UL') {
    // Process children — may include <li> and sibling <ul> (HTML quirk)
    const children = currentElement.childNodes.filter(function(n) { return n.nodeType === 1; });

    for (const child of children) {
      if (child.tagName === 'LI') {
        const fullText = extractCleanText(child);
        const strongTag = child.querySelector('strong');
        const typeName = strongTag ? extractCleanText(strongTag) : '';

        const match = fullText.match(/:\s*(.+?)(?:\s*$)/s);
        let definition = match ? match[1].trim() : '';

        // Remove nested list text from definition
        const nestedUL = child.querySelector('ul');
        if (nestedUL) {
          const nestedText = extractCleanText(nestedUL);
          definition = definition.replace(nestedText, '').trim();
        }

        const reqType = {
          type_name: typeName,
          definition: definition,
          sub_types: [],
        };

        // Check for nested <ul> (sub-types like Functional / Non-Functional)
        if (nestedUL) {
          nestedUL.childNodes.filter(function(n) { return n.tagName === 'LI'; }).forEach(subLi => {
            const subText = extractCleanText(subLi);
            const subStrongTag = subLi.querySelector('strong');
            const subTypeName = subStrongTag ? extractCleanText(subStrongTag) : '';
            const subMatch = subText.match(/:\s*(.+)$/);
            const subDefinition = subMatch ? subMatch[1].trim() : '';

            reqType.sub_types.push({
              type_name: subTypeName,
              definition: subDefinition,
            });
          });
        }

        chunk.requirement_types.push(reqType);
      } else if (child.tagName === 'UL') {
        // Handle sibling <ul> (nested list rendered as sibling in the HTML)
        const lastType = chunk.requirement_types[chunk.requirement_types.length - 1];
        if (lastType) {
          child.childNodes.filter(function(n) { return n.tagName === 'LI'; }).forEach(subLi => {
            const subText = extractCleanText(subLi);
            const subStrongTag = subLi.querySelector('strong');
            const subTypeName = subStrongTag ? extractCleanText(subStrongTag) : '';
            const subMatch = subText.match(/:\s*(.+)$/);
            const subDefinition = subMatch ? subMatch[1].trim() : '';

            lastType.sub_types.push({
              type_name: subTypeName,
              definition: subDefinition,
            });
          });
        }
      }
    }
  }

  chunk.metadata = {
    source_file: filePath,
    section_type: 'classification_schema',
    section_id: 'requirements-classification-schema',
    estimated_tokens: estimateTokens(JSON.stringify(chunk)),
  };

  return chunk;
}

/**
 * Extract Stakeholder Roles as individual chunks (11 roles).
 * Structure: H2#stakeholders → intro paragraphs → <ul.two-column-list> → H3 per role
 */
async function extractStakeholderRoleChunks(filePath) {
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];

  const stakeholdersHeader = doc.querySelector('h2#stakeholders');
  if (!stakeholdersHeader) return [];

  const chunks = [];
  let currentElement = stakeholdersHeader.nextElementSibling;

  // Skip introduction paragraphs and ul.two-column-list
  while (currentElement && currentElement.tagName !== 'H3') {
    currentElement = currentElement.nextElementSibling;
  }

  // Extract each H3 stakeholder role
  while (currentElement && currentElement.tagName === 'H3') {
    const roleName = extractCleanText(currentElement);
    let definition = '';
    let alternateRoles = [];

    // Collect following paragraphs
    let nextElement = currentElement.nextElementSibling;

    while (nextElement && nextElement.tagName === 'P') {
      const text = extractCleanText(nextElement);
      definition += text + '\n\n';

      // Check for "Alternate roles" text
      if (text.toLowerCase().includes('alternate role')) {
        const match = text.match(/Alternate roles? (?:are|is):?\s*(.+?)\.?$/i);
        if (match) {
          alternateRoles = match[1]
            .split(/,?\s*and\s*|,\s*/)
            .map(r => r.replace(/\.$/, '').trim())
            .filter(Boolean);
        }
      }

      nextElement = nextElement.nextElementSibling;
    }

    const chunk = {
      chunk_id: `stakeholder_${slugify(roleName)}`,
      chunk_type: 'stakeholder_role',
      role_name: roleName,
      definition: definition.trim(),
      metadata: {
        source_file: filePath,
        section_type: 'stakeholder_role',
        parent_section: 'stakeholders',
        estimated_tokens: estimateTokens(definition),
      },
    };

    if (alternateRoles.length > 0) {
      chunk.alternate_roles = alternateRoles;
    }

    chunks.push(chunk);
    currentElement = nextElement;
  }

  return chunks;
}

/**
 * Extract Requirements and Designs concept as a single chunk.
 * Structure: H2 → paragraphs (key principle) → Table 2.5.1 (examples)
 */
async function extractRequirementsDesignsChunk(filePath) {
  const doc = await loadHtmlFile(filePath);
  if (!doc) return null;

  const reqDesHeader = doc.querySelector('h2#requirements-and-designs');
  if (!reqDesHeader) return null;

  const chunk = {
    chunk_id: 'requirements_and_designs_distinction',
    chunk_type: 'conceptual_explanation',
    title: extractCleanText(reqDesHeader),
    examples: [],
  };

  let explanation = '';
  let currentElement = reqDesHeader.nextElementSibling;

  while (currentElement && !['H2', 'TABLE'].includes(currentElement.tagName)) {
    if (currentElement.tagName === 'P') {
      const text = extractCleanText(currentElement);

      // Detect key principle sentence
      if (text.includes('focused on the need') && text.includes('focused on the solution')) {
        chunk.key_principle = text.split('.')[0] + '.';
      }

      explanation += text + '\n\n';
    }
    currentElement = currentElement.nextElementSibling;
  }

  chunk.explanation = explanation.trim();

  // Extract examples from Table 2.5.1
  if (currentElement && currentElement.tagName === 'TABLE') {
    const rows = currentElement.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        chunk.examples.push({
          requirement: extractCleanText(cells[0]),
          design: extractCleanText(cells[1]),
        });
      }
    });
  }

  chunk.metadata = {
    source_file: filePath,
    section_type: 'conceptual_explanation',
    section_id: 'requirements-and-designs',
    has_table: chunk.examples.length > 0,
    has_diagram: true,
    estimated_tokens: estimateTokens(JSON.stringify(chunk)),
  };

  return chunk;
}

// ============================================================================
// GLOSSARY CHUNK EXTRACTION
// Structure: multiple <ul> blocks in <main>, each <li> has:
//   <strong>term</strong>: definition text
// Handles: cross-references ("See <term>"), related terms ("See also"),
//   aliases ("Also known as"), missing colon separators
// ============================================================================

/**
 * Extract glossary terms as individual chunks.
 * @param {string} filePath - Path to glossary HTML file
 * @returns {Promise<Array>} Array of glossary chunk objects
 */
async function extractGlossaryChunks(filePath) {
  console.log(`📚 Processing Glossary...`);

  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];

  const main = doc.querySelector('main');
  if (!main) return [];

  const chunks = [];

  // IMPORTANT: Query ALL <ul> sections (glossary has multiple <ul> blocks by letter)
  const allListItems = main.querySelectorAll('ul > li');

  allListItems.forEach(li => {
    const strongTag = li.querySelector('strong');
    if (!strongTag) return;

    const term = extractCleanText(strongTag);
    const fullText = extractCleanText(li);

    // Extract definition — handle missing colon separator
    const colonMatch = fullText.match(/^[^:]+:\s*(.+)$/s);
    let definitionText = colonMatch ? colonMatch[1].trim() : '';

    // If no colon found, definition starts right after the term
    if (!definitionText) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      definitionText = fullText.replace(new RegExp(`^${escapedTerm}\\s*`), '').trim();
    }

    if (!definitionText || definitionText.length < 3) return;

    const chunk = {
      chunk_id: `glossary_${slugify(term)}`,
      chunk_type: 'glossary_term',
      term: term,
      definition: definitionText,
    };

    // Check for cross-references ("See <term>" redirects)
    const crossRef = extractCrossReference(li, definitionText);
    if (crossRef) {
      chunk.cross_reference = crossRef;
    }

    // Check for related terms ("See also <term>")
    const relatedTerms = extractRelatedTerms(li, definitionText);
    if (relatedTerms.length > 0) {
      chunk.related_terms = relatedTerms;
    }

    // Check for aliases ("Also known as <alias>")
    const aliases = extractAliases(definitionText);
    if (aliases.length > 0) {
      chunk.aliases = aliases;
    }

    chunk.metadata = {
      source_file: filePath,
      section_type: 'glossary_term',
      is_redirect: !!crossRef && crossRef.type === 'redirect',
      estimated_tokens: estimateTokens(definitionText),
    };

    chunks.push(chunk);
  });

  console.log(`✅ Extracted ${chunks.length} glossary terms`);
  return chunks;
}

/**
 * Extract cross-reference from a glossary entry.
 * Pattern: "See <term>." (redirect) — note: <a> href attributes are empty
 */
function extractCrossReference(liElement, definitionText) {
  // Pattern: "See <term>" redirect (entire definition is just a redirect)
  const seeMatch = definitionText.match(/^See\s+(.+?)\.?$/i);
  if (seeMatch) {
    // Don't match "See also" patterns
    if (definitionText.match(/^See also/i)) return null;

    // Extract from <a> anchor text (href attributes are empty)
    const links = liElement.querySelectorAll('a');
    if (links.length > 0) {
      const seeTerm = extractCleanText(links[0]);
      if (seeTerm) {
        return {
          type: 'redirect',
          see_term: seeTerm,
          see_chunk_id: `glossary_${slugify(seeTerm)}`,
        };
      }
    }

    // Fallback: extract from regex match
    const seeTerm = seeMatch[1].replace(/<[^>]+>/g, '').trim();
    if (seeTerm) {
      return {
        type: 'redirect',
        see_term: seeTerm,
        see_chunk_id: `glossary_${slugify(seeTerm)}`,
      };
    }
  }

  return null;
}

/**
 * Extract related terms ("See also <term>, <term>" pattern)
 */
function extractRelatedTerms(liElement, definitionText) {
  const relatedTerms = [];

  // Look for "See also" embedded in or appended to definition
  const seeAlsoMatch = definitionText.match(/\.?\s*See also\s+(.+?)\.?$/i);
  if (seeAlsoMatch) {
    const links = liElement.querySelectorAll('a');
    links.forEach(link => {
      const linkedTerm = extractCleanText(link);
      if (linkedTerm) {
        relatedTerms.push({
          term: linkedTerm,
          chunk_id: `glossary_${slugify(linkedTerm)}`,
        });
      }
    });
  }

  return relatedTerms;
}

/**
 * Extract aliases ("Also known as <alias>" or "Alternate roles are <alias>")
 */
function extractAliases(definitionText) {
  const aliases = [];

  // Pattern 1: "Also known as <alias>"
  const alsoKnownMatch = definitionText.match(/Also known as:?\s+(.+?)\.?$/i);
  if (alsoKnownMatch) {
    const aliasText = alsoKnownMatch[1];
    const parts = aliasText.split(/,\s*|\s+and\s+|\s+or\s+/);
    parts.forEach(part => {
      const cleaned = part.trim().replace(/\.$/, '');
      if (cleaned) aliases.push(cleaned);
    });
  }

  // Pattern 2: "Alternate roles are <alias>"
  const alternateMatch = definitionText.match(/Alternate (?:roles?|names?) (?:are|is):?\s+(.+?)\.?$/i);
  if (alternateMatch) {
    const aliasText = alternateMatch[1];
    const parts = aliasText.split(/,\s*|\s+and\s+/);
    parts.forEach(part => {
      const cleaned = part.trim().replace(/\.$/, '');
      if (cleaned) aliases.push(cleaned);
    });
  }

  return aliases;
}

/**
 * Validate glossary cross-reference links (post-processing).
 * Returns array of broken links.
 */
function validateGlossaryLinks(chunks) {
  const chunkIds = new Set(chunks.map(c => c.chunk_id));
  const brokenLinks = [];

  chunks.forEach(chunk => {
    if (chunk.cross_reference && !chunkIds.has(chunk.cross_reference.see_chunk_id)) {
      brokenLinks.push({ term: chunk.term, broken_link: chunk.cross_reference.see_term });
    }
    if (chunk.related_terms) {
      chunk.related_terms.forEach(rt => {
        if (!chunkIds.has(rt.chunk_id)) {
          brokenLinks.push({ term: chunk.term, broken_link: rt.term });
        }
      });
    }
  });

  return brokenLinks;
}

// ============================================================================
// PERSPECTIVES CHUNK EXTRACTION (Chapter 11)
// Each perspective file produces:
//   - Section chunks (one per H3 section: Change Scope, BA Scope, etc.)
//   - Table chunks (approaches/techniques tables)
//   - Impact on Knowledge Areas chunks (one per H4 within Impact section)
// ============================================================================

/**
 * Extract perspective chunks from all 5 perspective files.
 * @returns {Promise<Array>} Array of perspective chunk objects
 */
async function extractPerspectiveChunks() {
  console.log(`📊 Processing Business Analysis Perspectives...`);

  const chunks = [];

  for (const meta of CONFIG.perspectives) {
    const doc = await loadHtmlFile(meta.path);
    if (!doc) continue;

    // Find all H3 sections
    const h3Sections = doc.querySelectorAll('h3');

    h3Sections.forEach(h3 => {
      const sectionTitle = extractCleanText(h3);

      // "Impact on Knowledge Areas" gets special treatment
      if (sectionTitle.toLowerCase().includes('impact')) {
        const impactChunks = extractPerspectiveKnowledgeAreaImpact(h3, meta);
        if (impactChunks) chunks.push(...impactChunks);
      } else {
        // Regular section (Change Scope, BA Scope, Approaches, etc.)
        const sectionChunk = extractPerspectiveSection(h3, meta);
        if (sectionChunk) chunks.push(sectionChunk);
      }
    });

    // Extract tables (approaches/methodologies/techniques)
    const tables = doc.querySelectorAll('table');
    tables.forEach(table => {
      const tableChunk = extractPerspectiveTable(table, meta);
      if (tableChunk) chunks.push(tableChunk);
    });
  }

  console.log(`✅ Extracted ${chunks.length} perspective chunks`);
  return chunks;
}

/**
 * Extract a perspective section (H3 with H4 subsections).
 */
function extractPerspectiveSection(h3Element, meta) {
  const sectionTitle = extractCleanText(h3Element);
  const sectionId = slugify(sectionTitle);

  const chunk = {
    chunk_id: `perspective_${meta.shortCode}_${sectionId}`,
    chunk_type: 'perspective_section',
    perspective: meta.name,
    perspective_num: meta.num,
    section: sectionTitle,
    section_id: sectionId,

    content: {
      overview: '',
      subsections: [],
    },

    metadata: {
      source_file: meta.path,
      section_type: 'perspective_section',
      perspective_type: meta.type,
      subsection_count: 0,
      has_lists: false,
      estimated_tokens: 0,
    },
  };

  // Extract overview (text before first H4)
  let currentElement = h3Element.nextElementSibling;
  while (currentElement &&
         !['H4', 'H3', 'H2'].includes(currentElement.tagName)) {
    if (currentElement.tagName === 'P') {
      chunk.content.overview += extractCleanText(currentElement) + '\n\n';
    }
    currentElement = currentElement.nextElementSibling;
  }
  chunk.content.overview = chunk.content.overview.trim();

  // Extract all H4 subsections within this H3
  while (currentElement &&
         currentElement.tagName !== 'H3' &&
         currentElement.tagName !== 'H2') {

    if (currentElement.tagName === 'H4') {
      const subsectionTitle = extractCleanText(currentElement);
      let description = '';
      const items = [];

      // Collect content until next H4, H3, or H2
      let nextElement = currentElement.nextElementSibling;

      while (nextElement &&
             !['H2', 'H3', 'H4'].includes(nextElement.tagName)) {
        if (nextElement.tagName === 'P') {
          description += extractCleanText(nextElement) + '\n\n';
        } else if (nextElement.tagName === 'UL' || nextElement.tagName === 'OL') {
          nextElement.querySelectorAll('li').forEach(li => {
            items.push(extractCleanText(li));
          });
          chunk.metadata.has_lists = true;
        }
        nextElement = nextElement.nextElementSibling;
      }

      const subsection = {
        title: subsectionTitle,
        description: description.trim(),
      };
      if (items.length > 0) subsection.items = items;

      chunk.content.subsections.push(subsection);
      currentElement = nextElement;
    } else {
      currentElement = currentElement.nextElementSibling;
    }
  }

  chunk.metadata.subsection_count = chunk.content.subsections.length;
  chunk.metadata.estimated_tokens = estimateTokens(JSON.stringify(chunk.content));

  return chunk;
}

/**
 * Extract perspective table (approaches/methodologies/techniques).
 */
function extractPerspectiveTable(tableElement, meta) {
  const caption = tableElement.querySelector('caption');
  const captionText = caption ? extractCleanText(caption).toLowerCase() : '';

  // Check technique before approach — "Techniques used within Agile Approaches"
  // should be classified as techniques, not approaches
  let tableType = 'table';
  if (captionText.includes('technique')) tableType = 'techniques';
  else if (captionText.includes('approach')) tableType = 'approaches';
  else if (captionText.includes('methodolog')) tableType = 'methodologies';
  else if (captionText.includes('reference')) tableType = 'reference_models';

  // Extract table number from caption (e.g., "Table 11.3.1" → "1") to disambiguate
  const tableNumMatch = captionText.match(/table\s+[\d.]+\.(\d+)/);
  const tableSuffix = tableNumMatch ? `_t${tableNumMatch[1]}` : '';

  const chunk = {
    chunk_id: `perspective_${meta.shortCode}_${tableType}${tableSuffix}`,
    chunk_type: 'perspective_table',
    perspective: meta.name,
    perspective_num: meta.num,
    table_type: tableType,
    table_title: caption ? extractCleanText(caption) : tableType,
    [tableType]: [],

    metadata: {
      source_file: meta.path,
      section_type: 'perspective_table',
      perspective_type: meta.type,
      table_type: tableType,
      count: 0,
      estimated_tokens: 0,
    },
  };

  const rows = tableElement.querySelectorAll('tbody tr');

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;

    const name = extractCleanText(cells[0]);
    const description = extractCleanText(cells[1]);

    const abbrTag = cells[0].querySelector('abbr');
    const abbr = abbrTag ? extractCleanText(abbrTag) : null;

    const item = {
      name: name,
      description: description.trim(),
    };
    if (abbr) item.abbr = abbr;

    chunk[tableType].push(item);
  });

  chunk.metadata.count = chunk[tableType].length;
  chunk.metadata.estimated_tokens = estimateTokens(JSON.stringify(chunk[tableType]));

  // Skip empty tables
  if (chunk[tableType].length === 0) return null;

  return chunk;
}

/**
 * Extract "Impact on Knowledge Areas" as individual chunks per knowledge area.
 * Each H4 becomes a separate chunk with context, description, and technique lists.
 */
function extractPerspectiveKnowledgeAreaImpact(h3Element, meta) {
  const chunks = [];
  let currentElement = h3Element.nextElementSibling;

  while (currentElement &&
         currentElement.tagName !== 'H3' &&
         currentElement.tagName !== 'H2') {

    if (currentElement.tagName === 'H4') {
      const kaTitle = extractCleanText(currentElement);
      let context = '';
      let description = '';
      const baBokTechniques = [];
      const extensionTechniques = [];

      let nextElement = currentElement.nextElementSibling;
      let inBaBokSection = false;
      let inExtensionSection = false;

      while (nextElement &&
             nextElement.tagName !== 'H4' &&
             nextElement.tagName !== 'H3' &&
             nextElement.tagName !== 'H2') {
        const text = extractCleanText(nextElement);

        // Detect H5 section headers for technique categories
        if (nextElement.tagName === 'H5') {
          const h5Text = text.toLowerCase();
          inBaBokSection = h5Text.includes('babok');
          inExtensionSection = h5Text.includes('extension');
          nextElement = nextElement.nextElementSibling;
          continue;
        }

        // Collect paragraphs (before technique lists)
        if (nextElement.tagName === 'P' && !inBaBokSection && !inExtensionSection) {
          if (!context) context = text;
          else description += text + '\n\n';
        }

        // Extract technique lists
        if (nextElement.tagName === 'UL') {
          nextElement.querySelectorAll('li').forEach(li => {
            const technique = extractCleanText(li);
            if (inExtensionSection) extensionTechniques.push(technique);
            else baBokTechniques.push(technique);
          });
        }

        nextElement = nextElement.nextElementSibling;
      }

      const impactChunk = {
        chunk_id: `perspective_${meta.shortCode}_impact_${slugify(kaTitle)}`,
        chunk_type: 'perspective_impact',
        perspective: meta.name,
        perspective_num: meta.num,
        knowledge_area: kaTitle,
        knowledge_area_id: slugify(kaTitle),
        context: context.trim(),
        description: description.trim(),
        techniques: {
          babok_guide: baBokTechniques,
        },
        metadata: {
          source_file: meta.path,
          section_type: 'perspective_impact',
          perspective_type: meta.type,
          has_babok_techniques: baBokTechniques.length > 0,
          has_extension_techniques: extensionTechniques.length > 0,
          estimated_tokens: estimateTokens(context + description),
        },
      };

      if (extensionTechniques.length > 0) {
        impactChunk.techniques.extension = extensionTechniques;
      }

      chunks.push(impactChunk);
      currentElement = nextElement;
    } else {
      currentElement = currentElement.nextElementSibling;
    }
  }

  return chunks.length > 0 ? chunks : null;
}

// ============================================================================
// MAIN EXECUTION - Orchestrates chunk extraction and output
// ============================================================================

/**
 * Main function: orchestrates all extraction and writes JSONL output.
 *
 * Process:
 * 1. Task chunks from Knowledge Area chapters (3-8)
 * 2. Technique chunks from chapters/techniques/
 * 3. Key Concepts chunks (BACCM, Key Terms, Classification, Stakeholders, Req/Design)
 * 4. Glossary term chunks
 * 5. Perspective chunks (sections, tables, impact)
 * 6. Write JSONL output
 */
async function main() {
  console.log('🚀 Starting BABOK Chunk Extraction...\n');

  const allChunks = [];
  let processedFiles = 0;

  try {
    // Step 1: Knowledge Area chapters (3-8)
    console.log('📂 Processing Knowledge Areas (Chapters 3-8)...\n');
    for (const chapter of CONFIG.chapters) {
      const chunks = await extractTaskChunks(chapter.path, chapter.num, chapter.title);
      allChunks.push(...chunks);
      processedFiles += 1;
    }

    // Step 2: Techniques (auto-discovered from chapters/techniques/)
    const techniqueChunks = await extractTechniqueChunks();
    allChunks.push(...techniqueChunks);
    processedFiles += 1;

    // Step 3: Key Concepts (Chapter 2 — 5 distinct extraction strategies)
    const conceptChunks = await extractKeyConceptsChunks(CONFIG.conceptsFile);
    allChunks.push(...conceptChunks);
    processedFiles += 1;

    // Step 4: Glossary (individual term chunks with cross-references)
    const glossaryChunks = await extractGlossaryChunks(CONFIG.glossaryFile);
    allChunks.push(...glossaryChunks);
    processedFiles += 1;

    // Validate glossary cross-references
    const brokenLinks = validateGlossaryLinks(glossaryChunks);
    if (brokenLinks.length > 0) {
      console.warn(`\n⚠️  ${brokenLinks.length} broken glossary cross-references:`);
      brokenLinks.slice(0, 10).forEach(bl => {
        console.warn(`   "${bl.term}" → "${bl.broken_link}"`);
      });
      if (brokenLinks.length > 10) {
        console.warn(`   ... and ${brokenLinks.length - 10} more`);
      }
    }

    // Step 5: Perspectives (5 files, each with sections + tables + impact)
    const perspectiveChunks = await extractPerspectiveChunks();
    allChunks.push(...perspectiveChunks);
    processedFiles += CONFIG.perspectives.length;

    // Step 6: Write JSONL output
    console.log(`\n📝 Writing ${allChunks.length} chunks to ${CONFIG.outputFile}...`);

    const jsonlOutput = allChunks
      .map(chunk => JSON.stringify(chunk))
      .join('\n');

    await fs.writeFile(CONFIG.outputFile, jsonlOutput, 'utf-8');

    // Step 7: Print summary statistics
    console.log(`\n✅ SUCCESS! Extraction Complete\n`);
    console.log(`📊 Summary Statistics:`);
    console.log(`   Total Chunks Generated: ${allChunks.length}`);
    console.log(`   Files Processed: ${processedFiles}`);
    console.log(`   Output File: ${CONFIG.outputFile}`);

    // Breakdown by type
    const byType = {};
    allChunks.forEach(chunk => {
      byType[chunk.chunk_type] = (byType[chunk.chunk_type] || 0) + 1;
    });

    console.log(`\n   Breakdown by Type:`);
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     • ${type}: ${count}`);
    });

    // Token statistics
    const totalTokens = allChunks.reduce((sum, c) => sum + ((c.metadata && c.metadata.estimated_tokens) || 0), 0);
    const avgTokens = allChunks.length > 0 ? Math.round(totalTokens / allChunks.length) : 0;
    console.log(`\n   Average Chunk Size: ${avgTokens} tokens`);
    console.log(`   Total Estimated Tokens: ${totalTokens.toLocaleString()}`);

    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Review ${CONFIG.outputFile} for quality`);
    console.log(`   2. Upload to vector database (Pinecone, Chroma, Weaviate)`);
    console.log(`      Pinecone index dimension depends on your embedding model:`);
    console.log(`        • all-MiniLM-L6-v2 (README example): dimension=384`);
    console.log(`        • text-embedding-3-small (OpenAI):    dimension=1536`);
    console.log(`        • text-embedding-3-large (OpenAI):    dimension=3072`);
    console.log(`   3. Test RAG retrieval with sample queries`);
    console.log(`   4. Adjust chunking strategy if needed\n`);

  } catch (error) {
    console.error(`\n❌ Fatal Error:`, error);
    process.exit(1);
  }
}

// Run the script
main();
