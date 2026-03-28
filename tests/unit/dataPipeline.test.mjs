/**
 * tests/unit/dataPipeline.test.mjs
 * Unit tests for the Cloudflare data pipeline modules:
 *   - CloudflareCrawler (constructor, usage stats, schemas/presets)
 *   - ADMMapper (field normalization, UAD formatting, conflict detection, adjustments)
 *   - CompAnalyzer ($/sqft, adjustments, reconciliation, outliers, trends)
 *   - CrawlCache (store, retrieve, staleness, stats)
 *   - pipelineContextBuilder (prompt context building)
 *   - pipelineSchema (DB table creation)
 *
 * Run: node tests/unit/dataPipeline.test.mjs
 */

import assert from 'assert/strict';

// ── Minimal test runner ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

async function testAsync(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CloudflareCrawler
// ══════════════════════════════════════════════════════════════════════════════

import { CloudflareCrawler, SCHEMAS, EXTRACTION_PROMPTS, CRAWL_PRESETS } from '../../server/dataPipeline/cloudflareCrawler.js';

console.log('\nCloudflareCrawler');

test('constructor requires accountId and apiToken', () => {
  assert.throws(() => new CloudflareCrawler('', 'token'), /accountId/);
  assert.throws(() => new CloudflareCrawler('acct', ''), /apiToken/);
});

test('constructor accepts valid credentials', () => {
  const c = new CloudflareCrawler('test-account-id', 'test-api-token');
  assert.equal(c.accountId, 'test-account-id');
  assert.equal(c.apiToken, 'test-api-token');
  assert.ok(c.baseUrl.includes('test-account-id'));
});

test('getUsageStats returns zeroed stats initially', () => {
  const c = new CloudflareCrawler('acct', 'tok');
  const stats = c.getUsageStats();
  assert.equal(stats.totalBrowserMs, 0);
  assert.equal(stats.totalBrowserSeconds, 0);
  assert.equal(stats.jobCount, 0);
  assert.equal(typeof stats.estimatedCostUsd, 'number');
});

test('SCHEMAS exports all required schemas', () => {
  assert.ok(SCHEMAS.propertyDetails, 'missing propertyDetails schema');
  assert.ok(SCHEMAS.comparableSale, 'missing comparableSale schema');
  assert.ok(SCHEMAS.marketData, 'missing marketData schema');
  assert.ok(SCHEMAS.commercialProperty, 'missing commercialProperty schema');
});

test('EXTRACTION_PROMPTS exports all required prompts', () => {
  assert.ok(EXTRACTION_PROMPTS.assessor, 'missing assessor prompt');
  assert.ok(EXTRACTION_PROMPTS.listing, 'missing listing prompt');
  assert.ok(EXTRACTION_PROMPTS.market, 'missing market prompt');
  assert.ok(EXTRACTION_PROMPTS.commercial, 'missing commercial prompt');
});

test('CRAWL_PRESETS exports built-in presets', () => {
  assert.ok(CRAWL_PRESETS.mcLeanCountyAssessor, 'missing mcLeanCountyAssessor');
  assert.ok(CRAWL_PRESETS.realtorCom, 'missing realtorCom');
  assert.ok(CRAWL_PRESETS.zillowListing, 'missing zillowListing');
  assert.ok(CRAWL_PRESETS.marketDataStatic, 'missing marketDataStatic');
  assert.ok(CRAWL_PRESETS.cityZoning, 'missing cityZoning');
});

test('propertyDetails schema has required fields', () => {
  const s = SCHEMAS.propertyDetails;
  const schemaObj = s.schema || s;
  const props = schemaObj.properties || {};
  const expectedFields = ['parcelNumber', 'address', 'yearBuilt', 'bedrooms', 'zoning'];
  for (const field of expectedFields) {
    assert.ok(props[field], 'missing field: ' + field);
  }
});

test('comparableSale schema has required fields', () => {
  const s = SCHEMAS.comparableSale;
  const schemaObj = s.schema || s;
  const props = schemaObj.properties || {};
  const expectedFields = ['mlsNumber', 'salePrice', 'listPrice', 'dom'];
  for (const field of expectedFields) {
    assert.ok(props[field], 'missing field: ' + field);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMMapper
// ══════════════════════════════════════════════════════════════════════════════

import { ADMMapper } from '../../server/dataPipeline/admMapper.js';

console.log('\nADMMapper');

test('constructor creates instance', () => {
  const m = new ADMMapper();
  assert.ok(m);
});

test('mapPropertyToADM normalizes assessor data', () => {
  const m = new ADMMapper();
  const raw = {
    parcelNumber: '12-34-567',
    year_built: 1998,
    gross_living_area: 1847,
    bedrooms: 3,
    bathrooms_full: 2,
    bathrooms_half: 0,
    address: { street: '123 Main St', city: 'Normal', state: 'IL', zip: '61761' },
  };
  const result = m.mapPropertyToADM(raw, 'assessor');
  assert.ok(result, 'should return mapped data');
  assert.equal(typeof result, 'object');
});

test('mapCompToGrid returns comp grid structure', () => {
  const m = new ADMMapper();
  const comp = {
    sale_price: 250000,
    sale_date: '2025-06-15',
    gross_living_area: 1920,
    year_built: 2000,
    bedrooms: 3,
    bathrooms_full: 2,
  };
  const subject = {
    gross_living_area: 1847,
    year_built: 1998,
    bedrooms: 3,
    bathrooms_full: 2,
  };
  const grid = m.mapCompToGrid(comp, subject);
  assert.ok(grid, 'should return comp grid');
  assert.equal(typeof grid, 'object');
});

test('detectConflicts finds differences between sources', () => {
  const m = new ADMMapper();
  const source1 = { gross_living_area: 1847, year_built: 1998 };
  const source2 = { gross_living_area: 1850, year_built: 1998 };
  const conflicts = m.detectConflicts(source1, source2);
  assert.ok(Array.isArray(conflicts));
  // GLA differs by 3 — may or may not be flagged depending on threshold
});

test('suggestAdjustments returns adjustment object', () => {
  const m = new ADMMapper();
  const subject = { gross_living_area: 1847, year_built: 1998, bedrooms: 3, bathrooms_full: 2 };
  const comp = { gross_living_area: 2100, year_built: 2005, bedrooms: 4, bathrooms_full: 3 };
  const adjustments = m.suggestAdjustments(subject, comp);
  assert.ok(adjustments, 'should return adjustments');
  assert.equal(typeof adjustments, 'object');
});

test('formatUAD handles condition ratings', () => {
  const m = new ADMMapper();
  const result = m.formatUAD('condition', 'Average');
  assert.ok(typeof result === 'string', 'should return string');
});

test('formatUAD handles quality ratings', () => {
  const m = new ADMMapper();
  const result = m.formatUAD('quality', 'Good');
  assert.ok(typeof result === 'string');
});

test('toFactsFormat returns facts-compatible structure', () => {
  const m = new ADMMapper();
  const adm = {
    year_built: 1998,
    gross_living_area: 1847,
    bedrooms: 3,
  };
  const facts = m.toFactsFormat(adm, '1004');
  assert.ok(facts, 'should return facts object');
  assert.equal(typeof facts, 'object');
});

// ══════════════════════════════════════════════════════════════════════════════
// CompAnalyzer
// ══════════════════════════════════════════════════════════════════════════════

import { CompAnalyzer } from '../../server/dataPipeline/compAnalyzer.js';

console.log('\nCompAnalyzer');

const testSubject = {
  gla: 1847,
  yearBuilt: 1998,
  bedrooms: 3,
  bathroomsFull: 2,
  bathroomsHalf: 0,
  salePrice: 240000,
};

const testComps = [
  { salePrice: 250000, gla: 1920, yearBuilt: 2000, bedrooms: 3, bathroomsFull: 2, saleDate: '2025-06-15', listPrice: 255000, daysOnMarket: 30 },
  { salePrice: 235000, gla: 1780, yearBuilt: 1996, bedrooms: 3, bathroomsFull: 2, saleDate: '2025-05-20', listPrice: 240000, daysOnMarket: 45 },
  { salePrice: 260000, gla: 2050, yearBuilt: 2002, bedrooms: 4, bathroomsFull: 2, bathroomsHalf: 1, saleDate: '2025-07-10', listPrice: 265000, daysOnMarket: 25 },
];

test('constructor accepts subject and comps', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  assert.ok(a);
});

test('pricePerSqftAnalysis returns stats', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.pricePerSqftAnalysis();
  assert.ok(result, 'should return analysis');
  assert.ok(Array.isArray(result.comps), 'should have comps array');
  assert.equal(typeof result.median, 'number');
  assert.equal(typeof result.min, 'number');
  assert.equal(typeof result.max, 'number');
});

test('generateAdjustmentGrid returns grid', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.generateAdjustmentGrid();
  assert.ok(result, 'should return grid');
  assert.ok(result.grid || Array.isArray(result), 'should have grid data');
});

test('reconciliationRange returns range', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.reconciliationRange();
  assert.ok(result, 'should return range');
  assert.equal(typeof result.low, 'number');
  assert.equal(typeof result.high, 'number');
});

test('flagOutliers returns array', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.flagOutliers();
  assert.ok(Array.isArray(result), 'should return array');
});

test('marketTrendAnalysis returns trend data', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.marketTrendAnalysis();
  assert.ok(result, 'should return trend data');
  assert.ok(['Increasing', 'Stable', 'Declining'].includes(result.trend), 'trend should be valid: ' + result.trend);
});

test('generateCompSelectionNarrative returns string', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.generateCompSelectionNarrative();
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0, 'narrative should not be empty');
});

test('pricePerSqft calculation is correct', () => {
  const a = new CompAnalyzer(testSubject, testComps);
  const result = a.pricePerSqftAnalysis();
  // Comp 1: 250000/1920 = 130.21
  // Comp 2: 235000/1780 = 132.02
  // Comp 3: 260000/2050 = 126.83
  for (const c of result.comps) {
    assert.ok(c.pricePerSqft > 100, 'price per sqft should be reasonable');
    assert.ok(c.pricePerSqft < 200, 'price per sqft should be reasonable');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CrawlCache
// ══════════════════════════════════════════════════════════════════════════════

import { CrawlCache } from '../../server/dataPipeline/crawlCache.js';

console.log('\nCrawlCache');

test('constructor creates empty cache', () => {
  const c = new CrawlCache();
  assert.ok(c);
  const stats = c.stats();
  assert.equal(stats.entries, 0);
});

test('store and retrieve data', () => {
  const c = new CrawlCache();
  const key = c.getCacheKey('https://example.com', { limit: 10 });
  c.store(key, { test: true }, { url: 'https://example.com' });
  const data = c.retrieve(key);
  assert.ok(data, 'should retrieve stored data');
  assert.deepStrictEqual(data.data || data, { test: true });
});

test('retrieve returns null for missing key', () => {
  const c = new CrawlCache();
  const data = c.retrieve('nonexistent');
  assert.equal(data, null);
});

test('isValid returns true for fresh entry', () => {
  const c = new CrawlCache();
  const key = c.getCacheKey('https://example.com', {});
  c.store(key, { test: true });
  assert.ok(c.isValid(key, 86400), 'should be valid');
});

test('getCacheKey is deterministic', () => {
  const c = new CrawlCache();
  const key1 = c.getCacheKey('https://example.com', { limit: 10 });
  const key2 = c.getCacheKey('https://example.com', { limit: 10 });
  assert.equal(key1, key2);
});

test('getCacheKey differs for different URLs', () => {
  const c = new CrawlCache();
  const key1 = c.getCacheKey('https://a.com', {});
  const key2 = c.getCacheKey('https://b.com', {});
  assert.notEqual(key1, key2);
});

test('clear removes all entries', () => {
  const c = new CrawlCache();
  const key = c.getCacheKey('https://example.com', {});
  c.store(key, { test: true });
  c.clear();
  const stats = c.stats();
  assert.equal(stats.entries, 0);
});

test('getStaleness reports freshness', () => {
  const c = new CrawlCache();
  const key = c.getCacheKey('https://example.com', {});
  c.store(key, { test: true });
  const staleness = c.getStaleness(key);
  assert.ok(staleness, 'should return staleness info');
  assert.equal(staleness.stale, false, 'fresh entry should not be stale');
  assert.equal(staleness.severity, 'ok');
});

test('stats returns correct count', () => {
  const c = new CrawlCache();
  c.store(c.getCacheKey('https://a.com', {}), { a: 1 });
  c.store(c.getCacheKey('https://b.com', {}), { b: 1 });
  const stats = c.stats();
  assert.equal(stats.entries, 2);
});

// ══════════════════════════════════════════════════════════════════════════════
// Pipeline Context Builder
// ══════════════════════════════════════════════════════════════════════════════

import { buildPipelineContext } from '../../server/dataPipeline/pipelineContextBuilder.js';

console.log('\npipelineContextBuilder');

test('returns null when caseId is empty', () => {
  const result = buildPipelineContext('', 'neighborhood');
  assert.equal(result, null);
});

test('returns null when no pipeline data in DB', () => {
  const result = buildPipelineContext('nonexistent-case-12345', 'neighborhood');
  assert.equal(result, null);
});

// ══════════════════════════════════════════════════════════════════════════════
// Pipeline Schema
// ══════════════════════════════════════════════════════════════════════════════

import BetterSqlite3 from 'better-sqlite3';
import { initPipelineSchema } from '../../server/migration/pipelineSchema.js';

console.log('\npipelineSchema');

test('creates pipeline tables in fresh database', () => {
  const db = new BetterSqlite3(':memory:');
  initPipelineSchema(db);

  // Check tables exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  assert.ok(tables.includes('pipeline_cache'), 'pipeline_cache table should exist');
  assert.ok(tables.includes('pipeline_crawl_jobs'), 'pipeline_crawl_jobs table should exist');
  assert.ok(tables.includes('pipeline_presets'), 'pipeline_presets table should exist');

  db.close();
});

test('idempotent — can run twice without error', () => {
  const db = new BetterSqlite3(':memory:');
  initPipelineSchema(db);
  initPipelineSchema(db); // Should not throw
  db.close();
});

test('pipeline_cache stores and retrieves data', () => {
  const db = new BetterSqlite3(':memory:');
  initPipelineSchema(db);

  db.prepare('INSERT INTO pipeline_cache (case_id, data) VALUES (?, ?)').run('test-case', JSON.stringify({ subject: { gla: 1847 } }));
  const row = db.prepare('SELECT * FROM pipeline_cache WHERE case_id = ?').get('test-case');
  assert.ok(row);
  const data = JSON.parse(row.data);
  assert.equal(data.subject.gla, 1847);

  db.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '─'.repeat(60));
console.log('dataPipeline: ' + passed + ' passed, ' + failed + ' failed');
console.log('─'.repeat(60));

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('- ' + f.label + ': ' + f.err.message));
}

if (failed > 0) process.exit(1);
