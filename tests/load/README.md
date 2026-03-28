# CACC Writer Load Testing Guide

Comprehensive load testing suite for the CACC Writer Express.js application. All scripts use Node.js built-in fetch API (no external dependencies).

## Quick Start

```bash
# Start the CACC Writer server (if not already running)
npm start

# In another terminal, run a quick smoke test
npm run test:smoke

# Run the standard load test (10 concurrent users, 60 seconds)
npm run test:load

# Run peak hours simulation (50 concurrent users, 5 minutes)
npm run test:peak

# Run 30-minute soak test (memory leak detection)
npm run test:soak
```

## Test Scripts

### 1. **Smoke Test** (`smokeTest.mjs`)

A quick validation that all endpoints are responding correctly.

```bash
node tests/load/smokeTest.mjs
```

**What it tests:**
- GET /api/health/live
- GET /api/health/ready
- GET /api/brain/config

**Duration:** ~10 seconds

**When to use:**
- Pre-deployment validation
- Verify server is running
- Quick sanity check before longer tests

**Expected output:**
```
✓ Health Liveness             [200]
✓ Health Readiness            [200]
✓ Brain Config                [200]

Results: 3/3 passed
```

---

### 2. **Standard Load Test** (`loadTest.mjs`)

Main load testing script with configurable parameters and detailed metrics.

```bash
node tests/load/loadTest.mjs
```

**Configuration (via environment variables):**

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_URL` | `http://localhost:5178` | Server URL |
| `CONCURRENCY` | `10` | Concurrent requests |
| `DURATION_SECONDS` | `60` | Test duration |
| `RAMP_UP_SECONDS` | `10` | Initial ramp-up phase |
| `AUTH_TOKEN` | `none` | Optional JWT (auto-login if not provided) |

**Example with custom parameters:**
```bash
CONCURRENCY=50 DURATION_SECONDS=300 node tests/load/loadTest.mjs
```

**Endpoint Distribution:**
- Health checks (30%): High volume, fast baseline
- Case list (25%): Moderate complexity
- Case creation (15%): Write operation
- Authentication (20%): Login simulation
- Brain config (5%): Additional read
- QC run (5%): Slow/expensive operation

**Metrics Collected:**
- **Throughput:** Requests per second
- **Latency percentiles:** p50, p75, p90, p95, p99
- **Error rate:** Percentage of failed requests
- **Status codes:** Distribution across response codes
- **Per-endpoint breakdown:** Request count and average latency

**Sample output:**
```
═══════════════════════════════════════════════════════════════
                    LOAD TEST SUMMARY
═══════════════════════════════════════════════════════════════

Test Duration:       60.32s
Total Requests:      2847
Requests/sec:        47.19
Total Errors:        15 (0.53%)

Latency Percentiles:
  p50:               45ms
  p75:               82ms
  p90:               158ms
  p95:               224ms
  p99:               512ms
  min:               8ms
  max:               1847ms

Status Code Distribution:
  200:               2815 (98.88%)
  400:               12 (0.42%)
  500:               20 (0.70%)

Requests by Endpoint:
  Auth-Login:        570 requests, avg 102ms
  Brain-Config:      142 requests, avg 31ms
  Cases-Create:      427 requests, avg 145ms
  Cases-List:        712 requests, avg 38ms
  Health-Live:       428 requests, avg 12ms
  Health-Ready:      428 requests, avg 14ms
  QC-Run:            142 requests, avg 287ms

═══════════════════════════════════════════════════════════════
✓ PASS: Load test completed successfully
```

**Exit codes:**
- `0`: Success (all SLOs met)
- `1`: Failure (error rate > 5% OR p99 > 5000ms)

---

### 3. **Peak Hours Scenario** (`scenarios/peakHours.mjs`)

Simulates peak usage patterns with realistic concurrency and request distribution.

```bash
node tests/load/scenarios/peakHours.mjs
```

**Configuration:**
- Concurrency: 50 concurrent virtual users
- Duration: 5 minutes
- Ramp-up: 30 seconds
- Request mix: 80% reads, 20% writes

**When to use:**
- Validate capacity for peak hours
- Identify bottlenecks under load
- Test autoscaling triggers
- Verify write performance under contention

**Example output:**
```
═══════════════════════════════════════════════════════════════
              PEAK HOURS LOAD TEST SUMMARY
═══════════════════════════════════════════════════════════════

Concurrency:         50 users
Test Duration:       300.41s
Total Requests:      9246
Requests/sec:        30.78

Latency Distribution:
  Min:               5ms
  p25:               28ms
  p50:               52ms
  p75:               89ms
  p90:               156ms
  p95:               234ms
  p99:               689ms
  Max:               4521ms

Performance by Endpoint:
  Brain-Config:      462 reqs, 29ms avg, 0.0% errors
  Cases-Create:      462 reqs, 248ms avg, 0.2% errors
  Cases-List:        1848 reqs, 47ms avg, 0.1% errors
  Health-Live:       1848 reqs, 11ms avg, 0.0% errors
  Health-Ready:      1848 reqs, 13ms avg, 0.0% errors
  QC-Run:            462 reqs, 421ms avg, 0.4% errors
```

---

### 4. **Soak Test** (`scenarios/soak.mjs`)

Long-running stability test to detect memory leaks and performance degradation.

```bash
node tests/load/scenarios/soak.mjs
```

**Configuration:**
- Concurrency: 10 concurrent users
- Duration: 30 minutes (configurable via `DURATION_MINUTES` env var)
- Ramp-up: None (sustained load)
- Focus: Stability and degradation monitoring

**What it monitors:**
- Memory usage (via latency degradation)
- Connection stability
- Error accumulation
- Latency trends over time

**When to use:**
- After major code changes
- Before production deployment
- To validate infrastructure stability
- To detect slow memory leaks

**Run a shorter soak test:**
```bash
DURATION_MINUTES=10 node tests/load/scenarios/soak.mjs
```

**Example output:**
```
═══════════════════════════════════════════════════════════════
                 SOAK TEST SUMMARY
═══════════════════════════════════════════════════════════════

Concurrency:         10 users
Test Duration:       30.1 minutes
Total Requests:      12847
Requests/sec:        7.10
Total Errors:        18 (0.14%)

Latency Distribution:
  Min:               4ms
  p50:               42ms
  p95:               156ms
  p99:               378ms
  Max:               2104ms

Stability Analysis:
  p99 Start:         356ms
  p99 End:           382ms
  p99 Degradation:   7.3%
  Status:            ✓ Stable

  Latency History (samples):
    [0.0m] p50: 41ms p95: 148ms p99: 356ms
    [6.0m] p50: 42ms p95: 152ms p99: 368ms
    [12.0m] p50: 43ms p95: 158ms p99: 374ms
    [18.0m] p50: 42ms p95: 160ms p99: 380ms
    [24.0m] p50: 43ms p95: 162ms p99: 382ms
```

**Degradation alerts:**
- Triggers if p99 increases by more than 20%
- Indicates potential memory leaks or resource exhaustion

---

## Target SLOs (Service Level Objectives)

These are the performance targets for CACC Writer:

| Metric | Target | Impact |
|--------|--------|--------|
| **Read latency (p50)** | < 200ms | User experience |
| **Read latency (p99)** | < 2000ms | SLA compliance |
| **Write latency (p95)** | < 3000ms | Case creation experience |
| **Error rate** | < 1% | Reliability |
| **Health check latency** | < 50ms | Liveness monitoring |

## Interpreting Results

### Good Results
- ✓ p99 < 2000ms for reads
- ✓ p95 < 3000ms for writes
- ✓ Error rate < 1%
- ✓ Consistent latency over time (soak test)
- ✓ Health checks < 50ms

### Warning Signs
- ⚠ p99 increasing over time (memory leak)
- ⚠ Write latencies > 3000ms (database contention)
- ⚠ Error rate 1-5% (intermittent issues)
- ⚠ Occasional 500 errors (application errors)

### Critical Issues
- ✗ Error rate > 5% (systemic failure)
- ✗ p99 > 5000ms (unacceptable latency)
- ✗ Growing errors during soak (stability issue)
- ✗ All requests failing (service down)

---

## Environment-Specific Tuning

### Local Development
```bash
CONCURRENCY=5 DURATION_SECONDS=30 npm run test:load
```

### Staging Environment
```bash
TARGET_URL=https://staging.cacc.local \
CONCURRENCY=25 \
DURATION_SECONDS=300 \
npm run test:load
```

### Production Pre-Deployment
```bash
# 1. Smoke test
npm run test:smoke

# 2. Standard load test
npm run test:load

# 3. Peak simulation (if expecting traffic spike)
npm run test:peak
```

---

## Troubleshooting

### "Connection refused"
Server is not running. Start it with:
```bash
npm start
```

### "All requests failing with 401"
Authentication token issue. The tests attempt auto-login, but this requires valid test credentials.

**Solution:** Ensure the test user exists:
```bash
# Check server logs for failed auth attempts
```

### "p99 latency very high"
Could indicate:
1. Server is overloaded
2. Database is slow
3. AI provider is slow (for generate endpoint)
4. Network issues

**Diagnosis:**
```bash
# Run with lower concurrency
CONCURRENCY=5 npm run test:load

# Check server metrics
curl http://localhost:5178/api/health/ready
```

### "Soak test shows degradation"
Potential memory leak or resource exhaustion.

**Next steps:**
1. Check server memory usage during test
2. Review recent code changes
3. Monitor database connection pool
4. Check for unbounded caches

---

## Integration with CI/CD

### GitHub Actions Example
```yaml
name: Load Tests

on: [push, pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    services:
      cacc-writer:
        image: cacc-writer:latest
        ports:
          - 5178:5178
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run test:smoke
      - run: npm run test:load
```

---

## Advanced Usage

### Custom Endpoint Distribution

Edit `loadTest.mjs` to modify `ENDPOINTS` array:

```javascript
const ENDPOINTS = [
  // Increase focus on a specific endpoint
  { path: '/api/cases', method: 'POST', weight: 0.50, ... },
  { path: '/api/health/live', method: 'GET', weight: 0.50, ... },
];
```

### Capture Results to File

```bash
node tests/load/loadTest.mjs | tee load-test-results.txt
```

### Compare Results Over Time

Run tests periodically and store results:
```bash
mkdir -p load-test-history
npm run test:load > load-test-history/$(date +%Y-%m-%d_%H:%M:%S).txt
```

---

## Performance Baseline

After your first successful test run, establish a baseline:

| Scenario | Throughput | p99 | Error Rate |
|----------|-----------|-----|-----------|
| Standard (10 users, 60s) | 40-60 req/s | 200-500ms | <1% |
| Peak (50 users, 5m) | 25-35 req/s | 500-1000ms | <1% |
| Soak (10 users, 30m) | 8-10 req/s | <500ms | <0.2% |

**Compare future runs to this baseline to detect regressions.**

---

## Contributing

To add new test scenarios:

1. Create file in `tests/load/scenarios/yourScenario.mjs`
2. Use same utility functions (executeRequest, recordMetric, etc.)
3. Add npm script to `package.json`
4. Document in this README

---

## License

Same as CACC Writer project.
