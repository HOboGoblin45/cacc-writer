/**
 * server/training/aciExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ACI Appraisal Data Extractor & Training Pipeline.
 *
 * Extracts data from Charles's completed appraisals in two formats:
 *   1. MISMO XML files (exported from ACI) — full structured data
 *   2. ACI .aci files (RAPID binary) — field names extractable
 *   3. PDF reports — OCR fallback
 *
 * Training output formats:
 *   - JSONL for OpenAI fine-tuning
 *   - Ollama Modelfile for local model training
 *   - Voice profile corpus (all narratives by section type)
 *   - Adjustment value database (historical paired data)
 *   - Comp selection patterns (which comps were chosen and why)
 */

import fs from 'fs';
import path from 'path';
import log from '../logger.js';

/**
 * Scan a directory recursively for appraisal files.
 */
export function scanAppraisalDirectory(dirPath) {
  const results = { aci: [], xml: [], pdf: [], total: 0, directories: 0 };

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.directories++;
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.aci') results.aci.push(fullPath);
        else if (ext === '.xml') results.xml.push(fullPath);
        else if (ext === '.pdf') results.pdf.push(fullPath);
        results.total++;
      }
    }
  }

  walk(dirPath);
  return results;
}

/**
 * Parse a MISMO XML file and extract all appraisal data.
 */
export function parseMismoXml(xmlPath) {
  const content = fs.readFileSync(xmlPath, 'utf-8');

  const extracted = {
    filePath: xmlPath,
    fileName: path.basename(xmlPath),
    formType: null,
    fileId: null,
    signedDate: null,
    purpose: null,

    // Narratives (the gold for training)
    narratives: {},
    addendumText: null,

    // Structured data
    subject: {},
    comps: [],
    adjustments: [],

    // Metadata
    extractedAt: new Date().toISOString(),
  };

  // Extract REPORT attributes
  const reportMatch = content.match(/<REPORT\s([^>]+)>/);
  if (reportMatch) {
    const attrs = reportMatch[1];
    extracted.formType = attrs.match(/AppraisalFormType="([^"]+)"/)?.[1];
    extracted.fileId = attrs.match(/AppraiserFileIdentifier="([^"]+)"/)?.[1];
    extracted.signedDate = attrs.match(/AppraiserReportSignedDate="([^"]+)"/)?.[1];
    extracted.purpose = attrs.match(/AppraisalPurposeType="([^"]+)"/)?.[1];
  }

  // Extract addendum text (contains ALL narratives in ACI format)
  const addendumMatch = content.match(/AppraisalAddendumText="([^"]*?)"/s);
  if (addendumMatch) {
    extracted.addendumText = addendumMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Parse section markers: -:SECTION NAME:-
    const sectionPattern = /-:([A-Z\s]+?):-\s*([\s\S]*?)(?=-:[A-Z]|$)/g;
    let match;
    while ((match = sectionPattern.exec(extracted.addendumText)) !== null) {
      const sectionName = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      const sectionText = match[2].trim();
      if (sectionText.length > 10) {
        extracted.narratives[sectionName] = sectionText;
      }
    }
  }

  // Extract PROPERTY data (addresses, values)
  const propMatches = content.match(/<PROPERTY[^>]*>/g) || [];
  for (const pm of propMatches) {
    if (pm.includes('_StreetAddress')) {
      const addr = pm.match(/_StreetAddress="([^"]+)"/)?.[1];
      const city = pm.match(/_City="([^"]+)"/)?.[1];
      const state = pm.match(/_State="([^"]+)"/)?.[1];
      const zip = pm.match(/_PostalCode="([^"]+)"/)?.[1];
      if (addr && !extracted.subject.address) {
        extracted.subject = { address: addr, city, state, zip };
      }
    }
  }

  // Extract APPRAISED_VALUE
  const valueMatch = content.match(/PropertyAppraisedValueAmount="([^"]+)"/);
  if (valueMatch) extracted.subject.appraisedValue = parseInt(valueMatch[1]);

  // Extract GLA, year built, etc.
  const glaMatch = content.match(/GrossLivingArea(?:Amount)?\s*=\s*"(\d+)"/i) || content.match(/LivingAreaTotalSquareFeet(?:Count)?\s*=\s*"(\d+)"/i);
  if (glaMatch) extracted.subject.gla = parseInt(glaMatch[1]);

  const yrMatch = content.match(/PropertyStructureBuiltYear="(\d+)"/);
  if (yrMatch) extracted.subject.yearBuilt = parseInt(yrMatch[1]);

  return extracted;
}

/**
 * Extract readable field names and values from an ACI binary file.
 * ACI uses a proprietary RAPID format. We extract what we can.
 */
export function parseAciBinary(aciPath) {
  const data = fs.readFileSync(aciPath);
  const ascii = data.toString('ascii');

  // Extract all readable strings of 5+ chars
  const strings = [];
  const regex = /[\x20-\x7E]{5,}/g;
  let match;
  while ((match = regex.exec(ascii)) !== null) {
    strings.push({ offset: match.index, value: match[0] });
  }

  // Identify field names (ACI convention: UPPER_CASE_WITH_DOTS)
  const fieldNames = strings.filter(s =>
    /^[A-Z_]{3,}(\.[0-9]+)?$/.test(s.value) ||
    s.value.startsWith('GS_') ||
    s.value.startsWith('COMP_') ||
    s.value.startsWith('APPR_') ||
    s.value.startsWith('DIML_') ||
    s.value.startsWith('UNPARSED_')
  ).map(s => s.value);

  // Identify the form type
  const formType = strings.find(s => s.value.match(/1004|1025|2055|1073|1075/))?.value;

  return {
    filePath: aciPath,
    fileName: path.basename(aciPath),
    fileSize: data.length,
    formType: formType || 'unknown',
    fieldNames: [...new Set(fieldNames)],
    fieldCount: new Set(fieldNames).size,
    hasSketch: strings.some(s => s.value.includes('SKETCH')),
    hasPhotos: strings.some(s => s.value.includes('PHOTO') || s.value.includes('IMAGE')),
  };
}

/**
 * Build training datasets from extracted appraisals.
 */
export function buildTrainingData(extractions, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. JSONL for OpenAI fine-tuning
  const jsonlLines = [];

  // 2. Voice corpus by section type
  const voiceCorpus = {};

  // 3. Adjustment patterns
  const adjustmentData = [];

  for (const ext of extractions) {
    if (!ext.narratives || Object.keys(ext.narratives).length === 0) continue;

    // Build training pairs for each narrative section
    for (const [section, text] of Object.entries(ext.narratives)) {
      // Add to voice corpus
      if (!voiceCorpus[section]) voiceCorpus[section] = [];
      voiceCorpus[section].push({
        text,
        formType: ext.formType,
        fileId: ext.fileId,
        date: ext.signedDate,
      });

      // Build fine-tuning example
      const systemMsg = `You are an expert real estate appraiser writing the ${section.replace(/_/g, ' ')} section of a ${ext.formType || '1004'} appraisal report. Write in a professional, concise style consistent with USPAP standards.`;

      const userMsg = buildPromptForSection(section, ext);
      if (userMsg) {
        jsonlLines.push(JSON.stringify({
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg },
            { role: 'assistant', content: text },
          ],
        }));
      }
    }
  }

  // Write JSONL
  const jsonlPath = path.join(outputDir, 'training_data.jsonl');
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

  // Write voice corpus
  for (const [section, entries] of Object.entries(voiceCorpus)) {
    const corpusPath = path.join(outputDir, `voice_corpus_${section}.json`);
    fs.writeFileSync(corpusPath, JSON.stringify(entries, null, 2));
  }

  // Write Ollama Modelfile
  const modelfilePath = path.join(outputDir, 'Modelfile');
  const sampleNarratives = Object.entries(voiceCorpus)
    .flatMap(([section, entries]) => entries.slice(0, 3).map(e => `[${section}]\n${e.text}`))
    .slice(0, 20)
    .join('\n\n---\n\n');

  fs.writeFileSync(modelfilePath, `FROM llama3.2
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER num_ctx 8192

SYSTEM """You are an expert residential real estate appraiser writing narrative sections for appraisal reports. You write in the exact style of Charles Cresci of Cresci Appraisal & Consulting Company (CACC).

Your writing style characteristics:
- Professional but accessible
- Data-driven with specific references
- USPAP compliant
- Concise — every sentence adds value
- Uses standard appraisal terminology
- References specific comparables by number
- Includes market conditions context

Here are examples of your writing style:

${sampleNarratives}
"""
`);

  // Summary
  const summary = {
    totalExtractions: extractions.length,
    withNarratives: extractions.filter(e => Object.keys(e.narratives || {}).length > 0).length,
    totalTrainingExamples: jsonlLines.length,
    sectionCounts: Object.fromEntries(Object.entries(voiceCorpus).map(([k, v]) => [k, v.length])),
    outputFiles: {
      jsonl: jsonlPath,
      modelfile: modelfilePath,
      voiceCorpus: Object.keys(voiceCorpus).map(s => `voice_corpus_${s}.json`),
    },
  };

  const summaryPath = path.join(outputDir, 'training_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  return summary;
}

function buildPromptForSection(section, ext) {
  const subject = ext.subject || {};
  const base = `Property: ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}
Form type: ${ext.formType || '1004'}
GLA: ${subject.gla || 'N/A'} SF
Year built: ${subject.yearBuilt || 'N/A'}
Value: $${subject.appraisedValue?.toLocaleString() || 'N/A'}
Purpose: ${ext.purpose || 'Purchase'}`;

  switch (section) {
    case 'neighborhood_market_conditions':
    case 'market_conditions':
      return `Write the neighborhood/market conditions narrative for this appraisal.\n\n${base}`;
    case 'highest_and_best_use':
      return `Write the highest and best use analysis.\n\n${base}`;
    case 'comments_on_sales_comparison':
    case 'sales_comparison':
      return `Write the sales comparison commentary.\n\n${base}`;
    case 'condition_of_the_property':
    case 'condition':
      return `Write the condition of the property narrative.\n\n${base}`;
    case 'site_comments':
    case 'site':
      return `Write the site comments narrative.\n\n${base}`;
    case 'additional_features':
      return `Write the additional features narrative.\n\n${base}`;
    case 'legal_description':
      return `Write the legal description section.\n\n${base}`;
    case 'conditions_of_appraisal':
      return `Write the conditions of appraisal section.\n\n${base}`;
    default:
      return `Write the ${section.replace(/_/g, ' ')} section.\n\n${base}`;
  }
}

/**
 * Run the full extraction pipeline on a directory.
 */
export function runExtractionPipeline(sourceDir, outputDir) {
  log.info('training:scan', { sourceDir });

  // Scan for files
  const scan = scanAppraisalDirectory(sourceDir);
  log.info('training:found', { aci: scan.aci.length, xml: scan.xml.length, pdf: scan.pdf.length });

  const extractions = [];
  const errors = [];

  // Parse XML files first (richest data)
  for (const xmlPath of scan.xml) {
    try {
      const data = parseMismoXml(xmlPath);
      extractions.push(data);
    } catch (err) {
      errors.push({ file: xmlPath, error: err.message });
    }
  }

  // Parse ACI files for metadata (field names, form types)
  const aciMeta = [];
  for (const aciPath of scan.aci) {
    try {
      const data = parseAciBinary(aciPath);
      aciMeta.push(data);
    } catch (err) {
      errors.push({ file: aciPath, error: err.message });
    }
  }

  // Build training data
  const summary = buildTrainingData(extractions, outputDir);

  const result = {
    scan: {
      aciFiles: scan.aci.length,
      xmlFiles: scan.xml.length,
      pdfFiles: scan.pdf.length,
      totalFiles: scan.total,
      directories: scan.directories,
    },
    extraction: {
      xmlParsed: extractions.length,
      aciParsed: aciMeta.length,
      errors: errors.length,
    },
    training: summary,
    errors: errors.slice(0, 20), // First 20 errors
  };

  // Save full results
  fs.writeFileSync(path.join(outputDir, 'pipeline_results.json'), JSON.stringify(result, null, 2));

  log.info('training:complete', { examples: summary.totalTrainingExamples, sections: Object.keys(summary.sectionCounts).length });

  return result;
}

export default { scanAppraisalDirectory, parseMismoXml, parseAciBinary, buildTrainingData, runExtractionPipeline };
