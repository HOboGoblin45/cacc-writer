#!/usr/bin/env node

/**
 * CACC Writer Peak Hours Load Test
 * Simulates peak usage patterns: 50 concurrent users, 5-minute duration
 *
 * Usage:
 *   node tests/load/scenarios/peakHours.mjs
 *
 * Environment Variables:
 *   TARGET_URL  - Base URL (default: http://localhost:5178)
 *   AUTH_TOKEN  - Optional JWT token
 */

import { performance } from 'perf_hooks';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5178';
const CONCURRENCY = 50;
const DURATION_SECONDS = 5 * 60; // 5 minutes
const RAMP_UP_SECONDS = 30; // 30 second ramp-up

// Peak hours: 80% reads, 20% writes
const ENDPOINTS = [
  { path: '/api/health/live', method: 'GET', weight: 0.15, requiresAuth: false, name: 'Health-Live' },
  { path: '/api/health/ready', method: 'GET', weight: 0.15, requiresAuth: false, name: 'Health-Ready' },
  { path: '/api/cases', method: 'GET', weight: 0.40, requiresAuth: true, name: 'Cases-List' },
  { path: '/api/cases', method: 'POST', weight: 0.10, requiresAuth: true, name: 'Cases-Create' },
  { path: '/api/brain/config', method: 'GET', weight: 0.10, requiresAuth: false, name: 'Brain-Config' },
  { path: '/api/qc/run', method: 'POST', weight: 0.10, requiresAuth: true, name: 'QC-Run' },
];

const metrics = {
  totalRequests: 0,
  totalErrors: 0,
  statusCodes: {},
  latencies: [],
  errorDetails: [],
  startTime: 0,
  endTime: 0,
  byEndpoint: {},
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
        email: 'peak-test@example.com',
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
          propertyAddress: `Test Property ${Date.now()}`,
          propertyType: 'single-family',
          appraisalType: 'refinance',
        });
      } else if (endpoint.path === '/api/qc/run') {
        options.body = JSON.stringify({ caseId: 'peak-test-case' });
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

  metrics.latencies.push({
    endpoint: endpoint.name,
    latency: result.latency,
    statusCode: result.statusCode,
  });

  metrics.statusCodes[result.statusCode] = (metrics.statusCodes[result.statusCode] || 0) + 1;

  if (!metrics.byEndpoint[endpoint.name]) {
    metrics.byEndpoint[endpoint.name] = { count: 0, totalLatency: 0, errors: 0 };
  }
  metrics.byEndpoint[endpoint.name].count++;
  metrics.byEndpoint[endpoint.name].totalLatency += result.latency;
  if (result.statusCode === 0 || result.statusCode >= 400) {
    metrics.byEndpoint[endpoint.name].errors++;
  }
}

/**
 * Get percentile
 */
function getPercentile(sortedArray, percentile) {
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Print progress
 */
function printProgress(elapsedSeconds) {
  const rps = metrics.totalRequests / elapsedSeconds;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  if (metrics.latencies.length > 0) {
    const latencies = metrics.latencies.map(m => m.latency).sort((a, b) => a - b);
    const p50 = getPercentile(latencies, 50);
    const p95 = getPercentile(latencies, 95);
    const p99 = getPercentile(latencies, 99);

    process.stdout.write(
      `\r[${elapsedSeconds.toFixed(0)}s/${DURATION_SECONDS}s] ` +
      `${rps.toFixed(1)} req/s | ` +
      `p50: ${p50.toFixed(0)}ms p95: ${p95.toFixed(0)}ms p99: ${p99.toFixed(0)}ms | ` +
      `Errors: ${errorRate.toFixed(1)}%`
    );
  }
}

/**
 * Print final summary
 */
function printSummary() {
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('              PEAK HOURS LOAD TEST SUMMARY                    ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const rps = metrics.totalRequests / duration;
  const errorRate = (metrics.totalErrors / metrics.totalRequests) * 100 || 0;

  console.log(`Concurrency:         ${CONCURRENCY} users`);
  console.log(`Test Duration:       ${duration.toFixed(2)}s`);
  console.log(`Total Requests:      ${metrics.totalRequests}`);
  console.log(`Requests/sec:        ${rps.toFixed(2)}`);
  console.log(`Total Errors:        ${metrics.totalErrors} (${errorRate.toFixed(2)}%)\n`);

  // Latency distribution
  if (metrics.latencies.length > 0) {
    const latencies = metrics.latencies.map(m => m.latency).sort((a, b) => a - b);

    console.log('Latency Distribution:');
    console.log(`  Min:               ${Math.min(...latencies).toFixed(0)}ms`);
    console.log(`  p25:               ${getPercentile(latencies, 25).toFixed(0)}ms`);
    console.log(`  p50:               ${getPercentile(latencies, 50).toFixed(0)}ms`);
    console.log(`  p75:               ${getPercentile(latencies, 75).toFixed(0)}ms`);
    console.log(`  p90:               ${getPercentile(latencies, 90).toFixed(0)}ms`);
    console.log(`  p95:               ${getPercentile(latencies, 95).toFixed(0)}ms`);
    console.log(`  p99:               ${getPercentile(latencies, 99).toFixed(0)}ms`);
    console.log(`  Max:               ${Math.max(...latencies).toFixed(0)}ms\n`);
  }

  // Endpoint performance
  console.log('Performance by Endpoint:');
  for (const [endpoint, stats] of Object.entries(metrics.byEndpoint).sort()) {
    const avgLatency = stats.count > 0 ? stats.totalLatency / stats.count : 0;
    const errorPct = stats.count > 0 ? (stats.errors / stats.count) * 100 : 0;
    console.log(
      `  ${endpoint.padEnd(15)}: ` +
      `${stats.count} reqs, ` +
      `${avgLatency.toFixed(0)}ms avg, ` +
      `${errorPct.toFixed(1)}% errors`
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           CACC Writer Peak Hours Load Test                    ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Target URL:        ${TARGET_URL}`);
  console.log(`Concurrency:       ${CONCURRENCY} users`);
  console.log(`Duration:          ${DURATION_SECONDS}s (${(DURATION_SECONDS / 60).toFixed(1)} minutes)`);
  console.log(`Ramp-up:           ${RAMP_UP_SECONDS}s`);
  console.log(`Profile:           80% reads, 20% writes\n`);

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
    }, 5000);

    console.log('Starting load test...\n');

    const makeRequests = async () => {
      while (true) {
        const now = performance.now();
        if (now >= testEndTime) break;

        const endpoint = selectEndpoint();
        const result = await executeRequest(endpoint);
        recordMetric(endpoint, result);

        await new Promise(resolve => setTimeout(resolve, 10));
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
