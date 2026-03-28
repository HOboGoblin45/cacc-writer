#!/usr/bin/env node

/**
 * CACC Writer Soak Test
 * Long-running stability test (30 minutes) to detect memory leaks and degradation
 *
 * Usage:
 *   node tests/load/scenarios/soak.mjs
 *
 * Environment Variables:
 *   TARGET_URL  - Base URL (default: http://localhost:5178)
 *   DURATION_MINUTES - Test duration in minutes (default: 30)
 *   AUTH_TOKEN  - Optional JWT token
 */

import { performance } from 'perf_hooks';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5178';
const DURATION_MINUTES = parseInt(process.env.DURATION_MINUTES || '30', 10);
const DURATION_SECONDS = DURATION_MINUTES * 60;
const CONCURRENCY = 10;

const ENDPOINTS = [
  { path: '/api/health/live', method: 'GET', weight: 0.30, requiresAuth: false, name: 'Health-Live' },
  { path: '/api/health/ready', method: 'GET', weight: 0.30, requiresAuth: false, name: 'Health-Ready' },
  { path: '/api/cases', method: 'GET', weight: 0.20, requiresAuth: true, name: 'Cases-List' },
  { path: '/api/cases', method: 'POST', weight: 0.10, requiresAuth: true, name: 'Cases-Create' },
  { path: '/api/brain/config', method: 'GET', weight: 0.10, requiresAuth: false, name: 'Brain-Config' },
];

const metrics = {
  totalRequests: 0,
  totalErrors: 0,
  statusCodes: {},
  latencies: [],
  startTime: 0,
  endTime: 0,
  // Track degradation
  latencyHistory: [], // Array of { time, p50, p95, p99 }
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
        email: 'soak-test@example.com',
        password: 'testPassword123!',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      authToken = data.token;
      return authToken;
    }
  } catch (error) {
    // Continue without auth
  }
  return null;
}

/**
 * Select weighted random endpoint
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
 * Execute single request
 */
async function executeRequest(endpoint) {
  const startTime = performance.now();
  let statusCode = 0;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (endpoint.requiresAuth && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const options = { method: endpoint.method, headers };

    if (endpoint.method === 'POST') {
      if (endpoint.path === '/api/cases') {
        options.body = JSON.stringify({
          propertyAddress: `Soak Test Property ${Date.now()}`,
          propertyType: 'single-family',
          appraisalType: 'refinance',
        });
      }
    }

    const response = await fetch(`${TARGET_URL}${endpoint.path}`, options);
    statusCode = response.status;
    await response.text();
  } catch (err) {
    statusCode = 0;
  }

  const latency = performance.now() - startTime;
  return { statusCode, latency };
}

/**
 * Record metric
 */
function recordMetric(endpoint, result) {
  metrics.totalRequests++;

  if (result.statusCode === 0 || result.statusCode >= 400) {
    metrics.totalErrors++;
  }

  metrics.latencies.push(result.latency);
  metrics.statusCodes[result.statusCode] = (metrics.statusCodes[result.statusCode] || 0) + 1;
}

/**
 * Get percentile
 */
function getPercentile(sortedArray, percentile) {
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Print progress with degradation detection
 */
function printProgress(elapsedSeconds) {
  const rps = metrics.totalRequests / elapsedSeconds;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  if (metrics.latencies.length > 0) {
    const latencies = [...metrics.latencies].sort((a, b) => a - b);
    const p50 = getPercentile(latencies, 50);
    const p95 = getPercentile(latencies, 95);
    const p99 = getPercentile(latencies, 99);

    // Track history for degradation analysis
    metrics.latencyHistory.push({
      time: new Date().toISOString(),
      p50,
      p95,
      p99,
      totalRequests: metrics.totalRequests,
    });

    process.stdout.write(
      `\r[${(elapsedSeconds / 60).toFixed(1)}m/${DURATION_MINUTES}m] ` +
      `${rps.toFixed(1)} req/s | ` +
      `p50: ${p50.toFixed(0)}ms p95: ${p95.toFixed(0)}ms p99: ${p99.toFixed(0)}ms | ` +
      `Errors: ${errorRate.toFixed(1)}%`
    );
  }
}

/**
 * Check for degradation
 */
function checkDegradation() {
  if (metrics.latencyHistory.length < 2) return null;

  const first = metrics.latencyHistory[0];
  const last = metrics.latencyHistory[metrics.latencyHistory.length - 1];

  const p99Degradation = ((last.p99 - first.p99) / first.p99) * 100;

  return {
    p99Start: first.p99,
    p99End: last.p99,
    p99DegradationPercent: p99Degradation,
    isDegraded: p99Degradation > 20, // Alert if > 20% degradation
  };
}

/**
 * Print final summary
 */
function printSummary() {
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('                 SOAK TEST SUMMARY                            ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const rps = metrics.totalRequests / duration;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  console.log(`Concurrency:         ${CONCURRENCY} users`);
  console.log(`Test Duration:       ${(duration / 60).toFixed(1)} minutes`);
  console.log(`Total Requests:      ${metrics.totalRequests}`);
  console.log(`Requests/sec:        ${rps.toFixed(2)}`);
  console.log(`Total Errors:        ${metrics.totalErrors} (${errorRate.toFixed(2)}%)\n`);

  // Latency analysis
  if (metrics.latencies.length > 0) {
    const sortedLatencies = [...metrics.latencies].sort((a, b) => a - b);

    console.log('Latency Distribution:');
    console.log(`  Min:               ${Math.min(...metrics.latencies).toFixed(0)}ms`);
    console.log(`  p50:               ${getPercentile(sortedLatencies, 50).toFixed(0)}ms`);
    console.log(`  p95:               ${getPercentile(sortedLatencies, 95).toFixed(0)}ms`);
    console.log(`  p99:               ${getPercentile(sortedLatencies, 99).toFixed(0)}ms`);
    console.log(`  Max:               ${Math.max(...metrics.latencies).toFixed(0)}ms\n`);
  }

  // Status codes
  console.log('Status Code Distribution:');
  for (const [code, count] of Object.entries(metrics.statusCodes).sort()) {
    const percentage = ((count / metrics.totalRequests) * 100).toFixed(1);
    console.log(`  ${code}:               ${count} (${percentage}%)`);
  }

  // Degradation analysis
  console.log('\nStability Analysis:');
  const degradation = checkDegradation();
  if (degradation) {
    console.log(`  p99 Start:         ${degradation.p99Start.toFixed(0)}ms`);
    console.log(`  p99 End:           ${degradation.p99End.toFixed(0)}ms`);
    console.log(`  p99 Degradation:   ${degradation.p99DegradationPercent.toFixed(1)}%`);
    console.log(
      `  Status:            ${degradation.isDegraded ? '⚠ DEGRADATION DETECTED' : '✓ Stable'}`
    );

    // Print samples of latency history
    console.log('\n  Latency History (samples):');
    const step = Math.max(1, Math.floor(metrics.latencyHistory.length / 5));
    for (let i = 0; i < metrics.latencyHistory.length; i += step) {
      const h = metrics.latencyHistory[i];
      const elapsed = (i * 300) / 60; // Approximate elapsed time (300s between updates)
      console.log(
        `    [${(elapsed / 60).toFixed(1)}m] p50: ${h.p50.toFixed(0)}ms p95: ${h.p95.toFixed(0)}ms p99: ${h.p99.toFixed(0)}ms`
      );
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              CACC Writer Soak Test                            ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Target URL:        ${TARGET_URL}`);
  console.log(`Concurrency:       ${CONCURRENCY} users`);
  console.log(`Duration:          ${DURATION_MINUTES} minutes`);
  console.log(`Monitoring:        Memory leaks, latency degradation\n`);

  // Authenticate
  await getAuthToken();

  metrics.startTime = performance.now();
  const testEndTime = metrics.startTime + DURATION_SECONDS * 1000;
  let progressInterval;

  try {
    progressInterval = setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = (now - metrics.startTime) / 1000;
      printProgress(elapsedSeconds);
    }, 300000); // Update every 5 minutes

    console.log('Starting soak test...\n');

    const makeRequests = async () => {
      while (true) {
        const now = performance.now();
        if (now >= testEndTime) break;

        const endpoint = selectEndpoint();
        const result = await executeRequest(endpoint);
        recordMetric(endpoint, result);

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(makeRequests());
    }

    await Promise.all(workers);
    metrics.endTime = performance.now();
  } finally {
    if (progressInterval) clearInterval(progressInterval);
  }

  printSummary();
  process.exit(0);
}

runTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
