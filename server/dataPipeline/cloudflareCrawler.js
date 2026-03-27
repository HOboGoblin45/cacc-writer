/**
 * server/dataPipeline/cloudflareCrawler.js
 * -----------------------------------------
 * Core wrapper for Cloudflare Browser Rendering API.
 * Handles /crawl (async multi-page) and /json (sync single-page extraction).
 *
 * Usage:
 *   import { CloudflareCrawler, SCHEMAS, EXTRACTION_PROMPTS, CRAWL_PRESETS } from './cloudflareCrawler.js';
 *   const crawler = new CloudflareCrawler(accountId, apiToken);
 *   const result = await crawler.crawlAndWait('https://example.com');
 *
 * Endpoints wrapped:
 *   POST   /crawl          — start an async multi-page crawl
 *   GET    /crawl/{jobId}  — poll crawl status / retrieve records
 *   DELETE /crawl/{jobId}  — cancel a running crawl
 *   POST   /json           — sync single-page structured extraction
 */

import log from '../logger.js';

// ── Configuration defaults ──────────────────────────────────────────────────

const DEFAULTS = {
  pollingIntervalMs: 5000,
  pollingMaxAttempts: 120,
  maxPagesPerCrawl: 25,
  defaultMaxAge: 86400,
};

const TERMINAL_STATUSES = new Set([
  'completed',
  'errored',
  'cancelled_by_user',
  'cancelled_due_to_timeout',
  'cancelled_due_to_limits',
]);

// ── CloudflareCrawler class ─────────────────────────────────────────────────

/**
 * CloudflareCrawler — reusable class for all Cloudflare Browser Rendering interactions.
 *
 * @example
 *   const crawler = new CloudflareCrawler(process.env.CF_ACCOUNT_ID, process.env.CF_API_TOKEN);
 *   const { status, records } = await crawler.crawlAndWait(url, { limit: 10 });
 */
export class CloudflareCrawler {
  /**
   * @param {string} accountId  - Cloudflare Account ID
   * @param {string} apiToken   - Cloudflare API Token with Browser Rendering permissions
   * @param {object} [options]
   * @param {number} [options.pollingIntervalMs]  - Base polling interval in ms (default 5000)
   * @param {number} [options.pollingMaxAttempts]  - Max poll attempts before giving up (default 120)
   * @param {number} [options.maxPagesPerCrawl]    - Default page limit per crawl (default 25)
   * @param {number} [options.defaultMaxAge]       - Cache max-age in seconds (default 86400)
   */
  constructor(accountId, apiToken, options = {}) {
    if (!accountId || typeof accountId !== 'string') {
      throw new Error('CloudflareCrawler requires a valid accountId string.');
    }
    if (!apiToken || typeof apiToken !== 'string') {
      throw new Error('CloudflareCrawler requires a valid apiToken string.');
    }

    this.accountId = accountId.trim();
    this.apiToken = apiToken.trim();
    this.options = { ...DEFAULTS, ...options };
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/browser-rendering`;

    // Usage tracking (cumulative across all requests on this instance)
    this._browserMsUsed = 0;
    this._jobCount = 0;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Build standard authorization and content-type headers.
   * @returns {Record<string, string>}
   */
  _headers() {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Build full API URL for a given sub-path.
   * @param {string} path - e.g. '/crawl' or '/crawl/abc123' or '/json'
   * @returns {string}
   */
  _url(path) {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Internal fetch wrapper with structured error handling and usage tracking.
   *
   * @param {string} path    - API sub-path (e.g. '/crawl')
   * @param {object} [opts]  - fetch options (method, body, etc.)
   * @returns {Promise<object>} Parsed JSON response
   * @throws {Error} with user-friendly message on HTTP errors
   */
  async _fetch(path, opts = {}) {
    const url = this._url(path);
    const method = opts.method || 'GET';

    log.debug('cf-crawler:fetch', { method, path });

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this._headers(),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs || 60_000),
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error('Cloudflare API request timed out. Please try again.');
      }
      throw new Error(`Cloudflare API network error: ${err.message}`);
    }

    // Track browser time from response header
    const browserMs = Number(res.headers.get('x-browser-ms-used') || 0);
    if (browserMs > 0) {
      this._browserMsUsed += browserMs;
    }

    // Map HTTP errors to user-friendly messages
    if (!res.ok) {
      const status = res.status;
      let body;
      try {
        body = await res.text();
      } catch {
        body = '';
      }

      if (status === 401 || status === 403) {
        throw new Error(
          'Invalid Cloudflare credentials. Check your Account ID and API Token in settings.'
        );
      }
      if (status === 429) {
        throw new Error(
          'Cloudflare rate limit reached. Please wait before trying again.'
        );
      }
      if (status >= 500) {
        throw new Error(
          'Cloudflare service error. Please try again later.'
        );
      }

      throw new Error(
        `Cloudflare API error (HTTP ${status}): ${body.slice(0, 500)}`
      );
    }

    try {
      return await res.json();
    } catch {
      throw new Error('Cloudflare API returned invalid JSON.');
    }
  }

  // ── CRAWL — async multi-page ────────────────────────────────────────────

  /**
   * Start an async multi-page crawl.
   *
   * @param {string} url               - Seed URL to begin crawling from
   * @param {object} [options]
   * @param {string[]} [options.formats]             - Output formats (default: ['markdown','json'])
   * @param {string[]} [options.rejectResourceTypes] - Resource types to skip (default: ['image','media','font'])
   * @param {number}   [options.limit]               - Max pages to crawl (capped at 100000)
   * @param {boolean}  [options.render]              - Whether to render JavaScript (default: true)
   * @param {number}   [options.maxAge]              - Cache max-age in seconds
   * @param {string}   [options.filterPattern]       - URL pattern to restrict crawl scope
   * @returns {Promise<string>} jobId
   */
  async startCrawl(url, options = {}) {
    if (!url || typeof url !== 'string') {
      throw new Error('startCrawl requires a valid URL string.');
    }

    const mergedOptions = {
      formats: options.formats || ['markdown', 'json'],
      rejectResourceTypes: options.rejectResourceTypes || ['image', 'media', 'font'],
      limit: Math.min(options.limit || this.options.maxPagesPerCrawl, 100000),
    };

    // Optional fields — only include if provided
    if (options.render !== undefined) mergedOptions.render = options.render;
    if (options.maxAge !== undefined) mergedOptions.maxAge = options.maxAge;
    if (options.filterPattern) mergedOptions.filterPattern = options.filterPattern;
    if (options.maxDepth !== undefined) mergedOptions.maxDepth = options.maxDepth;

    const body = { url, ...mergedOptions };

    log.info('cf-crawler:start-crawl', { url, limit: mergedOptions.limit });

    const data = await this._fetch('/crawl', { method: 'POST', body });

    const jobId = data.id || data.jobId || data.result?.id;
    if (!jobId) {
      throw new Error('Cloudflare crawl response did not include a job ID.');
    }

    this._jobCount++;
    log.info('cf-crawler:crawl-started', { jobId, url });
    return jobId;
  }

  /**
   * Poll a crawl job for status and records.
   *
   * @param {string} jobId
   * @param {object} [options]
   * @param {number} [options.limit]   - Max records per page
   * @param {string} [options.status]  - Filter by record status
   * @param {string} [options.cursor]  - Pagination cursor
   * @returns {Promise<{ status: string, records: object[], total: number, finished: number, cursor: string|null }>}
   */
  async pollCrawl(jobId, options = {}) {
    if (!jobId) throw new Error('pollCrawl requires a jobId.');

    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.status) params.set('status', options.status);
    if (options.cursor) params.set('cursor', options.cursor);

    const query = params.toString();
    const path = `/crawl/${jobId}${query ? `?${query}` : ''}`;

    const data = await this._fetch(path);

    return {
      status: data.status || 'unknown',
      records: data.data || data.records || [],
      total: data.total ?? 0,
      finished: data.finished ?? 0,
      cursor: data.cursor || null,
    };
  }

  /**
   * Cancel a running crawl job.
   *
   * @param {string} jobId
   * @returns {Promise<{ success: boolean }>}
   */
  async cancelCrawl(jobId) {
    if (!jobId) throw new Error('cancelCrawl requires a jobId.');

    log.info('cf-crawler:cancel-crawl', { jobId });

    try {
      await this._fetch(`/crawl/${jobId}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      log.warn('cf-crawler:cancel-failed', { jobId, error: err.message });
      return { success: false };
    }
  }

  /**
   * Convenience method: start a crawl, poll until terminal, return all records.
   *
   * Uses exponential backoff starting at pollingIntervalMs, capped at 15 000 ms.
   * Collects ALL records across pagination cursors.
   *
   * @param {string} url                      - Seed URL
   * @param {object} [options]                - Same as startCrawl options
   * @param {function|null} [onProgress]      - Optional callback: (status, finished, total) => void
   * @returns {Promise<{ status: string, records: object[], total: number, browserSecondsUsed: number }>}
   */
  async crawlAndWait(url, options = {}, onProgress = null) {
    const msBeforeStart = this._browserMsUsed;
    const jobId = await this.startCrawl(url, options);

    const { pollingIntervalMs, pollingMaxAttempts } = this.options;
    let attempt = 0;
    let delay = pollingIntervalMs;
    let lastStatus = 'pending';

    // Poll until terminal status or max attempts
    while (attempt < pollingMaxAttempts) {
      await _sleep(delay);
      attempt++;

      const poll = await this.pollCrawl(jobId);
      lastStatus = poll.status;

      if (typeof onProgress === 'function') {
        try {
          onProgress(poll.status, poll.finished, poll.total);
        } catch {
          // Swallow callback errors
        }
      }

      log.debug('cf-crawler:poll', {
        jobId,
        attempt,
        status: poll.status,
        finished: poll.finished,
        total: poll.total,
      });

      if (TERMINAL_STATUSES.has(poll.status)) {
        // Collect all records across pagination
        const allRecords = [...poll.records];
        let cursor = poll.cursor;

        while (cursor) {
          const next = await this.pollCrawl(jobId, { cursor });
          allRecords.push(...next.records);
          cursor = next.cursor;
        }

        const browserMsForJob = this._browserMsUsed - msBeforeStart;

        log.info('cf-crawler:crawl-complete', {
          jobId,
          status: poll.status,
          totalRecords: allRecords.length,
          browserMs: browserMsForJob,
        });

        return {
          status: poll.status,
          records: allRecords,
          total: allRecords.length,
          browserSecondsUsed: Math.round(browserMsForJob / 1000 * 100) / 100,
        };
      }

      // Exponential backoff capped at 15s
      delay = Math.min(delay * 1.5, 15000);
    }

    // Timed out — attempt cancellation and return what we have
    log.warn('cf-crawler:poll-timeout', { jobId, attempts: attempt, lastStatus });
    await this.cancelCrawl(jobId);

    const finalPoll = await this.pollCrawl(jobId);
    const allRecords = [...finalPoll.records];
    let cursor = finalPoll.cursor;
    while (cursor) {
      const next = await this.pollCrawl(jobId, { cursor });
      allRecords.push(...next.records);
      cursor = next.cursor;
    }

    return {
      status: `timeout_after_${attempt}_attempts`,
      records: allRecords,
      total: allRecords.length,
      browserSecondsUsed: Math.round((this._browserMsUsed - msBeforeStart) / 1000 * 100) / 100,
    };
  }

  // ── JSON — sync single-page structured extraction ───────────────────────

  /**
   * Perform single-page structured data extraction using Cloudflare's /json endpoint.
   *
   * @param {string} url                 - Page URL to extract from
   * @param {string} prompt              - Natural-language extraction instructions
   * @param {object} schema              - JSON Schema describing the expected output
   * @param {object} [options]
   * @param {boolean}  [options.render]  - Render JavaScript before extraction (default: true)
   * @param {number}   [options.maxAge]  - Cache max-age in seconds
   * @param {object}   [options.customAI] - Custom AI provider config (e.g. Anthropic routing)
   * @param {string}   [options.customAI.model]         - Model identifier
   * @param {string}   [options.customAI.authorization]  - Bearer token for the AI provider
   * @returns {Promise<object>} Extracted JSON conforming to the provided schema
   */
  async extractJSON(url, prompt, schema, options = {}) {
    if (!url || typeof url !== 'string') {
      throw new Error('extractJSON requires a valid URL string.');
    }
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('extractJSON requires a prompt string.');
    }
    if (!schema || typeof schema !== 'object') {
      throw new Error('extractJSON requires a JSON schema object.');
    }

    const body = {
      url,
      prompt,
      response_format: {
        type: 'json_schema',
        schema,
      },
    };

    if (options.render !== undefined) body.render = options.render;
    if (options.maxAge !== undefined) body.maxAge = options.maxAge;

    // Custom AI provider routing (e.g. Anthropic Claude)
    if (options.customAI) {
      body.custom_ai = [{
        model: options.customAI.model || 'anthropic/claude-sonnet-4-20250514',
        authorization: options.customAI.authorization,
      }];
    }

    log.info('cf-crawler:extract-json', { url, schemaType: schema.title || 'unknown' });

    this._jobCount++;
    const data = await this._fetch('/json', { method: 'POST', body, timeoutMs: 90_000 });

    // The /json endpoint returns the extracted object directly or nested under .result
    return data.result || data;
  }

  // ── UTILITY ─────────────────────────────────────────────────────────────

  /**
   * Quick connection validation. Performs a minimal crawl against example.com.
   *
   * @returns {Promise<{ ok: boolean, message: string, browserMs: number }>}
   */
  async testConnection() {
    const msBefore = this._browserMsUsed;

    try {
      const jobId = await this.startCrawl('https://example.com', {
        limit: 1,
        render: false,
        formats: ['markdown'],
      });

      // Poll once — example.com should resolve almost instantly
      await _sleep(3000);
      const poll = await this.pollCrawl(jobId);
      const browserMs = this._browserMsUsed - msBefore;

      return {
        ok: true,
        message: `Connection successful. Crawl status: ${poll.status}, records: ${poll.records.length}.`,
        browserMs,
      };
    } catch (err) {
      return {
        ok: false,
        message: err.message,
        browserMs: 0,
      };
    }
  }

  /**
   * Return cumulative usage statistics for this crawler instance.
   *
   * Cost estimate: Cloudflare charges $0.09/hr of browser time after a 10 hr/month free tier.
   * This method does NOT track free-tier offset — it reports raw cumulative usage.
   *
   * @returns {{ totalBrowserMs: number, totalBrowserSeconds: number, estimatedCostUsd: number, jobCount: number }}
   */
  getUsageStats() {
    const totalBrowserMs = this._browserMsUsed;
    const totalBrowserSeconds = Math.round(totalBrowserMs / 1000 * 100) / 100;
    const totalHours = totalBrowserMs / 3_600_000;
    // $0.09 per browser-hour
    const estimatedCostUsd = Math.round(totalHours * 0.09 * 10000) / 10000;

    return {
      totalBrowserMs,
      totalBrowserSeconds,
      estimatedCostUsd,
      jobCount: this._jobCount,
    };
  }
}

// ── EXTRACTION SCHEMAS ──────────────────────────────────────────────────────

/**
 * JSON schemas for structured extraction via the /json endpoint.
 * Each schema follows JSON Schema draft-07 conventions.
 */
export const SCHEMAS = {
  /**
   * Full property details schema for county assessor / tax record pages.
   */
  propertyDetails: {
    title: 'PropertyDetails',
    type: 'object',
    properties: {
      parcelNumber: {
        type: ['string', 'null'],
        description: 'Tax assessor parcel identification number (APN / PIN).',
      },
      address: {
        type: 'object',
        properties: {
          streetAddress: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
          state: { type: ['string', 'null'] },
          zip: { type: ['string', 'null'] },
          county: { type: ['string', 'null'] },
        },
      },
      legalDescription: {
        type: ['string', 'null'],
        description: 'Full legal description from the assessor record.',
      },
      owner: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          mailingAddress: { type: ['string', 'null'] },
          ownershipType: {
            type: ['string', 'null'],
            description: 'e.g. Individual, Trust, LLC, Joint Tenants.',
          },
        },
      },
      yearBuilt: {
        type: ['integer', 'null'],
        description: 'Original year of construction.',
      },
      effectiveAge: {
        type: ['integer', 'null'],
        description: 'Effective age if reported by assessor.',
      },
      gla: {
        type: ['number', 'null'],
        description: 'Gross living area in square feet (above-grade finished).',
      },
      siteArea: {
        type: ['number', 'null'],
        description: 'Site/lot area in square feet or acres.',
      },
      siteAreaUnit: {
        type: ['string', 'null'],
        enum: ['sqft', 'acres', null],
      },
      zoning: {
        type: ['string', 'null'],
        description: 'Zoning classification code (e.g. R-1, C-2).',
      },
      zoningDescription: {
        type: ['string', 'null'],
        description: 'Human-readable zoning description.',
      },
      bedrooms: {
        type: ['integer', 'null'],
      },
      bathrooms: {
        type: ['number', 'null'],
        description: 'Total bathroom count (e.g. 2.5 for 2 full + 1 half).',
      },
      bathroomsFull: {
        type: ['integer', 'null'],
      },
      bathroomsHalf: {
        type: ['integer', 'null'],
      },
      basement: {
        type: 'object',
        properties: {
          hasBasement: { type: ['boolean', 'null'] },
          type: {
            type: ['string', 'null'],
            description: 'e.g. Full, Partial, Crawl Space, Slab.',
          },
          finishedSqFt: { type: ['number', 'null'] },
          totalSqFt: { type: ['number', 'null'] },
        },
      },
      garage: {
        type: 'object',
        properties: {
          hasGarage: { type: ['boolean', 'null'] },
          type: {
            type: ['string', 'null'],
            description: 'e.g. Attached, Detached, Built-in, Carport.',
          },
          capacity: {
            type: ['integer', 'null'],
            description: 'Number of car spaces.',
          },
          sqFt: { type: ['number', 'null'] },
        },
      },
      construction: {
        type: 'object',
        properties: {
          exteriorWalls: {
            type: ['string', 'null'],
            description: 'e.g. Frame, Brick, Vinyl Siding, Stucco.',
          },
          roofType: {
            type: ['string', 'null'],
            description: 'e.g. Gable, Hip, Flat.',
          },
          roofMaterial: {
            type: ['string', 'null'],
            description: 'e.g. Asphalt Shingle, Metal, Tile.',
          },
          foundation: {
            type: ['string', 'null'],
            description: 'e.g. Poured Concrete, Block, Pier.',
          },
          heating: { type: ['string', 'null'] },
          cooling: { type: ['string', 'null'] },
          fireplaces: { type: ['integer', 'null'] },
          stories: { type: ['number', 'null'] },
          condition: {
            type: ['string', 'null'],
            description: 'Assessor-reported condition rating.',
          },
          quality: {
            type: ['string', 'null'],
            description: 'Assessor-reported quality/grade rating.',
          },
        },
      },
      assessedValue: {
        type: 'object',
        properties: {
          landValue: { type: ['number', 'null'] },
          improvementValue: { type: ['number', 'null'] },
          totalAssessedValue: { type: ['number', 'null'] },
          assessmentYear: { type: ['integer', 'null'] },
          marketValue: {
            type: ['number', 'null'],
            description: 'Assessor-estimated market value, if available.',
          },
        },
      },
      taxInfo: {
        type: 'object',
        properties: {
          annualTaxAmount: { type: ['number', 'null'] },
          taxYear: { type: ['integer', 'null'] },
          taxRate: { type: ['number', 'null'] },
          exemptions: {
            type: 'array',
            items: { type: 'string' },
            description: 'e.g. Homestead, Senior, Veteran.',
          },
          specialAssessments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                amount: { type: 'number' },
              },
            },
          },
        },
      },
      salesHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            saleDate: { type: ['string', 'null'], description: 'ISO 8601 or MM/DD/YYYY.' },
            salePrice: { type: ['number', 'null'] },
            grantor: { type: ['string', 'null'] },
            grantee: { type: ['string', 'null'] },
            deedType: { type: ['string', 'null'] },
            documentNumber: { type: ['string', 'null'] },
          },
        },
        description: 'Chronological list of recorded sales/transfers.',
      },
      floodZone: {
        type: ['string', 'null'],
        description: 'FEMA flood zone designation (e.g. X, AE, VE).',
      },
      utilities: {
        type: 'object',
        properties: {
          water: { type: ['string', 'null'], description: 'e.g. Municipal, Well.' },
          sewer: { type: ['string', 'null'], description: 'e.g. Municipal, Septic.' },
          electric: { type: ['string', 'null'] },
          gas: { type: ['string', 'null'] },
        },
      },
      propertyType: {
        type: ['string', 'null'],
        description: 'e.g. Single Family, Condo, Multi-Family, Vacant Land.',
      },
      landUseCode: {
        type: ['string', 'null'],
        description: 'Assessor land-use classification code.',
      },
      subdivision: {
        type: ['string', 'null'],
      },
      extractedAt: {
        type: ['string', 'null'],
        description: 'ISO 8601 timestamp of when data was extracted.',
      },
      sourceUrl: {
        type: ['string', 'null'],
        description: 'URL the data was extracted from.',
      },
    },
  },

  /**
   * MLS / listing comparable sale schema.
   */
  comparableSale: {
    title: 'ComparableSale',
    type: 'object',
    properties: {
      mlsNumber: {
        type: ['string', 'null'],
        description: 'MLS listing number.',
      },
      status: {
        type: ['string', 'null'],
        description: 'e.g. Active, Pending, Sold, Withdrawn, Expired.',
      },
      listPrice: { type: ['number', 'null'] },
      salePrice: { type: ['number', 'null'] },
      originalListPrice: { type: ['number', 'null'] },
      pricePerSqFt: { type: ['number', 'null'] },
      listDate: { type: ['string', 'null'] },
      saleDate: { type: ['string', 'null'] },
      contractDate: { type: ['string', 'null'] },
      dom: {
        type: ['integer', 'null'],
        description: 'Days on market.',
      },
      cdom: {
        type: ['integer', 'null'],
        description: 'Cumulative days on market (across relists).',
      },
      concessions: {
        type: 'object',
        properties: {
          hasConcessions: { type: ['boolean', 'null'] },
          amount: { type: ['number', 'null'] },
          description: { type: ['string', 'null'] },
          percentOfSalePrice: { type: ['number', 'null'] },
        },
        description: 'Seller concessions / closing cost contributions.',
      },
      financingType: {
        type: ['string', 'null'],
        description: 'e.g. Conventional, FHA, VA, Cash, USDA, Owner Financing.',
      },
      address: {
        type: 'object',
        properties: {
          streetAddress: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
          state: { type: ['string', 'null'] },
          zip: { type: ['string', 'null'] },
          county: { type: ['string', 'null'] },
          subdivision: { type: ['string', 'null'] },
        },
      },
      propertyType: { type: ['string', 'null'] },
      yearBuilt: { type: ['integer', 'null'] },
      gla: { type: ['number', 'null'], description: 'Gross living area in sqft.' },
      lotSizeSqFt: { type: ['number', 'null'] },
      lotSizeAcres: { type: ['number', 'null'] },
      bedrooms: { type: ['integer', 'null'] },
      bathrooms: { type: ['number', 'null'] },
      bathroomsFull: { type: ['integer', 'null'] },
      bathroomsHalf: { type: ['integer', 'null'] },
      stories: { type: ['number', 'null'] },
      basement: {
        type: 'object',
        properties: {
          hasBasement: { type: ['boolean', 'null'] },
          type: { type: ['string', 'null'] },
          finishedSqFt: { type: ['number', 'null'] },
          totalSqFt: { type: ['number', 'null'] },
        },
      },
      garage: {
        type: 'object',
        properties: {
          hasGarage: { type: ['boolean', 'null'] },
          type: { type: ['string', 'null'] },
          capacity: { type: ['integer', 'null'] },
        },
      },
      construction: {
        type: 'object',
        properties: {
          exteriorWalls: { type: ['string', 'null'] },
          roofType: { type: ['string', 'null'] },
          foundation: { type: ['string', 'null'] },
          heating: { type: ['string', 'null'] },
          cooling: { type: ['string', 'null'] },
          fireplaces: { type: ['integer', 'null'] },
          condition: { type: ['string', 'null'] },
        },
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Notable features (e.g. Pool, Deck, Updated Kitchen).',
      },
      publicRemarks: { type: ['string', 'null'] },
      agentRemarks: { type: ['string', 'null'] },
      listingAgent: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          office: { type: ['string', 'null'] },
        },
      },
      sellingAgent: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          office: { type: ['string', 'null'] },
        },
      },
      photoCount: { type: ['integer', 'null'] },
      virtualTourUrl: { type: ['string', 'null'] },
      taxInfo: {
        type: 'object',
        properties: {
          annualTaxAmount: { type: ['number', 'null'] },
          taxYear: { type: ['integer', 'null'] },
          assessedValue: { type: ['number', 'null'] },
        },
      },
      hoaFees: {
        type: 'object',
        properties: {
          amount: { type: ['number', 'null'] },
          frequency: { type: ['string', 'null'], description: 'e.g. Monthly, Annually.' },
        },
      },
      zoning: { type: ['string', 'null'] },
      extractedAt: { type: ['string', 'null'] },
      sourceUrl: { type: ['string', 'null'] },
    },
  },

  /**
   * Market / neighborhood data schema.
   */
  marketData: {
    title: 'MarketData',
    type: 'object',
    properties: {
      areaName: {
        type: ['string', 'null'],
        description: 'Neighborhood, ZIP, city, or market area name.',
      },
      areaType: {
        type: ['string', 'null'],
        description: 'e.g. Neighborhood, ZIP Code, City, County, MSA.',
      },
      reportDate: {
        type: ['string', 'null'],
        description: 'Date or period the market data covers.',
      },
      medianSalePrice: { type: ['number', 'null'] },
      averageSalePrice: { type: ['number', 'null'] },
      medianPricePerSqFt: { type: ['number', 'null'] },
      medianListPrice: { type: ['number', 'null'] },
      totalClosedSales: { type: ['integer', 'null'] },
      totalActiveListing: { type: ['integer', 'null'] },
      newListings: { type: ['integer', 'null'] },
      monthsOfSupply: {
        type: ['number', 'null'],
        description: 'Inventory expressed as months of supply.',
      },
      absorptionRate: {
        type: ['number', 'null'],
        description: 'Units sold per month.',
      },
      saleToListRatio: {
        type: ['number', 'null'],
        description: 'Average sale-to-list price ratio (e.g. 0.98 = 98%).',
      },
      medianDom: {
        type: ['integer', 'null'],
        description: 'Median days on market.',
      },
      averageDom: {
        type: ['integer', 'null'],
      },
      priceChange: {
        type: 'object',
        properties: {
          percentChangeYoY: {
            type: ['number', 'null'],
            description: 'Year-over-year median price change (e.g. 0.05 = +5%).',
          },
          percentChangeMoM: { type: ['number', 'null'] },
          trend: {
            type: ['string', 'null'],
            description: 'e.g. Increasing, Stable, Declining.',
          },
        },
      },
      marketCondition: {
        type: ['string', 'null'],
        description: "e.g. Seller's Market, Buyer's Market, Balanced.",
      },
      foreclosureRate: { type: ['number', 'null'] },
      medianHouseholdIncome: { type: ['number', 'null'] },
      populationGrowthRate: { type: ['number', 'null'] },
      unemploymentRate: { type: ['number', 'null'] },
      dominantPropertyType: {
        type: ['string', 'null'],
        description: 'Most common property type in the area.',
      },
      medianYearBuilt: { type: ['integer', 'null'] },
      schoolRating: {
        type: ['number', 'null'],
        description: 'Average school rating for the area (1-10 scale).',
      },
      crimeRate: {
        type: ['string', 'null'],
        description: 'Qualitative or quantitative crime level.',
      },
      walkScore: { type: ['integer', 'null'] },
      transitScore: { type: ['integer', 'null'] },
      dataSource: { type: ['string', 'null'] },
      extractedAt: { type: ['string', 'null'] },
      sourceUrl: { type: ['string', 'null'] },
    },
  },

  /**
   * Commercial property schema with income, expenses, and lease details.
   */
  commercialProperty: {
    title: 'CommercialProperty',
    type: 'object',
    properties: {
      propertyName: { type: ['string', 'null'] },
      propertyType: {
        type: ['string', 'null'],
        description: 'e.g. Office, Retail, Industrial, Multi-Family, Mixed-Use.',
      },
      propertyClass: {
        type: ['string', 'null'],
        description: 'e.g. Class A, Class B, Class C.',
      },
      address: {
        type: 'object',
        properties: {
          streetAddress: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
          state: { type: ['string', 'null'] },
          zip: { type: ['string', 'null'] },
          county: { type: ['string', 'null'] },
        },
      },
      yearBuilt: { type: ['integer', 'null'] },
      yearRenovated: { type: ['integer', 'null'] },
      totalBuildingSqFt: { type: ['number', 'null'] },
      rentableSqFt: { type: ['number', 'null'] },
      lotSizeSqFt: { type: ['number', 'null'] },
      lotSizeAcres: { type: ['number', 'null'] },
      numberOfUnits: { type: ['integer', 'null'] },
      numberOfFloors: { type: ['integer', 'null'] },
      parkingSpaces: { type: ['integer', 'null'] },
      parkingRatio: {
        type: ['number', 'null'],
        description: 'Spaces per 1,000 sqft.',
      },
      zoning: { type: ['string', 'null'] },
      occupancyRate: {
        type: ['number', 'null'],
        description: 'Current occupancy rate (e.g. 0.95 = 95%).',
      },
      income: {
        type: 'object',
        properties: {
          potentialGrossIncome: { type: ['number', 'null'] },
          effectiveGrossIncome: { type: ['number', 'null'] },
          vacancyLoss: { type: ['number', 'null'] },
          otherIncome: {
            type: ['number', 'null'],
            description: 'Parking, laundry, vending, etc.',
          },
        },
      },
      expenses: {
        type: 'object',
        properties: {
          totalOperatingExpenses: { type: ['number', 'null'] },
          taxes: { type: ['number', 'null'] },
          insurance: { type: ['number', 'null'] },
          utilities: { type: ['number', 'null'] },
          maintenance: { type: ['number', 'null'] },
          management: { type: ['number', 'null'] },
          managementFeePercent: { type: ['number', 'null'] },
          reserves: { type: ['number', 'null'] },
        },
      },
      expenseRatios: {
        type: 'object',
        properties: {
          operatingExpenseRatio: {
            type: ['number', 'null'],
            description: 'Total operating expenses / EGI.',
          },
          breakEvenRatio: {
            type: ['number', 'null'],
            description: '(Operating expenses + debt service) / PGI.',
          },
          debtServiceCoverageRatio: { type: ['number', 'null'] },
        },
      },
      noi: {
        type: ['number', 'null'],
        description: 'Net Operating Income (EGI minus operating expenses).',
      },
      capRate: {
        type: ['number', 'null'],
        description: 'Capitalization rate (NOI / sale price), e.g. 0.065 = 6.5%.',
      },
      salePrice: { type: ['number', 'null'] },
      listPrice: { type: ['number', 'null'] },
      pricePerSqFt: { type: ['number', 'null'] },
      pricePerUnit: { type: ['number', 'null'] },
      grm: {
        type: ['number', 'null'],
        description: 'Gross Rent Multiplier.',
      },
      leaseTerms: {
        type: 'object',
        properties: {
          leaseType: {
            type: ['string', 'null'],
            description: 'e.g. NNN, Modified Gross, Full Service, Ground Lease.',
          },
          averageLeaseTermYears: { type: ['number', 'null'] },
          weightedAverageLeaseExpiry: {
            type: ['string', 'null'],
            description: 'Weighted average lease term remaining.',
          },
          annualRentEscalation: {
            type: ['number', 'null'],
            description: 'Annual rent escalation rate (e.g. 0.03 = 3%).',
          },
        },
      },
      tenantInfo: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tenantName: { type: ['string', 'null'] },
            suitNumber: { type: ['string', 'null'] },
            leasedSqFt: { type: ['number', 'null'] },
            annualRent: { type: ['number', 'null'] },
            rentPerSqFt: { type: ['number', 'null'] },
            leaseStart: { type: ['string', 'null'] },
            leaseEnd: { type: ['string', 'null'] },
            leaseType: { type: ['string', 'null'] },
            creditRating: { type: ['string', 'null'] },
          },
        },
        description: 'Rent roll / tenant details.',
      },
      construction: {
        type: 'object',
        properties: {
          buildingStructure: { type: ['string', 'null'] },
          exteriorWalls: { type: ['string', 'null'] },
          roofType: { type: ['string', 'null'] },
          hvac: { type: ['string', 'null'] },
          sprinklers: { type: ['boolean', 'null'] },
          elevators: { type: ['integer', 'null'] },
          condition: { type: ['string', 'null'] },
        },
      },
      environmentalIssues: {
        type: ['string', 'null'],
        description: 'Phase I/II environmental concerns if reported.',
      },
      floodZone: { type: ['string', 'null'] },
      extractedAt: { type: ['string', 'null'] },
      sourceUrl: { type: ['string', 'null'] },
    },
  },
};

// ── EXTRACTION PROMPTS ──────────────────────────────────────────────────────

/**
 * Natural-language extraction prompts for each schema type.
 * These instruct the Cloudflare /json endpoint on what to extract.
 */
export const EXTRACTION_PROMPTS = {
  assessor:
    'Extract all property details from this county assessor / tax record page. ' +
    'Include the parcel number, full address, legal description, owner information, ' +
    'year built, gross living area (GLA), site/lot area, zoning, bedroom and bathroom counts, ' +
    'basement details (type, finished area), garage details (type, capacity), ' +
    'construction details (exterior walls, roof, foundation, heating, cooling, fireplaces, stories, condition, quality), ' +
    'assessed values (land, improvement, total, market value), ' +
    'tax information (annual amount, rate, exemptions, special assessments), ' +
    'sales history (all recorded sales with date, price, grantor, grantee, deed type), ' +
    'flood zone designation, and utility information (water, sewer, electric, gas). ' +
    'Return null for any fields not found on the page. Do not guess or fabricate values.',

  listing:
    'Extract all listing and property details from this real estate listing page. ' +
    'Include the MLS number, listing status, list price, sale price, original list price, price per sqft, ' +
    'list date, sale date, contract date, days on market (DOM and CDOM), ' +
    'seller concessions (amount, description, percent of sale price), financing type, ' +
    'full address with subdivision, property type, year built, GLA, lot size, ' +
    'bedroom and bathroom counts, number of stories, basement details, garage details, ' +
    'construction details, notable features, public and agent remarks, ' +
    'listing and selling agent/office information, photo count, virtual tour URL, ' +
    'tax information, HOA fees, and zoning. ' +
    'Return null for any fields not found on the page. Do not guess or fabricate values.',

  market:
    'Extract market data and neighborhood statistics from this page. ' +
    'Include the area name and type, report date/period, ' +
    'median and average sale prices, median price per sqft, median list price, ' +
    'total closed sales, active listings, new listings, months of supply, absorption rate, ' +
    'sale-to-list price ratio, median and average days on market, ' +
    'price change trends (year-over-year, month-over-month, trend direction), ' +
    'market condition classification, foreclosure rate, ' +
    'demographic data (median household income, population growth, unemployment rate), ' +
    'dominant property type, median year built, school ratings, crime rate, ' +
    'walk score, and transit score. ' +
    'Return null for any fields not found on the page. Do not guess or fabricate values.',

  commercial:
    'Extract commercial property details including income, expenses, cap rate, ' +
    'lease terms, and tenant information from this page. ' +
    'Include the property name, type, class, full address, year built/renovated, ' +
    'building and rentable square footage, lot size, number of units and floors, ' +
    'parking spaces and ratio, zoning, occupancy rate, ' +
    'income details (PGI, EGI, vacancy loss, other income), ' +
    'expense breakdown (total operating, taxes, insurance, utilities, maintenance, management, reserves), ' +
    'expense ratios (OER, break-even ratio, DSCR), NOI, cap rate, ' +
    'sale/list price, price per sqft, price per unit, GRM, ' +
    'lease terms (type, average term, WALE, rent escalation), ' +
    'tenant rent roll (name, suite, sqft, rent, lease dates, credit rating), ' +
    'construction details, environmental issues, and flood zone. ' +
    'Return null for any fields not found on the page. Do not guess or fabricate values.',
};

// ── CRAWL PRESETS ───────────────────────────────────────────────────────────

/**
 * Pre-configured crawl settings for common appraisal data sources.
 * Each preset includes recommended crawl options and the matching schema key.
 */
export const CRAWL_PRESETS = {
  mcLeanCountyAssessor: {
    name: 'McLean County Assessor',
    description: 'McLean County, IL property tax and assessment records.',
    options: {
      formats: ['markdown', 'json'],
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      limit: 3,
      render: true,
      maxDepth: 2,
      filterPattern: '*mcleancountyil*',
    },
    schema: 'propertyDetails',
    prompt: 'assessor',
  },

  realtorCom: {
    name: 'Realtor.com Listing',
    description: 'Single property listing from Realtor.com.',
    options: {
      formats: ['markdown', 'json'],
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      limit: 1,
      render: true,
      maxDepth: 0,
    },
    schema: 'comparableSale',
    prompt: 'listing',
  },

  zillowListing: {
    name: 'Zillow Listing',
    description: 'Single property listing from Zillow.',
    options: {
      formats: ['markdown', 'json'],
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      limit: 1,
      render: true,
      maxDepth: 0,
    },
    schema: 'comparableSale',
    prompt: 'listing',
  },

  marketDataStatic: {
    name: 'Market Data (static)',
    description: 'Static market/neighborhood statistics page (no JS rendering needed).',
    options: {
      formats: ['markdown'],
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      limit: 5,
      render: false,
      maxDepth: 1,
    },
    schema: null,
    prompt: 'market',
  },

  cityZoning: {
    name: 'City/Municipal Zoning',
    description: 'City or municipal zoning and land-use information.',
    options: {
      formats: ['markdown'],
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      limit: 5,
      render: false,
      maxDepth: 2,
    },
    schema: null,
    prompt: null,
  },
};

// ── Private helpers ─────────────────────────────────────────────────────────

/**
 * Simple async sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
