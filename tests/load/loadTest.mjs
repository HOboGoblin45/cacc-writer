#!/usr/bin/env node

/**
 * CACC Writer Load Test
 * Main load testing script using Node.js native fetch
 *
 * Usage:
 *   node tests/load/loadTest.mjs
 *
 * Environment Variables:
 *   TARGET_URL         - Base URL (default: http://localhost:5178)
 *   CONCURRENCY        - Number of concurrent requests (default: 10)
 *   DURATION_SECONDS   - Test duration in seconds (default: 60)
 *   RAMP_UP_SECONDS    - Ramp-up phase duration (default: 10)
 *   AUTH_TOKEN         - Optional JWT token (if not provided, will attempt login)
 */

import { performance } from 'perf_hooks';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5178';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const DURATION_SECONDS = parseInt(process.env.DURATION_SECONDS || '60', 10);
const RAMP_UP_SECONDS = parseInt(process.env.RAMP_UP_SECONDS || '10', 10);

// Endpoint definitions with weights
const ENDPOINTS = [
  { path: '/api/health/live', method: 'GET', weight: 0.15, requiresAuth: false, name: 'Health-Live' },
  { path: '/api/health/ready', method: 'GET', weight: 0.15, requiresAuth: false, name: 'Health-Ready' },
  { path: '/api/auth/login', method: 'POST', weight: 0.20, requiresAuth: false, name: 'Auth-Login' },
  { path: '/api/cases', method: 'GET', weight: 0.25, requiresAuth: true, name: 'Cases-List' },
  { path: '/api/cases', method: 'POST', weight: 0.15, requiresAuth: true, name: 'Cases-Create' },
  { path: '/api/brain/config', method: 'GET', weight: 0.05, requiresAuth: false, name: 'Brain-Config' },
  { path: '/api/qc/run', method: 'POST', weight: 0.05, requiresAuth: true, name: 'QC-Run' },
];

// Metrics collection
const metrics = {
  totalRequests: 0,
  totalErrors: 0,
  statusCodes: {},
  latencies: [],
  errorDetails: [],
  startTime: 0,
  endTime: 0,
};

let authToken = process.env.AUTH_TOKEN || null;

/**
 * Obtain authentication token
 */
async function getAuthToken() {
  if (authToken) return authToken;

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
      console.log('✓ Authentication successful');
      return authToken;
    } else {
      console.warn('⚠ Authentication failed, proceeding without token');
      return null;
    }
  } catch (error) {
    console.warn('⚠ Failed to obtain auth token:', error.message);
    return null;
  }
}

/**
 * Select a weighted random endpoint
 */
function selectEndpoint() {
  const random = Math.random();
  let cumulative = 0;

  for (const endpoint of ENDPOINTS) {
    cumulative += endpoint.weight;
    if (random <= cumulative) {
      return endpoint;
    }
  }

  return ENDPOINTS[ENDPOINTS.length - 1];
}

/**
 * Execute a single request
 */
async function executeRequest(endpoint) {
  const startTime = performance.now();
  let statusCode = 0;
  let error = null;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (endpoint.requiresAuth && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const options = { method: endpoint.method, headers };

    // Add body for POST requests
    if (endpoint.method === 'POST') {
      if (endpoint.path === '/api/cases') {
        options.body = JSON.stringify({
          propertyAddress: '123 Test St, City, ST 12345',
          propertyType: 'single-family',
          appraisalType: 'refinance',
        });
      } else if (endpoint.path === '/api/qc/run') {
        options.body = JSON.stringify({ caseId: 'test-case-id' });
      } else if (endpoint.path === '/api/auth/login') {
        options.body = JSON.stringify({
          email: `test-${Date.now()}@example.com`,
          password: 'testPassword123!',
        });
      }
    }

    const response = await fetch(`${TARGET_URL}${endpoint.path}`, options);
    statusCode = response.status;

    // Consume response body
    await response.text();
  } catch (err) {
    error = err.message;
    statusCode = 0;
  }

  const endTime = performance.now();
  const latency = endTime - startTime;

  return { statusCode, latency, error };
}

/**
 * Record metrics from a request
 */
function recordMetric(endpoint, result) {
  metrics.totalRequests++;

  if (result.error) {
    metrics.totalErrors++;
    metrics.errorDetails.push({
      endpoint: endpoint.name,
      error: result.error,
      timestamp: new Date().toISOString(),
    });
  }

  metrics.latencies.push({
    endpoint: endpoint.name,
    latency: result.latency,
    statusCode: result.statusCode,
  });

  metrics.statusCodes[result.statusCode] = (metrics.statusCodes[result.statusCode] || 0) + 1;
}

/**
 * Calculate percentiles
 */
function getPercentile(sortedArray, percentile) {
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Print real-time progress
 */
function printProgress(elapsedSeconds) {
  const requestsPerSecond = metrics.totalRequests / elapsedSeconds;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  if (metrics.latencies.length > 0) {
    const latencies = metrics.latencies.map(m => m.latency).sort((a, b) => a - b);
    const p50 = getPercentile(latencies, 50);
    const p95 = getPercentile(latencies, 95);

    process.stdout.write(
      `\r[${elapsedSeconds.toFixed(1)}s] ` +
      `Req/s: ${requestsPerSecond.toFixed(2)} | ` +
      `Total: ${metrics.totalRequests} | ` +
      `Errors: ${metrics.totalErrors} (${errorRate.toFixed(1)}%) | ` +
      `p50: ${p50.toFixed(0)}ms | p95: ${p95.toFixed(0)}ms`
    );
  }
}

/**
 * Print final summary
 */
function printSummary() {
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('                    LOAD TEST SUMMARY                        ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const requestsPerSecond = metrics.totalRequests / duration;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  console.log(`Test Duration:       ${duration.toFixed(2)}s`);
  console.log(`Total Requests:      ${metrics.totalRequests}`);
  console.log(`Requests/sec:        ${requestsPerSecond.toFixed(2)}`);
  console.log(`Total Errors:        ${metrics.totalErrors} (${errorRate.toFixed(2)}%)`);

  // Latency percentiles
  if (metrics.latencies.length > 0) {
    const latencies = metrics.latencies.map(m => m.latency).sort((a, b) => a - b);
    const p50 = getPercentile(latencies, 50);
    const p75 = getPercentile(latencies, 75);
    const p90 = getPercentile(latencies, 90);
    const p95 = getPercentile(latencies, 95);
    const p99 = getPercentile(latencies, 99);

    console.log('\nLatency Percentiles:');
    console.log(`  p50:               ${p50.toFixed(0)}ms`);
    console.log(`  p75:               ${p75.toFixed(0)}ms`);
    console.log(`  p90:               ${p90.toFixed(0)}ms`);
    console.log(`  p95:               ${p95.toFixed(0)}ms`);
    console.log(`  p99:               ${p99.toFixed(0)}ms`);
    console.log(`  min:               ${Math.min(...latencies).toFixed(0)}ms`);
    console.log(`  max:               ${Math.max(...latencies).toFixed(0)}ms`);
  }

  // Status codes
  console.log('\nStatus Code Distribution:');
  for (const [code, count] of Object.entries(metrics.statusCodes).sort()) {
    const percentage = ((count / metrics.totalRequests) * 100).toFixed(1);
    console.log(`  ${code}:               ${count} (${percentage}%)`);
  }

  // Endpoint breakdown
  console.log('\nRequests by Endpoint:');
  const endpointStats = {};
  for (const latency of metrics.latencies) {
    if (!endpointStats[latency.endpoint]) {
      endpointStats[latency.endpoint] = { count: 0, totalLatency: 0 };
    }
    endpointStats[latency.endpoint].count++;
    endpointStats[latency.endpoint].totalLatency += latency.latency;
  }

  for (const [endpoint, stats] of Object.entries(endpointStats).sort()) {
    const avgLatency = stats.totalLatency / stats.count;
    console.log(`  ${endpoint.padEnd(15)}: ${stats.count} requests, avg ${avgLatency.toFixed(0)}ms`);
  }

  // Error details
  if (metrics.errorDetails.length > 0 && metrics.errorDetails.length <= 10) {
    console.log('\nSample Errors:');
    for (const error of metrics.errorDetails.slice(0, 10)) {
      console.log(`  ${error.endpoint}: ${error.error}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');

  // Determine exit code
  if (errorRate > 5) {
    console.log('⚠ FAIL: Error rate exceeds 5%\n');
    return 1;
  }

  if (metrics.latencies.length > 0) {
    const latencies = metrics.latencies.map(m => m.latency).sort((a, b) => a - b);
    const p99 = getPercentile(latencies, 99);
    if (p99 > 5000) {
      console.log('⚠ FAIL: p99 latency exceeds 5000ms\n');
      return 1;
    }
  }

  console.log('✓ PASS: Load test completed successfully\n');
  return 0;
}

/**
 * Main load test execution
 */
async function runLoadTest() {
  console.log('CACC Writer Load Test');
  console.log(`Target URL:        ${TARGET_URL}`);
  console.log(`Concurrency:       ${CONCURRENCY}`);
  console.log(`Duration:          ${DURATION_SECONDS}s`);
  console.log(`Ramp-up:           ${RAMP_UP_SECONDS}s`);
  console.log('');

  // Get auth token if needed
  const hasProtectedEndpoints = ENDPOINTS.some(e => e.requiresAuth);
  if (hasProtectedEndpoints) {
    await getAuthToken();
  }

  metrics.startTime = performance.now();
  const testEndTime = metrics.startTime + DURATION_SECONDS * 1000;
  let progressInterval;

  try {
    let concurrentCount = 0;
    const targetConcurrency = CONCURRENCY;
    let rampUpEndTime = metrics.startTime + RAMP_UP_SECONDS * 1000;

    // Start progress reporting
    progressInterval = setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = (now - metrics.startTime) / 1000;
      printProgress(elapsedSeconds);
    }, 5000);

    console.log('Starting load test...\n');

    // Worker function for continuous requests
    const makeRequests = async () => {
      while (true) {
        const now = performance.now();
        if (now >= testEndTime) break;

        const endpoint = selectEndpoint();
        const result = await executeRequest(endpoint);
        recordMetric(endpoint, result);

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };

    // Ramp-up phase
    const rampUpWorkers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      rampUpWorkers.push(makeRequests());
    }

    // Wait for all workers to complete
    await Promise.all(rampUpWorkers);

    metrics.endTime = performance.now();
  } finally {
    if (progressInterval) clearInterval(progressInterval);
  }

  // Print summary and determine exit code
  const exitCode = printSummary();
  process.exit(exitCode);
}

// Run the test
runLoadTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
