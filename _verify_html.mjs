import { readFileSync } from 'fs';

const h = readFileSync('index.html', 'utf8');
const lines = h.split('\n');

// Find the generate tab section
const tabStart = lines.findIndex(l => l.includes('id="tab-generate"'));
console.log('=== #tab-generate starts at line', tabStart + 1);
console.log('--- First 80 lines of Generate tab ---');
console.log(lines.slice(tabStart, tabStart + 80).join('\n'));

// Check CSS tokens block
const tokenStart = lines.findIndex(l => l.includes('--gen-bg'));
console.log('\n=== --gen-* tokens at line', tokenStart + 1);
console.log(lines.slice(tokenStart, tokenStart + 25).join('\n'));

// Check command strip
const stripLine = lines.findIndex(l => l.includes('gen-strip'));
console.log('\n=== gen-strip at line', stripLine + 1, ':', lines[stripLine].trim());

// Check inspector
const inspLine = lines.findIndex(l => l.includes('gen-inspector'));
console.log('=== gen-inspector at line', inspLine + 1, ':', lines[inspLine].trim());

// Check workspace
const wsLine = lines.findIndex(l => l.includes('gen-workspace'));
console.log('=== gen-workspace at line', wsLine + 1, ':', lines[wsLine].trim());

// Verify key inspector IDs exist
const inspIds = ['inspStatus','inspElapsed','inspCompleted','inspRetries',
                 'inspNarratives','inspPhrases','inspVoice','inspCache',
                 'inspWarningsBody','inspSelected','inspProfile','inspDuration','inspOutput'];
console.log('\n=== Inspector element IDs:');
inspIds.forEach(id => {
  const found = h.includes(`id="${id}"`);
  console.log((found ? 'OK  ' : 'FAIL') + ' #' + id);
});

// Verify existing critical IDs still present
const existingIds = ['fullDraftPanel','compCommentaryPanel','fdElapsed','fdProgressFill',
                     'fdProgressLabel','genFullDraftBtn','fieldList','concSalePrice',
                     'genStatus','fdStatus'];
console.log('\n=== Existing critical IDs:');
existingIds.forEach(id => {
  const found = h.includes(`id="${id}"`);
  console.log((found ? 'OK  ' : 'FAIL') + ' #' + id);
});

console.log('\n=== Total lines in index.html:', lines.length);
