/**
 * server/dataPipeline/pipelineContextBuilder.js
 * -----------------------------------------------
 * Builds prompt context blocks from crawled data stored in pipeline cache.
 * Injected into extraContext for AI narrative generation.
 *
 * Reads pipeline data from the case's pipeline store (in-memory cache or DB).
 * Returns a formatted string suitable for system-role prompt injection.
 */

import { getDb } from '../db/database.js';

/**
 * Build pipeline context for a specific case and section.
 * @param {string} caseId — the case ID
 * @param {string} sectionId — the section being generated
 * @returns {string|null} formatted context block, or null if no pipeline data
 */
export function buildPipelineContext(caseId, sectionId) {
  if (!caseId) return null;

  const db = getDb();
  let row;
  try {
    const stmt = db.prepare('SELECT data FROM pipeline_cache WHERE case_id = ?');
    row = stmt.get(caseId);
  } catch {
    // Table doesn't exist yet or DB not available — non-fatal
    return null;
  }

  if (!row?.data) return null;

  let pipelineData;
  try {
    pipelineData = JSON.parse(row.data);
  } catch {
    return null;
  }

  const blocks = [];

  // ── Subject property crawled data ──────────────────────────────────────────
  if (pipelineData.subject) {
    const s = pipelineData.subject;
    const subjectLines = ['CRAWLED SUBJECT PROPERTY DATA (verified from web sources):'];
    if (s.address) subjectLines.push(`  Address: ${formatAddress(s.address)}`);
    if (s.parcelNumber) subjectLines.push(`  Parcel: ${s.parcelNumber}`);
    if (s.year_built) subjectLines.push(`  Year Built: ${s.year_built}`);
    if (s.gross_living_area) subjectLines.push(`  GLA: ${s.gross_living_area} sf`);
    if (s.bedrooms) subjectLines.push(`  Bedrooms: ${s.bedrooms}`);
    if (s.bathrooms_full) subjectLines.push(`  Full Baths: ${s.bathrooms_full}`);
    if (s.bathrooms_half) subjectLines.push(`  Half Baths: ${s.bathrooms_half}`);
    if (s.site_area) subjectLines.push(`  Site Area: ${s.site_area} sf`);
    if (s.zoning) subjectLines.push(`  Zoning: ${s.zoning}${s.zoning_description ? ' (' + s.zoning_description + ')' : ''}`);
    if (s.construction) {
      if (s.construction.exterior_walls) subjectLines.push(`  Exterior: ${s.construction.exterior_walls}`);
      if (s.construction.foundation) subjectLines.push(`  Foundation: ${s.construction.foundation}`);
      if (s.construction.roof_material) subjectLines.push(`  Roof: ${s.construction.roof_material}`);
      if (s.construction.heating_type) subjectLines.push(`  Heating: ${s.construction.heating_type}`);
      if (s.construction.cooling_type) subjectLines.push(`  Cooling: ${s.construction.cooling_type}`);
    }
    if (s.basement) {
      if (s.basement.total_sqft) subjectLines.push(`  Basement: ${s.basement.total_sqft} sf total${s.basement.finished_sqft ? ', ' + s.basement.finished_sqft + ' sf finished' : ''}`);
    }
    if (s.garage) {
      if (s.garage.type) subjectLines.push(`  Garage: ${s.garage.type}${s.garage.car_count ? ' ' + s.garage.car_count + '-car' : ''}`);
    }
    if (s.assessed_value) {
      subjectLines.push(`  Assessed Value: $${(s.assessed_value.total || 0).toLocaleString()} (${s.assessed_value.assessment_year || 'N/A'})`);
    }
    if (s.tax_info) {
      subjectLines.push(`  Annual Taxes: $${(s.tax_info.annual_taxes || 0).toLocaleString()} (${s.tax_info.tax_year || 'N/A'})`);
    }
    if (s.flood_zone) subjectLines.push(`  Flood Zone: ${s.flood_zone}`);
    if (s.sales_history?.length) {
      subjectLines.push('  Sales History:');
      s.sales_history.slice(0, 5).forEach(sale => {
        subjectLines.push(`    ${sale.date || 'N/A'}: $${(sale.price || 0).toLocaleString()} (${sale.deed_type || 'N/A'})`);
      });
    }
    if (subjectLines.length > 1) blocks.push(subjectLines.join('\n'));
  }

  // ── Comparable sales crawled data ──────────────────────────────────────────
  if (pipelineData.comps?.length) {
    const compLines = ['CRAWLED COMPARABLE SALES DATA:'];
    pipelineData.comps.forEach((comp, i) => {
      if (!comp) return;
      compLines.push(`\n  Comp ${i + 1}:`);
      if (comp.address) compLines.push(`    Address: ${formatAddress(comp.address)}`);
      if (comp.sale_price) compLines.push(`    Sale Price: $${comp.sale_price.toLocaleString()}`);
      if (comp.sale_date) compLines.push(`    Sale Date: ${comp.sale_date}`);
      if (comp.days_on_market != null) compLines.push(`    DOM: ${comp.days_on_market}`);
      if (comp.gla || comp.gross_living_area) compLines.push(`    GLA: ${comp.gla || comp.gross_living_area} sf`);
      if (comp.year_built) compLines.push(`    Year Built: ${comp.year_built}`);
      if (comp.bedrooms) compLines.push(`    Bed/Bath: ${comp.bedrooms}/${comp.bathrooms_full || 0}.${comp.bathrooms_half ? '5' : '0'}`);
      if (comp.lot_size) compLines.push(`    Lot: ${comp.lot_size}`);
      if (comp.price_per_sqft) compLines.push(`    $/SqFt: $${comp.price_per_sqft.toFixed(2)}`);
      if (comp.concessions) compLines.push(`    Concessions: ${comp.concessions}`);
      if (comp.financing_type) compLines.push(`    Financing: ${comp.financing_type}`);
    });
    if (compLines.length > 1) blocks.push(compLines.join('\n'));
  }

  // ── Comparable analysis summary ────────────────────────────────────────────
  if (pipelineData.analysis) {
    const a = pipelineData.analysis;
    const analysisLines = ['COMPARABLE SALES ANALYSIS (derived from crawled data):'];
    if (a.pricePerSqft) {
      analysisLines.push(`  $/SqFt Range: $${a.pricePerSqft.min?.toFixed(2)} – $${a.pricePerSqft.max?.toFixed(2)}`);
      analysisLines.push(`  $/SqFt Median: $${a.pricePerSqft.median?.toFixed(2)}`);
    }
    if (a.reconciliation) {
      analysisLines.push(`  Indicated Value Range: $${a.reconciliation.low?.toLocaleString()} – $${a.reconciliation.high?.toLocaleString()}`);
      if (a.reconciliation.indicated) analysisLines.push(`  Indicated Value: $${a.reconciliation.indicated.toLocaleString()}`);
    }
    if (a.marketTrend) {
      analysisLines.push(`  Market Trend: ${a.marketTrend.trend}`);
      if (a.marketTrend.annualChangePct != null) analysisLines.push(`  Annual Change: ${a.marketTrend.annualChangePct.toFixed(1)}%`);
      if (a.marketTrend.avgDOM != null) analysisLines.push(`  Avg DOM: ${a.marketTrend.avgDOM.toFixed(0)}`);
      if (a.marketTrend.saleToListRatio != null) analysisLines.push(`  Sale-to-List Ratio: ${(a.marketTrend.saleToListRatio * 100).toFixed(1)}%`);
    }
    if (analysisLines.length > 1) blocks.push(analysisLines.join('\n'));
  }

  // ── Market / neighborhood crawled data ─────────────────────────────────────
  if (pipelineData.market) {
    const m = pipelineData.market;
    const marketLines = ['CRAWLED MARKET / NEIGHBORHOOD DATA:'];
    if (m.area_name) marketLines.push(`  Area: ${m.area_name}`);
    if (m.median_sale_price) marketLines.push(`  Median Sale Price: $${m.median_sale_price.toLocaleString()}`);
    if (m.median_price_change_pct != null) marketLines.push(`  YoY Price Change: ${m.median_price_change_pct.toFixed(1)}%`);
    if (m.average_dom) marketLines.push(`  Avg DOM: ${m.average_dom}`);
    if (m.inventory_count) marketLines.push(`  Active Listings: ${m.inventory_count}`);
    if (m.months_of_supply) marketLines.push(`  Months of Supply: ${m.months_of_supply.toFixed(1)}`);
    if (m.sale_to_list_ratio) marketLines.push(`  Sale-to-List Ratio: ${(m.sale_to_list_ratio * 100).toFixed(1)}%`);
    if (m.trend) marketLines.push(`  Trend: ${m.trend}`);
    if (m.price_range_low && m.price_range_high) marketLines.push(`  Price Range: $${m.price_range_low.toLocaleString()} – $${m.price_range_high.toLocaleString()}`);
    if (m.predominant_price) marketLines.push(`  Predominant Price: $${m.predominant_price.toLocaleString()}`);
    if (m.school_district) marketLines.push(`  School District: ${m.school_district}`);
    if (m.neighborhood_description) marketLines.push(`  Description: ${m.neighborhood_description}`);
    if (marketLines.length > 1) blocks.push(marketLines.join('\n'));
  }

  // ── Raw markdown context (for unstructured crawl results) ──────────────────
  if (pipelineData.marketMarkdown) {
    const md = pipelineData.marketMarkdown;
    if (md.length > 50) {
      // Truncate to ~3000 chars to avoid bloating the prompt
      const truncated = md.length > 3000 ? md.slice(0, 3000) + '\n[...truncated]' : md;
      blocks.push(`CRAWLED MARKET CONTEXT (raw):\n${truncated}`);
    }
  }

  if (blocks.length === 0) return null;

  return blocks.join('\n\n');
}

function formatAddress(addr) {
  if (typeof addr === 'string') return addr;
  const parts = [];
  if (addr.street) parts.push(addr.street);
  if (addr.city) parts.push(addr.city);
  if (addr.state) parts.push(addr.state);
  if (addr.zip) parts.push(addr.zip);
  return parts.join(', ') || 'N/A';
}
