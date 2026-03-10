import { readFileSync } from 'fs';
const h = readFileSync('index.html', 'utf8');

// Style block 2 is at chars 64459–104612
const css = h.slice(64459, 104612);

// Check all gen CSS rules
const rules = [
  '.gen-layout',
  '.gen-workspace',
  '.gen-inspector',
  '.gen-insp-card',
  '.gen-insp-head',
  '.gen-insp-body',
  '.gen-insp-row',
  '.gen-insp-label',
  '.gen-insp-value',
  '.gen-panel',
  '.gen-panel-head',
  '.gen-panel-title',
  '.gen-btn-primary',
  '--gen-bg',
  '--gen-fg',
  '--gen-border',
  '--gen-strip-h',
  '--gen-font-body',
  '--gen-font-mono',
  '--gen-font-display',
  'gen-insp-w',
];

console.log('=== CSS Rules in Style Block 2 ===');
let ok = 0, miss = 0;
rules.forEach(r => {
  const found = css.includes(r);
  if (found) ok++; else miss++;
  console.log((found ? 'OK  ' : 'MISS') + '  ' + r);
});
console.log('\n' + ok + ' / ' + (ok + miss) + ' CSS rules found');

// Show the :root gen tokens block
const rootIdx = css.lastIndexOf(':root');
if (rootIdx > -1) {
  const rootEnd = css.indexOf('}', rootIdx);
  console.log('\n--- :root gen tokens ---');
  console.log(css.slice(rootIdx, rootEnd + 1));
}

// Show .gen-layout rule
const layoutIdx = css.indexOf('.gen-layout');
if (layoutIdx > -1) {
  console.log('\n--- .gen-layout rule ---');
  console.log(css.slice(layoutIdx, layoutIdx + 300));
}

// Show .gen-inspector rule
const inspIdx = css.indexOf('.gen-inspector');
if (inspIdx > -1) {
  console.log('\n--- .gen-inspector rule ---');
  console.log(css.slice(inspIdx, inspIdx + 300));
}
