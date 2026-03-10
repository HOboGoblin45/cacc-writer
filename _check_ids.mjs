import { readFileSync } from 'fs';
const h = readFileSync('index.html', 'utf8');

const genStart = h.indexOf('id="tab-generate"');
const genSection = h.slice(genStart, genStart + 20000);

const ids = Array.from(genSection.matchAll(/id="([^"]+)"/g)).map(m => m[1]);
console.log('IDs in #tab-generate section:');
ids.forEach(id => console.log('  ' + id));

const tokenMatches = Array.from(h.matchAll(/--gen-insp[^:;\s\)"]*/g)).map(m => m[0]);
const unique = Array.from(new Set(tokenMatches));
console.log('\nInspector token variants found: ' + (unique.join(', ') || 'none'));

// Also check what the section progress and editor panels are actually called
const panelChecks = ['sectionProgress', 'sectionEditor', 'fdProgress', 'fdSection', 'genProgress', 'genSection'];
console.log('\nPanel ID fragments present:');
panelChecks.forEach(k => {
  const found = h.includes(k);
  console.log('  ' + (found ? 'YES' : 'NO ') + '  ' + k);
});
