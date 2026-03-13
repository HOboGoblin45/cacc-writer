// ====== DATA PIPELINE — Client-side controller ======
// Manages the Cloudflare Browser Rendering data pipeline UI.
// Depends on globals from app.js: $, esc, apiFetch, server, STATE, setStatus, showErr

// ── State ──────────────────────────────────────────────────────────────────────

const PIPELINE_STATE = {
  cloudflareAccountId: localStorage.getItem('cf_account_id') || '',
  cloudflareApiToken: localStorage.getItem('cf_api_token') || '',
  // Settings
  defaultMaxAge: parseInt(localStorage.getItem('cf_max_age') || '86400', 10),
  preferStaticFetch: localStorage.getItem('cf_prefer_static') !== 'false',
  maxPagesPerCrawl: parseInt(localStorage.getItem('cf_max_pages') || '25', 10),
  pollingIntervalMs: parseInt(localStorage.getItem('cf_poll_interval') || '5000', 10),
  // Source URLs
  subjectUrl: '',
  subjectSourceType: 'assessor', // 'assessor' | 'listing' | 'custom'
  compUrls: ['', '', '', '', '', ''],
  marketUrl: '',
  customUrl: '',
  // Active jobs
  activeJobs: [], // { jobId, label, type, status, finished, total, records, error, pollTimer }
  // Extracted data
  extractedSubject: null,
  extractedComps: [],    // array of { raw, adm, source }
  extractedMarket: null,
  // Verification state
  verificationState: {}, // keyed by field: { verified, value, overrideValue, source, crawlDate, conflict }
  // Usage tracking
  usageStats: { totalBrowserMs: 0, jobCount: 0 },
  // Custom presets
  customPresets: JSON.parse(localStorage.getItem('cf_custom_presets') || '{}'),
};

// ── Internal helpers ───────────────────────────────────────────────────────────

function _dpEl(id) { return $(id) || null; }

function _dpSetHtml(id, html) {
  const el = _dpEl(id);
  if (el) el.innerHTML = html;
}

function _dpCredQuery() {
  return 'accountId=' + encodeURIComponent(PIPELINE_STATE.cloudflareAccountId) +
    '&apiToken=' + encodeURIComponent(PIPELINE_STATE.cloudflareApiToken);
}

function _dpNow() { return new Date().toISOString(); }

function _dpFmtMs(ms) {
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

function _dpFmtCost(browserMs) {
  const FREE_TIER_MS = 10 * 3600 * 1000; // 10 hours
  const RATE_PER_MS = 0.09 / 3600000;    // $0.09/hr
  if (browserMs <= FREE_TIER_MS) return '$0.00 (free tier)';
  const billable = browserMs - FREE_TIER_MS;
  return '$' + (billable * RATE_PER_MS).toFixed(4);
}

function _dpStatusIcon(status) {
  if (status === 'completed') return '<span style="color:var(--ok);">&#10003;</span>';
  if (status === 'running' || status === 'in_progress') return '<span class="dp-spinner"></span>';
  if (status === 'queued' || status === 'pending') return '<span style="color:var(--warn);">&#9201;</span>';
  if (status === 'failed' || status === 'error') return '<span style="color:var(--err);">&#10007;</span>';
  if (status === 'cancelled') return '<span style="color:var(--muted);">&#8212;</span>';
  return '<span>&#8226;</span>';
}

// ── Settings Management ────────────────────────────────────────────────────────

function dpSaveSettings() {
  const acctEl = _dpEl('dpAccountId');
  const tokenEl = _dpEl('dpApiToken');
  const maxAgeEl = _dpEl('dpMaxAge');
  const staticEl = _dpEl('dpPreferStatic');
  const maxPagesEl = _dpEl('dpMaxPages');
  const pollEl = _dpEl('dpPollInterval');

  if (acctEl) PIPELINE_STATE.cloudflareAccountId = acctEl.value.trim();
  if (tokenEl) PIPELINE_STATE.cloudflareApiToken = tokenEl.value.trim();
  if (maxAgeEl) PIPELINE_STATE.defaultMaxAge = parseInt(maxAgeEl.value, 10) || 86400;
  if (staticEl) PIPELINE_STATE.preferStaticFetch = staticEl.checked;
  if (maxPagesEl) PIPELINE_STATE.maxPagesPerCrawl = parseInt(maxPagesEl.value, 10) || 25;
  if (pollEl) PIPELINE_STATE.pollingIntervalMs = parseInt(pollEl.value, 10) || 5000;

  localStorage.setItem('cf_account_id', PIPELINE_STATE.cloudflareAccountId);
  localStorage.setItem('cf_api_token', PIPELINE_STATE.cloudflareApiToken);
  localStorage.setItem('cf_max_age', String(PIPELINE_STATE.defaultMaxAge));
  localStorage.setItem('cf_prefer_static', String(PIPELINE_STATE.preferStaticFetch));
  localStorage.setItem('cf_max_pages', String(PIPELINE_STATE.maxPagesPerCrawl));
  localStorage.setItem('cf_poll_interval', String(PIPELINE_STATE.pollingIntervalMs));

  dpUpdateSettingsUI();
  setStatus('dpStatus', 'Settings saved.', 'ok');
}

function dpLoadSettings() {
  PIPELINE_STATE.cloudflareAccountId = localStorage.getItem('cf_account_id') || '';
  PIPELINE_STATE.cloudflareApiToken = localStorage.getItem('cf_api_token') || '';
  PIPELINE_STATE.defaultMaxAge = parseInt(localStorage.getItem('cf_max_age') || '86400', 10);
  PIPELINE_STATE.preferStaticFetch = localStorage.getItem('cf_prefer_static') !== 'false';
  PIPELINE_STATE.maxPagesPerCrawl = parseInt(localStorage.getItem('cf_max_pages') || '25', 10);
  PIPELINE_STATE.pollingIntervalMs = parseInt(localStorage.getItem('cf_poll_interval') || '5000', 10);
  PIPELINE_STATE.customPresets = JSON.parse(localStorage.getItem('cf_custom_presets') || '{}');

  dpUpdateSettingsUI();
}

function dpUpdateSettingsUI() {
  const acctEl = _dpEl('dpAccountId');
  const tokenEl = _dpEl('dpApiToken');
  const maxAgeEl = _dpEl('dpMaxAge');
  const staticEl = _dpEl('dpPreferStatic');
  const maxPagesEl = _dpEl('dpMaxPages');
  const pollEl = _dpEl('dpPollInterval');

  if (acctEl) acctEl.value = PIPELINE_STATE.cloudflareAccountId;
  if (tokenEl) tokenEl.value = PIPELINE_STATE.cloudflareApiToken;
  if (maxAgeEl) maxAgeEl.value = PIPELINE_STATE.defaultMaxAge;
  if (staticEl) staticEl.checked = PIPELINE_STATE.preferStaticFetch;
  if (maxPagesEl) maxPagesEl.value = PIPELINE_STATE.maxPagesPerCrawl;
  if (pollEl) pollEl.value = PIPELINE_STATE.pollingIntervalMs;

  // Show masked token indicator
  const indicator = _dpEl('dpTokenIndicator');
  if (indicator) {
    indicator.textContent = PIPELINE_STATE.cloudflareApiToken
      ? 'Token set (' + PIPELINE_STATE.cloudflareApiToken.slice(0, 4) + '...)'
      : 'No token';
  }
}

// ── Connection Test ────────────────────────────────────────────────────────────

async function dpTestConnection() {
  const creds = dpGetCredentials();
  if (!creds) return;

  const statusEl = _dpEl('dpConnStatus');
  if (statusEl) {
    statusEl.textContent = 'Testing connection...';
    statusEl.className = 'status';
  }

  try {
    const res = await apiFetch('/api/data-pipeline/test-connection', {
      method: 'POST',
      body: creds,
    });
    if (statusEl) {
      if (res.ok) {
        statusEl.textContent = 'Connected. Account verified.';
        statusEl.className = 'status ok';
      } else {
        statusEl.textContent = 'Connection failed: ' + (res.error || 'Unknown error');
        statusEl.className = 'status err';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Connection error: ' + err.message;
      statusEl.className = 'status err';
    }
  }
}

// ── Crawl Operations ───────────────────────────────────────────────────────────

function dpGetCredentials() {
  const accountId = PIPELINE_STATE.cloudflareAccountId;
  const apiToken = PIPELINE_STATE.cloudflareApiToken;
  if (!accountId || !apiToken) {
    showErr('dpError', 'Cloudflare Account ID and API Token are required. Configure in Settings.');
    return null;
  }
  showErr('dpError', '');
  return { accountId, apiToken };
}

async function dpCrawlSubject() {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpSubjectUrl');
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Subject URL is required.'); return; }

  PIPELINE_STATE.subjectUrl = url;
  const sourceTypeEl = _dpEl('dpSubjectSourceType');
  PIPELINE_STATE.subjectSourceType = sourceTypeEl ? sourceTypeEl.value : 'assessor';

  const presetEl = _dpEl('dpSubjectPreset');
  const preset = presetEl ? presetEl.value : PIPELINE_STATE.subjectSourceType;

  setStatus('dpStatus', 'Starting subject crawl...', '');
  try {
    const res = await apiFetch('/api/data-pipeline/crawl/start', {
      method: 'POST',
      body: {
        ...creds,
        urls: [url],
        preset: preset,
        options: { maxPages: PIPELINE_STATE.maxPagesPerCrawl },
      },
    });
    if (!res.ok) { showErr('dpError', 'Crawl start failed: ' + (res.error || 'Unknown')); return; }
    dpAddJob(res.jobId, 'Subject: ' + _dpTruncUrl(url), 'subject');
    setStatus('dpStatus', 'Subject crawl started.', 'ok');
  } catch (err) {
    showErr('dpError', 'Crawl error: ' + err.message);
  }
}

async function dpQuickExtractSubject() {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpSubjectUrl');
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Subject URL is required.'); return; }

  PIPELINE_STATE.subjectUrl = url;
  setStatus('dpStatus', 'Quick-extracting subject...', '');

  try {
    const res = await apiFetch('/api/data-pipeline/extract-json', {
      method: 'POST',
      body: {
        ...creds,
        url: url,
        prompt: 'Extract all property details: address, GLA/sqft, bedrooms, bathrooms, year built, lot size, garage, pool, stories, condition, sale price, sale date, property type, zoning.',
      },
      timeout: 60000,
    });
    if (!res.ok) { showErr('dpError', 'Extraction failed: ' + (res.error || 'Unknown')); return; }

    dpProcessResults([{ url, data: res.data || res.extracted || res }], 'subject', 'Subject (quick)');
    setStatus('dpStatus', 'Subject data extracted.', 'ok');

    if (res.browserTimeMs) {
      PIPELINE_STATE.usageStats.totalBrowserMs += res.browserTimeMs;
      PIPELINE_STATE.usageStats.jobCount++;
      dpRenderUsage();
    }
  } catch (err) {
    showErr('dpError', 'Quick extract error: ' + err.message);
  }
}

async function dpCrawlComp(index) {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpCompUrl' + index);
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Comp ' + (index + 1) + ' URL is required.'); return; }

  PIPELINE_STATE.compUrls[index] = url;
  setStatus('dpStatus', 'Starting comp ' + (index + 1) + ' crawl...', '');

  try {
    const res = await apiFetch('/api/data-pipeline/crawl/start', {
      method: 'POST',
      body: {
        ...creds,
        urls: [url],
        preset: 'listing',
        options: { maxPages: 1 },
      },
    });
    if (!res.ok) { showErr('dpError', 'Comp crawl failed: ' + (res.error || 'Unknown')); return; }
    dpAddJob(res.jobId, 'Comp ' + (index + 1) + ': ' + _dpTruncUrl(url), 'comp', { compIndex: index });
    setStatus('dpStatus', 'Comp ' + (index + 1) + ' crawl started.', 'ok');
  } catch (err) {
    showErr('dpError', 'Comp crawl error: ' + err.message);
  }
}

async function dpQuickExtractComp(index) {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpCompUrl' + index);
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Comp ' + (index + 1) + ' URL is required.'); return; }

  PIPELINE_STATE.compUrls[index] = url;
  setStatus('dpStatus', 'Quick-extracting comp ' + (index + 1) + '...', '');

  try {
    const res = await apiFetch('/api/data-pipeline/extract-json', {
      method: 'POST',
      body: {
        ...creds,
        url: url,
        prompt: 'Extract all property details: address, GLA/sqft, bedrooms, bathrooms, year built, lot size, garage, pool, stories, condition, sale price, sale date, property type.',
      },
      timeout: 60000,
    });
    if (!res.ok) { showErr('dpError', 'Comp extraction failed: ' + (res.error || 'Unknown')); return; }

    dpProcessResults([{ url, data: res.data || res.extracted || res }], 'comp', 'Comp ' + (index + 1), { compIndex: index });
    setStatus('dpStatus', 'Comp ' + (index + 1) + ' data extracted.', 'ok');

    if (res.browserTimeMs) {
      PIPELINE_STATE.usageStats.totalBrowserMs += res.browserTimeMs;
      PIPELINE_STATE.usageStats.jobCount++;
      dpRenderUsage();
    }
  } catch (err) {
    showErr('dpError', 'Comp extract error: ' + err.message);
  }
}

async function dpCrawlMarket() {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpMarketUrl');
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Market data URL is required.'); return; }

  PIPELINE_STATE.marketUrl = url;
  setStatus('dpStatus', 'Starting market data crawl...', '');

  try {
    const res = await apiFetch('/api/data-pipeline/crawl/start', {
      method: 'POST',
      body: {
        ...creds,
        urls: [url],
        preset: 'market',
        options: { maxPages: PIPELINE_STATE.maxPagesPerCrawl },
      },
    });
    if (!res.ok) { showErr('dpError', 'Market crawl failed: ' + (res.error || 'Unknown')); return; }
    dpAddJob(res.jobId, 'Market: ' + _dpTruncUrl(url), 'market');
    setStatus('dpStatus', 'Market data crawl started.', 'ok');
  } catch (err) {
    showErr('dpError', 'Market crawl error: ' + err.message);
  }
}

async function dpCrawlCustom() {
  const creds = dpGetCredentials();
  if (!creds) return;

  const urlEl = _dpEl('dpCustomUrl');
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { showErr('dpError', 'Custom URL is required.'); return; }

  PIPELINE_STATE.customUrl = url;
  const presetEl = _dpEl('dpCustomPreset');
  const preset = presetEl ? presetEl.value : '';
  const maxPagesEl = _dpEl('dpCustomMaxPages');
  const maxPages = maxPagesEl ? parseInt(maxPagesEl.value, 10) || 5 : 5;

  setStatus('dpStatus', 'Starting custom crawl...', '');

  try {
    const res = await apiFetch('/api/data-pipeline/crawl/start', {
      method: 'POST',
      body: {
        ...creds,
        urls: [url],
        preset: preset || undefined,
        options: { maxPages },
      },
    });
    if (!res.ok) { showErr('dpError', 'Custom crawl failed: ' + (res.error || 'Unknown')); return; }
    dpAddJob(res.jobId, 'Custom: ' + _dpTruncUrl(url), 'custom');
    setStatus('dpStatus', 'Custom crawl started.', 'ok');
  } catch (err) {
    showErr('dpError', 'Custom crawl error: ' + err.message);
  }
}

function _dpTruncUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 27) + '...' : u.pathname;
    return u.hostname + path;
  } catch { return url.slice(0, 50); }
}

// ── Job Management ─────────────────────────────────────────────────────────────

function dpAddJob(jobId, label, type, meta) {
  const job = {
    jobId,
    label,
    type,
    status: 'queued',
    finished: 0,
    total: 0,
    records: [],
    error: null,
    startedAt: _dpNow(),
    pollCount: 0,
    meta: meta || {},
  };
  PIPELINE_STATE.activeJobs.push(job);
  dpRenderJobs();

  // Start polling
  const jobIndex = PIPELINE_STATE.activeJobs.length - 1;
  dpPollJob(jobIndex);
}

async function dpPollJob(jobIndex) {
  const job = PIPELINE_STATE.activeJobs[jobIndex];
  if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;

  const creds = dpGetCredentials();
  if (!creds) return;

  try {
    const queryStr = _dpCredQuery();
    const res = await apiFetch('/api/data-pipeline/crawl/' + job.jobId + '/status?' + queryStr);

    if (!res.ok) {
      job.status = 'failed';
      job.error = res.error || 'Status check failed';
      dpRenderJobs();
      return;
    }

    job.status = res.status || res.state || 'running';
    job.finished = res.finished || res.completedPages || 0;
    job.total = res.total || res.totalPages || 0;

    if (res.browserTimeMs) {
      PIPELINE_STATE.usageStats.totalBrowserMs += res.browserTimeMs;
    }

    dpRenderJobs();

    // Terminal states
    if (job.status === 'completed' || job.status === 'done') {
      job.status = 'completed';
      PIPELINE_STATE.usageStats.jobCount++;
      dpRenderUsage();
      await _dpFetchJobResults(jobIndex);
      return;
    }
    if (job.status === 'failed' || job.status === 'error') {
      job.status = 'failed';
      job.error = res.error || 'Crawl failed';
      dpRenderJobs();
      return;
    }

    // Exponential backoff: base interval * min(2^pollCount, 8)
    job.pollCount++;
    const backoff = Math.min(Math.pow(2, Math.min(job.pollCount - 1, 3)), 8);
    const delay = PIPELINE_STATE.pollingIntervalMs * backoff;
    setTimeout(function() { dpPollJob(jobIndex); }, delay);

  } catch (err) {
    job.status = 'failed';
    job.error = 'Poll error: ' + err.message;
    dpRenderJobs();
  }
}

async function _dpFetchJobResults(jobIndex) {
  const job = PIPELINE_STATE.activeJobs[jobIndex];
  if (!job) return;

  const queryStr = _dpCredQuery();
  try {
    const res = await apiFetch('/api/data-pipeline/crawl/' + job.jobId + '/results?' + queryStr + '&limit=100');
    if (res.ok) {
      job.records = res.records || res.results || [];
      dpProcessResults(job.records, job.type, job.label, job.meta);
    } else {
      job.error = 'Results fetch failed: ' + (res.error || 'Unknown');
    }
  } catch (err) {
    job.error = 'Results fetch error: ' + err.message;
  }
  dpRenderJobs();
}

function dpCancelJob(jobIndex) {
  const job = PIPELINE_STATE.activeJobs[jobIndex];
  if (!job || job.status === 'completed' || job.status === 'failed') return;

  const creds = dpGetCredentials();
  if (!creds) return;

  job.status = 'cancelled';
  dpRenderJobs();

  apiFetch('/api/data-pipeline/crawl/' + job.jobId, {
    method: 'DELETE',
    body: creds,
  }).catch(function() { /* best effort */ });
}

function dpClearFinishedJobs() {
  PIPELINE_STATE.activeJobs = PIPELINE_STATE.activeJobs.filter(function(j) {
    return j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled';
  });
  dpRenderJobs();
}

function dpRenderJobs() {
  const container = _dpEl('dpJobsList');
  if (!container) return;

  if (!PIPELINE_STATE.activeJobs.length) {
    container.innerHTML = '<div style="color:var(--muted);padding:12px;">No active jobs.</div>';
    return;
  }

  var html = '';
  PIPELINE_STATE.activeJobs.forEach(function(job, i) {
    var progress = '';
    if (job.total > 0) {
      var pct = Math.round((job.finished / job.total) * 100);
      progress =
        '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">' +
          '<div style="flex:1;height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">' +
            '<div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:3px;transition:width .3s;"></div>' +
          '</div>' +
          '<span style="font-size:0.75em;color:var(--muted);">' + job.finished + '/' + job.total + '</span>' +
        '</div>';
    }

    var actions = '';
    if (job.status === 'queued' || job.status === 'running' || job.status === 'in_progress' || job.status === 'pending') {
      actions = '<button class="btn small" onclick="dpCancelJob(' + i + ')">Cancel</button>';
    }

    var errorLine = job.error
      ? '<div style="color:var(--err);font-size:0.8em;margin-top:2px;">' + esc(job.error) + '</div>'
      : '';

    html +=
      '<div class="dp-job-card" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<span style="margin-right:6px;">' + _dpStatusIcon(job.status) + '</span>' +
            '<strong style="font-size:0.85em;">' + esc(job.label) + '</strong>' +
            '<span class="chip" style="font-size:0.7em;margin-left:8px;padding:1px 5px;">' + esc(job.status) + '</span>' +
          '</div>' +
          '<div>' + actions + '</div>' +
        '</div>' +
        progress +
        errorLine +
      '</div>';
  });

  var clearBtn = PIPELINE_STATE.activeJobs.some(function(j) {
    return j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled';
  })
    ? '<div style="text-align:right;margin-top:6px;"><button class="btn small" onclick="dpClearFinishedJobs()">Clear finished</button></div>'
    : '';

  container.innerHTML = html + clearBtn;
}

// ── Data Extraction & Preview ──────────────────────────────────────────────────

function dpProcessResults(records, type, label, meta) {
  if (!records || !records.length) return;

  // Merge all record data into a single raw object for this extraction
  var rawData = {};
  records.forEach(function(rec) {
    var d = rec.data || rec.extracted || rec;
    if (d && typeof d === 'object') {
      Object.assign(rawData, d);
    }
  });

  // Map to ADM format via server
  _dpMapToADM(rawData, records[0] && records[0].url ? records[0].url : '').then(function(admData) {
    var entry = {
      raw: rawData,
      adm: admData,
      source: label || type,
      crawlDate: _dpNow(),
      urls: records.map(function(r) { return r.url; }).filter(Boolean),
    };

    if (type === 'subject') {
      PIPELINE_STATE.extractedSubject = entry;
      _dpPopulateVerification(admData, 'subject');
    } else if (type === 'comp') {
      var idx = (meta && meta.compIndex != null) ? meta.compIndex : PIPELINE_STATE.extractedComps.length;
      PIPELINE_STATE.extractedComps[idx] = entry;
    } else if (type === 'market') {
      PIPELINE_STATE.extractedMarket = entry;
    }

    dpRenderExtractedPreview();
    dpRenderVerification();
  });
}

async function _dpMapToADM(extracted, sourceUrl) {
  try {
    var res = await apiFetch('/api/data-pipeline/map-to-adm', {
      method: 'POST',
      body: { extracted: extracted, sourceUrl: sourceUrl },
    });
    return (res.ok && res.mapped) ? res.mapped : extracted;
  } catch {
    return extracted;
  }
}

function _dpPopulateVerification(admData, source) {
  if (!admData || typeof admData !== 'object') return;

  Object.keys(admData).forEach(function(field) {
    var val = admData[field];
    if (val === null || val === undefined || val === '') return;

    var existing = PIPELINE_STATE.verificationState[field];
    PIPELINE_STATE.verificationState[field] = {
      verified: existing ? existing.verified : false,
      value: val,
      overrideValue: existing ? existing.overrideValue : null,
      source: source,
      crawlDate: _dpNow(),
      conflict: existing && existing.value !== undefined && String(existing.value) !== String(val)
        ? { previousValue: existing.value, previousSource: existing.source }
        : null,
    };
  });
}

// ADM preview field labels
var DP_PREVIEW_FIELDS = [
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'gla', label: 'GLA (sqft)' },
  { key: 'bedrooms', label: 'Bedrooms' },
  { key: 'bathrooms', label: 'Bathrooms' },
  { key: 'yearBuilt', label: 'Year Built' },
  { key: 'lotSize', label: 'Lot Size' },
  { key: 'garage', label: 'Garage' },
  { key: 'pool', label: 'Pool' },
  { key: 'stories', label: 'Stories' },
  { key: 'condition', label: 'Condition' },
  { key: 'salePrice', label: 'Sale Price' },
  { key: 'saleDate', label: 'Sale Date' },
  { key: 'propertyType', label: 'Property Type' },
  { key: 'zoning', label: 'Zoning' },
];

function dpRenderExtractedPreview() {
  var container = _dpEl('dpExtractedPreview');
  if (!container) return;

  var html = '';

  // Subject
  if (PIPELINE_STATE.extractedSubject) {
    html += _dpRenderEntryPreview('Subject Property', PIPELINE_STATE.extractedSubject, 'subject');
  }

  // Comps
  PIPELINE_STATE.extractedComps.forEach(function(comp, i) {
    if (comp) {
      html += _dpRenderEntryPreview('Comp ' + (i + 1), comp, 'comp-' + i);
    }
  });

  // Market
  if (PIPELINE_STATE.extractedMarket) {
    html += _dpRenderEntryPreview('Market Data', PIPELINE_STATE.extractedMarket, 'market');
  }

  if (!html) {
    html = '<div style="color:var(--muted);padding:12px;">No extracted data yet. Run a crawl or quick extraction above.</div>';
  }

  container.innerHTML = html;
}

function _dpRenderEntryPreview(title, entry, detailsId) {
  var data = entry.adm || entry.raw || {};
  var html =
    '<details class="dp-preview-group" style="margin-bottom:8px;">' +
      '<summary style="cursor:pointer;font-weight:bold;padding:6px 0;">' + esc(title) +
        '<span style="font-size:0.75em;color:var(--muted);margin-left:8px;">(' + esc(entry.source || '') + ' &mdash; ' + _dpFmtDate(entry.crawlDate) + ')</span>' +
      '</summary>' +
      '<div style="padding:4px 0 8px 12px;">';

  var fieldCount = 0;
  DP_PREVIEW_FIELDS.forEach(function(f) {
    var val = _dpResolveField(data, f.key);
    if (val !== undefined && val !== null && val !== '') {
      fieldCount++;
      html +=
        '<div style="display:flex;gap:8px;padding:2px 0;font-size:0.85em;">' +
          '<span style="min-width:100px;color:var(--muted);">' + esc(f.label) + '</span>' +
          '<span>' + esc(String(val)) + '</span>' +
        '</div>';
    }
  });

  // Show additional unrecognized fields
  var knownKeys = DP_PREVIEW_FIELDS.map(function(f) { return f.key; });
  var extraKeys = Object.keys(data).filter(function(k) { return knownKeys.indexOf(k) === -1 && data[k] != null && data[k] !== ''; });
  if (extraKeys.length > 0) {
    html += '<details style="margin-top:4px;"><summary style="cursor:pointer;font-size:0.8em;color:var(--muted);">' + extraKeys.length + ' additional fields</summary>';
    extraKeys.forEach(function(k) {
      html +=
        '<div style="display:flex;gap:8px;padding:2px 0;font-size:0.8em;">' +
          '<span style="min-width:100px;color:var(--muted);">' + esc(k) + '</span>' +
          '<span>' + esc(String(data[k]).slice(0, 200)) + '</span>' +
        '</div>';
    });
    html += '</details>';
  }

  if (fieldCount === 0 && extraKeys.length === 0) {
    html += '<div style="color:var(--warn);font-size:0.85em;">No structured fields extracted.</div>';
  }

  html += '</div></details>';
  return html;
}

function _dpResolveField(data, key) {
  if (data[key] !== undefined) return data[key];
  // Try common alternate keys
  var alts = {
    gla: ['grossLivingArea', 'sqft', 'squareFeet', 'livingArea', 'gross_living_area'],
    bedrooms: ['beds', 'bed', 'bedroom_count'],
    bathrooms: ['baths', 'bath', 'bathroom_count', 'fullBaths'],
    yearBuilt: ['year_built', 'builtYear', 'constructionYear'],
    lotSize: ['lot_size', 'lotSqft', 'lotArea', 'lot_area'],
    salePrice: ['sale_price', 'price', 'soldPrice', 'sold_price', 'listPrice'],
    saleDate: ['sale_date', 'soldDate', 'sold_date', 'closingDate'],
    propertyType: ['property_type', 'type', 'homeType'],
  };
  var candidates = alts[key];
  if (!candidates) return undefined;
  for (var i = 0; i < candidates.length; i++) {
    if (data[candidates[i]] !== undefined) return data[candidates[i]];
  }
  return undefined;
}

function _dpFmtDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString() + ' ' + new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

// ── Verification Checklist ─────────────────────────────────────────────────────

function dpRenderVerification() {
  var container = _dpEl('dpVerification');
  if (!container) return;

  var vs = PIPELINE_STATE.verificationState;
  var fields = Object.keys(vs);

  if (!fields.length) {
    container.innerHTML = '<div style="color:var(--muted);padding:12px;">No data to verify. Extract data first.</div>';
    return;
  }

  var totalFields = fields.length;
  var verifiedCount = fields.filter(function(f) { return vs[f].verified; }).length;
  var conflictCount = fields.filter(function(f) { return vs[f].conflict; }).length;

  var html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<div>' +
        '<strong>Verification Progress:</strong> ' + verifiedCount + '/' + totalFields +
        (conflictCount > 0 ? ' <span style="color:var(--warn);">(' + conflictCount + ' conflicts)</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="btn small" onclick="dpMarkAllVerified()">Verify All</button>' +
        '<button class="btn small" onclick="dpExportVerificationLog()">Export Log</button>' +
      '</div>' +
    '</div>' +
    '<div style="flex:1;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-bottom:10px;">' +
      '<div style="width:' + Math.round((verifiedCount / totalFields) * 100) + '%;height:100%;background:var(--ok);border-radius:2px;transition:width .3s;"></div>' +
    '</div>';

  fields.sort().forEach(function(field) {
    var entry = vs[field];
    var displayVal = entry.overrideValue != null ? entry.overrideValue : entry.value;
    var conflictIcon = entry.conflict
      ? '<span title="Conflict: was ' + esc(String(entry.conflict.previousValue)) + ' from ' + esc(entry.conflict.previousSource || '') + '" style="color:var(--warn);cursor:help;margin-left:4px;">&#9888;</span>'
      : '';
    var overrideIndicator = entry.overrideValue != null
      ? '<span style="color:var(--accent);font-size:0.75em;margin-left:4px;">(edited)</span>'
      : '';
    var checkClass = entry.verified ? 'dp-check checked' : 'dp-check';

    html +=
      '<div class="dp-verify-row" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85em;">' +
        '<span class="' + checkClass + '" onclick="dpToggleVerification(\'' + esc(field) + '\')" style="cursor:pointer;width:18px;text-align:center;' + (entry.verified ? 'color:var(--ok);' : 'color:var(--muted);') + '">' +
          (entry.verified ? '&#10003;' : '&#9744;') +
        '</span>' +
        '<span style="min-width:120px;color:var(--muted);">' + esc(field) + '</span>' +
        '<span style="flex:1;">' + esc(String(displayVal)) + overrideIndicator + conflictIcon + '</span>' +
        '<span style="font-size:0.75em;color:var(--muted);">' + esc(entry.source || '') + '</span>' +
        '<button class="btn small" onclick="dpEditField(\'' + esc(field) + '\')" style="font-size:0.75em;padding:1px 6px;">Edit</button>' +
      '</div>';
  });

  container.innerHTML = html;
}

function dpToggleVerification(field) {
  var entry = PIPELINE_STATE.verificationState[field];
  if (!entry) return;
  entry.verified = !entry.verified;
  dpRenderVerification();
}

function dpEditField(field) {
  var entry = PIPELINE_STATE.verificationState[field];
  if (!entry) return;

  var currentVal = entry.overrideValue != null ? entry.overrideValue : entry.value;
  var newVal = prompt('Edit value for "' + field + '":', String(currentVal));
  if (newVal === null) return; // cancelled

  entry.overrideValue = newVal;
  entry.verified = true;
  dpRenderVerification();
}

function dpMarkAllVerified() {
  var vs = PIPELINE_STATE.verificationState;
  Object.keys(vs).forEach(function(f) { vs[f].verified = true; });
  dpRenderVerification();
}

function dpExportVerificationLog() {
  var vs = PIPELINE_STATE.verificationState;
  var fields = Object.keys(vs).sort();

  var log = {
    exportDate: _dpNow(),
    caseId: STATE.caseId || null,
    formType: STATE.formType || null,
    totalFields: fields.length,
    verifiedFields: fields.filter(function(f) { return vs[f].verified; }).length,
    conflictFields: fields.filter(function(f) { return vs[f].conflict; }).length,
    entries: {},
  };

  fields.forEach(function(field) {
    var entry = vs[field];
    log.entries[field] = {
      value: entry.overrideValue != null ? entry.overrideValue : entry.value,
      originalValue: entry.value,
      overridden: entry.overrideValue != null,
      verified: entry.verified,
      source: entry.source,
      crawlDate: entry.crawlDate,
      conflict: entry.conflict || null,
    };
  });

  log.uspapCompliance = {
    allVerified: log.verifiedFields === log.totalFields,
    conflictsResolved: fields.every(function(f) { return !vs[f].conflict || vs[f].verified; }),
    dataSources: _dpUnique(fields.map(function(f) { return vs[f].source; }).filter(Boolean)),
    verificationTimestamp: _dpNow(),
  };

  _dpDownloadJSON(log, 'verification-log-' + (STATE.caseId || 'draft') + '.json');
}

function _dpUnique(arr) {
  var seen = {};
  return arr.filter(function(v) {
    if (seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

// ── Conflict Detection ─────────────────────────────────────────────────────────

async function dpDetectConflicts() {
  var sources = [];

  if (PIPELINE_STATE.extractedSubject) {
    sources.push({
      label: 'Subject',
      ...(PIPELINE_STATE.extractedSubject.adm || PIPELINE_STATE.extractedSubject.raw || {}),
    });
  }
  PIPELINE_STATE.extractedComps.forEach(function(c, i) {
    if (c) {
      sources.push({
        label: 'Comp ' + (i + 1),
        ...(c.adm || c.raw || {}),
      });
    }
  });

  if (sources.length < 2) {
    showErr('dpError', 'Need at least two data sources to detect conflicts.');
    return;
  }

  setStatus('dpStatus', 'Detecting conflicts...', '');
  try {
    var res = await apiFetch('/api/data-pipeline/detect-conflicts', {
      method: 'POST',
      body: { sources: sources },
    });
    if (!res.ok) { showErr('dpError', 'Conflict detection failed: ' + (res.error || 'Unknown')); return; }

    // Merge conflicts into verification state
    var conflicts = res.conflicts || [];
    conflicts.forEach(function(c) {
      var field = c.field || c.key;
      if (!field) return;
      var existing = PIPELINE_STATE.verificationState[field];
      if (existing) {
        existing.conflict = {
          previousValue: c.valueA,
          previousSource: c.sourceA,
          otherValue: c.valueB,
          otherSource: c.sourceB,
          severity: c.severity || 'warning',
        };
        existing.verified = false;
      }
    });

    dpRenderVerification();
    setStatus('dpStatus', conflicts.length + ' conflict(s) found.', conflicts.length > 0 ? 'warn' : 'ok');
  } catch (err) {
    showErr('dpError', 'Conflict detection error: ' + err.message);
  }
}

// ── Comp Analysis ──────────────────────────────────────────────────────────────

async function dpRunCompAnalysis() {
  if (!PIPELINE_STATE.extractedSubject) {
    showErr('dpError', 'Subject data is required for comp analysis. Extract subject first.');
    return;
  }

  var comps = PIPELINE_STATE.extractedComps.filter(Boolean);
  if (!comps.length) {
    showErr('dpError', 'At least one comp is required for analysis.');
    return;
  }

  setStatus('dpStatus', 'Running comp analysis...', '');
  try {
    var subjectData = PIPELINE_STATE.extractedSubject.adm || PIPELINE_STATE.extractedSubject.raw || {};
    var compData = comps.map(function(c) { return c.adm || c.raw || {}; });

    var res = await apiFetch('/api/data-pipeline/analyze-comps', {
      method: 'POST',
      body: {
        subject: subjectData,
        comps: compData,
      },
    });
    if (!res.ok) { showErr('dpError', 'Comp analysis failed: ' + (res.error || 'Unknown')); return; }

    dpRenderCompAnalysis(res);
    setStatus('dpStatus', 'Comp analysis complete.', 'ok');
  } catch (err) {
    showErr('dpError', 'Comp analysis error: ' + err.message);
  }
}

function dpRenderCompAnalysis(analysis) {
  var container = _dpEl('dpCompAnalysis');
  if (!container) return;

  var html = '<h4 style="margin:0 0 8px;">Comparable Analysis Results</h4>';

  // Price per sqft summary
  if (analysis.pricePerSqft) {
    var pps = analysis.pricePerSqft;
    html +=
      '<div class="dp-analysis-card" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;">' +
        '<strong>Price per Sqft</strong>' +
        '<div style="display:flex;gap:16px;margin-top:4px;font-size:0.85em;">' +
          '<span>Low: $' + esc(_dpFmtNum(pps.low)) + '</span>' +
          '<span>High: $' + esc(_dpFmtNum(pps.high)) + '</span>' +
          '<span>Median: $' + esc(_dpFmtNum(pps.median)) + '</span>' +
          '<span>Mean: $' + esc(_dpFmtNum(pps.mean)) + '</span>' +
        '</div>' +
      '</div>';
  }

  // Adjustment grid
  if (analysis.adjustments && analysis.adjustments.length) {
    html +=
      '<div style="margin-bottom:8px;">' +
        '<strong>Adjustment Grid</strong>' +
        '<table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:0.82em;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);">' +
            '<th style="text-align:left;padding:4px;">Feature</th>';

    analysis.adjustments[0].comps && analysis.adjustments[0].comps.forEach(function(_, i) {
      html += '<th style="text-align:right;padding:4px;">Comp ' + (i + 1) + '</th>';
    });
    html += '</tr></thead><tbody>';

    analysis.adjustments.forEach(function(adj) {
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
      html += '<td style="padding:4px;">' + esc(adj.feature || adj.field || '') + '</td>';
      if (adj.comps) {
        adj.comps.forEach(function(val) {
          var color = val > 0 ? 'var(--ok)' : val < 0 ? 'var(--err)' : 'var(--muted)';
          html += '<td style="text-align:right;padding:4px;color:' + color + ';">' + _dpFmtAdjustment(val) + '</td>';
        });
      }
      html += '</tr>';
    });

    html += '</tbody></table></div>';
  }

  // Reconciliation range
  if (analysis.reconciliation) {
    var recon = analysis.reconciliation;
    html +=
      '<div class="dp-analysis-card" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;">' +
        '<strong>Reconciliation Range</strong>' +
        '<div style="display:flex;gap:16px;margin-top:4px;font-size:0.85em;">' +
          '<span>Low: $' + esc(_dpFmtNum(recon.low)) + '</span>' +
          '<span>High: $' + esc(_dpFmtNum(recon.high)) + '</span>' +
          (recon.indicated ? '<span><strong>Indicated: $' + esc(_dpFmtNum(recon.indicated)) + '</strong></span>' : '') +
        '</div>' +
      '</div>';
  }

  // Narrative summary
  if (analysis.summary || analysis.narrative) {
    html +=
      '<div style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;font-size:0.85em;white-space:pre-wrap;">' +
        esc(analysis.summary || analysis.narrative) +
      '</div>';
  }

  container.innerHTML = html;
}

function _dpFmtNum(n) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function _dpFmtAdjustment(val) {
  if (val == null || isNaN(val)) return '-';
  var n = Number(val);
  var prefix = n > 0 ? '+$' : n < 0 ? '-$' : '$';
  return prefix + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ── Push to Case ───────────────────────────────────────────────────────────────

async function dpPushToCase() {
  if (!STATE.caseId) {
    showErr('dpError', 'No active case. Open or create a case first.');
    return;
  }

  // Collect all verified/extracted facts
  var facts = {};
  var vs = PIPELINE_STATE.verificationState;
  Object.keys(vs).forEach(function(field) {
    var entry = vs[field];
    facts[field] = entry.overrideValue != null ? entry.overrideValue : entry.value;
  });

  if (!Object.keys(facts).length) {
    showErr('dpError', 'No extracted data to push. Run an extraction first.');
    return;
  }

  var unverifiedCount = Object.keys(vs).filter(function(f) { return !vs[f].verified; }).length;
  if (unverifiedCount > 0) {
    var proceed = confirm(unverifiedCount + ' field(s) are unverified. Push anyway?');
    if (!proceed) return;
  }

  setStatus('dpStatus', 'Pushing data to case...', '');
  try {
    var res = await apiFetch('/api/data-pipeline/push-to-case/' + STATE.caseId, {
      method: 'POST',
      body: {
        facts: facts,
        source: 'data-pipeline',
      },
    });
    if (!res.ok) { showErr('dpError', 'Push failed: ' + (res.error || 'Unknown')); return; }

    // Update local STATE.facts
    if (res.facts) {
      STATE.facts = res.facts;
    }

    // Refresh the facts panel if available
    if (typeof renderFieldList === 'function') {
      renderFieldList();
    }
    if (typeof loadCase === 'function' && STATE.caseId) {
      loadCase(STATE.caseId);
    }

    var msg = 'Pushed ' + res.factsCount + ' fact(s) to case.';
    if (res.factChangeInvalidation && res.factChangeInvalidation.invalidatedSections && res.factChangeInvalidation.invalidatedSections.length) {
      msg += ' ' + res.factChangeInvalidation.invalidatedSections.length + ' section(s) invalidated.';
    }
    setStatus('dpStatus', msg, 'ok');
  } catch (err) {
    showErr('dpError', 'Push error: ' + err.message);
  }
}

// ── Export Raw JSON ────────────────────────────────────────────────────────────

function dpExportRawJSON() {
  var payload = {
    exportDate: _dpNow(),
    caseId: STATE.caseId || null,
    subject: PIPELINE_STATE.extractedSubject || null,
    comps: PIPELINE_STATE.extractedComps.filter(Boolean),
    market: PIPELINE_STATE.extractedMarket || null,
    verification: PIPELINE_STATE.verificationState,
    usage: PIPELINE_STATE.usageStats,
  };

  _dpDownloadJSON(payload, 'pipeline-data-' + (STATE.caseId || 'draft') + '.json');
}

function _dpDownloadJSON(data, filename) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ── Usage Tracking ─────────────────────────────────────────────────────────────

function dpUpdateUsage(stats) {
  if (!stats) return;
  if (stats.totalBrowserMs != null) PIPELINE_STATE.usageStats.totalBrowserMs = stats.totalBrowserMs;
  if (stats.jobCount != null) PIPELINE_STATE.usageStats.jobCount = stats.jobCount;
  dpRenderUsage();
}

async function dpRefreshUsage() {
  if (!PIPELINE_STATE.cloudflareAccountId || !PIPELINE_STATE.cloudflareApiToken) return;

  try {
    var queryStr = _dpCredQuery();
    var res = await apiFetch('/api/data-pipeline/usage?' + queryStr);
    if (res.ok) {
      dpUpdateUsage(res);
    }
  } catch {
    // non-critical, silently fail
  }
}

function dpRenderUsage() {
  var container = _dpEl('dpUsage');
  if (!container) return;

  var stats = PIPELINE_STATE.usageStats;
  var html =
    '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.85em;">' +
      '<div>' +
        '<span style="color:var(--muted);">Browser Time:</span> ' + _dpFmtMs(stats.totalBrowserMs) +
      '</div>' +
      '<div>' +
        '<span style="color:var(--muted);">Jobs:</span> ' + stats.jobCount +
      '</div>' +
      '<div>' +
        '<span style="color:var(--muted);">Est. Cost:</span> ' + _dpFmtCost(stats.totalBrowserMs) +
      '</div>' +
    '</div>' +
    '<div style="font-size:0.75em;color:var(--muted);margin-top:4px;">Cloudflare Browser Rendering: first 10 hrs/mo free, then $0.09/hr</div>';

  container.innerHTML = html;
}

// ── Preset Management ──────────────────────────────────────────────────────────

async function dpLoadPresets() {
  try {
    var res = await apiFetch('/api/data-pipeline/presets');
    if (!res.ok) return;

    var presets = res.presets || [];
    // Merge custom presets from localStorage
    var customKeys = Object.keys(PIPELINE_STATE.customPresets);
    customKeys.forEach(function(key) {
      if (!presets.find(function(p) { return p.id === key; })) {
        presets.push({ id: key, name: PIPELINE_STATE.customPresets[key].name || key, custom: true, config: PIPELINE_STATE.customPresets[key].config || {} });
      }
    });

    _dpPopulatePresetSelectors(presets);
  } catch {
    // Populate with defaults only
    _dpPopulatePresetSelectors([
      { id: 'assessor', name: 'Assessor / Tax Records' },
      { id: 'listing', name: 'MLS / Listing Page' },
      { id: 'market', name: 'Market Data' },
    ]);
  }
}

function _dpPopulatePresetSelectors(presets) {
  var selectors = ['dpSubjectPreset', 'dpCustomPreset'];
  selectors.forEach(function(selId) {
    var sel = _dpEl(selId);
    if (!sel) return;
    // Preserve current selection
    var current = sel.value;
    sel.innerHTML = '<option value="">-- Select Preset --</option>';
    presets.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.custom ? ' (custom)' : '');
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
}

function dpApplyPreset(presetId) {
  if (!presetId) return;

  // Check localStorage custom presets first
  var custom = PIPELINE_STATE.customPresets[presetId];
  if (custom && custom.config) {
    var cfg = custom.config;
    if (cfg.maxPages) {
      var mp = _dpEl('dpCustomMaxPages');
      if (mp) mp.value = cfg.maxPages;
    }
    return;
  }

  // Built-in presets apply source type logic
  var sourceTypeEl = _dpEl('dpSubjectSourceType');
  if (sourceTypeEl) sourceTypeEl.value = presetId;
  PIPELINE_STATE.subjectSourceType = presetId;
}

async function dpSaveCustomPreset() {
  var nameEl = _dpEl('dpNewPresetName');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { showErr('dpError', 'Preset name is required.'); return; }

  var presetId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var config = {
    maxPages: PIPELINE_STATE.maxPagesPerCrawl,
    maxAge: PIPELINE_STATE.defaultMaxAge,
    preferStatic: PIPELINE_STATE.preferStaticFetch,
  };

  try {
    var res = await apiFetch('/api/data-pipeline/presets/' + presetId, {
      method: 'PUT',
      body: { name: name, config: config },
    });
    if (res.ok) {
      PIPELINE_STATE.customPresets[presetId] = { name: name, config: config };
      localStorage.setItem('cf_custom_presets', JSON.stringify(PIPELINE_STATE.customPresets));
      dpLoadPresets();
      setStatus('dpStatus', 'Preset "' + name + '" saved.', 'ok');
      if (nameEl) nameEl.value = '';
    } else {
      showErr('dpError', 'Failed to save preset: ' + (res.error || 'Unknown'));
    }
  } catch (err) {
    showErr('dpError', 'Preset save error: ' + err.message);
  }
}

async function dpDeleteCustomPreset(presetId) {
  if (!presetId) return;
  if (!confirm('Delete preset "' + presetId + '"?')) return;

  try {
    await apiFetch('/api/data-pipeline/presets/' + presetId, { method: 'DELETE' });
  } catch {
    // best effort
  }

  delete PIPELINE_STATE.customPresets[presetId];
  localStorage.setItem('cf_custom_presets', JSON.stringify(PIPELINE_STATE.customPresets));
  dpLoadPresets();
  setStatus('dpStatus', 'Preset deleted.', 'ok');
}

// ── Cache Management ───────────────────────────────────────────────────────────

async function dpClearCache() {
  try {
    var res = await apiFetch('/api/data-pipeline/cache', { method: 'DELETE' });
    if (res.ok) {
      setStatus('dpStatus', 'Cache cleared.', 'ok');
    } else {
      showErr('dpError', 'Cache clear failed: ' + (res.error || 'Unknown'));
    }
  } catch (err) {
    showErr('dpError', 'Cache clear error: ' + err.message);
  }
}

async function dpShowCacheStats() {
  try {
    var res = await apiFetch('/api/data-pipeline/cache/stats');
    if (res.ok) {
      var el = _dpEl('dpCacheStats');
      if (el) {
        el.innerHTML =
          '<span style="font-size:0.85em;">' +
            'Entries: ' + (res.entries || res.count || 0) +
            ' &mdash; Size: ' + (res.sizeBytes ? Math.round(res.sizeBytes / 1024) + ' KB' : 'N/A') +
            ' &mdash; Hit rate: ' + (res.hitRate != null ? Math.round(res.hitRate * 100) + '%' : 'N/A') +
          '</span>';
      }
    }
  } catch {
    // non-critical
  }
}

// ── Tab initialization ─────────────────────────────────────────────────────────

function dpOnTabOpen() {
  dpLoadSettings();
  dpLoadPresets();
  dpRenderJobs();
  dpRenderExtractedPreview();
  dpRenderVerification();
  dpRenderUsage();
  dpRefreshUsage();
  dpShowCacheStats();
  showErr('dpError', '');
}

// ── Enhanced AI prompt context builder ──────────────────────────────────────────

function dpBuildPromptContext() {
  var parts = [];

  // Subject data
  if (PIPELINE_STATE.extractedSubject) {
    var subj = PIPELINE_STATE.extractedSubject.adm || PIPELINE_STATE.extractedSubject.raw || {};
    var subjLines = ['## Subject Property (Data Pipeline)'];
    DP_PREVIEW_FIELDS.forEach(function(f) {
      var val = _dpResolveField(subj, f.key);
      if (val !== undefined && val !== null && val !== '') {
        subjLines.push('- **' + f.label + '**: ' + String(val));
      }
    });
    if (PIPELINE_STATE.extractedSubject.crawlDate) {
      subjLines.push('- _Source_: ' + (PIPELINE_STATE.extractedSubject.source || 'crawler'));
      subjLines.push('- _Crawl date_: ' + PIPELINE_STATE.extractedSubject.crawlDate);
    }
    parts.push(subjLines.join('\n'));
  }

  // Comps
  var comps = PIPELINE_STATE.extractedComps.filter(Boolean);
  if (comps.length) {
    var compLines = ['## Comparable Sales (Data Pipeline)'];
    comps.forEach(function(comp, i) {
      var data = comp.adm || comp.raw || {};
      compLines.push('### Comp ' + (i + 1));
      DP_PREVIEW_FIELDS.forEach(function(f) {
        var val = _dpResolveField(data, f.key);
        if (val !== undefined && val !== null && val !== '') {
          compLines.push('- **' + f.label + '**: ' + String(val));
        }
      });
      if (comp.crawlDate) {
        compLines.push('- _Source_: ' + (comp.source || 'crawler'));
        compLines.push('- _Crawl date_: ' + comp.crawlDate);
      }
    });
    parts.push(compLines.join('\n'));
  }

  // Market data
  if (PIPELINE_STATE.extractedMarket) {
    var mkt = PIPELINE_STATE.extractedMarket.adm || PIPELINE_STATE.extractedMarket.raw || {};
    var mktLines = ['## Market Data (Data Pipeline)'];
    Object.keys(mkt).forEach(function(k) {
      if (mkt[k] != null && mkt[k] !== '') {
        mktLines.push('- **' + k + '**: ' + String(mkt[k]));
      }
    });
    if (PIPELINE_STATE.extractedMarket.crawlDate) {
      mktLines.push('- _Source_: ' + (PIPELINE_STATE.extractedMarket.source || 'crawler'));
      mktLines.push('- _Crawl date_: ' + PIPELINE_STATE.extractedMarket.crawlDate);
    }
    parts.push(mktLines.join('\n'));
  }

  // Verification overrides (show only overridden fields)
  var vs = PIPELINE_STATE.verificationState;
  var overrides = Object.keys(vs).filter(function(f) { return vs[f].overrideValue != null; });
  if (overrides.length) {
    var oLines = ['## Appraiser-Verified Overrides'];
    overrides.forEach(function(field) {
      var entry = vs[field];
      oLines.push('- **' + field + '**: ' + String(entry.overrideValue) + ' (was: ' + String(entry.value) + ')');
    });
    parts.push(oLines.join('\n'));
  }

  return parts.join('\n\n');
}
