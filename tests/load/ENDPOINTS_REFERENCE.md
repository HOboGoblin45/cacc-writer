# CACC Writer Endpoints Load Testing Reference

Complete specification of endpoints tested by the load testing suite.

## Endpoints Overview

| # | Endpoint | Method | Auth | Weight | Type | Priority |
|---|----------|--------|------|--------|------|----------|
| 1 | `/api/health/live` | GET | No | 15% | Probe | P0 |
| 2 | `/api/health/ready` | GET | No | 15% | Probe | P0 |
| 3 | `/api/auth/login` | POST | No | 20% | Auth | P0 |
| 4 | `/api/cases` | GET | Yes | 25% | Read | P1 |
| 5 | `/api/cases` | POST | Yes | 15% | Write | P1 |
| 6 | `/api/brain/config` | GET | No | 5% | Read | P2 |
| 7 | `/api/qc/run` | POST | Yes | 5% | Expensive | P2 |

## Endpoint Details

### 1. GET /api/health/live (Liveness Probe)

**Purpose:** Kubernetes liveness probe to check if server process is alive

**Status Code:** 200 OK

**Response Body:** JSON object
```json
{
  "status": "alive"
}
```

**Expected Latency:** 5-20ms

**Test Behavior:**
- No authentication required
- No request body
- Called frequently (15% of requests in standard test)
- Must respond within 50ms for SLA compliance

**Test Weight:** 15%

**Notes:**
- Fastest endpoint
- No database calls
- Used for server uptime monitoring

---

### 2. GET /api/health/ready (Readiness Probe)

**Purpose:** Kubernetes readiness probe to check if server is ready for traffic

**Status Code:** 200 OK (if ready) or 503 (if not ready)

**Response Body:** JSON object
```json
{
  "ready": true,
  "database": "connected",
  "ai": "available"
}
```

**Expected Latency:** 10-50ms

**Test Behavior:**
- No authentication required
- Checks database connectivity
- Checks AI service availability
- Returns 503 if dependencies unavailable

**Test Weight:** 15%

**Notes:**
- Used before routing traffic
- May fail during initialization
- More comprehensive than liveness probe

---

### 3. POST /api/auth/login (Authentication)

**Purpose:** Authenticate user and obtain JWT token

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "test@example.com",
  "password": "testPassword123!"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "userId": "user-123"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Invalid credentials"
}
```

**Expected Latency:** 50-200ms

**Test Behavior:**
- No authentication required
- Validates credentials
- Returns JWT token on success
- Token valid for 1 hour
- Load test auto-generates test user accounts

**Test Weight:** 20%

**Notes:**
- Involves bcryptjs validation (expensive)
- Creates JWT (moderate cost)
- Test creates unique users per request

---

### 4. GET /api/cases (List Cases)

**Purpose:** Retrieve list of user's appraisal cases

**Request Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "cases": [
    {
      "id": "case-123",
      "address": "123 Main St, City, ST 12345",
      "propertyType": "single-family",
      "appraisalType": "refinance",
      "createdAt": "2026-03-28T10:00:00Z",
      "status": "draft"
    },
    ...
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Expected Latency:** 30-100ms

**Test Behavior:**
- Requires valid JWT token
- Returns paginated list
- Filtered by authenticated user
- Database query with pagination

**Test Weight:** 25%

**Notes:**
- High traffic endpoint (25% of requests)
- Database-backed
- Typical user operation
- Should be highly optimized

---

### 5. POST /api/cases (Create Case)

**Purpose:** Create a new appraisal case

**Request Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "propertyAddress": "456 Oak Ave, City, ST 67890",
  "propertyType": "single-family",
  "appraisalType": "refinance"
}
```

**Response (201 Created):**
```json
{
  "id": "case-456",
  "address": "456 Oak Ave, City, ST 67890",
  "propertyType": "single-family",
  "appraisalType": "refinance",
  "createdAt": "2026-03-28T10:30:00Z",
  "status": "draft"
}
```

**Expected Latency:** 100-300ms

**Test Behavior:**
- Requires valid JWT token
- Validates input data
- Creates database record
- Returns created case object
- Generate unique addresses per request

**Test Weight:** 15%

**Notes:**
- Write operation
- Database INSERT required
- Slower than GET
- Common user operation

---

### 6. GET /api/brain/config (Brain Configuration)

**Purpose:** Retrieve Knowledge Brain configuration

**Status Code:** 200 OK

**Response Body:** JSON object
```json
{
  "brainsEnabled": true,
  "providers": [
    {
      "id": "provider-1",
      "type": "openai",
      "model": "gpt-4",
      "endpoint": "https://api.openai.com/v1"
    },
    {
      "id": "provider-2",
      "type": "runpod",
      "model": "llama-3.1-8b",
      "endpoint": "http://localhost:8000"
    }
  ],
  "graphUrl": "http://localhost:8080"
}
```

**Expected Latency:** 10-50ms

**Test Behavior:**
- No authentication required
- Returns static configuration
- Minimal processing
- Fast endpoint

**Test Weight:** 5%

**Notes:**
- Configuration endpoint
- Used by frontend initialization
- Should be cached
- Very fast response expected

---

### 7. POST /api/qc/run (Quality Control Run)

**Purpose:** Trigger quality control evaluation on a case

**Request Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "caseId": "case-123"
}
```

**Response (200 OK):**
```json
{
  "qcId": "qc-789",
  "caseId": "case-123",
  "status": "running",
  "progress": 0,
  "engines": [
    {
      "name": "grammar",
      "status": "running"
    },
    {
      "name": "compliance",
      "status": "pending"
    },
    {
      "name": "consistency",
      "status": "pending"
    }
  ]
}
```

**Response (202 Accepted):** Async operation started

**Expected Latency:** 200-1000ms+

**Test Behavior:**
- Requires valid JWT token
- Validates case exists
- Triggers background QC engines (6 engines)
- May run asynchronously
- Resource-intensive operation

**Test Weight:** 5%

**Notes:**
- Expensive operation
- Lowest traffic percentage
- Multi-step processing
- Can be asynchronous
- High latency expected

---

## Request Distribution

### Standard Load Test (10 concurrent users, 60 seconds)

```
Health Checks:  30%  (fastest, highest volume)
├─ /api/health/live     15%
└─ /api/health/ready    15%

Read Operations: 30%  (moderate complexity)
├─ /api/cases (GET)     25%
└─ /api/brain/config     5%

Authentication: 20%  (baseline user load)
└─ /api/auth/login      20%

Write Operations: 15%  (slower)
└─ /api/cases (POST)    15%

Expensive Ops:   5%   (slowest, least frequent)
└─ /api/qc/run          5%
```

### Peak Hours Test (50 concurrent users, 5 minutes)

```
Read Operations: 55%  (emphasize read performance)
├─ /api/cases (GET)     40%
├─ /api/health/live     15%

Other Operations: 45%
├─ /api/health/ready    15%
├─ /api/auth/login      20%
├─ /api/cases (POST)    10%

Advanced Features: 10%
├─ /api/brain/config    5%
└─ /api/qc/run         5%
```

---

## Performance Expectations

### By Category

| Category | p50 | p95 | p99 | Notes |
|----------|-----|-----|-----|-------|
| **Health Probes** | 10ms | 30ms | 50ms | Must be fast |
| **Read Ops** | 30ms | 80ms | 200ms | Database queries |
| **Write Ops** | 100ms | 200ms | 500ms | Includes INSERT |
| **Auth** | 80ms | 150ms | 400ms | bcrypt validation |
| **Expensive** | 200ms | 1000ms | 2000ms | Multi-step processing |

### By Load Level

| Load Level | p50 | p95 | p99 | Throughput |
|-----------|-----|-----|-----|-----------|
| **Light** (5 users) | 20ms | 50ms | 100ms | 60+ req/s |
| **Normal** (10 users) | 45ms | 150ms | 500ms | 45+ req/s |
| **Peak** (50 users) | 80ms | 250ms | 1000ms | 30+ req/s |
| **Stress** (100 users) | 200ms | 800ms | 5000ms | <20 req/s |

---

## Database Impact

### Query Types

| Endpoint | Query Type | Complexity | Impact |
|----------|-----------|-----------|--------|
| `/api/health/live` | None | N/A | None |
| `/api/health/ready` | PING/SELECT | Low | Single row |
| `/api/auth/login` | SELECT + INSERT | Medium | User lookup + create |
| `/api/cases` GET | SELECT | Medium | User's cases (paginated) |
| `/api/cases` POST | INSERT + SELECT | Medium | Single row insert |
| `/api/brain/config` | None/Cache | N/A | None (cached) |
| `/api/qc/run` | INSERT + SELECT | High | Multiple tables, async |

---

## Error Scenarios

### Common Error Codes

| Status | Endpoint | Cause | Handling |
|--------|----------|-------|----------|
| 401 | Auth required | Invalid/missing token | Counted as error |
| 400 | Any | Invalid input | Counted as error |
| 500 | Any | Server error | Counted as error |
| 503 | Health | Service unavailable | Counted as error |
| 0 | Any | Connection error | Counted as error |

### What the Tests Do

- Log error types
- Track error rate
- Count by status code
- Report sample errors
- Fail if error rate > 5%

---

## Future Endpoints

Not currently tested but important:

- **GET /api/generate** - Trigger narrative generation (AI-intensive, excluded for cost)
- **GET /api/cases/{id}** - Get single case details
- **PUT /api/cases/{id}** - Update case
- **DELETE /api/cases/{id}** - Delete case
- **POST /api/export/pdf** - Generate PDF
- **WebSocket /api/brain/chat** - Live chat (not testable with HTTP)

---

## Notes for Load Testing

### Authentication Token Handling
- Tests auto-login if AUTH_TOKEN not provided
- Each login creates a new test user
- Tokens are valid for 1 hour
- No cleanup of test users (acceptable for testing)

### Request Payloads
- POST bodies are minimal but realistic
- Addresses are unique per request (prevents cache)
- User IDs are randomly generated

### Performance Considerations
- Health checks must be instant
- Database indexes should exist on user_id, case_id
- Connection pooling should be enabled
- JWT validation should be cached if possible

---

**Last Updated:** March 28, 2026
**API Version:** 3.1.0
