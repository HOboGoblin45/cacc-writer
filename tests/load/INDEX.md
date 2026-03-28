# Load Testing Suite - Complete Index

## Overview

Complete load testing suite for CACC Writer Express.js application. All scripts use Node.js native fetch API (no external dependencies).

**Status:** ✓ Complete and Ready to Use  
**Date Created:** March 28, 2026  
**Node.js Minimum:** 18.0.0  

## File Structure

```
tests/load/
├── loadTest.mjs                    # Main load test (410 lines)
├── smokeTest.mjs                   # Quick validation (150 lines)
├── scenarios/
│   ├── peakHours.mjs              # Peak hours simulation (280 lines)
│   └── soak.mjs                   # 30-minute stability test (330 lines)
├── README.md                       # Full documentation (500+ lines)
├── QUICK_REFERENCE.md             # Quick command reference
├── ENDPOINTS_REFERENCE.md         # Endpoint specifications
├── IMPLEMENTATION_SUMMARY.md      # Technical implementation details
└── INDEX.md                       # This file
```

## Quick Start (60 seconds)

```bash
# Start server if not already running
npm start

# Run smoke test
npm run test:load:smoke

# Run standard load test
npm run test:load

# View results (should show PASS)
```

## Available Commands

```bash
npm run test:load:smoke     # Smoke test (10 seconds)
npm run test:load          # Standard load test (60 seconds)
npm run test:peak          # Peak hours test (5 minutes)
npm run test:soak          # Soak test (30 minutes)
```

## Documentation

| Document | Purpose | Audience | Read Time |
|----------|---------|----------|-----------|
| **README.md** | Complete guide with examples | Everyone | 15 min |
| **QUICK_REFERENCE.md** | Copy-paste commands | Fast users | 3 min |
| **ENDPOINTS_REFERENCE.md** | Endpoint specifications | Engineers | 10 min |
| **IMPLEMENTATION_SUMMARY.md** | Technical details | Developers | 10 min |

## Test Types

### 1. Smoke Test (10 seconds)
- **Purpose:** Pre-deployment validation
- **Command:** `npm run test:load:smoke`
- **Load:** 3 endpoints, no concurrency
- **Check:** All endpoints responding?
- **Use when:** Before deployment, verify server is up

### 2. Standard Load Test (60 seconds)
- **Purpose:** Baseline performance
- **Command:** `npm run test:load`
- **Load:** 10 concurrent users
- **Metrics:** Throughput, latency percentiles, error rate
- **Use when:** Regular testing, development

### 3. Peak Hours Test (5 minutes)
- **Purpose:** High-load scenario
- **Command:** `npm run test:peak`
- **Load:** 50 concurrent users, 80% reads
- **Focus:** Performance under peak load
- **Use when:** Expecting traffic spike, capacity planning

### 4. Soak Test (30 minutes)
- **Purpose:** Stability & memory leak detection
- **Command:** `npm run test:soak`
- **Load:** 10 users, long duration
- **Monitor:** Latency degradation over time
- **Use when:** After code changes, before production

## Key Metrics

### Collected Metrics
- **Throughput:** Requests per second
- **Latency:** p50, p75, p90, p95, p99, min, max
- **Error Rate:** Percentage of failed requests
- **Status Codes:** Distribution (200, 400, 500, etc.)
- **Per-endpoint:** Count, average latency, errors

### SLOs (Service Level Objectives)
- **Read p50:** < 200ms
- **Read p99:** < 2000ms
- **Write p95:** < 3000ms
- **Error rate:** < 1%
- **Health checks:** < 50ms

## Environment Variables

| Variable | Default | Example |
|----------|---------|---------|
| `TARGET_URL` | `http://localhost:5178` | `https://api.example.com` |
| `CONCURRENCY` | `10` | `50` |
| `DURATION_SECONDS` | `60` | `300` |
| `RAMP_UP_SECONDS` | `10` | `30` |
| `AUTH_TOKEN` | auto-login | `eyJhbGc...` |
| `DURATION_MINUTES` | `30` | `10` (soak test only) |

## Endpoints Tested

| Endpoint | Method | Auth | Weight | Type |
|----------|--------|------|--------|------|
| `/api/health/live` | GET | No | 15% | Probe |
| `/api/health/ready` | GET | No | 15% | Probe |
| `/api/auth/login` | POST | No | 20% | Auth |
| `/api/cases` | GET | Yes | 25% | Read |
| `/api/cases` | POST | Yes | 15% | Write |
| `/api/brain/config` | GET | No | 5% | Read |
| `/api/qc/run` | POST | Yes | 5% | Expensive |

## Example Workflows

### Pre-Deployment Checklist
```bash
npm run test:load:smoke && npm run test:load && npm run test:peak
```

### Development Testing
```bash
CONCURRENCY=5 DURATION_SECONDS=30 npm run test:load
```

### Staging Validation
```bash
TARGET_URL=https://staging.api.com \
CONCURRENCY=20 \
DURATION_SECONDS=300 \
npm run test:load
```

### Memory Leak Detection
```bash
DURATION_MINUTES=10 npm run test:soak
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | ✓ PASS - All SLOs met |
| 1 | ✗ FAIL - SLOs missed (error rate > 5% OR p99 > 5000ms) |

## Performance Baseline

After first successful run, record baseline for future comparison:

```
Standard Test (10 users, 60s):
- Throughput: 45+ req/s
- p99: < 500ms
- Error rate: < 1%

Peak Test (50 users, 5m):
- Throughput: 30+ req/s
- p99: < 1000ms
- Error rate: < 1%

Soak Test (10 users, 30m):
- p99 degradation: < 10%
- Error rate: < 0.5%
```

## What Each Test Does

### loadTest.mjs (Main Load Test)
1. Authenticates users automatically
2. Ramps up load gradually (10s default)
3. Sustains load for test duration
4. Sends requests to 7 endpoints with weights
5. Collects detailed metrics
6. Reports results with percentiles
7. Exits with code 0 (pass) or 1 (fail)

### smokeTest.mjs (Quick Validation)
1. Attempts to connect to server
2. Tests 3 critical health endpoints
3. Checks HTTP status codes
4. Reports pass/fail per endpoint
5. Simple output for CI/CD

### peakHours.mjs (Peak Simulation)
1. Simulates 50 concurrent virtual users
2. 80% read operations, 20% writes
3. Sustained 5-minute load
4. Detailed latency distribution
5. Per-endpoint performance breakdown

### soak.mjs (Stability Test)
1. Runs 10 concurrent users for 30 minutes
2. Tracks latency over time
3. Detects degradation (> 20% increase)
4. Checks for memory leaks
5. Reports stability analysis

## Troubleshooting

### Issue: "Connection refused"
```bash
npm start  # Start server in another terminal
```

### Issue: "All requests fail with 401"
- Auto-login failed
- Provide AUTH_TOKEN manually
- Check test user credentials

### Issue: "High p99 latency (> 2000ms)"
1. Check server logs
2. Reduce concurrency: `CONCURRENCY=5 npm run test:load`
3. Monitor database performance
4. Check AI provider latency

### Issue: "Soak test shows degradation"
- Potential memory leak
- Run shorter test: `DURATION_MINUTES=5 npm run test:soak`
- Monitor memory during test
- Check for unbounded caches

## Next Steps

1. **Run smoke test:** `npm run test:load:smoke`
2. **Run standard test:** `npm run test:load`
3. **Record baseline:** Save results for comparison
4. **Set up CI/CD:** Add to GitHub Actions / GitLab CI
5. **Monitor trends:** Run regularly, track regressions

## Key Features

✓ No external dependencies (uses Node.js native fetch)  
✓ Configurable via environment variables  
✓ Real-time progress reporting  
✓ Comprehensive metrics collection  
✓ Auto-authentication for protected endpoints  
✓ Weighted endpoint distribution  
✓ Ramp-up phase for gradual load  
✓ Degradation detection (soak test)  
✓ Proper exit codes for CI/CD  
✓ Clear pass/fail criteria  

## Integration

### npm Scripts
```json
{
  "test:load": "node tests/load/loadTest.mjs",
  "test:load:smoke": "node tests/load/smokeTest.mjs",
  "test:peak": "node tests/load/scenarios/peakHours.mjs",
  "test:soak": "node tests/load/scenarios/soak.mjs"
}
```

### GitHub Actions
```yaml
- run: npm run test:load:smoke
- run: npm run test:load
```

### Local Development
```bash
# Before committing
npm run test:load:smoke && npm run test:load
```

## File Statistics

| File | Lines | Size | Purpose |
|------|-------|------|---------|
| loadTest.mjs | 410 | 12KB | Main load test |
| smokeTest.mjs | 150 | 4KB | Quick validation |
| peakHours.mjs | 280 | ~8KB | Peak scenario |
| soak.mjs | 330 | ~9KB | Stability test |
| README.md | 500+ | 12KB | Full documentation |
| QUICK_REFERENCE.md | 200+ | 8KB | Quick commands |
| ENDPOINTS_REFERENCE.md | 400+ | 12KB | Endpoint specs |
| IMPLEMENTATION_SUMMARY.md | 250+ | 8KB | Technical details |

**Total:** ~2300 lines of code + documentation

## Requirements

- **Node.js:** 18.0.0 or higher
- **npm:** 8.0.0 or higher
- **Express.js server:** Running on port 5178 (configurable)
- **No external packages needed**

## Support

- **README.md** - Start here for full documentation
- **QUICK_REFERENCE.md** - Copy-paste commands
- **ENDPOINTS_REFERENCE.md** - Endpoint details
- **IMPLEMENTATION_SUMMARY.md** - Technical implementation

## License

Same as CACC Writer project

---

**Version:** 1.0.0  
**Created:** March 28, 2026  
**Last Updated:** March 28, 2026  
**Status:** ✓ Production Ready
