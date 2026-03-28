#!/usr/bin/env node

/**
 * CACC Writer Smoke Test
 * Quick validation that all endpoints are responding
 *
 * Usage:
 *   node tests/load/smokeTest.mjs
 *
 * Environment Variables:
 *   TARGET_URL  - Base URL (default: http://localhost:5178)
 *   AUTH_TOKEN  - Optional JWT token (if not provided, will attempt login)
 */

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5178';

const SMOKE_TESTS = [
  { name: 'Health Liveness', method: 'GET', path: '/api/health/live', requiresAuth: false },
  { name: 'Health Readiness', method: 'GET', path: '/api/health/ready', requiresAuth: false },
  { name: 'Brain Config', method: 'GET', path: '/api/brain/config', requiresAuth: false },
];

let authToken = process.env.AUTH_TOKEN || null;

/**
 * Attempt authentication
 */
async function authenticate() {
  if (authToken) return true;

  try {
    const response = await fetch(`${TARGET_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testPassword123!',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      authToken = data.token;
      console.log('✓ Authentication successful\n');
      return true;
    } else {
      console.log('⚠ Authentication failed, some endpoints may fail\n');
      return false;
    }
  } catch (error) {
    console.log(`⚠ Authentication error: ${error.message}\n`);
    return false;
  }
}

/**
 * Run a single smoke test
 */
async function runTest(test) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (test.requiresAuth && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const options = {
      method: test.method,
      headers,
    };

    const response = await fetch(`${TARGET_URL}${test.path}`, options);

    // Consume body
    await response.text();

    if (response.ok) {
      console.log(`✓ ${test.name.padEnd(25)} [${response.status}]`);
      return true;
    } else {
      console.log(`✗ ${test.name.padEnd(25)} [${response.status}]`);
      return false;
    }
  } catch (error) {
    console.log(`✗ ${test.name.padEnd(25)} [ERROR: ${error.message}]`);
    return false;
  }
}

/**
 * Main smoke test execution
 */
async function runSmokeTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              CACC Writer Smoke Test                           ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Target: ${TARGET_URL}\n`);

  // Authenticate if needed
  await authenticate();

  // Run all tests
  console.log('Running smoke tests...\n');
  const results = [];

  for (const test of SMOKE_TESTS) {
    const passed = await runTest(test);
    results.push({ test: test.name, passed });
  }

  // Print summary
  const passCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  console.log(`\n${'─'.repeat(63)}`);
  console.log(`Results: ${passCount}/${totalCount} passed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (passCount === totalCount) {
    console.log('✓ All smoke tests passed');
    process.exit(0);
  } else {
    console.log('✗ Some smoke tests failed');
    process.exit(1);
  }
}

// Run the smoke test
runSmokeTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
