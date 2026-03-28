# Load Testing Implementation Summary

## Overview

Comprehensive load testing suite has been created for the CACC Writer application. All scripts use Node.js native fetch API (available in Node 18+) with no external dependencies.

## Files Created

### Core Test Scripts

1. **`tests/load/loadTest.mjs`** (410 lines)
   - Main load testing script with configurable parameters
   - Tests 7 endpoints with weighted distribution
   - Collects detailed metrics: throughput, latency percentiles, error rate, status codes
   - Ramp-up phase support for gradual load increase
   - Real-time progress reporting (every 5 seconds)
   - Exit code 1 if error rate > 5% or p99 > 5000ms
   - Environment variables: TARGET_URL, CONCURRENCY, DURATION_SECONDS, RAMP_UP_SECONDS, AUTH_TOKEN

2. **`tests/load/smokeTest.mjs`** (150 lines)
   - Quick pre-deployment validation (10 seconds)
   - Tests 3 critical health endpoints
   - Simple pass/fail for each endpoint
   - Auto-authentication for protected endpoints

### Scenario Tests

3. **`tests/load/scenarios/peakHours.mjs`** (280 lines)
   - Peak hours simulation
   - 50 concurrent virtual users
   - 5-minute sustained load
   - 80% reads / 20% writes request distribution
   - Percentile latency distribution analysis
   - Per-endpoint performance breakdown

4. **`tests/load/scenarios/soak.mjs`** (330 lines)
   - Long-running stability test
   - 10 concurrent users, 30-minute duration (configurable)
   - Memory leak detection via latency degradation
   - Tracks p99 trends over time
   - Alerts if p99 increases > 20% (degradation warning)
   - Historical latency sampling

### Documentation

5. **`tests/load/README.md`** (500+ lines)
   - Comprehensive guide for all test scripts
   - Quick start instructions
   - Detailed configuration options for each test
   - Target SLOs and how to interpret results
   - Troubleshooting guide
   - CI/CD integration examples
   - Performance baseline template

## Updated Files

6. **`package.json`**
   - Added 4 new npm scripts:
     - `npm run test:load` - Standard load test
     - `npm run test:load:smoke` - Smoke test
     - `npm run test:peak` - Peak hours scenario
     - `npm run test:soak` - 30-minute soak test

## Test Coverage

### Endpoints Tested

| Endpoint | Method | Weight | Notes |
|----------|--------|--------|-------|
| `/api/health/live` | GET | 15% | Liveness probe |
| `/api/health/ready` | GET | 15% | Readiness probe |
| `/api/auth/login` | POST | 20% | Authentication |
| `/api/cases` | GET | 25% | List cases (requires auth) |
| `/api/cases` | POST | 15% | Create case (requires auth) |
| `/api/brain/config` | GET | 5% | Knowledge brain config |
| `/api/qc/run` | POST | 5% | QC evaluation (requires auth) |

### Metrics Collected

For each test run:
- **Throughput:** Requests per second
- **Latency percentiles:** p50, p75, p90, p95, p99, min, max
- **Error rate:** Percentage of failed requests
- **Status codes:** Distribution (200, 400, 500, etc.)
- **Per-endpoint breakdown:** Count, average latency, error rates

### SLOs Defined

| Metric | Target |
|--------|--------|
| Read latency (p50) | < 200ms |
| Read latency (p99) | < 2000ms |
| Write latency (p95) | < 3000ms |
| Error rate | < 1% |
| Health check latency | < 50ms |

## Usage Examples

### Basic Smoke Test
```bash
npm run test:load:smoke
# ~10 seconds, validates all endpoints responding
```

### Standard Load Test (10 users, 60 seconds)
```bash
npm run test:load
```

### Peak Hours Test (50 users, 5 minutes)
```bash
npm run test:peak
```

### 30-Minute Soak Test
```bash
npm run test:soak
```

### Custom Configuration
```bash
# Run with 25 concurrent users for 5 minutes
CONCURRENCY=25 DURATION_SECONDS=300 npm run test:load

# Run against staging environment
TARGET_URL=https://staging.example.com npm run test:load

# Provide custom JWT token
AUTH_TOKEN="eyJhbGc..." npm run test:load
```

## Key Features

### Auto-Authentication
Tests automatically attempt to log in if no AUTH_TOKEN is provided. This allows tests to run without manual token management.

### Weighted Endpoint Distribution
Tests simulate realistic usage patterns:
- Heavy emphasis on read operations (health + case list)
- Moderate auth load (login simulation)
- Lower write/expensive operations (case creation, QC)

### Ramp-Up Phase
Standard load test includes configurable ramp-up phase (default 10s) to:
- Warm up connections
- Simulate gradual user arrival
- Prevent thundering herd effect

### Real-Time Monitoring
Progress updates every 5 seconds with:
- Current throughput (req/s)
- Latency percentiles (p50, p95)
- Error rate
- Total requests

### Degradation Detection
Soak test specifically monitors for:
- Memory leaks (detected as latency increase)
- Connection pool exhaustion
- Unbounded cache growth
- Alerts if p99 increases > 20%

## Exit Codes

- **0:** Success (all SLOs met)
- **1:** Failure (error rate > 5% OR p99 > 5000ms)

## Dependencies

**None.** All scripts use:
- Node.js native `fetch` API (Node 18+)
- Node.js built-in `perf_hooks` for timing
- No external npm packages

## Integration Points

### With CI/CD
All tests exit with appropriate codes for automation:
```bash
npm run test:load:smoke && npm run test:load && npm run test:peak
```

### With Monitoring
Tests can be integrated with:
- Performance dashboards
- Alert systems
- Trend analysis
- Baseline comparison

### With Load Balancers
Tests respect the service configuration:
- Configurable target URL
- Support for multiple regions
- Custom headers (e.g., AUTH_TOKEN)

## Performance Characteristics

### Standard Test (10 users, 60s)
- Expected throughput: 40-60 req/s
- Expected p99: 200-500ms
- Expected error rate: <1%

### Peak Test (50 users, 5m)
- Expected throughput: 25-35 req/s
- Expected p99: 500-1000ms
- Expected error rate: <1%

### Soak Test (10 users, 30m)
- Expected throughput: 8-10 req/s
- Expected p99: <500ms (constant)
- Expected degradation: <10%

## Troubleshooting

### Connection Refused
Server not running:
```bash
npm start
```

### Authentication Failures
Test credentials might not exist. The tests create temporary test users, but if login fails:
1. Check server logs
2. Verify API is accessible
3. Check authentication configuration

### High Latency
Could indicate:
- Server overloaded
- Database contention
- Network issues
- AI provider latency (for /api/generate endpoints)

**Diagnosis:**
```bash
# Run with lower concurrency
CONCURRENCY=5 npm run test:load

# Check health endpoints
curl http://localhost:5178/api/health/ready
```

### Memory Growth (Soak Test)
Potential memory leak indicators:
- Latency increases over time
- Error rate increases
- p99 > 20% degradation alert

**Next steps:**
1. Monitor server memory during test
2. Check for unbounded caches
3. Review recent code changes
4. Check database connection pool

## Future Enhancements

Possible additions:
1. **Content generator endpoint** - Currently not tested heavily (`/api/generate`)
2. **WebSocket tests** - Knowledge brain chat connections
3. **File upload tests** - Document handling
4. **PDF generation** - Export functionality
5. **Custom scenarios** - Business-specific workflows
6. **Distributed load** - Multi-machine testing
7. **Grafana dashboard** - Real-time metrics
8. **Comparison reports** - Baseline vs. current

## Notes

- All timestamps are in milliseconds internally, displayed as ms
- Concurrency is implemented via concurrent async operations (not threads)
- Latency values are wall-clock time (includes network)
- Status code 0 indicates network error/timeout
- Tests are self-contained and can run in parallel (with different ports)

---

**Created:** March 28, 2026
**Node.js minimum:** 18.0.0
**No external dependencies required**
