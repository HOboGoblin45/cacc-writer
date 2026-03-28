/**
 * server/dataPipeline/crawlCache.js
 * In-memory + optional localStorage-backed cache for crawl results.
 * Prevents redundant API calls during iterative report writing.
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {object} CacheEntry
 * @property {*} data - The cached crawl result data
 * @property {number} timestamp - Unix epoch ms when the entry was stored
 * @property {object} metadata - Arbitrary metadata (url, area, city, zip, etc.)
 */

/**
 * @typedef {object} StalenessInfo
 * @property {boolean} stale - Whether the entry exceeds defaultMaxAge
 * @property {number} ageSeconds - Age in seconds
 * @property {string} ageLabel - Human-readable age label
 * @property {'ok'|'amber'|'red'} severity - ok = fresh, amber = >30 days, red = >90 days
 */

/**
 * @typedef {object} CacheStats
 * @property {number} entries - Total number of cache entries
 * @property {number} validEntries - Entries still within defaultMaxAge
 * @property {number} expiredEntries - Entries past defaultMaxAge
 * @property {number} totalSizeEstimate - Rough byte estimate of cached data
 * @property {number} oldestTimestamp - Oldest entry timestamp (ms)
 * @property {number} newestTimestamp - Newest entry timestamp (ms)
 */

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;
const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;

export class CrawlCache {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultMaxAge=86400] - Default TTL in seconds (1 day)
   * @param {boolean} [options.persistToStorage=false] - Whether to persist to a JSON file on disk (server-side)
   * @param {string} [options.storagePath] - File path for persistence (only used if persistToStorage is true)
   */
  constructor(options = {}) {
    /** @type {number} */
    this.defaultMaxAge = options.defaultMaxAge ?? 86400;

    /** @type {boolean} */
    this.persistToStorage = options.persistToStorage ?? false;

    /** @type {string|undefined} */
    this.storagePath = options.storagePath;

    /** @type {Map<string, CacheEntry>} */
    this._cache = new Map();

    // Hydrate from disk if configured
    if (this.persistToStorage && this.storagePath) {
      this._loadFromDisk();
    }
  }

  /**
   * Generate a deterministic cache key from a URL and options object.
   * @param {string} url - The crawl URL
   * @param {object} [options={}] - Additional options that differentiate requests
   * @returns {string} A hex SHA-256 hash key
   */
  getCacheKey(url, options = {}) {
    const normalized = typeof url === 'string' ? url.trim().toLowerCase() : '';
    const payload = JSON.stringify({ url: normalized, options });
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Check if a cached entry is still valid per the given maxAge.
   * @param {string} key - Cache key
   * @param {number} [maxAge] - Max age in seconds; defaults to this.defaultMaxAge
   * @returns {boolean} True if the entry exists and has not expired
   */
  isValid(key, maxAge) {
    const entry = this._cache.get(key);
    if (!entry) return false;
    const ttl = (maxAge ?? this.defaultMaxAge) * 1000;
    return Date.now() - entry.timestamp < ttl;
  }

  /**
   * Store crawl results with timestamp and metadata.
   * @param {string} key - Cache key (from getCacheKey)
   * @param {*} data - The data to cache
   * @param {object} [metadata={}] - Extra metadata (url, city, zip, area, etc.)
   */
  store(key, data, metadata = {}) {
    /** @type {CacheEntry} */
    const entry = {
      data,
      timestamp: Date.now(),
      metadata: { ...metadata },
    };
    this._cache.set(key, entry);
    this._persistIfNeeded();
  }

  /**
   * Retrieve cached data if valid.
   * @param {string} key - Cache key
   * @param {number} [maxAge] - Max age in seconds; defaults to this.defaultMaxAge
   * @returns {*|null} Cached data or null if expired/missing
   */
  retrieve(key, maxAge) {
    if (!this.isValid(key, maxAge)) return null;
    return this._cache.get(key).data;
  }

  /**
   * Get the stored timestamp for a cache entry, useful for If-Modified-Since headers
   * in incremental crawling.
   * @param {string} key - Cache key
   * @returns {number|null} Unix epoch ms timestamp, or null if no entry exists
   */
  getModifiedSinceTimestamp(key) {
    const entry = this._cache.get(key);
    return entry ? entry.timestamp : null;
  }

  /**
   * Find recent crawls for an area (city/zip).
   * Searches metadata of all entries for matching city or zip values.
   * @param {string} [city] - City name to match (case-insensitive)
   * @param {string} [zip] - ZIP code to match
   * @returns {Array<{key: string, url: string, timestamp: number, area: string}>}
   */
  getRecentCrawlsForArea(city, zip) {
    const normalizedCity = city ? city.trim().toLowerCase() : null;
    const normalizedZip = zip ? zip.trim() : null;

    /** @type {Array<{key: string, url: string, timestamp: number, area: string}>} */
    const results = [];

    for (const [key, entry] of this._cache) {
      const meta = entry.metadata || {};
      const metaCity = (meta.city || '').trim().toLowerCase();
      const metaZip = (meta.zip || '').trim();
      const metaArea = meta.area || meta.city || '';

      let match = false;
      if (normalizedCity && metaCity === normalizedCity) match = true;
      if (normalizedZip && metaZip === normalizedZip) match = true;

      if (match) {
        results.push({
          key,
          url: meta.url || '',
          timestamp: entry.timestamp,
          area: metaArea,
        });
      }
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results;
  }

  /**
   * Get staleness info for a cache entry.
   * @param {string} key - Cache key
   * @returns {StalenessInfo|null} Staleness information, or null if entry does not exist
   */
  getStaleness(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;

    const ageMs = Date.now() - entry.timestamp;
    const ageSeconds = Math.floor(ageMs / 1000);
    const stale = ageSeconds > this.defaultMaxAge;

    // Severity thresholds
    let severity = 'ok';
    if (ageSeconds > NINETY_DAYS_SEC) {
      severity = 'red';
    } else if (ageSeconds > THIRTY_DAYS_SEC) {
      severity = 'amber';
    }

    return {
      stale,
      ageSeconds,
      ageLabel: this._humanizeAge(ageSeconds),
      severity,
    };
  }

  /**
   * Clear all cached data (both in-memory and persisted).
   */
  clear() {
    this._cache.clear();
    this._persistIfNeeded();
  }

  /**
   * Get cache statistics.
   * @returns {CacheStats}
   */
  stats() {
    let validEntries = 0;
    let expiredEntries = 0;
    let totalSizeEstimate = 0;
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    const ttlMs = this.defaultMaxAge * 1000;
    const now = Date.now();

    for (const [, entry] of this._cache) {
      const age = now - entry.timestamp;
      if (age < ttlMs) {
        validEntries++;
      } else {
        expiredEntries++;
      }

      // Rough size estimate via JSON serialization length
      try {
        totalSizeEstimate += JSON.stringify(entry.data).length * 2; // ~2 bytes/char
      } catch {
        totalSizeEstimate += 1024; // fallback estimate
      }

      if (entry.timestamp < oldestTimestamp) oldestTimestamp = entry.timestamp;
      if (entry.timestamp > newestTimestamp) newestTimestamp = entry.timestamp;
    }

    return {
      entries: this._cache.size,
      validEntries,
      expiredEntries,
      totalSizeEstimate,
      oldestTimestamp: this._cache.size > 0 ? oldestTimestamp : 0,
      newestTimestamp: this._cache.size > 0 ? newestTimestamp : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert an age in seconds to a human-readable label.
   * @param {number} seconds
   * @returns {string}
   * @private
   */
  _humanizeAge(seconds) {
    if (seconds < 60) return `${seconds} second(s)`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute(s)`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour(s)`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day(s)`;
    const months = Math.floor(days / 30);
    return `${months} month(s)`;
  }

  /**
   * Persist the cache to disk if persistToStorage is enabled.
   * Uses synchronous write for simplicity; callers should be aware.
   * @private
   */
  _persistIfNeeded() {
    if (!this.persistToStorage || !this.storagePath) return;

    try {
      const { writeFileSync, mkdirSync } = require('node:fs');
      const { dirname } = require('node:path');

      // Ensure directory exists
      mkdirSync(dirname(this.storagePath), { recursive: true });

      // Serialize the map
      const serializable = {};
      for (const [key, entry] of this._cache) {
        serializable[key] = entry;
      }
      writeFileSync(this.storagePath, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (err) {
      // Persistence is best-effort; log but don't throw
      if (typeof console !== 'undefined') {
        console.warn(`[CrawlCache] Failed to persist cache to ${this.storagePath}:`, err.message);
      }
    }
  }

  /**
   * Load cached data from disk if the file exists.
   * @private
   */
  _loadFromDisk() {
    if (!this.storagePath) return;

    try {
      const { readFileSync, existsSync } = require('node:fs');
      if (!existsSync(this.storagePath)) return;

      const raw = readFileSync(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw);

      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.timestamp === 'number' && 'data' in entry) {
          this._cache.set(key, /** @type {CacheEntry} */ (entry));
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`[CrawlCache] Failed to load cache from ${this.storagePath}:`, err.message);
      }
    }
  }
}
