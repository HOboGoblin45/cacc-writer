/**
 * run_training_pipeline.mjs
 * One-shot: run the full ACI training pipeline against converted XMLs.
 * Usage: node run_training_pipeline.mjs
 */

import { runExtractionPipeline } from './server/training/aciExtractor.js';
import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'C:\\Users\\ccres\\OneDrive\\Desktop\\cacc-writer\\training_output\\xml_exports';
const OUTPUT_DIR = 'C:\\Users\\ccres\\OneDrive\\Desktop\\cacc-writer\\training_output';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('=== CACC Appraisal Training Pipeline ===');
console.log(`Source: ${SOURCE_DIR}`);
console.log(`Output: ${OUTPUT_DIR}`);
console.log('');

try {
  const result = runExtractionPipeline(SOURCE_DIR, OUTPUT_DIR);

  console.log('\n=== RESULTS ===');
  console.log(`Files scanned: ${result.scan.totalFiles}`);
  console.log(`XML parsed: ${result.extraction.xmlParsed}`);
  console.log(`Errors: ${result.extraction.errors}`);
  console.log('');
  console.log('Training summary:');
  console.log(JSON.stringify(result.training, null, 2));

  if (result.errors?.length) {
    console.log('\nFirst errors:');
    result.errors.slice(0, 5).forEach(e => console.log(`  ${path.basename(e.file)}: ${e.error}`));
  }

  console.log('\n✅ Done! Check training_output/ for:');
  console.log('  - training_data.jsonl (OpenAI fine-tune format)');
  console.log('  - Modelfile (for: ollama create cacc-appraiser -f training_output/Modelfile)');
  console.log('  - voice_corpus.json (narrative text by section)');
  console.log('  - pipeline_results.json (full stats)');
} catch (err) {
  console.error('Pipeline failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
