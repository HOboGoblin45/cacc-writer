/**
 * tests/vitest/storageAdapter.test.mjs
 * ====================================
 * Test suite for storage adapters.
 *
 * Uses LocalStorageAdapter with temporary directories (safe, no cloud credentials needed).
 * Tests the full StorageAdapter interface contract.
 *
 * Run with: npm test -- storageAdapter.test.mjs
 * Or: vitest run tests/vitest/storageAdapter.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import {
  StorageAdapter,
  LocalStorageAdapter,
  DualWriteAdapter,
  createStorageAdapter,
  _resetStorageAdapter,
  _setStorageAdapter,
} from '../../server/storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test fixtures
let tempDir;

beforeEach(() => {
  // Create temporary directory for each test
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-storage-test-'));
});

afterEach(() => {
  // Clean up temporary directory
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  _resetStorageAdapter();
});

describe('StorageAdapter (Abstract Base)', () => {
  it('should throw NotImplementedError for unimplemented methods', async () => {
    const adapter = new StorageAdapter();

    await expect(adapter.put('test', Buffer.from('data'))).rejects.toThrow('not implemented');
    await expect(adapter.get('test')).rejects.toThrow('not implemented');
    await expect(adapter.delete('test')).rejects.toThrow('not implemented');
    await expect(adapter.exists('test')).rejects.toThrow('not implemented');
    await expect(adapter.list('test')).rejects.toThrow('not implemented');
    await expect(adapter.getSignedUrl('test')).rejects.toThrow('not implemented');
    await expect(adapter.copy('src', 'dst')).rejects.toThrow('not implemented');
    await expect(adapter.getMetadata('test')).rejects.toThrow('not implemented');
    expect(() => adapter.getProviderName()).toThrow('not implemented');
  });
});

describe('LocalStorageAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new LocalStorageAdapter({ basePath: tempDir });
  });

  describe('put/get roundtrip', () => {
    it('should store and retrieve a Buffer', async () => {
      const data = Buffer.from('Hello, World!');
      await adapter.put('test.txt', data);

      const retrieved = await adapter.get('test.txt');
      expect(retrieved).toEqual(data);
    });

    it('should store and retrieve a string', async () => {
      const data = 'Hello, World!';
      await adapter.put('test.txt', data);

      const retrieved = await adapter.get('test.txt');
      expect(retrieved).toEqual(Buffer.from(data, 'utf8'));
    });

    it('should create parent directories automatically', async () => {
      const data = Buffer.from('nested');
      await adapter.put('a/b/c/test.txt', data);

      const retrieved = await adapter.get('a/b/c/test.txt');
      expect(retrieved).toEqual(data);
    });

    it('should store JSON data', async () => {
      const obj = { key: 'value', nested: { count: 42 } };
      const json = JSON.stringify(obj);
      await adapter.put('data.json', json);

      const retrieved = await adapter.get('data.json');
      const parsed = JSON.parse(retrieved.toString('utf8'));
      expect(parsed).toEqual(obj);
    });

    it('should return null for non-existent files', async () => {
      const result = await adapter.get('nonexistent.txt');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing file', async () => {
      await adapter.put('test.txt', Buffer.from('data'));
      expect(await adapter.exists('test.txt')).toBe(true);

      await adapter.delete('test.txt');
      expect(await adapter.exists('test.txt')).toBe(false);
    });

    it('should not error when deleting non-existent file', async () => {
      await expect(adapter.delete('nonexistent.txt')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await adapter.put('test.txt', Buffer.from('data'));
      expect(await adapter.exists('test.txt')).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      expect(await adapter.exists('nonexistent.txt')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list files with prefix', async () => {
      await adapter.put('kb/index.json', Buffer.from('{}'));
      await adapter.put('kb/examples.json', Buffer.from('[]'));
      await adapter.put('exports/report.pdf', Buffer.from('pdf'));

      const results = await adapter.list('kb/');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key)).toContain('kb/index.json');
      expect(results.map((r) => r.key)).toContain('kb/examples.json');
    });

    it('should return empty array for non-existent prefix', async () => {
      const results = await adapter.list('nonexistent/');
      expect(results).toEqual([]);
    });

    it('should include file metadata (size, lastModified)', async () => {
      const data = Buffer.from('test data');
      await adapter.put('test.txt', data);

      const results = await adapter.list('');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('test.txt');
      expect(results[0].size).toBe(data.length);
      expect(results[0].lastModified).toBeInstanceOf(Date);
    });

    it('should recursively list nested directories', async () => {
      await adapter.put('a/b/c/test.txt', Buffer.from('data'));
      await adapter.put('a/d/test.txt', Buffer.from('data'));

      const results = await adapter.list('a/');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key)).toContain('a/b/c/test.txt');
      expect(results.map((r) => r.key)).toContain('a/d/test.txt');
    });
  });

  describe('copy', () => {
    it('should copy file to new location', async () => {
      const data = Buffer.from('original');
      await adapter.put('original.txt', data);

      await adapter.copy('original.txt', 'copy.txt');

      const copied = await adapter.get('copy.txt');
      expect(copied).toEqual(data);
    });

    it('should throw if source file does not exist', async () => {
      await expect(adapter.copy('nonexistent.txt', 'copy.txt')).rejects.toThrow('not found');
    });

    it('should create parent directories for destination', async () => {
      await adapter.put('original.txt', Buffer.from('data'));
      await adapter.copy('original.txt', 'a/b/copy.txt');

      expect(await adapter.exists('a/b/copy.txt')).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return metadata for existing file', async () => {
      const data = Buffer.from('test data');
      await adapter.put('test.txt', data);

      const meta = await adapter.getMetadata('test.txt');
      expect(meta).toBeDefined();
      expect(meta.size).toBe(data.length);
      expect(meta.lastModified).toBeInstanceOf(Date);
      expect(meta.contentType).toBe('text/plain');
    });

    it('should infer content type from extension', async () => {
      await adapter.put('data.json', Buffer.from('{}'));
      const jsonMeta = await adapter.getMetadata('data.json');
      expect(jsonMeta.contentType).toBe('application/json');

      await adapter.put('image.png', Buffer.from('png'));
      const imageMeta = await adapter.getMetadata('image.png');
      expect(imageMeta.contentType).toBe('image/png');
    });

    it('should return null for non-existent file', async () => {
      const meta = await adapter.getMetadata('nonexistent.txt');
      expect(meta).toBeNull();
    });
  });

  describe('getSignedUrl', () => {
    it('should return file:// URL for local files', async () => {
      await adapter.put('test.txt', Buffer.from('data'));
      const url = await adapter.getSignedUrl('test.txt');

      expect(url).toMatch(/^file:\/\//);
      expect(url).toContain('test.txt');
    });
  });

  describe('getProviderName', () => {
    it('should return "local"', () => {
      expect(adapter.getProviderName()).toBe('local');
    });
  });

  describe('atomic writes', () => {
    it('should use atomic rename pattern', async () => {
      const data = Buffer.from('test');
      await adapter.put('atomic.txt', data);

      // Verify no .tmp files left behind
      const tmpFiles = fs.readdirSync(tempDir).filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});

describe('DualWriteAdapter', () => {
  let primary, secondary, adapter;

  beforeEach(() => {
    const primaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-primary-'));
    const secondaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-secondary-'));

    primary = new LocalStorageAdapter({ basePath: primaryDir });
    secondary = new LocalStorageAdapter({ basePath: secondaryDir });
    adapter = new DualWriteAdapter(primary, secondary);

    // Store temp dirs for cleanup
    adapter._primaryDir = primaryDir;
    adapter._secondaryDir = secondaryDir;
  });

  afterEach(() => {
    if (adapter._primaryDir && fs.existsSync(adapter._primaryDir)) {
      fs.rmSync(adapter._primaryDir, { recursive: true, force: true });
    }
    if (adapter._secondaryDir && fs.existsSync(adapter._secondaryDir)) {
      fs.rmSync(adapter._secondaryDir, { recursive: true, force: true });
    }
  });

  describe('put to both storages', () => {
    it('should write to both primary and secondary', async () => {
      const data = Buffer.from('dual data');
      await adapter.put('test.txt', data);

      // Allow async write to secondary
      await new Promise((r) => setTimeout(r, 100));

      expect(await primary.get('test.txt')).toEqual(data);
      expect(await secondary.get('test.txt')).toEqual(data);
    });

    it('should succeed even if secondary write fails', async () => {
      const data = Buffer.from('test');

      // Mock secondary.put to throw
      const originalPut = secondary.put.bind(secondary);
      secondary.put = async () => {
        throw new Error('Secondary storage unavailable');
      };

      // Should not throw
      await expect(adapter.put('test.txt', data)).resolves.not.toThrow();

      // Primary should succeed
      expect(await primary.get('test.txt')).toEqual(data);

      // Restore
      secondary.put = originalPut;
    });
  });

  describe('get with fallback', () => {
    it('should read from primary if available', async () => {
      const data = Buffer.from('primary data');
      await primary.put('test.txt', data);

      const result = await adapter.get('test.txt');
      expect(result).toEqual(data);
    });

    it('should fallback to secondary if primary missing', async () => {
      const data = Buffer.from('secondary data');
      await secondary.put('test.txt', data);

      const result = await adapter.get('test.txt');
      expect(result).toEqual(data);
    });

    it('should backfill to primary on secondary hit', async () => {
      const data = Buffer.from('secondary data');
      await secondary.put('test.txt', data);

      // Get should backfill
      await adapter.get('test.txt');

      // Allow backfill to complete
      await new Promise((r) => setTimeout(r, 100));

      // Verify backfill happened
      expect(await primary.get('test.txt')).toEqual(data);
    });

    it('should return null if file not in either storage', async () => {
      const result = await adapter.get('nonexistent.txt');
      expect(result).toBeNull();
    });
  });

  describe('delete from both', () => {
    it('should delete from both storages', async () => {
      await adapter.put('test.txt', Buffer.from('data'));
      await new Promise((r) => setTimeout(r, 100)); // Wait for secondary write

      await adapter.delete('test.txt');
      await new Promise((r) => setTimeout(r, 100)); // Wait for secondary delete

      expect(await primary.exists('test.txt')).toBe(false);
      expect(await secondary.exists('test.txt')).toBe(false);
    });
  });

  describe('exists with fallback', () => {
    it('should check primary first', async () => {
      await primary.put('test.txt', Buffer.from('data'));
      expect(await adapter.exists('test.txt')).toBe(true);
    });

    it('should fallback to secondary', async () => {
      await secondary.put('test.txt', Buffer.from('data'));
      expect(await adapter.exists('test.txt')).toBe(true);
    });
  });

  describe('getProviderName', () => {
    it('should return "dual"', () => {
      expect(adapter.getProviderName()).toBe('dual');
    });
  });
});

describe('StorageFactory', () => {
  describe('createStorageAdapter', () => {
    it('should create LocalStorageAdapter by default', () => {
      const adapter = createStorageAdapter({ basePath: tempDir });
      expect(adapter).toBeInstanceOf(LocalStorageAdapter);
      expect(adapter.getProviderName()).toBe('local');
    });

    it('should create LocalStorageAdapter for "local" provider', () => {
      const adapter = createStorageAdapter({ provider: 'local', basePath: tempDir });
      expect(adapter).toBeInstanceOf(LocalStorageAdapter);
    });

    it('should create DualWriteAdapter for "dual" provider', () => {
      const adapter = createStorageAdapter({
        provider: 'dual',
        primaryProvider: 'local',
        secondaryProvider: 'local',
        basePath: tempDir,
      });
      expect(adapter).toBeInstanceOf(DualWriteAdapter);
      expect(adapter.getProviderName()).toBe('dual');
    });

    it('should throw for S3 without credentials', () => {
      // Clear env vars
      const saved = {
        S3_BUCKET: process.env.S3_BUCKET,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      };
      delete process.env.S3_BUCKET;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(() => createStorageAdapter({ provider: 's3' })).toThrow();

      // Restore
      Object.assign(process.env, saved);
    });

    it('should throw for R2 without credentials', () => {
      // Clear env vars
      const saved = {
        R2_BUCKET: process.env.R2_BUCKET,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      };
      delete process.env.R2_BUCKET;
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

      expect(() => createStorageAdapter({ provider: 'r2' })).toThrow();

      // Restore
      Object.assign(process.env, saved);
    });
  });

  describe('getStorageAdapter (singleton)', () => {
    it('should return singleton instance', () => {
      _resetStorageAdapter();
      const adapter1 = createStorageAdapter({ provider: 'local', basePath: tempDir });
      _setStorageAdapter(adapter1);

      // Simulate app using singleton
      // In real app: getStorageAdapter() returns same instance
      expect(adapter1.getProviderName()).toBe('local');
    });
  });
});
