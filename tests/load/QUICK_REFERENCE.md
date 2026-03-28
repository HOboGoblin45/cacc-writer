# Load Testing Quick Reference

## Commands

```bash
# Smoke test (quick validation)
npm run test:load:smoke

# Standard load test (10 users, 60s)
npm run test:load

# Peak hours test (50 users, 5min)
npm run test:peak

# Soak test (10 users, 30min)
npm run test:soak
```

## Common Scenarios

### Pre-Deployment Checklist
```bash
# 1. Smoke test
npm run test:load:smoke

# 2. Standard load
npm run test:load

# 3. If expecting traffic spike
npm run test:peak
```

### Development Workflow
```bash
# Quick test during development
CONCURRENCY=5 DURATION_SECONDS=30 npm run test:load
```

### Staging Validation
```bash
TARGET_URL=https://staging.example.com \
CONCURRENCY=20 \
DURATION_SECONDS=300 \
npm run test:load
```

### Memory Leak Detection
```bash
# Run 10-minute soak test
DURATION_MINUTES=10 npm run test:soak
```

## Environment Variables

| Variable | Default | Example |
|----------|---------|---------|
| `TARGET_URL` | `http://localhost:5178` | `https://api.example.com` |
| `CONCURRENCY` | `10` | `50` |
| `DURATION_SECONDS` | `60` | `300` |
| `RAMP_UP_SECONDS` | `10` | `30` |
| `AUTH_TOKEN` | auto-login | `eyJhbGc...` |
| `DURATION_MINUTES` | `30` | `10` (soak test only) |

## Metrics Cheat Sheet

### What's Good?
| Metric | Good | OK | Bad |
|--------|------|----|----|
| p50 latency | <100ms | <200ms | >500ms |
| p99 latency | <500ms | <2000ms | >5000ms |
| Error rate | <0.5% | <1% | >5% |
| Throughput | 50+ req/s | 30+ req/s | <10 req/s |
| Health p50 | <20ms | <50ms | >100ms |

### Peak vs. Standard
- Peak tests use 5x more users (50 vs 10)
- Peak tests run 5x longer (5m vs 60s)
- Peak shows sustained performance under load
- Standard tests detect quick regressions

## Exit Codes

```bash
npm run test:load
echo $?
# 0 = PASS (SLOs met)
# 1 = FAIL (SLOs missed)
```

## Output Sections

### Real-Time Progress (every 5s)
```
[15.2s] Req/s: 42.50 | Total: 638 | Errors: 2 (0.3%) | p50: 45ms | p95: 125ms
```

### Final Summary
```
═════════════════════════════════════════════════════════════════
                    LOAD TEST SUMMARY
═════════════════════════════════════════════════════════════════

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

═════════════════════════════════════════════════════════════════
✓ PASS: Load test completed successfully
```

## Interpreting Results

### Passed Test
```
✓ PASS: Load test completed successfully
```
- ✓ Error rate < 5%
- ✓ p99 < 5000ms
- ✓ All endpoints responding
- ✓ SLOs met

### Failed Test
```
✗ FAIL: Error rate exceeds 5%
✗ FAIL: p99 latency exceeds 5000ms
```
- ✗ Server under too much load
- ✗ Need to optimize or scale
- ✗ Investigate error causes

## Common Issues

### "Connection refused"
```bash
npm start  # in another terminal
```

### "All requests failing with 401"
- Auto-login failed
- Check if test user credentials exist
- Provide AUTH_TOKEN manually

### "p99 > 2000ms"
1. Check server logs
2. Reduce concurrency: `CONCURRENCY=5 npm run test:load`
3. Check database performance
4. Monitor AI provider latency

### "Soak test shows p99 increasing"
- Potential memory leak
- Run shorter test: `DURATION_MINUTES=5 npm run test:soak`
- Monitor memory usage during test

## Baseline Performance

After first successful run, record baseline:

```
Standard Test (10 users, 60s):
- Throughput: 47 req/s
- p99: 512ms
- Error rate: 0.53%

Peak Test (50 users, 5m):
- Throughput: 30 req/s
- p99: 689ms
- Error rate: 0.10%

Soak Test (10 users, 30m):
- Throughput: 7 req/s
- p99 degradation: 7.3%
- Error rate: 0.14%
```

Compare future runs to detect regressions.

## File Locations

```
tests/load/
├── loadTest.mjs           # Main load test
├── smokeTest.mjs          # Quick validation
├── scenarios/
│   ├── peakHours.mjs      # Peak hours simulation
│   └── soak.mjs           # 30-minute stability test
├── README.md              # Full documentation
├── QUICK_REFERENCE.md     # This file
└── IMPLEMENTATION_SUMMARY.md
```

## More Info

- Full docs: `tests/load/README.md`
- Implementation details: `tests/load/IMPLEMENTATION_SUMMARY.md`
- Source code: `tests/load/*.mjs`

## Node.js Version

Requires Node.js 18.0.0 or higher (for native fetch API).

Check your version:
```bash
node --version
# v20.11.0 ✓ OK
# v16.14.0 ✗ Too old
```

---

**Last updated:** March 28, 2026
