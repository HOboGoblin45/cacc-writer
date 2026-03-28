import { buildPromptMessages } from './server/promptBuilder.js';

const facts = {
  neighborhood: {
    NORTH_BOUNDARY: { value: 'Vernon Ave', confidence: 'high' },
    SOUTH_BOUNDARY: { value: 'Emerson St', confidence: 'high' },
    EAST_BOUNDARY:  { value: 'Airport Rd', confidence: 'high' },
    WEST_BOUNDARY:  { value: 'Hershey Rd', confidence: 'high' },
    city: { value: 'Normal', confidence: 'high' }
  }
};

const fakeLocationContext = 'MANDATORY: "The subject neighborhood is bordered to the North by [INSERT north road], to the South by [INSERT south road], to the East by [INSERT east road], and to the West by [INSERT west road]."';

const msgs = buildPromptMessages({
  formType: '1004',
  fieldId: 'neighborhood_description',
  facts,
  locationContext: fakeLocationContext,
});

const allText = msgs.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
console.log('Has [INSERT north road]:', allText.includes('[INSERT north road]'));
console.log('Has Vernon Ave:', allText.includes('Vernon Ave'));
console.log('Has [INSERT NORTH_BOUNDARY]:', allText.includes('[INSERT NORTH_BOUNDARY]'));

// Find where NORTH_BOUNDARY appears in facts block
const factsIdx = allText.indexOf('NORTH_BOUNDARY');
if (factsIdx >= 0) {
  console.log('NORTH_BOUNDARY in prompt:', allText.substring(factsIdx - 5, factsIdx + 60));
}
