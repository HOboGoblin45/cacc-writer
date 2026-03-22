/**
 * server/data/zoningAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Zoning classification and land use analysis.
 *
 * Appraisers must report zoning on every form. This module:
 *   - Classifies zoning codes into standard categories
 *   - Determines if current use is legal conforming/nonconforming
 *   - Analyzes highest & best use implications
 *   - Identifies zoning change risks
 *   - Generates zoning narrative for the report
 */

import log from '../logger.js';

const ZONING_CATEGORIES = {
  'R-1': { type: 'Residential', density: 'Single Family', description: 'Single-family residential' },
  'R-2': { type: 'Residential', density: 'Two Family', description: 'Two-family/duplex residential' },
  'R-3': { type: 'Residential', density: 'Multi Family', description: 'Multi-family residential' },
  'R-4': { type: 'Residential', density: 'High Density', description: 'High-density residential' },
  'R-A': { type: 'Residential', density: 'Agricultural', description: 'Residential-agricultural' },
  'R-E': { type: 'Residential', density: 'Estate', description: 'Residential estate (large lots)' },
  'C-1': { type: 'Commercial', density: 'Neighborhood', description: 'Neighborhood commercial' },
  'C-2': { type: 'Commercial', density: 'General', description: 'General commercial' },
  'C-3': { type: 'Commercial', density: 'Heavy', description: 'Heavy commercial' },
  'M-1': { type: 'Industrial', density: 'Light', description: 'Light industrial/manufacturing' },
  'M-2': { type: 'Industrial', density: 'Heavy', description: 'Heavy industrial' },
  'PUD': { type: 'Planned', density: 'Varies', description: 'Planned Unit Development' },
  'MH': { type: 'Residential', density: 'Mobile Home', description: 'Mobile/manufactured home' },
  'AG': { type: 'Agricultural', density: 'Farm', description: 'Agricultural/farming' },
};

/**
 * Analyze zoning for a property.
 */
export function analyzeZoning({ zoningCode, propertyType, currentUse, lotSize, improvements }) {
  const code = (zoningCode || 'R-1').toUpperCase().replace(/\s+/g, '-');

  // Match to known category or infer
  let category = ZONING_CATEGORIES[code];
  if (!category) {
    // Try partial match
    const prefix = code.replace(/[^A-Z]/g, '');
    if (prefix.startsWith('R')) category = { type: 'Residential', density: 'General', description: `Residential (${code})` };
    else if (prefix.startsWith('C')) category = { type: 'Commercial', density: 'General', description: `Commercial (${code})` };
    else if (prefix.startsWith('M') || prefix.startsWith('I')) category = { type: 'Industrial', density: 'General', description: `Industrial (${code})` };
    else category = { type: 'Unknown', density: 'Unknown', description: `Zoning: ${code}` };
  }

  // Legal conforming analysis
  const currentUseType = (currentUse || propertyType || 'single family').toLowerCase();
  const isResidentialUse = currentUseType.includes('single') || currentUseType.includes('family') || currentUseType.includes('residential');
  const isResidentialZone = category.type === 'Residential';
  const isLegalConforming = isResidentialUse === isResidentialZone || category.type === 'Planned';

  // HBU implications
  let hbuAnalysis;
  if (!isLegalConforming) {
    hbuAnalysis = 'Current use may be legal nonconforming (grandfathered). This can affect value and marketability. Verify with local zoning authority.';
  } else if (category.type === 'Residential' && category.density === 'Single Family') {
    hbuAnalysis = 'Zoning supports current single-family residential use. This is the highest and best use of the site as improved.';
  } else {
    hbuAnalysis = `Zoning allows ${category.description}. Current use appears consistent with zoning regulations.`;
  }

  return {
    zoningCode: code,
    category: category.type,
    density: category.density,
    description: category.description,
    legalConforming: isLegalConforming,
    legalStatus: isLegalConforming ? 'Legal Conforming' : 'Legal Nonconforming (Grandfathered)',
    hbuAnalysis,
    narrativeText: `The subject property is zoned ${code} (${category.description}) by the local municipality. The current use as a ${currentUse || 'single-family residence'} is a ${isLegalConforming ? 'legal conforming' : 'legal nonconforming'} use under the current zoning classification. ${isLegalConforming ? 'No zoning issues were noted.' : 'As a legal nonconforming use, the property may have restrictions on expansion or reconstruction. This has been considered in the valuation.'}`,
    uadFormat: {
      zoningClassification: code,
      zoningDescription: category.description,
      zoningCompliance: isLegalConforming ? 'Legal' : 'Legal Nonconforming (Grandfathered)',
      isHighestAndBestUse: isLegalConforming ? 'Yes' : 'Yes, as improved (see comments)',
    },
  };
}

export { ZONING_CATEGORIES };
export default { analyzeZoning, ZONING_CATEGORIES };
