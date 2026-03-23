/**
 * tests/quality.test.mjs — Narrative Quality Tests
 * Generates each section type and verifies professional quality:
 *   - No [INSERT] placeholders
 *   - Length > 30 chars
 *   - Professional language (no "I think", no "hello")
 *   - Neighborhood mentions boundary roads from facts
 *   - Market conditions mentions "financing" or "rates"
 *   - Reconciliation mentions "Sales Comparison Approach"
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'https://appraisal-agent.com';
const API_KEY = 'cacc-local-key-2026';

// Test facts with known boundaries for verifiable assertions
const TEST_FACTS = {
  subjectAddress: '789 Quality Check Dr',
  city: 'Naperville',
  state: 'IL',
  zip: '60540',
  grossLivingArea: '2100',
  bedrooms: '4',
  bathrooms: '2.5',
  yearBuilt: '2001',
  propertyType: 'Single Family',
  // Boundary roads — must appear in neighborhood narrative
  northBoundary: 'Jefferson Boulevard',
  southBoundary: 'Harrison Avenue',
  eastBoundary: 'Washington Street',
  westBoundary: 'Lincoln Parkway',
  // For market conditions
  marketTrend: 'increasing',
  daysOnMarket: '30',
};

let authToken = null;
let testCaseId = null;

async function api(method, path, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a section and return the text */
async function generateSection(section) {
  const { status, data } = await api(
    'POST',
    '/api/generate',
    {
      caseId: testCaseId,
      section,
      facts: TEST_FACTS,
      forceGateBypass: true,
    },
    authToken
  );
  if (status !== 200 && status !== 201) {
    throw new Error(`Generate ${section} failed with ${status}: ${JSON.stringify(data)}`);
  }
  return (
    data.result ??
    data.text ??
    data.content ??
    data.narrative ??
    data.sections?.[section] ??
    ''
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  // Login to get auth token
  const loginRes = await api('POST', '/api/auth/login', {
    email: `quality-test@cacc-quality.com`,
    password: 'QualityTest123!',
  });

  if (loginRes.status !== 200) {
    // Register first
    await api('POST', '/api/auth/register', {
      email: 'quality-test@cacc-quality.com',
      password: 'QualityTest123!',
      name: 'Quality Test User',
    });
    const loginRes2 = await api('POST', '/api/auth/login', {
      email: 'quality-test@cacc-quality.com',
      password: 'QualityTest123!',
    });
    authToken = loginRes2.data.token ?? loginRes2.data.accessToken;
  } else {
    authToken = loginRes.data.token ?? loginRes.data.accessToken;
  }

  // Create a test case
  const createRes = await api(
    'POST',
    '/api/cases/create',
    {
      address: `${TEST_FACTS.subjectAddress}, ${TEST_FACTS.city}, ${TEST_FACTS.state}`,
      formType: '1004',
      clientName: 'Quality Test',
    },
    authToken
  );
  testCaseId = createRes.data.caseId ?? createRes.data.id;

  // Save facts
  if (testCaseId) {
    await api('PUT', `/api/cases/${testCaseId}/facts`, TEST_FACTS, authToken);
  }
});

// ─── General Quality Checks ───────────────────────────────────────────────────

describe('Narrative Quality — General', { timeout: 60_000 }, () => {
  const sections = ['neighborhood', 'market_conditions', 'site', 'improvements', 'reconciliation'];

  for (const section of sections) {
    it(`${section} — no [INSERT] placeholders`, async () => {
      const text = await generateSection(section);
      assert.ok(text.length > 0, `Expected non-empty text for ${section}`);
      assert.ok(
        !text.includes('[INSERT]'),
        `${section} contains [INSERT] placeholder: "${text.substring(0, 200)}"`
      );
      await delay(1500);
    });

    it(`${section} — length > 30 chars`, async () => {
      const text = await generateSection(section);
      assert.ok(
        text.length > 30,
        `${section} narrative too short (${text.length} chars): "${text}"`
      );
      await delay(1500);
    });

    it(`${section} — professional language (no "I think", no casual greetings)`, async () => {
      const text = await generateSection(section);
      const lower = text.toLowerCase();
      assert.ok(
        !lower.includes('i think'),
        `${section} contains unprofessional "I think": "${text.substring(0, 200)}"`
      );
      assert.ok(
        !lower.startsWith('hello'),
        `${section} starts with "hello": "${text.substring(0, 100)}"`
      );
      assert.ok(
        !lower.includes('hey there'),
        `${section} contains casual "hey there"`
      );
      await delay(1500);
    });
  }
});

// ─── Section-Specific Quality Checks ─────────────────────────────────────────

describe('Narrative Quality — Neighborhood', { timeout: 60_000 }, () => {
  it('mentions boundary roads from facts', async () => {
    const text = await generateSection('neighborhood');
    // Check that at least some of the boundary roads appear
    const boundaries = [
      TEST_FACTS.northBoundary,
      TEST_FACTS.southBoundary,
      TEST_FACTS.eastBoundary,
      TEST_FACTS.westBoundary,
    ];
    const found = boundaries.filter((b) => text.includes(b));
    assert.ok(
      found.length >= 1,
      `Expected neighborhood to mention at least 1 boundary road from facts.\n` +
        `Boundaries: ${boundaries.join(', ')}\n` +
        `Text: "${text.substring(0, 300)}"`
    );
  });
});

describe('Narrative Quality — Market Conditions', { timeout: 60_000 }, () => {
  it('mentions "financing" or "rates"', async () => {
    const text = await generateSection('market_conditions');
    const lower = text.toLowerCase();
    assert.ok(
      lower.includes('financing') || lower.includes('rates') || lower.includes('interest'),
      `Expected market conditions to mention financing/rates/interest.\n` +
        `Text: "${text.substring(0, 300)}"`
    );
  });
});

describe('Narrative Quality — Reconciliation', { timeout: 60_000 }, () => {
  it('mentions "Sales Comparison Approach"', async () => {
    const text = await generateSection('reconciliation');
    assert.ok(
      text.includes('Sales Comparison Approach') ||
        text.includes('sales comparison approach') ||
        text.includes('Sales Comparison') ||
        text.toLowerCase().includes('sales comparison'),
      `Expected reconciliation to mention Sales Comparison Approach.\n` +
        `Text: "${text.substring(0, 300)}"`
    );
  });
});

// ─── No Placeholder Check — Comprehensive ────────────────────────────────────

describe('Narrative Quality — Placeholder Audit', { timeout: 90_000 }, () => {
  it('no section contains common placeholder patterns', async () => {
    const sections = ['neighborhood', 'market_conditions', 'site', 'reconciliation'];
    const placeholderPatterns = [
      /\[INSERT[^\]]*\]/gi,
      /\[PLACEHOLDER[^\]]*\]/gi,
      /\[FILL[^\]]*\]/gi,
      /\[TBD[^\]]*\]/gi,
      /\[TODO[^\]]*\]/gi,
      /\[ENTER[^\]]*\]/gi,
    ];

    const failures = [];
    for (const section of sections) {
      try {
        const text = await generateSection(section);
        for (const pattern of placeholderPatterns) {
          const matches = text.match(pattern);
          if (matches) {
            failures.push({ section, matches });
          }
        }
        await delay(1500);
      } catch (err) {
        failures.push({ section, error: err.message });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `Found placeholder patterns in sections:\n${JSON.stringify(failures, null, 2)}`
    );
  });
});
