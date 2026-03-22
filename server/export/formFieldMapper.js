/**
 * server/export/formFieldMapper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps internal case data to specific appraisal form fields.
 *
 * Supports all major URAR/appraisal forms:
 *   - Form 1004 (URAR — Single Family)
 *   - Form 1004C (Manufactured Home)
 *   - Form 1025 (Small Income 2-4 Unit)
 *   - Form 2055 (Exterior Only)
 *   - Form 1073 (Condo Interior)
 *   - Form 1075 (Condo Exterior)
 *   - Form 1007 (Rent Schedule)
 *   - Form 216 (Operating Income Statement)
 *   - Form 1004MC (Market Conditions Addendum)
 *
 * Each form has specific field mappings from our database
 * to the exact PDF field names used in the industry-standard forms.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

const FORM_DEFINITIONS = {
  '1004': {
    name: 'Uniform Residential Appraisal Report (URAR)',
    sections: ['subject', 'contract', 'neighborhood', 'site', 'improvements', 'sales_comparison', 'reconciliation', 'cost_approach'],
    fieldCount: 425,
  },
  '1004C': {
    name: 'Manufactured Home Appraisal Report',
    sections: ['subject', 'contract', 'neighborhood', 'site', 'manufactured_home', 'sales_comparison', 'reconciliation'],
    fieldCount: 380,
  },
  '1025': {
    name: 'Small Residential Income Property (2-4 Units)',
    sections: ['subject', 'contract', 'neighborhood', 'site', 'improvements', 'income_approach', 'sales_comparison', 'reconciliation'],
    fieldCount: 460,
  },
  '2055': {
    name: 'Exterior-Only Inspection Residential',
    sections: ['subject', 'contract', 'neighborhood', 'site', 'improvements_exterior', 'sales_comparison', 'reconciliation'],
    fieldCount: 320,
  },
  '1073': {
    name: 'Individual Condominium Unit Appraisal',
    sections: ['subject', 'contract', 'neighborhood', 'site', 'condo_project', 'improvements', 'sales_comparison', 'reconciliation'],
    fieldCount: 440,
  },
  '1075': {
    name: 'Exterior-Only Condo Appraisal',
    sections: ['subject', 'contract', 'neighborhood', 'condo_project', 'improvements_exterior', 'sales_comparison', 'reconciliation'],
    fieldCount: 340,
  },
  '1007': {
    name: 'Single Family Comparable Rent Schedule',
    sections: ['subject_rental', 'comparable_rentals', 'market_rent'],
    fieldCount: 85,
  },
  '216': {
    name: 'Operating Income Statement',
    sections: ['income', 'expenses', 'net_income'],
    fieldCount: 60,
  },
  '1004MC': {
    name: 'Market Conditions Addendum',
    sections: ['inventory', 'sales_trends', 'median_price', 'absorption_rate'],
    fieldCount: 45,
  },
};

/**
 * Map case data to form fields for a specific form type.
 */
export function mapToFormFields(caseId, formType = '1004') {
  const db = getDb();
  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  const form = FORM_DEFINITIONS[formType];
  if (!form) throw new Error(`Unknown form type. Supported: ${Object.keys(FORM_DEFINITIONS).join(', ')}`);

  // Base field mapping (common to all forms)
  const fields = {
    // Subject Section
    'Property_Address': caseData.property_address || '',
    'City': caseData.city || caseData.property_city || '',
    'State': caseData.state || caseData.property_state || '',
    'Zip_Code': caseData.zip || caseData.property_zip || '',
    'County': caseData.county || '',
    'Legal_Description': caseData.legal_description || '',
    'Assessor_Parcel': caseData.parcel_number || caseData.apn || '',
    'Tax_Year': caseData.tax_year || new Date().getFullYear().toString(),
    'RE_Taxes': caseData.annual_taxes || '',
    'Census_Tract': caseData.census_tract || '',
    'Map_Reference': caseData.map_reference || '',
    'Special_Assessments': caseData.special_assessments || '',
    'Borrower': caseData.borrower_name || '',
    'Owner_of_Public_Record': caseData.owner_name || '',
    'Occupant': caseData.occupant || caseData.occupancy_type || 'Owner',

    // Contract Section
    'Sale_Price': caseData.contract_price || caseData.sale_price || '',
    'Date_of_Sale': caseData.contract_date || '',
    'Property_Rights_Appraised': caseData.property_rights || 'Fee Simple',

    // Site
    'Site_Area': caseData.lot_size || '',
    'Zoning_Classification': caseData.zoning || '',
    'Zoning_Description': caseData.zoning_description || '',
    'Highest_Best_Use': caseData.hbu || 'Present use',
    'Utilities_Electric': caseData.electric || 'Public',
    'Utilities_Gas': caseData.gas || 'Public',
    'Utilities_Water': caseData.water || 'Public',
    'Utilities_Sewer': caseData.sewer || 'Public',
    'Topography': caseData.topography || 'Level',
    'Shape': caseData.lot_shape || 'Rectangular',
    'View': caseData.view || 'Residential',
    'Flood_Zone': caseData.flood_zone || 'X',
    'FEMA_Map': caseData.fema_map || '',

    // Improvements
    'Year_Built': caseData.year_built || '',
    'Effective_Age': caseData.effective_age || '',
    'Design_Style': caseData.design_style || caseData.style || '',
    'Foundation_Type': caseData.foundation || '',
    'Exterior_Walls': caseData.exterior_walls || '',
    'Roof_Surface': caseData.roof_surface || '',
    'Basement_Area': caseData.basement_area || '',
    'Basement_Finished': caseData.basement_finished || '',
    'Heating_Type': caseData.heating || '',
    'Cooling_Type': caseData.cooling || '',
    'Above_Grade_Room_Count': caseData.total_rooms || '',
    'Above_Grade_Bedroom_Count': caseData.bedrooms || '',
    'Above_Grade_Bath_Count': caseData.bathrooms || '',
    'GLA': caseData.gla || caseData.living_area || '',
    'Condition': caseData.condition_rating || '',
    'Quality': caseData.quality_rating || '',
    'Garage_Type': caseData.garage_type || '',
    'Garage_Spaces': caseData.garage_spaces || '',

    // Valuation
    'Indicated_Value_Sales_Comparison': caseData.opinion_value || caseData.estimated_value || '',
    'Indicated_Value_Cost': caseData.cost_value || '',
    'Indicated_Value_Income': caseData.income_value || '',
    'Final_Reconciled_Value': caseData.opinion_value || caseData.estimated_value || '',
    'Effective_Date': caseData.effective_date || caseData.inspection_date || '',
    'Appraiser_Name': caseData.appraiser_name || '',
    'License_Number': caseData.license_number || '',
    'License_State': caseData.license_state || '',
  };

  // Get report sections for narrative fields
  let sections = [];
  try { sections = db.prepare("SELECT section_type, content FROM report_sections WHERE case_id = ? AND status = 'approved'").all(caseId); } catch { /* ok */ }

  const sectionMap = {};
  for (const s of sections) sectionMap[s.section_type] = s.content;

  fields['Neighborhood_Comments'] = sectionMap['neighborhood'] || '';
  fields['Site_Comments'] = sectionMap['site'] || '';
  fields['Improvements_Comments'] = sectionMap['improvements'] || '';
  fields['Sales_Comparison_Comments'] = sectionMap['sales_comparison'] || sectionMap['comp_analysis'] || '';
  fields['Reconciliation_Comments'] = sectionMap['reconciliation'] || '';
  fields['Cost_Approach_Comments'] = sectionMap['cost_approach'] || '';

  // Comps
  let comps = [];
  try { comps = db.prepare('SELECT * FROM comparables WHERE case_id = ? LIMIT 6').all(caseId); } catch { /* ok */ }

  comps.forEach((comp, i) => {
    const n = i + 1;
    fields[`Comp${n}_Address`] = comp.address || '';
    fields[`Comp${n}_Sale_Price`] = comp.sold_price || comp.sale_price || '';
    fields[`Comp${n}_Sale_Date`] = comp.sold_date || comp.sale_date || '';
    fields[`Comp${n}_GLA`] = comp.gla || '';
    fields[`Comp${n}_Year_Built`] = comp.year_built || '';
    fields[`Comp${n}_Bedrooms`] = comp.bedrooms || '';
    fields[`Comp${n}_Bathrooms`] = comp.bathrooms || '';
    fields[`Comp${n}_Lot_Size`] = comp.lot_size || '';
    fields[`Comp${n}_Proximity`] = comp.proximity || '';
  });

  const filledCount = Object.values(fields).filter(v => v !== '' && v != null).length;
  const totalCount = Object.keys(fields).length;

  log.info('form:mapped', { caseId, formType, filled: filledCount, total: totalCount });

  return {
    formType,
    formName: form.name,
    totalFields: totalCount,
    filledFields: filledCount,
    completionPercent: Math.round((filledCount / totalCount) * 100),
    fields,
    missingRequired: Object.entries(fields)
      .filter(([k, v]) => (v === '' || v == null) && ['Property_Address', 'City', 'State', 'GLA', 'Year_Built', 'Final_Reconciled_Value'].includes(k))
      .map(([k]) => k),
  };
}

/**
 * Get list of supported forms.
 */
export function getSupportedForms() {
  return Object.entries(FORM_DEFINITIONS).map(([id, info]) => ({ id, ...info }));
}

export { FORM_DEFINITIONS };
export default { mapToFormFields, getSupportedForms, FORM_DEFINITIONS };
