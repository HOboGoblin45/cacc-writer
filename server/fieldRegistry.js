/**
 * fieldRegistry.js  —  PHASE 1: Canonical Field Registry
 * -------------------------------------------------------
 * Single source of truth for all appraisal fields across all forms
 * and software targets (ACI desktop agent + Real Quantum web agent).
 *
 * LEGACY SOURCES (transitional — do not extend, derive from here instead):
 *   forms/*.js field arrays                       → generation fields
 *   desktop_agent/field_maps/*.json               → ACI targets
 *   real_quantum_agent/field_maps/commercial.json → RQ targets
 *   server/promptBuilder.js FIELD_LABELS / FIELD_PHRASE_TAGS → now registry-derived
 *
 * TODO Phase 2: populate automationId/className/classIndex from ACI calibration.
 */

// ── Factory helpers ───────────────────────────────────────────────────────────

function aci(label, tabName, hints = []) {
  return { label, tabName, automationId: '', className: '', classIndex: null, controlIndex: null, controlHints: hints };
}

function rq(slug, iframeId, strategy, verified, tabText = null, tabSel = null) {
  return { navUrlSlug: slug, selector: `iframe#${iframeId}`, iframeId, editorType: 'tinymce', sectionStrategy: strategy, tabText, tabSelector: tabSel, verified };
}

function f(formTypes, fieldId, title, sectionName, priority, verifyRequired, promptCategory, phraseTags, factsDeps, kbTags, aciT, rqT, opts = {}) {
  return {
    formTypes, fieldId, title,
    humanLabel:          opts.humanLabel          ?? title,
    sectionName,
    narrativeType:       opts.narrativeType       ?? 'narrative',
    destinationType:     'software_box',
    inputType:           'text',
    generationSupported: opts.generationSupported ?? true,
    verifyRequired, promptCategory, phraseTags,
    factsDependencies:   factsDeps,
    kbTags, priority,
    migrationStatus:     'canonical',
    ...(opts._note ? { _note: opts._note } : {}),
    softwareTargets: { aci: aciT, real_quantum: rqT },
  };
}

const RES = ['1004', '1025', '1073', '1004c'];
const COM = ['commercial'];

// ── Canonical field definitions ───────────────────────────────────────────────

const FIELDS = [

  // ── Residential Shared (1004 / 1025 / 1073 / 1004c) ──────────────────────

  f(RES,'offering_history','Offering History','Contract','high',true,
    'market_conditions',['market_conditions'],['contract','subject'],['residential','contract'],
    aci('Offering History','',['offering','history']),null),

  f(RES,'contract_analysis','Contract Analysis','Contract','high',true,
    'contract',['concession_adjustment'],['contract','subject'],['residential','contract'],
    aci('Contract Analysis','',['contract','agreement of sale']),null),

  f(RES,'concessions','Concessions / Financial Assistance','Contract','high',true,
    'concession_adjustment',['concession_adjustment'],['contract'],['residential','contract'],
    aci('Concessions / Financial Assistance','',['concessions','financial assistance']),null),

  f(RES,'neighborhood_boundaries','Neighborhood Boundaries','Neighborhood','medium',false,
    'neighborhood',['flood_zone','zoning'],['neighborhood','subject'],['residential','neighborhood'],
    aci('Neighborhood Boundaries','Neig',['boundaries','bounded by']),null),

  f(RES,'neighborhood_description','Neighborhood Description','Neighborhood','critical',true,
    'neighborhood',['flood_zone','zoning','market_conditions'],['neighborhood','subject','market'],['residential','neighborhood'],
    aci('Neighborhood Description','Neig',['neighborhood description','TX32']),null),

  f(RES,'market_conditions','Market Conditions Addendum','Neighborhood','critical',true,
    'market_conditions',['market_conditions'],['market','neighborhood'],['residential','market'],
    aci('Market Conditions','Neig',['market conditions','1004MC']),null,{humanLabel:'Market Conditions'}),

  f(RES,'site_comments','Site / Utilities / Adverse Conditions','Site','critical',true,
    'site',['flood_zone','zoning','fha_well_septic','rural_acreage'],['subject'],['residential','site'],
    aci('Site Comments','Site',['site','utilities','adverse']),null,{humanLabel:'Site Comments'}),

  f(RES,'improvements_condition','Improvements / Condition Narrative','Improvements','critical',true,
    'improvements',['accessory_dwelling'],['subject'],['residential','improvements'],
    aci('Improvements','Impro',['improvements','condition']),null,{humanLabel:'Improvements'}),

  f(RES,'sca_summary','Sales Comparison Approach Summary','SalesComparison','critical',true,
    'sales_comparison',['concession_adjustment','gla_adjustment','market_conditions'],
    ['comps','subject','market'],['residential','sales_comparison'],
    aci('Sales Comparison Analysis','Sales',['sales comparison']),null),

  f(RES,'sales_comparison_commentary','Sales Comparison Commentary','SalesComparison','critical',true,
    'sales_comparison',['concession_adjustment','gla_adjustment'],
    ['comps','subject','market'],['residential','sales_comparison'],
    aci('Sales Comparison Analysis','Sales',['sales comparison']),null,
    {_note:'ACI insertion alias. sca_summary is preferred generation ID.'}),

  f(RES,'reconciliation','Reconciliation Narrative','Reconciliation','critical',true,
    'reconciliation',['highest_best_use'],['subject','comps','assignment'],['residential','reconciliation'],
    aci('Reconciliation','Reco',['reconciliation','final value']),null,{humanLabel:'Reconciliation'}),

  f(RES,'exposure_time','Exposure Time','Reconciliation','medium',false,
    'market_conditions',['market_conditions'],['market'],['residential','exposure_time'],
    aci('Exposure Time','Reco',['exposure time','marketing time']),null),

  f(RES,'cost_approach','Cost Approach Comments','CostApproach','low',false,
    'cost_approach',[],['subject'],['residential','cost_approach'],
    aci('Cost Approach Comments','Cost',['cost approach']),null,{generationSupported:false}),

  // ── 1004 ACI-only (not a generation field) ────────────────────────────────
  f(['1004'],'income_approach','Income Approach Comments (1004)','IncomeApproach','low',false,
    'income_approach',['market_conditions'],['subject'],['1004','income_approach'],
    aci('Income Approach Comments','Income',['income approach']),null,
    {generationSupported:false,humanLabel:'Income Approach Comments'}),

  // ── 1025-specific ─────────────────────────────────────────────────────────
  f(['1025'],'income_approach','Income Approach Narrative','IncomeApproach','critical',true,
    'income_approach',['market_conditions'],['incomeApproach','subject'],['1025','income_approach'],
    aci('Income Approach','Income',['income approach']),null,{humanLabel:'Income Approach'}),

  f(['1025'],'rental_analysis','Rental Analysis','IncomeApproach','high',false,
    'income_approach',['market_conditions'],['incomeApproach'],['1025','rental_analysis'],
    aci('Rental Analysis','Income',['rental analysis','market rent']),null),

  // ── 1073-specific ─────────────────────────────────────────────────────────
  f(['1073'],'condo_project_analysis','Condo Project Analysis','CondoProject','critical',true,
    'condo_project',[],['condoProject','subject'],['1073','condo','hoa'],
    aci('Project Information','Subj',['project information','condo','HOA']),null,{humanLabel:'Project Information'}),

  // ── 1004c-specific ────────────────────────────────────────────────────────
  f(['1004c'],'manufactured_home_comments','Manufactured Housing Comments','ManufacturedHome','critical',true,
    'manufactured_home',[],['manufacturedHome','subject'],['1004c','manufactured_home'],
    aci('Manufactured Housing Comments','',['manufactured','HUD','foundation']),null),

  // ── Commercial — Introduction ─────────────────────────────────────────────
  f(COM,'introduction','Introduction','Introduction','high',true,
    'introduction',[],['subject','assignment'],['commercial','introduction'],
    null,rq('introduction','introduction_section_content_text_area_ifr','visible',true)),

  f(COM,'general_assumptions','General Assumptions & Limiting Conditions','Introduction','medium',false,
    'introduction',[],['assignment'],['commercial','assumptions'],
    null,rq('introduction','general_assumptions_and_limiting_conditions_section_content_text_area_ifr','scroll',false),
    {generationSupported:false}),

  // ── Commercial — Market Data ──────────────────────────────────────────────
  f(COM,'market_area','Market Area Analysis','MarketData','critical',true,
    'market_conditions',['market_conditions'],['market','subject'],['commercial','market_area'],
    aci('Market Area Analysis','',['market area','national overview']),
    rq('market_data','national_overview_section_content_text_area_ifr','visible',true),
    {humanLabel:'Market Data — National Overview'}),

  f(COM,'regional_overview','Regional Overview','MarketData','high',false,
    'market_conditions',['market_conditions'],['market'],['commercial','market_data'],
    null,rq('market_data','regional_overview_section_content_text_area_ifr','tab_click',true,'regional overview','a.text-center'),
    {humanLabel:'Market Data — Regional Overview'}),

  f(COM,'local_market_analysis','Local Market Analysis','MarketData','high',false,
    'market_conditions',['market_conditions'],['market'],['commercial','market_data'],
    null,rq('market_data','local_market_analysis_section_content_text_area_ifr','scroll',false),
    {humanLabel:'Market Data — Local Market Analysis'}),

  f(COM,'industry_overview','Industry Overview','MarketData','medium',false,
    'market_conditions',['market_conditions'],['market'],['commercial','market_data'],
    null,rq('market_data','industry_overview_section_content_text_area_ifr','tab_click',true,'industry overview','a.text-center'),
    {humanLabel:'Market Data — Industry Overview'}),

  f(COM,'neighborhood_description','Neighborhood Description (Commercial)','MarketData','high',true,
    'neighborhood',[],['subject','market'],['commercial','market_data','neighborhood'],
    null,rq('market_data','neighborhood_section_content_text_area_ifr','scroll',true),
    {humanLabel:'Market Data — Neighborhood'}),

  f(COM,'demographics','Demographics','MarketData','medium',false,
    'market_conditions',[],['market'],['commercial','market_data'],
    null,rq('market_data','demographics_section_content_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Data — Demographics'}),

  f(COM,'demographics_conclusions','Demographics Conclusions','MarketData','medium',false,
    'market_conditions',[],['market'],['commercial','market_data'],
    null,rq('market_data','demographics_conclusions_content_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Data — Demographics Conclusions'}),

  // ── Commercial — Property Data ────────────────────────────────────────────
  f(COM,'zoning_remarks','Zoning Remarks','PropertyData','medium',false,
    'site',['flood_zone','zoning'],['subject'],['commercial','property_data'],
    null,rq('property_data','zoning_remarks_text_area_ifr','visible',false),
    {generationSupported:false,humanLabel:'Property Data — Zoning Remarks'}),

  f(COM,'site_description','Site Description','PropertyData','critical',true,
    'site',['flood_zone','zoning','fha_well_septic'],['subject'],['commercial','site_description'],
    aci('Site Description','',['site description']),
    rq('property_data','site_description_conclusions_text_area_ifr','visible',true),
    {humanLabel:'Property Data — Site Description'}),

  f(COM,'improvement_description','Improvement Description','PropertyData','critical',true,
    'improvements',['accessory_dwelling'],['improvements'],['commercial','improvement_description'],
    aci('Improvements','',['improvements','building class']),
    rq('property_data','improvement_description_conclusions_text_area_ifr','scroll',true),
    {humanLabel:'Property Data — Improvement Description'}),

  f(COM,'real_estate_taxes_remarks','Real Estate Taxes Remarks','PropertyData','low',false,
    'site',[],['subject'],['commercial','property_data'],
    null,rq('property_data','real_estate_taxes_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Property Data — Real Estate Taxes Remarks'}),

  f(COM,'real_estate_taxes_comparables','Real Estate Taxes Comparables','PropertyData','low',false,
    'site',[],['subject'],['commercial','property_data'],
    null,rq('property_data','real_estate_taxes_comparables_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Property Data — Real Estate Taxes Comparables'}),

  // ── Commercial — Highest & Best Use ──────────────────────────────────────
  f(COM,'hbu_analysis','Highest and Best Use Analysis','HighestBestUse','critical',true,
    'highest_best_use',['highest_best_use'],['subject'],['commercial','hbu'],
    aci('Highest and Best Use','',['highest best use','as vacant']),
    rq('highest_best_use','highest_and_best_use_as_vacant_remarks_text_area_ifr','visible',true),
    {humanLabel:'Highest & Best Use — As Vacant'}),

  f(COM,'hbu_as_improved','Highest and Best Use — As Improved','HighestBestUse','critical',true,
    'highest_best_use',['highest_best_use'],['subject','improvements'],['commercial','hbu'],
    null,rq('highest_best_use','highest_and_best_use_as_improved_remarks_text_area_ifr','visible',true),
    {humanLabel:'Highest & Best Use — As Improved'}),

  // ── Commercial — Cost Approach ────────────────────────────────────────────
  f(COM,'cost_approach','Cost Approach','CostApproach','high',true,
    'cost_approach',[],['subject','improvements'],['commercial','cost_approach'],
    aci('Cost Approach Comments','',['cost approach']),
    rq('cost_approach','replacement_cost_new_remarks_text_area_ifr','visible',true),
    {humanLabel:'Cost Approach — Replacement Cost New'}),

  f(COM,'depreciation_remarks','Depreciation Remarks','CostApproach','medium',false,
    'cost_approach',[],['subject','improvements'],['commercial','cost_approach'],
    null,rq('cost_approach','depreciation_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Cost Approach — Depreciation'}),

  f(COM,'cost_approach_reconciliation','Cost Approach Reconciliation','CostApproach','high',true,
    'cost_approach',[],['subject'],['commercial','cost_approach'],
    null,rq('cost_approach','cost_approach_reconciliation_remarks_text_area_ifr','scroll',true),
    {humanLabel:'Cost Approach — Reconciliation'}),

  f(COM,'cost_approach_final_conclusion','Cost Approach Final Conclusion','CostApproach','medium',false,
    'cost_approach',[],['subject'],['commercial','cost_approach'],
    null,rq('cost_approach','cost_approach_final_conclusion_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Cost Approach — Final Conclusion'}),

  f(COM,'insurable_replacement_cost','Insurable Replacement Cost','CostApproach','low',false,
    'cost_approach',[],['subject'],['commercial','cost_approach'],
    null,rq('cost_approach','insurable_replacement_cost_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Cost Approach — Insurable Replacement Cost'}),

  // ── Commercial — Sales Comparison ─────────────────────────────────────────
  f(COM,'sales_comparison','Sales Comparison Narrative','SalesComparison','critical',true,
    'sales_comparison',['concession_adjustment','gla_adjustment'],['sales','subject'],['commercial','sales_comparison'],
    aci('Sales Comparison Analysis','',['sales comparison']),
    rq('sale_valuation','sale_valuation_reconciliation_remarks_text_area_ifr','scroll',true),
    {humanLabel:'Sales Comparison — Reconciliation',
     _note:'RQ slug is sale_valuation not sales_comparison. Iframe hidden on load — scroll activates it.'}),

  f(COM,'sale_comparable_detail','Sale Comparable Detail','SalesComparison','medium',false,
    'sales_comparison',[],['sales'],['commercial','sales_comparison'],
    null,{navUrlSlug:'sale_valuation',selector:'a.details_link',iframeId:'DYNAMIC',editorType:'detail_page',sectionStrategy:'detail_page',tabText:null,tabSelector:null,verified:false},
    {generationSupported:false,humanLabel:'Sales Comparison — Comparable Sale Detail'}),

  // ── Commercial — Market Rent Analysis ────────────────────────────────────
  f(COM,'market_rent_analysis','Market Rent Analysis','MarketRentAnalysis','critical',true,
    'income_approach',['market_conditions'],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','income_approach_intro_text_area_ifr','visible',true),
    {humanLabel:'Market Rent Analysis — Introduction'}),

  f(COM,'rent_roll_remarks','Rent Roll Remarks','MarketRentAnalysis','high',true,
    'income_approach',[],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','rent_roll_remarks_text_area_ifr','visible',true),
    {humanLabel:'Market Rent Analysis — Rent Roll'}),

  f(COM,'rent_reconciliation','Rent Reconciliation','MarketRentAnalysis','high',false,
    'income_approach',[],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','rent_reconciliation_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Market Rent Analysis — Rent Reconciliation'}),

  f(COM,'lease_gain_loss','Lease Gain/Loss, Concessions & Subsidies','MarketRentAnalysis','medium',false,
    'income_approach',[],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','lease_gain_loss_non_revenue_concessions_and_subsidies_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Rent Analysis — Lease Gain/Loss'}),

  f(COM,'other_revenue','Other Revenue','MarketRentAnalysis','medium',false,
    'income_approach',[],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','other_revenue_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Rent Analysis — Other Revenue'}),

  f(COM,'commercial_market_summary','Commercial Market Summary','MarketRentAnalysis','medium',false,
    'market_conditions',[],['market'],['commercial','market_rent'],
    null,rq('market_rent_analysis','commercial_market_summary_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Rent Analysis — Commercial Market Summary'}),

  f(COM,'commercial_market_summary_standalone','Commercial Market Summary (Standalone)','MarketRentAnalysis','low',false,
    'market_conditions',[],['market'],['commercial','market_rent'],
    null,rq('market_rent_analysis','commercial_market_summary_standalone_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Market Rent Analysis — Commercial Market Summary (Standalone)'}),

  f(COM,'vacancy_credit_loss','Vacancy & Credit Loss','MarketRentAnalysis','high',false,
    'income_approach',[],['income'],['commercial','market_rent'],
    null,rq('market_rent_analysis','vacancy_and_credit_loss_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Market Rent Analysis — Vacancy & Credit Loss'}),

  // ── Commercial — Income Approach ──────────────────────────────────────────
  f(COM,'expense_remarks','Expense Remarks','IncomeApproach','high',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','expense_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Income Approach — Expense Remarks'}),

  f(COM,'investment_classifications','Investment Classifications','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','investment_classifications_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — Investment Classifications'}),

  f(COM,'investor_survey_remarks','Investor Survey','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','investor_survey_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — Investor Survey'}),

  f(COM,'income_approach','Income Approach — Direct Capitalization','IncomeApproach','critical',true,
    'income_approach',['market_conditions'],['income','subject'],['commercial','income_approach'],
    aci('Income Approach Comments','',['income approach']),
    rq('income_approach','direct_capitalization_remarks_text_area_ifr','scroll',true),
    {humanLabel:'Income Approach — Direct Capitalization'}),

  f(COM,'investment_considerations','Investment Considerations','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','investment_considerations_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — Investment Considerations'}),

  f(COM,'property_class_investment_overview','Property Class Investment Overview','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','property_class_investment_overview_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — Property Class Investment Overview'}),

  f(COM,'market_participants','Market Participants','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','market_participants_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — Market Participants'}),

  f(COM,'direct_capitalization_conclusion','Direct Capitalization Conclusion','IncomeApproach','high',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','direct_capitalization_conclusion_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Income Approach — Direct Capitalization Conclusion'}),

  f(COM,'dcf_assumptions','DCF Assumptions','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','dcf_assumptions_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — DCF Assumptions'}),

  f(COM,'dcf_analysis','DCF Analysis','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','dcf_analysis_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — DCF Analysis'}),

  f(COM,'dcf_conclusions','DCF Conclusions','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','dcf_conclusions_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — DCF Conclusions'}),

  f(COM,'dcf_reconciliation','DCF Reconciliation','IncomeApproach','medium',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','dcf_reconciliation_remarks_text_area_ifr','scroll',false),
    {generationSupported:false,humanLabel:'Income Approach — DCF Reconciliation'}),

  f(COM,'income_approach_reconciliation','Income Approach Reconciliation','IncomeApproach','high',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','income_approach_reconciliation_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Income Approach — Reconciliation'}),

  f(COM,'income_approach_conclusion','Income Approach Conclusion','IncomeApproach','high',false,
    'income_approach',[],['income'],['commercial','income_approach'],
    null,rq('income_approach','income_approach_conclusion_remarks_text_area_ifr','scroll',false),
    {humanLabel:'Income Approach — Conclusion'}),

  // ── Commercial — Reconciliation ───────────────────────────────────────────
  f(COM,'reconciliation','Reconciliation and Final Value Opinion','Reconciliation','critical',true,
    'reconciliation',['highest_best_use'],['subject','income','sales'],['commercial','reconciliation'],
    aci('Reconciliation','',['reconciliation']),
    rq('reconciliation','reconciliation_section_content_text_area_ifr','visible',true),
    {humanLabel:'Reconciliation'}),

]; // END_FIELDS

// ── Build lookup indexes at module load ───────────────────────────────────────

const _byFormField  = new Map(); // 'formType::fieldId' → field
const _byForm       = new Map(); // 'formType'          → field[]
const _bySection    = new Map(); // 'formType::section' → field[]

for (const field of FIELDS) {
  for (const formType of field.formTypes) {
    _byFormField.set(`${formType}::${field.fieldId}`, field);

    if (!_byForm.has(formType)) _byForm.set(formType, []);
    _byForm.get(formType).push(field);

    const sk = `${formType}::${field.sectionName}`;
    if (!_bySection.has(sk)) _bySection.set(sk, []);
    _bySection.get(sk).push(field);
  }
}

// ── Public helper API ─────────────────────────────────────────────────────────

/**
 * getFieldDefinition(formType, fieldId)
 * Returns the canonical field entry, or null if not found.
 */
export function getFieldDefinition(formType, fieldId) {
  return _byFormField.get(`${formType}::${fieldId}`) ?? null;
}

/**
 * getFieldsForForm(formType)
 * Returns all canonical field entries for a given form type.
 */
export function getFieldsForForm(formType) {
  return _byForm.get(formType) ?? [];
}

/**
 * getFieldsForSection(formType, sectionName)
 * Returns all fields in a named section for a given form type.
 */
export function getFieldsForSection(formType, sectionName) {
  return _bySection.get(`${formType}::${sectionName}`) ?? [];
}

/**
 * getSoftwareTarget(formType, fieldId, software)
 * Returns the software target descriptor for 'aci' or 'real_quantum', or null.
 */
export function getSoftwareTarget(formType, fieldId, software) {
  const field = getFieldDefinition(formType, fieldId);
  if (!field) return null;
  return field.softwareTargets?.[software] ?? null;
}

/**
 * isVerificationRequired(formType, fieldId)
 * Returns true if read-back verification is required after insertion.
 */
export function isVerificationRequired(formType, fieldId) {
  return getFieldDefinition(formType, fieldId)?.verifyRequired ?? false;
}

/**
 * getPromptCategory(formType, fieldId)
 * Returns the prompt category string used for phrase bank lookup and prompt routing.
 */
export function getPromptCategory(formType, fieldId) {
  return getFieldDefinition(formType, fieldId)?.promptCategory ?? null;
}

/**
 * getFieldLabel(formType, fieldId)
 * Returns the human-readable label for display and ACI label-match targeting.
 */
export function getFieldLabel(formType, fieldId) {
  return getFieldDefinition(formType, fieldId)?.humanLabel ?? fieldId;
}

/**
 * getPhraseTags(formType, fieldId)
 * Returns the phrase bank tag array for this field.
 */
export function getPhraseTags(formType, fieldId) {
  return getFieldDefinition(formType, fieldId)?.phraseTags ?? [];
}

/**
 * getAllFieldIds(formType)
 * Returns an array of all fieldIds registered for a form type.
 */
export function getAllFieldIds(formType) {
  return getFieldsForForm(formType).map(f => f.fieldId);
}

/**
 * isGenerationSupported(formType, fieldId)
 * Returns true if AI generation is supported for this field.
 */
export function isGenerationSupported(formType, fieldId) {
  return getFieldDefinition(formType, fieldId)?.generationSupported ?? false;
}

/**
 * getRegistryStats()
 * Returns a summary of registry contents for diagnostics.
 */
export function getRegistryStats() {
  const formCounts = {};
  for (const [formType, fields] of _byForm.entries()) {
    formCounts[formType] = fields.length;
  }
  return {
    totalFields:  FIELDS.length,
    uniqueKeys:   _byFormField.size,
    formCounts,
    sectionCount: _bySection.size,
  };
}

/**
 * validateRegistry()
 * Runs integrity checks on the registry. Returns { ok, errors, warnings }.
 * Call this at startup or from scripts/validateFieldRegistry.js.
 */
export function validateRegistry() {
  const errors   = [];
  const warnings = [];
  const seen     = new Set();

  for (const field of FIELDS) {
    // Required fields check
    const required = ['formTypes','fieldId','title','humanLabel','sectionName','priority','promptCategory'];
    for (const key of required) {
      if (!field[key]) {
        errors.push(`MISSING ${key} on field: ${JSON.stringify(field.fieldId)}`);
      }
    }

    // Duplicate (formType, fieldId) check
    for (const formType of (field.formTypes || [])) {
      const key = `${formType}::${field.fieldId}`;
      if (seen.has(key)) {
        errors.push(`DUPLICATE key: ${key}`);
      }
      seen.add(key);
    }

    // Software target sanity
    if (!field.softwareTargets) {
      warnings.push(`NO softwareTargets on: ${field.fieldId}`);
    }

    // Generation fields should have a promptCategory
    if (field.generationSupported && !field.promptCategory) {
      warnings.push(`generationSupported=true but no promptCategory: ${field.fieldId}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, fieldCount: FIELDS.length };
}

// ── Named export of raw FIELDS array (for advanced consumers) ─────────────────
export { FIELDS };
