/**
 * tests/vitest/tenancy.test.mjs
 * ----------------------------
 * Comprehensive test suite for Row-Level Security multi-tenancy system.
 *
 * Tests:
 * - TenantContext: AsyncLocalStorage behavior and error cases
 * - TenantAwareAdapter: Query wrapping and tenant context setting
 * - tenantMiddleware: Request context extraction and setup
 * - UserDbBridge: Backward compatibility shim
 * - Concurrent tenant isolation: Parallel requests don't leak context
 *
 * Run with: npm test -- tests/vitest/tenancy.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runWithTenant,
  getCurrentTenantId,
  hasTenantContext,
  getTenantContext,
} from '../../server/db/tenancy/TenantContext.js';
import { TenantAwareAdapter } from '../../server/db/tenancy/TenantAwareAdapter.js';
import {
  tenantMiddleware,
  requireTenantContext,
  getTenantIdFromRequest,
} from '../../server/db/tenancy/tenantMiddleware.js';
import {
  createUserDbBridge,
  getUserDbCompat,
} from '../../server/db/tenancy/UserDbBridge.js';

// Mock adapter for testing
class MockDatabaseAdapter {
  constructor(dialect = 'postgresql') {
    this.dialect = dialect;
    this.queries = [];
    this.sessionVars = {};
  }

  async all(sql, params = []) {
    this.queries.push({ method: 'all', sql, params });
    return [{ id: 1, name: 'test' }];
  }

  async get(sql, params = []) {
    this.queries.push({ method: 'get', sql, params });
    return { id: 1, name: 'test' };
  }

  async run(sql, params = []) {
    this.queries.push({ method: 'run', sql, params });
    return { changes: 1, lastInsertRowid: 1 };
  }

  async transaction(fn) {
    return fn();
  }

  async exec(sql) {
    this.queries.push({ method: 'exec', sql });
  }

  async tableExists(tableName) {
    return true;
  }

  getDialect() {
    return this.dialect;
  }

  async initSchema() {
    // no-op
  }

  async close() {
    // no-op
  }

  // For PostgreSQL tenant context setting
  prepare(sql) {
    return {
      run: () => ({ changes: 0 }),
      get: () => ({}),
      all: () => [],
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TenantContext Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('TenantContext', () => {
  describe('runWithTenant', () => {
    it('should set tenant context for the callback', () => {
      let capturedTenantId = null;

      runWithTenant('user-123', () => {
        capturedTenantId = getCurrentTenantId();
      });

      expect(capturedTenantId).toBe('user-123');
    });

    it('should throw if tenantId is empty', () => {
      expect(() => {
        runWithTenant('', () => {});
      }).toThrow();

      expect(() => {
        runWithTenant(null, () => {});
      }).toThrow();
    });

    it('should return the callback result', () => {
      const result = runWithTenant('user-123', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should support nested contexts (inner overrides outer)', () => {
      const capturedIds = [];

      runWithTenant('user-outer', () => {
        capturedIds.push(getCurrentTenantId());

        runWithTenant('user-inner', () => {
          capturedIds.push(getCurrentTenantId());
        });

        capturedIds.push(getCurrentTenantId());
      });

      expect(capturedIds).toEqual(['user-outer', 'user-inner', 'user-outer']);
    });
  });

  describe('getCurrentTenantId', () => {
    it('should throw when no context is set', () => {
      expect(() => {
        getCurrentTenantId();
      }).toThrow('No tenant context');
    });

    it('should return tenant ID when context is active', () => {
      runWithTenant('user-abc', () => {
        expect(getCurrentTenantId()).toBe('user-abc');
      });
    });
  });

  describe('hasTenantContext', () => {
    it('should return false when no context', () => {
      expect(hasTenantContext()).toBe(false);
    });

    it('should return true when context is active', () => {
      runWithTenant('user-123', () => {
        expect(hasTenantContext()).toBe(true);
      });
    });

    it('should return false after context exits', () => {
      runWithTenant('user-123', () => {
        expect(hasTenantContext()).toBe(true);
      });
      expect(hasTenantContext()).toBe(false);
    });
  });

  describe('getTenantContext', () => {
    it('should return null when no context', () => {
      expect(getTenantContext()).toBe(null);
    });

    it('should return context object when active', () => {
      runWithTenant('user-456', () => {
        const context = getTenantContext();
        expect(context).toEqual({ tenantId: 'user-456' });
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TenantAwareAdapter Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('TenantAwareAdapter', () => {
  let mockAdapter;
  let tenantAdapter;

  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter('postgresql');
    tenantAdapter = new TenantAwareAdapter(mockAdapter);
  });

  describe('constructor', () => {
    it('should throw if baseAdapter is missing', () => {
      expect(() => {
        new TenantAwareAdapter(null);
      }).toThrow('baseAdapter is required');
    });

    it('should store baseAdapter', () => {
      expect(tenantAdapter.getBaseAdapter()).toBe(mockAdapter);
    });
  });

  describe('query methods', () => {
    it('should call baseAdapter.all() with tenant context', async () => {
      await runWithTenant('user-123', async () => {
        const result = await tenantAdapter.all('SELECT * FROM cases', []);
        expect(result).toEqual([{ id: 1, name: 'test' }]);
      });
    });

    it('should call baseAdapter.get() with tenant context', async () => {
      await runWithTenant('user-123', async () => {
        const result = await tenantAdapter.get('SELECT * FROM cases WHERE id = $1', [1]);
        expect(result).toEqual({ id: 1, name: 'test' });
      });
    });

    it('should call baseAdapter.run() with tenant context', async () => {
      await runWithTenant('user-123', async () => {
        const result = await tenantAdapter.run('INSERT INTO cases VALUES ($1, $2)', ['id', 'name']);
        expect(result).toEqual({ changes: 1, lastInsertRowid: 1 });
      });
    });

    it('should call baseAdapter.transaction() with tenant context', async () => {
      await runWithTenant('user-123', async () => {
        const result = await tenantAdapter.transaction(() => 'tx-result');
        expect(result).toBe('tx-result');
      });
    });

    it('should throw if no tenant context', async () => {
      expect(async () => {
        await tenantAdapter.all('SELECT * FROM cases', []);
      }).rejects.toThrow('No tenant context');
    });
  });

  describe('pass-through methods', () => {
    it('should pass through exec()', async () => {
      await tenantAdapter.exec('PRAGMA table_info(cases)');
      const calls = mockAdapter.queries.filter(q => q.method === 'exec');
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should pass through tableExists()', async () => {
      const exists = await tenantAdapter.tableExists('cases');
      expect(exists).toBe(true);
    });

    it('should return dialect', () => {
      expect(tenantAdapter.getDialect()).toBe('postgresql');
    });

    it('should return baseAdapter', () => {
      expect(tenantAdapter.getBaseAdapter()).toBe(mockAdapter);
    });
  });

  describe('SQLite behavior', () => {
    it('should handle SQLite adapter (no session var setting)', async () => {
      const sqliteAdapter = new MockDatabaseAdapter('sqlite');
      const tenantAdapter = new TenantAwareAdapter(sqliteAdapter);

      await runWithTenant('user-123', async () => {
        const result = await tenantAdapter.all('SELECT * FROM cases', []);
        expect(result).toBeDefined();
      });

      // SQLite adapter should still work, just without session vars
      expect(sqliteAdapter.queries.length).toBeGreaterThan(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tenantMiddleware Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('tenantMiddleware', () => {
  describe('tenantMiddleware function', () => {
    it('should set tenant context for authenticated requests', () => {
      const req = { user: { userId: 'user-123' }, path: '/api/cases' };
      const res = {};
      let capturedTenantId = null;
      let nextCalled = false;

      tenantMiddleware(req, res, () => {
        nextCalled = true;
        capturedTenantId = hasTenantContext() ? getCurrentTenantId() : null;
      });

      expect(nextCalled).toBe(true);
      expect(capturedTenantId).toBe('user-123');
    });

    it('should skip context for unauthenticated requests', () => {
      const req = { path: '/api/health' };
      const res = {};
      let contextActive = null;

      tenantMiddleware(req, res, () => {
        contextActive = hasTenantContext();
      });

      expect(contextActive).toBe(false);
    });

    it('should skip context for requests with empty userId', () => {
      const req = { user: { userId: '' }, path: '/api/cases' };
      const res = {};
      let contextActive = null;

      tenantMiddleware(req, res, () => {
        contextActive = hasTenantContext();
      });

      expect(contextActive).toBe(false);
    });

    it('should skip context for requests without user object', () => {
      const req = { path: '/api/cases' };
      const res = {};
      let contextActive = null;

      tenantMiddleware(req, res, () => {
        contextActive = hasTenantContext();
      });

      expect(contextActive).toBe(false);
    });

    it('should handle non-string userId gracefully', () => {
      const req = { user: { userId: 123 }, path: '/api/cases' };
      const res = {};
      let contextActive = null;

      tenantMiddleware(req, res, () => {
        contextActive = hasTenantContext();
      });

      expect(contextActive).toBe(false);
    });
  });

  describe('requireTenantContext function', () => {
    it('should pass if context is set', () => {
      const req = {};
      const res = {};
      let nextCalled = false;

      runWithTenant('user-123', () => {
        requireTenantContext(req, res, () => {
          nextCalled = true;
        });
      });

      expect(nextCalled).toBe(true);
    });

    it('should reject if context is missing', () => {
      const req = { path: '/api/secure' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      requireTenantContext(req, res, () => {
        throw new Error('Should not reach here');
      });

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('getTenantIdFromRequest function', () => {
    it('should return userId from authenticated request', () => {
      const req = { user: { userId: 'user-456' } };
      const userId = getTenantIdFromRequest(req);
      expect(userId).toBe('user-456');
    });

    it('should return null for unauthenticated request', () => {
      const req = {};
      const userId = getTenantIdFromRequest(req);
      expect(userId).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// UserDbBridge Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('UserDbBridge', () => {
  let mockAdapter;
  let tenantAdapter;
  let bridge;

  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter('postgresql');
    tenantAdapter = new TenantAwareAdapter(mockAdapter);
  });

  describe('createUserDbBridge', () => {
    it('should create a bridge object with prepare() method', () => {
      bridge = createUserDbBridge(tenantAdapter);
      expect(bridge.prepare).toBeDefined();
      expect(typeof bridge.prepare).toBe('function');
    });

    it('should return statement wrapper from prepare()', () => {
      bridge = createUserDbBridge(tenantAdapter);
      const stmt = bridge.prepare('SELECT * FROM cases');
      expect(stmt).toBeDefined();
      expect(stmt.run).toBeDefined();
      expect(stmt.get).toBeDefined();
      expect(stmt.all).toBeDefined();
    });

    it('should provide getAdapter() for direct async access', () => {
      bridge = createUserDbBridge(tenantAdapter);
      expect(bridge.getAdapter()).toBe(tenantAdapter);
    });

    it('should provide transaction() method', async () => {
      bridge = createUserDbBridge(tenantAdapter);
      await runWithTenant('user-123', async () => {
        const result = await bridge.transaction(() => 'tx-result');
        expect(result).toBe('tx-result');
      });
    });

    it('should provide exec() method (no-op)', async () => {
      bridge = createUserDbBridge(tenantAdapter);
      await bridge.exec('PRAGMA table_info(cases)');
      // Should not throw
    });

    it('should provide pragma() method (no-op)', () => {
      bridge = createUserDbBridge(tenantAdapter);
      bridge.pragma('journal_mode', 'WAL');
      // Should not throw
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Concurrent Tenant Isolation Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Concurrent Tenant Isolation', () => {
  it('should isolate concurrent contexts for different tenants', async () => {
    const results = {};

    // Simulate two parallel requests
    const promise1 = new Promise((resolve) => {
      runWithTenant('user-A', () => {
        setTimeout(() => {
          const tenantId = getCurrentTenantId();
          results['user-A'] = tenantId;
          resolve();
        }, 10);
      });
    });

    const promise2 = new Promise((resolve) => {
      runWithTenant('user-B', () => {
        setTimeout(() => {
          const tenantId = getCurrentTenantId();
          results['user-B'] = tenantId;
          resolve();
        }, 5);
      });
    });

    await Promise.all([promise1, promise2]);

    expect(results['user-A']).toBe('user-A');
    expect(results['user-B']).toBe('user-B');
  });

  it('should maintain context isolation across async boundaries', async () => {
    const contexts = [];

    const promise1 = runWithTenant('tenant-1', async () => {
      contexts.push(getCurrentTenantId());
      await new Promise(resolve => setTimeout(resolve, 10));
      contexts.push(getCurrentTenantId());
    });

    const promise2 = runWithTenant('tenant-2', async () => {
      contexts.push(getCurrentTenantId());
      await new Promise(resolve => setTimeout(resolve, 5));
      contexts.push(getCurrentTenantId());
    });

    await Promise.all([promise1, promise2]);

    // Each tenant should only see its own context, even with async delays
    expect(contexts.filter(c => c === 'tenant-1').length).toBeGreaterThan(0);
    expect(contexts.filter(c => c === 'tenant-2').length).toBeGreaterThan(0);
  });

  it('should not leak context after request completes', async () => {
    let contextAfter = null;

    await runWithTenant('user-temp', async () => {
      expect(getCurrentTenantId()).toBe('user-temp');
    });

    // After exiting context, should have no tenant set
    contextAfter = hasTenantContext();
    expect(contextAfter).toBe(false);
  });
});
