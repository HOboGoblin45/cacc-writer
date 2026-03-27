const API_BASE = window.location.origin;
const API_KEY = 'cacc-local-key-2026';
const APP_NAME = 'Appraisal Agent';

const STEP_META = [
  { id: 1, label: 'Import', description: 'Load source files' },
  { id: 2, label: 'Facts', description: 'Validate extracted data' },
  { id: 3, label: 'Generate', description: 'Draft narratives' },
  { id: 4, label: 'Review', description: 'Approve or reject sections' },
  { id: 5, label: 'Insert', description: 'Run QC and send to ACI' }
];

const FACT_GROUPS = [
  { key: 'subject', label: 'Subject Property' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'borrower', label: 'Borrower' },
  { key: 'lender', label: 'Lender' },
  { key: 'site', label: 'Site' },
  { key: 'market', label: 'Market' }
];

const S = {
  step: 1,
  caseId: null,
  caseMeta: null,
  facts: {},
  outputs: {},
  cases: [],
  docUploads: [],
  docSummary: {},
  scopeWarning: null,
  caseQuery: '',
  reviewQuery: '',
  ui: {
    sidebarCollapsed: false
  },
  generation: {
    running: false,
    startedAt: null,
    timer: null,
    stageIndex: 0,
    stages: [
      'Preparing case context',
      'Checking extracted facts',
      'Drafting narrative sections',
      'Refining section language',
      'Refreshing review workspace'
    ],
    log: [],
    lastTone: 'muted',
    lastMessage: 'Ready to generate when you are.'
  }
};

const refs = {};

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
const SHORTCUTS = [
  { key: 's', ctrl: true, action: () => { if (S.step === 2) refs.saveFacts.click(); }, label: 'Save facts' },
  { key: 'g', ctrl: true, shift: true, action: () => { if (S.caseId) gotoStep(3); refs.generateButton?.click(); }, label: 'Generate all' },
  { key: 'Enter', ctrl: true, action: () => { if (S.step === 5) refs.insertButton.click(); }, label: 'Insert all' },
  { key: '1', alt: true, action: () => gotoStep(1), label: 'Step 1: Import' },
  { key: '2', alt: true, action: () => gotoStep(2), label: 'Step 2: Facts' },
  { key: '3', alt: true, action: () => gotoStep(3), label: 'Step 3: Generate' },
  { key: '4', alt: true, action: () => gotoStep(4), label: 'Step 4: Review' },
  { key: '5', alt: true, action: () => gotoStep(5), label: 'Step 5: Insert' },
  { key: 'k', ctrl: true, action: () => toggleCommandPalette(), label: 'Command palette' },
  { key: 'Escape', action: () => { if (commandPaletteOpen) toggleCommandPalette(false); }, label: 'Close palette' },
];

let commandPaletteOpen = false;

document.addEventListener('keydown', (e) => {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.key !== e.key) continue;
    if (shortcut.ctrl && !(e.ctrlKey || e.metaKey)) continue;
    if (shortcut.shift && !e.shiftKey) continue;
    if (shortcut.alt && !e.altKey) continue;
    if (!shortcut.ctrl && (e.ctrlKey || e.metaKey) && shortcut.key !== 'Escape') continue;
    if (!shortcut.alt && e.altKey) continue;
    e.preventDefault();
    shortcut.action();
    return;
  }
});

// ── Command Palette ──────────────────────────────────────────────────────────
function toggleCommandPalette(force) {
  commandPaletteOpen = force !== undefined ? force : !commandPaletteOpen;
  let palette = document.getElementById('command-palette');
  if (commandPaletteOpen) {
    if (!palette) {
      palette = document.createElement('div');
      palette.id = 'command-palette';
      palette.className = 'command-palette-overlay';
      palette.innerHTML = `
        <div class="command-palette-card">
          <input type="text" class="command-palette-input" placeholder="Type a command…" autocomplete="off" />
          <div class="command-palette-list"></div>
        </div>
      `;
      document.body.appendChild(palette);
      palette.addEventListener('click', (e) => { if (e.target === palette) toggleCommandPalette(false); });
      const input = palette.querySelector('.command-palette-input');
      input.addEventListener('input', () => renderCommandPaletteResults(palette, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const first = palette.querySelector('.command-palette-item');
          if (first) first.click();
        }
      });
    }
    palette.classList.remove('hidden');
    const input = palette.querySelector('.command-palette-input');
    input.value = '';
    input.focus();
    renderCommandPaletteResults(palette, '');
  } else if (palette) {
    palette.classList.add('hidden');
  }
}

function renderCommandPaletteResults(palette, query) {
  const commands = [
    { label: 'Go to Import', shortcut: 'Alt+1', action: () => { gotoStep(1); toggleCommandPalette(false); } },
    { label: 'Go to Facts', shortcut: 'Alt+2', action: () => { gotoStep(2); toggleCommandPalette(false); } },
    { label: 'Go to Generate', shortcut: 'Alt+3', action: () => { gotoStep(3); toggleCommandPalette(false); } },
    { label: 'Go to Review', shortcut: 'Alt+4', action: () => { gotoStep(4); toggleCommandPalette(false); } },
    { label: 'Go to Insert', shortcut: 'Alt+5', action: () => { gotoStep(5); toggleCommandPalette(false); } },
    { label: 'Save facts', shortcut: 'Ctrl+S', action: () => { refs.saveFacts.click(); toggleCommandPalette(false); } },
    { label: 'Generate all narratives', shortcut: 'Ctrl+Shift+G', action: () => { refs.generateButton?.click(); toggleCommandPalette(false); } },
    { label: 'Approve all sections', action: () => { refs.approveAll?.click(); toggleCommandPalette(false); } },
    { label: 'Insert into ACI', shortcut: 'Ctrl+Enter', action: () => { refs.insertButton?.click(); toggleCommandPalette(false); } },
    { label: 'Refresh cases', action: () => { refreshCases({ restoreSelection: true }); toggleCommandPalette(false); } },
    { label: 'Toggle sidebar', action: () => { toggleSidebar(); toggleCommandPalette(false); } },
    { label: 'Toggle theme (dark/light)', action: () => { toggleTheme(); toggleCommandPalette(false); } },
    { label: 'New case…', action: () => { toggleCommandPalette(false); promptNewCase(); } },
  ];

  const q = query.toLowerCase().trim();
  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;
  const list = palette.querySelector('.command-palette-list');
  list.innerHTML = filtered.map(c => `
    <button class="command-palette-item" type="button">
      <span>${escapeHtml(c.label)}</span>
      ${c.shortcut ? `<kbd>${escapeHtml(c.shortcut)}</kbd>` : ''}
    </button>
  `).join('') || '<div class="command-palette-empty">No matching commands</div>';

  list.querySelectorAll('.command-palette-item').forEach((btn, i) => {
    btn.addEventListener('click', () => filtered[i].action());
  });
}

// ── Auto-refresh polling ─────────────────────────────────────────────────────
let pollTimer = null;
let serviceCheckTimer = null;

async function checkServices() {
  try {
    const data = await api('/api/health/detailed');
    const aiOk = data.ai?.ready;
    const aciOk = data.agents?.aciReachable;
    const rqOk = data.agents?.rqReachable;

    const setDot = (id, state, title) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = `service-dot ${state}`;
      el.title = title;
    };

    setDot('svc-ai', aiOk ? 'up' : 'down', aiOk ? 'OpenAI: Connected' : 'OpenAI: Key invalid or missing');
    setDot('svc-aci', aciOk ? 'up' : 'warn', aciOk ? 'ACI agent: Running' : 'ACI agent: Not running');
    setDot('svc-rq', rqOk ? 'up' : 'warn', rqOk ? 'Real Quantum: Running' : 'Real Quantum: Not running');

    const label = document.getElementById('services-label');
    if (label) {
      const issues = [!aiOk && 'AI key', !aciOk && 'ACI', !rqOk && 'RQ'].filter(Boolean);
      label.textContent = issues.length ? `Issues: ${issues.join(', ')}` : 'All systems go';
    }
  } catch (_) { /* health endpoint unavailable */ }
}

function startPolling() {
  stopPolling();
  checkServices();
  pollTimer = window.setInterval(async () => {
    if (!S.caseId || S.generation.running) return;
    try {
      const data = await api(`/api/cases/${S.caseId}`);
      const newOutputKeys = Object.keys(data.outputs || {}).filter(k => data.outputs[k]?.text);
      const oldOutputKeys = Object.keys(S.outputs || {}).filter(k => S.outputs[k]?.text);
      if (newOutputKeys.length !== oldOutputKeys.length) {
        S.outputs = data.outputs || {};
        S.caseMeta = data.meta || data.caseMeta || S.caseMeta;
        S.docSummary = data.docSummary || S.docSummary;
        renderAll();
      }
    } catch (_) { /* silent */ }
  }, 8000);
  serviceCheckTimer = window.setInterval(checkServices, 120000);
}

function stopPolling() {
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
  if (serviceCheckTimer) { window.clearInterval(serviceCheckTimer); serviceCheckTimer = null; }
}

document.addEventListener('DOMContentLoaded', init);

async function api(path, opts = {}) {
  const headers = { 'X-API-Key': API_KEY, ...(opts.headers || {}) };
  const request = { ...opts, headers };

  if (request.body && typeof request.body === 'object' && !(request.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(request.body);
  }

  const response = await fetch(API_BASE + path, request);
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));

  if (!response.ok || data.ok === false) {
    const message = data.error || data.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.data = data;
    throw error;
  }

  return data;
}

function init() {
  document.title = APP_NAME;
  cacheRefs();
  restoreUiPrefs();
  bindCaseControls();
  bindProgress();
  bindNavButtons();
  bindUploadZones();
  bindActionButtons();
  bindDelegatedInputs();
  renderAll();
  refreshCases({ restoreSelection: true });
  startPolling();
}

function cacheRefs() {
  refs.sidebar = document.getElementById('sidebar');
  refs.sidebarToggle = document.getElementById('sidebar-toggle');
  refs.sidebarSearch = document.getElementById('sidebar-search');
  refs.caseSelect = document.getElementById('case-select');
  refs.caseList = document.getElementById('case-list');
  refs.caseEmpty = document.getElementById('case-empty');
  refs.refreshCases = document.getElementById('refresh-cases');
  refs.headerRefresh = document.getElementById('header-refresh');
  refs.sidebarProgress = document.getElementById('sidebar-progress');
  refs.sidebarStepLabel = document.getElementById('sidebar-step-label');

  refs.headerCaseTitle = document.getElementById('header-case-title');
  refs.headerCaseMeta = document.getElementById('header-case-meta');
  refs.connectionBadge = document.getElementById('connection-badge');
  refs.connectionText = document.getElementById('connection-text');
  refs.statusDot = document.getElementById('status-dot');

  refs.heroCaseId = document.getElementById('hero-case-id');
  refs.heroCaseForm = document.getElementById('hero-case-form');
  refs.heroDocCount = document.getElementById('hero-doc-count');
  refs.heroSectionCount = document.getElementById('hero-section-count');
  refs.heroApprovedCount = document.getElementById('hero-approved-count');

  refs.progressBar = document.getElementById('progress-bar');
  refs.scopeBanner = document.getElementById('scope-banner');
  refs.steps = Array.from(document.querySelectorAll('.wizard-step'));

  refs.importSummary = document.getElementById('import-summary');
  refs.importContinue = document.getElementById('import-continue');
  refs.importExisting = document.getElementById('import-existing');

  refs.factsGroups = document.getElementById('facts-groups');
  refs.compsCount = document.getElementById('comps-count');
  refs.compsBody = document.querySelector('#comps-table tbody');
  refs.saveFacts = document.getElementById('save-facts');
  refs.docsInput = document.getElementById('docs-input');
  refs.uploadDocs = document.getElementById('upload-docs');
  refs.docStatus = document.getElementById('doc-status');
  refs.docSummary = document.getElementById('doc-summary');

  refs.generateSummary = document.getElementById('generate-summary');
  refs.generateButton = document.getElementById('generate-all');
  refs.generateStatus = document.getElementById('generate-status');
  refs.generationProgressFill = document.getElementById('generation-progress-fill');
  refs.generationFeed = document.getElementById('generation-feed');

  refs.reviewSummary = document.getElementById('review-summary');
  refs.reviewSearch = document.getElementById('review-search');
  refs.sectionsList = document.getElementById('sections-list');
  refs.approveAll = document.getElementById('approve-all');

  refs.insertSummary = document.getElementById('insert-summary');
  refs.insertChecklist = document.getElementById('insert-checklist');
  refs.insertButton = document.getElementById('insert-all');
  refs.insertResults = document.getElementById('insert-results');

  refs.toastRegion = document.getElementById('toast-region');
  refs.globalLoading = document.getElementById('global-loading');
  refs.globalLoadingText = document.getElementById('global-loading-text');

  refs.generateAllBtn = document.getElementById('generate-all-btn');
  refs.generateReportModal = document.getElementById('generate-report-modal');
  refs.genModalSubtitle = document.getElementById('gen-modal-subtitle');
  refs.genModalProgressFill = document.getElementById('gen-modal-progress-fill');
  refs.genModalSectionList = document.getElementById('gen-modal-section-list');
  refs.genModalFooter = document.getElementById('gen-modal-footer');
  refs.genModalTime = document.getElementById('gen-modal-time');
  refs.genModalStop = document.getElementById('gen-modal-stop');
  refs.genModalDone = document.getElementById('gen-modal-done');
}

function restoreUiPrefs() {
  S.ui.sidebarCollapsed = localStorage.getItem('cacc-sidebar-collapsed') === '1';
  document.body.classList.toggle('sidebar-collapsed', S.ui.sidebarCollapsed);
  
  // Theme
  const savedTheme = localStorage.getItem('cacc-theme') || 'dark';
  S.ui.theme = savedTheme;
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  const themeIcon = document.getElementById('theme-icon');
  if (themeIcon) themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f8f9fb' : '#0d1117');
}

function toggleTheme() {
  S.ui.theme = S.ui.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cacc-theme', S.ui.theme);
  applyTheme(S.ui.theme);
}

function bindCaseControls() {
  refs.sidebarToggle.addEventListener('click', toggleSidebar);

  refs.sidebarSearch.addEventListener('input', (event) => {
    S.caseQuery = String(event.target.value || '').trim().toLowerCase();
    renderSidebarCases();
  });

  refs.caseSelect.addEventListener('change', async (event) => {
    const caseId = event.target.value;
    if (!caseId) {
      clearCase();
      return;
    }
    await selectCase(caseId, { keepStep: true });
  });

  refs.caseList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-case-id]');
    if (!button) return;
    await selectCase(button.dataset.caseId, { keepStep: true });
  });

  refs.refreshCases.addEventListener('click', () => refreshCases({ restoreSelection: true }));
  refs.headerRefresh.addEventListener('click', () => refreshCases({ restoreSelection: true }));

  const newCaseBtn = document.getElementById('new-case-btn');
  if (newCaseBtn) newCaseBtn.addEventListener('click', promptNewCase);

  const paletteTrigger = document.getElementById('cmd-palette-trigger');
  if (paletteTrigger) paletteTrigger.addEventListener('click', () => toggleCommandPalette());
  
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  const deleteCaseBtn = document.getElementById('delete-case-btn');
  if (deleteCaseBtn) deleteCaseBtn.addEventListener('click', confirmDeleteCase);

  refs.importContinue.addEventListener('click', () => gotoStep(2));
  refs.importExisting.addEventListener('click', () => {
    if (!S.caseId) {
      refs.sidebarSearch.focus();
      showToast('Select a case from the sidebar first.', 'warning');
      return;
    }
    gotoStep(2);
  });

  refs.reviewSearch.addEventListener('input', (event) => {
    S.reviewQuery = String(event.target.value || '').trim().toLowerCase();
    renderSections();
  });
}

function bindProgress() {
  refs.progressBar.addEventListener('click', (event) => {
    const stepEl = event.target.closest('.progress-step');
    if (!stepEl) return;
    gotoStep(Number(stepEl.dataset.step));
  });

  refs.sidebarProgress.addEventListener('click', (event) => {
    const stepEl = event.target.closest('.sidebar-step');
    if (!stepEl) return;
    gotoStep(Number(stepEl.dataset.step));
  });
}

function bindNavButtons() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.nav;
      if (direction === 'back') gotoStep(Math.max(1, S.step - 1));
      if (direction === 'forward') gotoStep(Math.min(STEP_META.length, S.step + 1));
    });
  });
}

function bindUploadZones() {
  document.querySelectorAll('.dropzone').forEach((zone) => {
    const input = zone.querySelector('input');
    const button = zone.querySelector('button');

    zone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      input.click();
    });

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      input.click();
    });

    input.addEventListener('change', () => {
      if (input.files && input.files[0]) handleIntakeUpload(zone.dataset.type, input.files[0]);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach((name) => {
      zone.addEventListener(name, (event) => {
        event.preventDefault();
        zone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((name) => {
      zone.addEventListener(name, (event) => {
        event.preventDefault();
        if (name === 'drop' && event.dataTransfer && event.dataTransfer.files[0]) {
          handleIntakeUpload(zone.dataset.type, event.dataTransfer.files[0]);
        }
        zone.classList.remove('dragover');
      });
    });
  });
}

function bindActionButtons() {
  refs.saveFacts.addEventListener('click', saveFacts);
  refs.uploadDocs.addEventListener('click', uploadDocuments);
  refs.generateButton.addEventListener('click', generateAll);
  refs.approveAll.addEventListener('click', approveAllSections);
  refs.insertButton.addEventListener('click', insertAll);
  refs.generateAllBtn.addEventListener('click', generateFullReport);
  refs.genModalStop.addEventListener('click', stopFullReportGeneration);
  refs.genModalDone.addEventListener('click', function() {
    closeGenerateReportModal();
    gotoStep(4);
  });
}

function bindDelegatedInputs() {
  refs.factsGroups.addEventListener('input', onFactInput);

  refs.sectionsList.addEventListener('input', (event) => {
    const area = event.target.closest('textarea[data-field]');
    if (!area) return;

    const field = area.dataset.field;
    if (!S.outputs[field]) S.outputs[field] = {};
    S.outputs[field].text = area.value;
    S.outputs[field]._dirty = true;

    const card = area.closest('.section-card');
    if (card) updateSectionCardMeta(card, field);
  });

  refs.sectionsList.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('[data-save-section]');
    if (saveButton) {
      await saveSection(saveButton.dataset.saveSection, saveButton);
      return;
    }

    const approveButton = event.target.closest('[data-approve]');
    if (approveButton) {
      await approveSection(approveButton.dataset.approve, approveButton);
      return;
    }

    const rejectButton = event.target.closest('[data-reject]');
    if (rejectButton) {
      await rejectSection(rejectButton.dataset.reject, rejectButton);
      return;
    }

    const regenerateButton = event.target.closest('[data-regenerate]');
    if (regenerateButton) {
      await regenerateSection(regenerateButton.dataset.regenerate, regenerateButton);
    }
  });
}

async function confirmDeleteCase() {
  if (!S.caseId) return;
  const address = getCaseAddress(S.caseMeta) || S.caseId;
  if (!window.confirm(`Delete case "${address}"?\n\nThis cannot be undone.`)) return;

  try {
    setGlobalLoading(true, 'Deleting case…');
    await api(`/api/cases/${S.caseId}`, { method: 'DELETE' });
    clearCase({ silent: true });
    await refreshCases();
    showToast('Case deleted.', 'info');
  } catch (error) {
    showToast(`Delete failed: ${error.message}`, 'error');
  } finally {
    setGlobalLoading(false);
  }
}

async function promptNewCase() {
  const address = window.prompt('Property address for new case:', '');
  if (!address || !address.trim()) return;

  const formOptions = ['1004', '1025', '1073', '1004c', 'commercial'];
  const formPrompt = window.prompt(`Form type:\n  1. 1004 – Single Family\n  2. 1025 – Small Income\n  3. 1073 – Condo\n  4. 1004c – Manufactured Home\n  5. commercial\n\nEnter number or form type:`, '1');
  const formMap = { '1': '1004', '2': '1025', '3': '1073', '4': '1004c', '5': 'commercial' };
  const formType = formMap[formPrompt] || (formOptions.includes(formPrompt) ? formPrompt : '1004');

  try {
    setGlobalLoading(true, 'Creating case…');
    const result = await api('/api/cases/create', {
      method: 'POST',
      body: { address: address.trim(), formType }
    });

    if (result.ok && result.caseId) {
      await refreshCases();
      await selectCase(result.caseId);
      showToast(`New ${formType} case created.`, 'success');
    }
  } catch (error) {
    showToast(`Failed to create case: ${error.message}`, 'error');
  } finally {
    setGlobalLoading(false);
  }
}

function toggleSidebar() {
  S.ui.sidebarCollapsed = !S.ui.sidebarCollapsed;
  localStorage.setItem('cacc-sidebar-collapsed', S.ui.sidebarCollapsed ? '1' : '0');
  document.body.classList.toggle('sidebar-collapsed', S.ui.sidebarCollapsed);
}

async function refreshCases({ restoreSelection = false } = {}) {
  setRefreshButtonsBusy(true);

  try {
    const data = await api('/api/cases');
    const list = data.cases || data.items || data;
    S.cases = Array.isArray(list) ? list : [];

    renderCaseSelect();
    renderSidebarCases();
    setConnection(true, `${S.cases.length} case${S.cases.length === 1 ? '' : 's'} available`);

    const currentExists = S.caseId && S.cases.some((item) => getCaseSummary(item).id === S.caseId);
    if (S.caseId && !currentExists) clearCase({ silent: true });

    if (restoreSelection) {
      const remembered = S.caseId || localStorage.getItem('cacc-last-case');
      if (remembered && S.cases.some((item) => getCaseSummary(item).id === remembered)) {
        await selectCase(remembered, { keepStep: true, silent: true });
      }
    }

    renderAll();
  } catch (error) {
    console.error(error);
    setConnection(false, 'API unavailable');
    showToast(`Unable to load cases: ${error.message}`, 'error');
  } finally {
    setRefreshButtonsBusy(false);
  }
}

async function selectCase(caseId, { keepStep = false, silent = false } = {}) {
  if (!caseId) {
    clearCase();
    return;
  }

  S.caseId = caseId;
  localStorage.setItem('cacc-last-case', caseId);
  renderCaseSelect();
  renderSidebarCases();

  await loadCase(caseId, { silent });

  if (!keepStep && S.step === 1) renderImportSummary();
}

async function loadCase(caseId, { silent = false } = {}) {
  if (!caseId) return;

  if (!silent) setGlobalLoading(true, 'Loading case workspace');

  try {
    const data = await api(`/api/cases/${caseId}`);
    S.caseMeta = data.meta || data.caseMeta || null;
    S.facts = data.facts || {};
    S.outputs = data.outputs || {};
    S.docSummary = data.docSummary || {};
    S.scopeWarning = data.scopeWarning || null;

    setConnection(true, 'Connected to local API');
    renderAll();
  } catch (error) {
    console.error(error);
    setConnection(false, 'Case load failed');
    showToast(`Unable to load case: ${error.message}`, 'error');
  } finally {
    if (!silent) setGlobalLoading(false);
  }
}

function clearCase({ silent = false } = {}) {
  S.caseId = null;
  S.caseMeta = null;
  S.facts = {};
  S.outputs = {};
  S.docSummary = {};
  S.scopeWarning = null;
  S.docUploads = [];

  localStorage.removeItem('cacc-last-case');

  if (S.step > 1) S.step = 1;
  if (!silent) showToast('Case cleared.', 'info');

  renderAll();
}

function gotoStep(step) {
  if (!Number.isFinite(step) || step < 1 || step > STEP_META.length) return;

  if (step > 1 && !S.caseId) {
    showToast('Select or import a case first.', 'warning');
    return;
  }

  S.step = step;
  renderProgress();
  updateStepVisibility();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  renderProgress();
  updateStepVisibility();
  renderSidebarCases();
  renderCaseHeader();
  renderScopeBanner();
  renderImportSummary();
  renderFacts();
  renderComps();
  renderDocStatus();
  renderGenerateSummary();
  renderGenerationStatus();
  renderReviewSummary();
  renderSections();
  renderInsertSummary();
}

function renderProgress() {
  refs.sidebarStepLabel.textContent = `Step ${S.step} of ${STEP_META.length}`;

  refs.progressBar.innerHTML = STEP_META.map((meta) => {
    const state = getStepState(meta.id);
    const clickable = meta.id === 1 || Boolean(S.caseId);
    return `
      <button class="progress-step ${state} ${clickable ? 'clickable' : ''}" type="button" data-step="${meta.id}">
        <span class="progress-index">${meta.id < S.step ? '?' : meta.id}</span>
        <span class="progress-copy-block">
          <strong>${meta.label}</strong>
          <span>${meta.description}</span>
        </span>
      </button>
    `;
  }).join('');

  refs.sidebarProgress.innerHTML = STEP_META.map((meta) => {
    const state = getStepState(meta.id);
    return `
      <button class="sidebar-step ${state}" type="button" data-step="${meta.id}">
        <span class="sidebar-step-index">${meta.id < S.step ? '?' : meta.id}</span>
        <span class="sidebar-step-copy">
          <strong>${meta.label}</strong>
          <span>${meta.description}</span>
        </span>
      </button>
    `;
  }).join('');
}

function getStepState(stepId) {
  if (stepId < S.step) return 'complete';
  if (stepId === S.step) return 'active';
  return 'pending';
}

function updateStepVisibility() {
  refs.steps.forEach((step) => {
    step.classList.toggle('is-active', Number(step.dataset.step) === S.step);
  });
}

function renderCaseSelect() {
  const options = ['<option value="">Select a case</option>'];

  for (const item of S.cases) {
    const summary = getCaseSummary(item);
    options.push(`<option value="${escapeAttr(summary.id)}">${escapeHtml(summary.address || 'Untitled case')} � ${escapeHtml(summary.borrower || 'Unknown borrower')}</option>`);
  }

  refs.caseSelect.innerHTML = options.join('');
  refs.caseSelect.value = S.caseId || '';
}

function renderSidebarCases() {
  const filtered = S.cases
    .map(getCaseSummary)
    .filter((item) => {
      if (!S.caseQuery) return true;
      const haystack = [item.address, item.borrower, item.formType, item.workflowStatus, item.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(S.caseQuery);
    });

  refs.caseEmpty.classList.toggle('hidden', filtered.length > 0);

  refs.caseList.innerHTML = filtered.map((item) => {
    const active = item.id === S.caseId ? 'is-active' : '';
    return `
      <button class="case-item ${active}" type="button" data-case-id="${escapeAttr(item.id)}">
        <div class="case-item-top">
          <strong>${escapeHtml(item.address || 'Untitled case')}</strong>
          <span class="workflow-pill">${escapeHtml(item.workflowStatus || 'new')}</span>
        </div>
        <div class="case-item-meta">${escapeHtml(item.borrower || 'Unknown borrower')}</div>
        <div class="case-item-footer">
          <span>${escapeHtml(item.formType || '1004')}</span>
          <span>${escapeHtml(formatDateTime(item.updatedAt) || 'No timestamp')}</span>
        </div>
      </button>
    `;
  }).join('');
}

function renderCaseHeader() {
  const deleteCaseBtn = document.getElementById('delete-case-btn');
  if (!S.caseMeta || !S.caseId) {
    refs.headerCaseTitle.textContent = 'Select a case to begin';
    refs.headerCaseMeta.textContent = 'Import a new XML and order package or open an existing case from the sidebar.';
    refs.heroCaseId.textContent = '--';
    refs.heroCaseForm.textContent = 'Form --';
    refs.heroDocCount.textContent = '0';
    refs.heroSectionCount.textContent = '0';
    refs.heroApprovedCount.textContent = '0 approved';
    if (deleteCaseBtn) deleteCaseBtn.classList.add('hidden');
    if (refs.generateAllBtn) refs.generateAllBtn.classList.add('hidden');
    return;
  }
  if (deleteCaseBtn) deleteCaseBtn.classList.remove('hidden');
  if (refs.generateAllBtn) refs.generateAllBtn.classList.remove('hidden');

  const address = getCaseAddress(S.caseMeta) || 'Untitled case';
  const borrower = getCaseBorrower(S.caseMeta) || 'Unknown borrower';
  const formType = getCaseFormType(S.caseMeta) || '--';
  const workflowStatus = prettify(S.caseMeta.workflowStatus || 'in progress');
  const sectionCount = getSectionEntries().length;
  const approvedCount = Object.values(S.outputs || {}).filter((item) => item && item.approved).length;

  const eyebrow = document.getElementById('header-eyebrow');
  if (eyebrow) {
    const formLabel = { '1004': 'Single Family (1004)', '1025': 'Small Income (1025)', '1073': 'Condo (1073)', 'commercial': 'Commercial Narrative', '1004c': 'Manufactured Home (1004C)' };
    eyebrow.textContent = formLabel[formType] || `Form ${formType}`;
  }
  refs.headerCaseTitle.textContent = address;
  refs.headerCaseMeta.textContent = `${borrower} · Form ${formType} · ${workflowStatus}`;
  refs.heroCaseId.textContent = S.caseId;
  refs.heroCaseForm.textContent = `Form ${formType}`;
  refs.heroDocCount.textContent = String(Object.keys(S.docSummary || {}).length);
  refs.heroSectionCount.textContent = String(sectionCount);
  refs.heroApprovedCount.textContent = `${approvedCount} approved`;
}

function renderScopeBanner() {
  if (!S.scopeWarning || !S.scopeWarning.message) {
    refs.scopeBanner.classList.add('hidden');
    refs.scopeBanner.textContent = '';
    return;
  }

  refs.scopeBanner.classList.remove('hidden');
  refs.scopeBanner.textContent = S.scopeWarning.message;
}

function renderImportSummary() {
  refs.importContinue.disabled = !S.caseId;

  if (!S.caseMeta) {
    refs.importSummary.innerHTML = `
      <div class="empty-state compact">
        <h3>No case selected</h3>
        <p>Upload an XML or order PDF, or search the sidebar to open an existing case.</p>
      </div>
    `;
    return;
  }

  const address = getCaseAddress(S.caseMeta) || '�';
  const borrower = getCaseBorrower(S.caseMeta) || '�';
  const lender = getCaseLender(S.caseMeta) || '�';
  const formType = getCaseFormType(S.caseMeta) || '�';
  const comps = Array.isArray(S.facts?.comps) ? S.facts.comps.length : (S.caseMeta.comps?.length || S.caseMeta.comparableCount || 0);
  const docs = Object.keys(S.docSummary || {}).length;

  refs.importSummary.innerHTML = `
    <div class="summary-card-grid">
      <div class="summary-card"><span>Address</span><strong>${escapeHtml(address)}</strong></div>
      <div class="summary-card"><span>Borrower</span><strong>${escapeHtml(borrower)}</strong></div>
      <div class="summary-card"><span>Lender</span><strong>${escapeHtml(lender)}</strong></div>
      <div class="summary-card"><span>Form</span><strong>${escapeHtml(formType)}</strong></div>
      <div class="summary-card"><span>Comps</span><strong>${escapeHtml(String(comps))}</strong></div>
      <div class="summary-card"><span>Documents</span><strong>${escapeHtml(String(docs))}</strong></div>
    </div>
    <div class="summary-note">
      <strong>Selected case ready.</strong>
      <span>Move to facts when the import package looks complete.</span>
    </div>
  `;
}

function renderFacts() {
  if (!S.caseId) {
    refs.factsGroups.innerHTML = `
      <div class="empty-state compact">
        <h3>No facts loaded</h3>
        <p>Select a case to review extracted fact groups.</p>
      </div>
    `;
    return;
  }

  refs.factsGroups.innerHTML = FACT_GROUPS.map((group) => {
    const entries = Object.entries(S.facts?.[group.key] || {}).map(([field, raw]) => normalizeFactEntry(field, raw));

    return `
      <section class="fact-group-card">
        <div class="fact-group-head">
          <div>
            <h3>${group.label}</h3>
            <p>${entries.length} field${entries.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div class="fact-group-body">
          ${entries.length ? entries.map((entry) => renderFactRow(group.key, entry)).join('') : '<div class="empty-inline">No extracted data in this group yet.</div>'}
        </div>
      </section>
    `;
  }).join('');
}

function normalizeFactEntry(field, raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      field,
      value: raw.value ?? '',
      confidence: String(raw.confidence || 'manual').toLowerCase()
    };
  }

  return {
    field,
    value: raw ?? '',
    confidence: 'manual'
  };
}

function renderFactRow(groupKey, entry) {
  const tone = ['high', 'medium', 'low', 'manual'].includes(entry.confidence) ? entry.confidence : 'manual';
  return `
    <label class="fact-row">
      <span class="fact-label">${escapeHtml(prettify(entry.field))}</span>
      <input type="text" data-group="${escapeAttr(groupKey)}" data-field="${escapeAttr(entry.field)}" value="${escapeAttr(entry.value)}" />
      <span class="confidence-pill ${tone}">${escapeHtml(entry.confidence)}</span>
    </label>
  `;
}

function onFactInput(event) {
  const input = event.target.closest('input[data-group][data-field]');
  if (!input) return;

  const group = input.dataset.group;
  const field = input.dataset.field;

  if (!S.facts[group]) S.facts[group] = {};
  if (!S.facts[group][field] || typeof S.facts[group][field] !== 'object') {
    S.facts[group][field] = { value: '', confidence: 'manual' };
  }

  S.facts[group][field].value = input.value;
}

function renderComps() {
  const comps = Array.isArray(S.facts?.comps) ? S.facts.comps : [];
  refs.compsCount.textContent = `${comps.length} comp${comps.length === 1 ? '' : 's'}`;

  if (!comps.length) {
    refs.compsBody.innerHTML = '<tr><td colspan="6" class="table-empty">No comparables loaded yet.</td></tr>';
    return;
  }

  refs.compsBody.innerHTML = comps.map((comp, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(comp.address?.value || comp.address || '')}</td>
      <td>${escapeHtml(comp.salePrice?.value || comp.salePrice || '')}</td>
      <td>${escapeHtml(comp.gla?.value || comp.gla || '')}</td>
      <td>${escapeHtml(comp.saleDate?.value || comp.saleDate || '')}</td>
      <td>${escapeHtml(comp.adjustedPrice?.value || comp.adjustedPrice || '')}</td>
    </tr>
  `).join('');
}

async function saveFacts() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  setButtonBusy(refs.saveFacts, true, 'Saving');

  try {
    await api(`/api/cases/${S.caseId}/facts`, {
      method: 'PUT',
      body: S.facts
    });

    setConnection(true, 'Facts saved');
    showToast('Facts saved successfully.', 'success');
  } catch (error) {
    console.error(error);
    setConnection(false, 'Facts save failed');
    showToast(`Unable to save facts: ${error.message}`, 'error');
  } finally {
    setButtonBusy(refs.saveFacts, false);
  }
}

async function handleIntakeUpload(type, file) {
  // Determine file extension for routing
  var fileExt = (file.name || '').split('.').pop().toLowerCase();
  var isXml = type === 'xml' || fileExt === 'xml';
  var isOrderPdf = type === 'order_sheet' || type === 'order' || (!isXml && fileExt === 'pdf');

  // If we have an active case and the upload is an order PDF or XML,
  // import INTO that case instead of creating a new one.
  var endpoint;
  var importIntoExisting = false;
  if (S.caseId && (isOrderPdf || isXml)) {
    endpoint = isXml
      ? '/api/cases/' + S.caseId + '/import-xml'
      : '/api/cases/' + S.caseId + '/import-order';
    importIntoExisting = true;
  } else {
    endpoint = isXml ? '/api/intake/xml' : '/api/intake/order';
  }

  setDropzoneBusy(type, true);

  refs.importSummary.innerHTML = [
    '<div class="summary-note loading-note">',
    '  <div class="spinner spinner-small"></div>',
    '  <span>' + (importIntoExisting ? 'Extracting order data from ' : 'Importing ') + escapeHtml(file.name) + '&hellip;</span>',
    '</div>',
  ].join('');

  try {
    var formData = new FormData();
    formData.append('file', file);

    var data = await api(endpoint, { method: 'POST', body: formData });
    var caseId = data.caseId || data.id || (data.case && data.case.id) || S.caseId;

    if (caseId) {
      S.caseId = caseId;
      localStorage.setItem('cacc-last-case', caseId);
      await refreshCases();
      await loadCase(caseId, { silent: true });
      renderCaseSelect();
      renderSidebarCases();

      // Build a descriptive toast from the extracted data
      var extracted = data.extracted || {};
      var toastMsg = '';
      if (importIntoExisting && (extracted.address || extracted.borrowerName || extracted.lenderName || extracted.borrower)) {
        var parts = [];
        var addr = extracted.address || '';
        var city = extracted.city || '';
        var state = extracted.state || '';
        var location = addr || (city && state ? city + ', ' + state : city || state);
        if (location) parts.push(location);
        var borrower = extracted.borrowerName || extracted.borrower || extracted.borrower1 || '';
        var lender = extracted.lenderName || extracted.lender || '';
        var people = [borrower, lender].filter(Boolean).join(' / ');
        if (people) parts.push(people);
        toastMsg = parts.length ? 'Extracted: ' + parts.join(' \u2014 ') : file.name + ' imported successfully.';
      } else {
        toastMsg = file.name + ' imported successfully.';
      }
      showToast(toastMsg, 'success');
    }

    renderImportSummary();
  } catch (error) {
    console.error(error);
    refs.importSummary.innerHTML = [
      '<div class="summary-note error-note">',
      '  <strong>Upload failed</strong>',
      '  <span>' + escapeHtml(error.message) + '</span>',
      '</div>',
    ].join('');
    setConnection(false, 'Import failed');
    showToast('Unable to import ' + file.name + ': ' + error.message, 'error');
  } finally {
    setDropzoneBusy(type, false);
  }
}

async function uploadDocuments() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  const files = Array.from(refs.docsInput.files || []);
  if (!files.length) {
    showToast('Choose one or more PDF documents to upload.', 'warning');
    return;
  }

  S.docUploads = files.map((file) => ({ name: file.name, status: 'queued', detail: 'Queued for upload' }));
  renderDocStatus();
  setButtonBusy(refs.uploadDocs, true, 'Uploading');

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const entry = S.docUploads[index];
      const formData = new FormData();
      formData.append('file', file);

      entry.status = 'uploading';
      entry.detail = 'Uploading';
      renderDocStatus();

      try {
        const result = await api(`/api/cases/${S.caseId}/documents/upload`, {
          method: 'POST',
          body: formData
        });

        entry.status = 'done';
        entry.detail = result.type || result.category || 'Classified';
        setConnection(true, 'Document uploaded');
      } catch (error) {
        entry.status = 'error';
        entry.detail = error.message;
        setConnection(false, 'Document upload failed');
      }

      renderDocStatus();
    }

    const failedUploads = S.docUploads.filter((entry) => entry.status === 'error');
    refs.docsInput.value = '';
    refs.docSummary.textContent = `Processed ${files.length} document${files.length === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}.`;
    await loadCase(S.caseId, { silent: true });

    if (failedUploads.length === 0) {
      showToast(`Uploaded ${files.length} supporting document${files.length === 1 ? '' : 's'}.`, 'success');
    } else if (failedUploads.length === files.length) {
      showToast('All document uploads failed. Review the upload status list for details.', 'error');
    } else {
      showToast(`${failedUploads.length} document upload${failedUploads.length === 1 ? '' : 's'} failed. Review the upload status list for details.`, 'warning');
    }
  } finally {
    setButtonBusy(refs.uploadDocs, false);
    renderAll();
  }
}

function renderDocStatus() {
  if (!S.docUploads.length) {
    refs.docStatus.innerHTML = '<div class="empty-inline">No document uploads in progress.</div>';
    return;
  }

  refs.docStatus.innerHTML = S.docUploads.map((entry) => {
    const tone = entry.status === 'done' ? 'success' : entry.status === 'error' ? 'error' : entry.status === 'uploading' ? 'warning' : 'muted';
    const indicator = entry.status === 'uploading'
      ? '<span class="spinner spinner-small"></span>'
      : `<span class="status-bullet ${tone}"></span>`;

    return `
      <div class="status-row">
        <div class="status-row-main">
          ${indicator}
          <strong>${escapeHtml(entry.name)}</strong>
        </div>
        <span class="status-row-detail">${escapeHtml(entry.detail || entry.status)}</span>
      </div>
    `;
  }).join('');
}

function renderGenerateSummary() {
  if (!S.caseMeta || !S.caseId) {
    refs.generateSummary.innerHTML = '<div class="empty-inline">Select a case to view generation details.</div>';
    return;
  }

  const address = getCaseAddress(S.caseMeta) || '�';
  const borrower = getCaseBorrower(S.caseMeta) || '�';
  const formType = getCaseFormType(S.caseMeta) || '�';
  const docs = Object.keys(S.docSummary || {}).length;
  const sectionCount = getSectionEntries().length;

  refs.generateSummary.innerHTML = `
    <div class="summary-card"><span>Address</span><strong>${escapeHtml(address)}</strong></div>
    <div class="summary-card"><span>Borrower</span><strong>${escapeHtml(borrower)}</strong></div>
    <div class="summary-card"><span>Form</span><strong>${escapeHtml(formType)}</strong></div>
    <div class="summary-card"><span>Documents</span><strong>${escapeHtml(String(docs))}</strong></div>
    <div class="summary-card"><span>Existing sections</span><strong>${escapeHtml(String(sectionCount))}</strong></div>
  `;
}

function startGenerationMonitor() {
  stopGenerationMonitor(false);

  S.generation.running = true;
  S.generation.startedAt = Date.now();
  S.generation.stageIndex = 0;
  S.generation.log = [];
  S.generation.lastTone = 'info';
  S.generation.lastMessage = 'Starting generation pipeline…';
  S.generation.totalFields = 0;
  S.generation.completedFields = 0;

  pushGenerationLog('Starting generation pipeline…');

  // Connect SSE for real-time progress
  if (S.caseId) {
    try {
      S.generation.eventSource = new EventSource(`${API_BASE}/api/events/${S.caseId}`);
      S.generation.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleGenerationEvent(data);
        } catch (_) { /* ignore parse errors */ }
      };
      S.generation.eventSource.onerror = () => {
        // SSE connection lost — fall back to timer
        if (!S.generation.timer) {
          S.generation.timer = window.setInterval(() => {
            renderGenerationStatus();
          }, 2500);
        }
      };
    } catch (_) {
      // SSE not available — use timer fallback
      S.generation.timer = window.setInterval(() => {
        renderGenerationStatus();
      }, 2500);
    }
  }

  renderGenerationStatus();
}

function handleGenerationEvent(data) {
  switch (data.type) {
    case 'started':
      S.generation.totalFields = data.totalFields || 0;
      S.generation.completedFields = 0;
      pushGenerationLog(`Generating ${data.totalFields} sections for ${data.formType || 'form'}`);
      break;

    case 'section-start':
      S.generation.lastMessage = `Drafting: ${data.title || data.fieldId}`;
      S.generation.stageIndex = data.index || 0;
      pushGenerationLog(`Drafting ${data.title || data.fieldId} (${(data.index || 0) + 1}/${data.total || '?'})`);
      break;

    case 'section-complete':
      S.generation.completedFields = (data.index || 0) + 1;
      S.generation.lastMessage = `Completed: ${data.title || data.fieldId} (${data.charCount || 0} chars)`;
      pushGenerationLog(`✓ ${data.title || data.fieldId} — ${data.charCount || 0} chars`);
      break;

    case 'section-error':
      S.generation.completedFields = (data.index || 0) + 1;
      pushGenerationLog(`✗ ${data.title || data.fieldId} — ${data.error || 'failed'}`);
      break;

    case 'completed':
      S.generation.lastMessage = `Generated ${data.resultsCount || 0} sections (${data.errorsCount || 0} errors)`;
      S.generation.lastTone = data.errorsCount > 0 ? 'warning' : 'success';
      pushGenerationLog(`Generation complete: ${data.resultsCount} sections`);
      break;
  }

  renderGenerationStatus();
}

function stopGenerationMonitor(resetMessage = true) {
  if (S.generation.timer) {
    window.clearInterval(S.generation.timer);
    S.generation.timer = null;
  }

  if (S.generation.eventSource) {
    S.generation.eventSource.close();
    S.generation.eventSource = null;
  }

  S.generation.running = false;
  if (resetMessage && !S.generation.lastMessage) {
    S.generation.lastMessage = 'Ready to generate when you are.';
    S.generation.lastTone = 'muted';
  }
}

function pushGenerationLog(message) {
  S.generation.log.unshift({ message, time: new Date().toLocaleTimeString() });
  S.generation.log = S.generation.log.slice(0, 5);
}

function renderGenerationStatus() {
  const generatedSections = getSectionEntries().length;
  const totalFields = S.generation.totalFields || Math.max(1, S.generation.stages.length - 1);
  const completed = S.generation.completedFields || S.generation.stageIndex;
  const runningProgress = totalFields > 0 ? Math.round((completed / totalFields) * 100) : 0;
  const progress = S.generation.running ? Math.max(5, runningProgress) : (generatedSections ? 100 : 0);

  refs.generationProgressFill.style.width = `${progress}%`;
  refs.generateStatus.textContent = S.generation.running
    ? `${S.generation.stages[S.generation.stageIndex]} � ${formatElapsed(S.generation.startedAt)}`
    : S.generation.lastMessage;

  refs.generateStatus.className = '';
  refs.generateStatus.classList.add(`tone-${S.generation.lastTone || 'muted'}`);

  const items = S.generation.log.length
    ? S.generation.log
    : [{ message: generatedSections ? 'Generated content is ready for review.' : 'Waiting for generation to start.', time: '' }];

  refs.generationFeed.innerHTML = items.map((item) => `
    <div class="generation-feed-item ${S.generation.running ? 'is-live' : ''}">
      <span class="generation-feed-dot"></span>
      <div>
        <strong>${escapeHtml(item.message)}</strong>
        <span>${escapeHtml(item.time || 'Idle')}</span>
      </div>
    </div>
  `).join('');
}

async function generateAll() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  setButtonBusy(refs.generateButton, true, 'Generating');
  startGenerationMonitor();

  try {
    const result = await api(`/api/cases/${S.caseId}/generate-all`, {
      method: 'POST',
      body: { twoPass: true, forceGateBypass: true }
    });

    const sections = result.results || result.sections || {};
    const count = Object.keys(sections).length || result.count || 0;

    pushGenerationLog(`Generated ${count} section${count === 1 ? '' : 's'}`);
    S.generation.lastMessage = `Generated ${count} section${count === 1 ? '' : 's'} successfully.`;
    S.generation.lastTone = 'success';
    stopGenerationMonitor(false);

    await loadCase(S.caseId, { silent: true });
    renderGenerationStatus();
    showToast(`Generation complete. ${count} section${count === 1 ? '' : 's'} ready for review.`, 'success');

    window.setTimeout(() => gotoStep(4), 700);
  } catch (error) {
    console.error(error);
    const detail = error.data?.gate?.blockers?.map((item) => item.message).join('; ') || error.message;
    pushGenerationLog(`Generation failed: ${detail}`);
    S.generation.lastMessage = `Generation failed: ${detail}`;
    S.generation.lastTone = 'error';
    stopGenerationMonitor(false);
    renderGenerationStatus();
    setConnection(false, 'Generation failed');
    showToast(`Generation failed: ${detail}`, 'error');
  } finally {
    setButtonBusy(refs.generateButton, false);
  }
}

// ── Generate Full Report (modal with per-section progress) ─────────────────

var _fullReportAbortController = null;

var FULL_REPORT_SECTIONS_FALLBACK = [
  { id: 'neighborhood_description', title: 'Neighborhood Description' },
  { id: 'site_description', title: 'Site Description' },
  { id: 'improvements_description', title: 'Improvements Description' },
  { id: 'highest_best_use', title: 'Highest & Best Use' },
  { id: 'sales_comparison', title: 'Sales Comparison' },
  { id: 'reconciliation_narrative', title: 'Reconciliation Narrative' },
  { id: 'scope_of_work', title: 'Scope of Work' },
  { id: 'conditions_of_appraisal', title: 'Conditions of Appraisal' },
  { id: 'market_conditions', title: 'Market Conditions' },
  { id: 'functional_utility', title: 'Functional Utility' },
  { id: 'contract_analysis', title: 'Contract Analysis' },
  { id: 'prior_sales_subject', title: 'Prior Sales of Subject' },
];

async function getFullReportSections() {
  var formType = getCaseFormType(S.caseMeta) || '1004';
  try {
    var config = await api('/api/forms/' + formType);
    if (config && Array.isArray(config.fields) && config.fields.length > 0) {
      return config.fields.map(function(f) { return { id: f.id, title: f.title }; });
    }
  } catch (_) { /* fall back to default */ }
  return FULL_REPORT_SECTIONS_FALLBACK;
}

function openGenerateReportModal(sections) {
  var list = refs.genModalSectionList;
  list.innerHTML = '';
  sections.forEach(function(sec) {
    var row = document.createElement('div');
    row.className = 'gen-section-row status-pending';
    row.id = 'gen-row-' + sec.id;
    row.innerHTML = '<div class="gen-section-icon">·</div>' +
      '<span class="gen-section-name">' + escapeHtml(sec.title) + '</span>' +
      '<span class="gen-section-meta gen-section-meta-' + sec.id + '">Pending</span>';
    list.appendChild(row);
  });
  refs.genModalProgressFill.style.width = '0%';
  refs.genModalSubtitle.textContent = 'Generating all narrative sections sequentially…';
  refs.genModalFooter.classList.add('hidden');
  refs.genModalStop.disabled = false;
  refs.genModalStop.textContent = 'Stop';
  refs.generateReportModal.classList.remove('hidden');
}

function closeGenerateReportModal() {
  refs.generateReportModal.classList.add('hidden');
  if (_fullReportAbortController) {
    _fullReportAbortController.abort();
    _fullReportAbortController = null;
  }
}

function stopFullReportGeneration() {
  if (_fullReportAbortController) {
    _fullReportAbortController.abort();
    _fullReportAbortController = null;
  }
  refs.genModalStop.disabled = true;
  refs.genModalStop.textContent = 'Stopping…';
  refs.genModalSubtitle.textContent = 'Generation stopped.';
  refs.genModalFooter.classList.remove('hidden');
  refs.genModalTime.textContent = '';
  refs.genModalDone.textContent = 'Close';
}

function updateGenSectionRow(sectionId, status, meta) {
  var row = document.getElementById('gen-row-' + sectionId);
  if (!row) return;
  row.className = 'gen-section-row status-' + status;
  var iconEl = row.querySelector('.gen-section-icon');
  var metaEl = row.querySelector('.gen-section-meta');
  if (status === 'generating') {
    iconEl.innerHTML = '<div class="spinner spinner-small"></div>';
    if (metaEl) metaEl.textContent = 'Generating…';
  } else if (status === 'done') {
    iconEl.textContent = '✓';
    if (metaEl) metaEl.textContent = meta || 'Done';
  } else if (status === 'error') {
    iconEl.textContent = '✗';
    if (metaEl) metaEl.textContent = meta || 'Error';
  } else {
    iconEl.textContent = '·';
    if (metaEl) metaEl.textContent = 'Pending';
  }
}

async function generateFullReport() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  var sections = await getFullReportSections();
  openGenerateReportModal(sections);

  var startedAt = Date.now();
  var abortCtrl = new AbortController();
  _fullReportAbortController = abortCtrl;

  // Connect SSE for per-section progress updates
  var sseSource = null;
  var sectionStatuses = {};
  sections.forEach(function(s) { sectionStatuses[s.id] = 'pending'; });

  function handleFullReportSSE(data) {
    if (!data || !data.type) return;
    var total = sections.length;
    var done = Object.values(sectionStatuses).filter(function(v) { return v === 'done' || v === 'error'; }).length;

    if (data.type === 'section-start' && data.fieldId) {
      sectionStatuses[data.fieldId] = 'generating';
      updateGenSectionRow(data.fieldId, 'generating', null);
      var pct = Math.round((done / total) * 100);
      refs.genModalProgressFill.style.width = pct + '%';
      refs.genModalSubtitle.textContent = 'Generating: ' + (data.title || data.fieldId) + ' (' + (done + 1) + '/' + total + ')';
    } else if (data.type === 'section-complete' && data.fieldId) {
      sectionStatuses[data.fieldId] = 'done';
      var chars = data.charCount ? data.charCount + ' chars' : 'Done';
      updateGenSectionRow(data.fieldId, 'done', chars);
      done = Object.values(sectionStatuses).filter(function(v) { return v === 'done' || v === 'error'; }).length;
      var pct2 = Math.round((done / total) * 100);
      refs.genModalProgressFill.style.width = pct2 + '%';
    } else if (data.type === 'section-error' && data.fieldId) {
      sectionStatuses[data.fieldId] = 'error';
      updateGenSectionRow(data.fieldId, 'error', data.error || 'Failed');
      done = Object.values(sectionStatuses).filter(function(v) { return v === 'done' || v === 'error'; }).length;
      var pct3 = Math.round((done / total) * 100);
      refs.genModalProgressFill.style.width = pct3 + '%';
    } else if (data.type === 'completed') {
      refs.genModalProgressFill.style.width = '100%';
    }
  }

  try {
    sseSource = new EventSource(API_BASE + '/api/events/' + S.caseId);
    sseSource.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        handleFullReportSSE(data);
      } catch (_) {}
    };
  } catch (_) {
    // SSE unavailable, modal will still work via response
  }

  try {
    var result = await api('/api/cases/' + S.caseId + '/generate-all', {
      method: 'POST',
      body: { forceGateBypass: true },
      signal: abortCtrl.signal
    });

    if (sseSource) { sseSource.close(); sseSource = null; }

    // Mark any remaining sections based on result
    var resultSections = result.results || {};
    var errorSections = result.errors || {};
    sections.forEach(function(sec) {
      if (resultSections[sec.id]) {
        updateGenSectionRow(sec.id, 'done', resultSections[sec.id].text ? (resultSections[sec.id].text.length + ' chars') : 'Done');
      } else if (errorSections[sec.id]) {
        updateGenSectionRow(sec.id, 'error', errorSections[sec.id]);
      }
    });

    refs.genModalProgressFill.style.width = '100%';
    var elapsed = Math.round((Date.now() - startedAt) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    var timeStr = mins > 0 ? (mins + 'm ' + secs + 's') : (secs + 's');
    var count = Object.keys(resultSections).length;
    var errCount = Object.keys(errorSections).length;

    refs.genModalSubtitle.textContent = 'Complete! ' + count + ' section' + (count === 1 ? '' : 's') + ' generated' + (errCount ? ', ' + errCount + ' errors' : '') + '.';
    refs.genModalTime.textContent = 'Total time: ' + timeStr;
    refs.genModalStop.disabled = true;
    refs.genModalStop.classList.add('hidden');
    refs.genModalDone.textContent = 'Review sections →';
    refs.genModalFooter.classList.remove('hidden');

    // Reload case so sections show up in review step
    await loadCase(S.caseId, { silent: true });
    showToast('Full report generated! ' + count + ' sections ready for review.', 'success');
  } catch (err) {
    if (sseSource) { sseSource.close(); sseSource = null; }
    if (err && err.name === 'AbortError') return; // user stopped it
    console.error('[generateFullReport]', err);
    var detail = (err && err.data && err.data.gate && err.data.gate.blockers)
      ? err.data.gate.blockers.map(function(b) { return b.message; }).join('; ')
      : (err && err.message) || 'Unknown error';
    refs.genModalSubtitle.textContent = 'Generation failed: ' + detail;
    refs.genModalStop.disabled = true;
    refs.genModalFooter.classList.remove('hidden');
    refs.genModalTime.textContent = '';
    refs.genModalDone.textContent = 'Close';
    showToast('Generation failed: ' + detail, 'error');
  } finally {
    _fullReportAbortController = null;
  }
}

function renderReviewSummary() {
  const entries = getSectionEntries();
  const approved = entries.filter(([, payload]) => payload.approved).length;
  const pending = Math.max(entries.length - approved, 0);

  refs.reviewSummary.innerHTML = `
    <span class="review-chip">${entries.length} total</span>
    <span class="review-chip success">${approved} approved</span>
    <span class="review-chip warning">${pending} pending</span>
  `;
}

function renderSections() {
  if (!S.caseId) {
    refs.sectionsList.innerHTML = `
      <div class="empty-state compact">
        <h3>No case selected</h3>
        <p>Select a case to review generated narrative sections.</p>
      </div>
    `;
    return;
  }

  const allEntries = getSectionEntries();
  const entries = allEntries.filter(([fieldId, payload]) => {
    if (!S.reviewQuery) return true;

    const haystack = [fieldId, prettify(fieldId), payload.text]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(S.reviewQuery);
  });

  if (!allEntries.length) {
    refs.sectionsList.innerHTML = `
      <div class="empty-state compact">
        <h3>No generated sections yet</h3>
        <p>Run generation to populate the review workspace.</p>
      </div>
    `;
    return;
  }

  if (!entries.length) {
    refs.sectionsList.innerHTML = `
      <div class="empty-state compact">
        <h3>No matching sections</h3>
        <p>Adjust your review search to see more content.</p>
      </div>
    `;
    return;
  }

  refs.sectionsList.innerHTML = entries.map(([fieldId, payload]) => {
    const status = getSectionStatusMeta(payload);
    const text = payload.text || '';
    const charCount = text.length;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const charClass = charCount < 100 ? 'tone-error' : charCount < 300 ? 'tone-muted' : 'tone-success';
    const updatedAt = formatDateTime(payload.updatedAt);
    const dirty = payload._dirty ? '<span class="review-chip muted">Unsaved edits</span>' : '';

    return `
      <article class="section-card" data-field-card="${escapeAttr(fieldId)}">
        <div class="section-card-head">
          <div>
            <h3>${escapeHtml(prettify(fieldId))}</h3>
            <p>${escapeHtml(fieldId)}</p>
          </div>
          <div class="section-card-status">
            <span class="status-pill ${status.className}">${escapeHtml(status.label)}</span>
            ${dirty}
          </div>
        </div>
        <textarea class="section-editor" data-field="${escapeAttr(fieldId)}">${escapeHtml(payload.text || '')}</textarea>
        <div class="section-card-footer">
          <div class="section-meta">
            <span class="section-char-count ${charClass}">${escapeHtml(String(charCount))} chars · ${escapeHtml(String(wordCount))} words</span>
            <span class="section-updated">${escapeHtml(updatedAt || 'Not saved yet')}</span>
          </div>
          <div class="section-actions">
            <button class="btn btn-ghost" type="button" data-regenerate="${escapeAttr(fieldId)}" title="Re-draft this section with AI">↺ Regenerate</button>
            <button class="btn btn-secondary" type="button" data-save-section="${escapeAttr(fieldId)}">Save</button>
            <button class="btn btn-ghost" type="button" data-reject="${escapeAttr(fieldId)}">Reject</button>
            <button class="btn btn-primary" type="button" data-approve="${escapeAttr(fieldId)}">Approve</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function updateSectionCardMeta(card, fieldId) {
  const payload = S.outputs[fieldId] || {};
  const countEl = card.querySelector('.section-char-count');
  const updatedEl = card.querySelector('.section-updated');
  const statusWrap = card.querySelector('.section-card-status');
  const currentStatus = getSectionStatusMeta(payload);

  const t = payload.text || '';
  const wc = t.trim() ? t.trim().split(/\s+/).length : 0;
  const cc = t.length;
  const ccClass = cc < 100 ? 'tone-error' : cc < 300 ? 'tone-muted' : 'tone-success';
  if (countEl) { countEl.textContent = `${cc} chars · ${wc} words`; countEl.className = `section-char-count ${ccClass}`; }
  if (updatedEl) updatedEl.textContent = payload._dirty ? 'Unsaved changes' : (formatDateTime(payload.updatedAt) || 'Not saved yet');

  if (statusWrap) {
    statusWrap.innerHTML = `
      <span class="status-pill ${currentStatus.className}">${escapeHtml(currentStatus.label)}</span>
      ${payload._dirty ? '<span class="review-chip muted">Unsaved edits</span>' : ''}
    `;
  }
}

function getSectionEntries() {
  return Object.entries(S.outputs || {}).filter(([, payload]) => {
    return payload && typeof payload === 'object' && typeof payload.text === 'string' && payload.text.trim().length > 0;
  });
}

function getSectionStatusMeta(payload = {}) {
  const rawStatus = payload.approved ? 'approved' : (payload.sectionStatus || payload.status || 'drafted');

  switch (rawStatus) {
    case 'approved':
      return { label: 'Approved', className: 'success' };
    case 'inserted':
      return { label: 'Inserted', className: 'info' };
    case 'verified':
      return { label: 'Verified', className: 'info' };
    case 'reviewed':
      return { label: 'Needs revision', className: 'warning' };
    case 'error':
      return { label: 'Error', className: 'danger' };
    default:
      return { label: 'Drafted', className: 'muted' };
  }
}

async function saveSection(fieldId, button, { toast = true } = {}) {
  if (!S.caseId) return false;

  const text = (S.outputs[fieldId] && S.outputs[fieldId].text) || '';
  if (!text.trim()) {
    showToast(`Section ${prettify(fieldId)} is empty.`, 'warning');
    return false;
  }

  setButtonBusy(button, true, 'Saving');

  try {
    await api(`/api/cases/${S.caseId}/outputs/${fieldId}`, {
      method: 'PATCH',
      body: { text }
    });

    if (!S.outputs[fieldId]) S.outputs[fieldId] = {};
    S.outputs[fieldId]._dirty = false;
    S.outputs[fieldId].updatedAt = new Date().toISOString();

    const card = refs.sectionsList.querySelector(`[data-field-card="${cssEscape(fieldId)}"]`);
    if (card) updateSectionCardMeta(card, fieldId);

    renderReviewSummary();
    renderInsertSummary();

    if (toast) showToast(`${prettify(fieldId)} saved.`, 'success');
    return true;
  } catch (error) {
    console.error(error);
    showToast(`Unable to save ${prettify(fieldId)}: ${error.message}`, 'error');
    return false;
  } finally {
    setButtonBusy(button, false);
  }
}

async function approveSection(fieldId, button) {
  if (!S.caseId) return;

  const saved = await saveSection(fieldId, null, { toast: false });
  if (!saved) return;

  setButtonBusy(button, true, 'Approving');

  try {
    await api(`/api/cases/${S.caseId}/sections/${fieldId}/status`, {
      method: 'PATCH',
      body: { status: 'approved' }
    });

    await loadCase(S.caseId, { silent: true });
    showToast(`${prettify(fieldId)} approved.`, 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to approve ${prettify(fieldId)}: ${error.message}`, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function rejectSection(fieldId, button) {
  if (!S.caseId) return;

  const saved = await saveSection(fieldId, null, { toast: false });
  if (!saved) return;

  setButtonBusy(button, true, 'Rejecting');

  try {
    await api(`/api/cases/${S.caseId}/sections/${fieldId}/status`, {
      method: 'PATCH',
      body: { status: 'reviewed', notes: 'Rejected for revision from frontend review workspace.' }
    });

    await loadCase(S.caseId, { silent: true });
    showToast(`${prettify(fieldId)} marked for revision.`, 'info');
  } catch (error) {
    console.error(error);
    showToast(`Unable to reject ${prettify(fieldId)}: ${error.message}`, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function regenerateSection(fieldId, button) {
  if (!S.caseId) return;

  setButtonBusy(button, true, 'Generating…');

  try {
    const result = await api(`/api/cases/${S.caseId}/generate-core`, {
      method: 'POST',
      body: { fields: [fieldId], forceGateBypass: true }
    });

    const text = result.results?.[fieldId]?.text || result.text || '';
    if (text) {
      if (!S.outputs[fieldId]) S.outputs[fieldId] = {};
      S.outputs[fieldId].text = text;
      S.outputs[fieldId]._dirty = true;
      S.outputs[fieldId].sectionStatus = 'drafted';
      S.outputs[fieldId].approved = false;

      // Update the textarea directly
      const card = refs.sectionsList.querySelector(`[data-field-card="${cssEscape(fieldId)}"]`);
      if (card) {
        const textarea = card.querySelector(`textarea[data-field="${cssEscape(fieldId)}"]`);
        if (textarea) textarea.value = text;
        updateSectionCardMeta(card, fieldId);
      }

      renderReviewSummary();
      showToast(`${prettify(fieldId)} regenerated. Review and approve.`, 'success');
    } else {
      showToast(`Regeneration returned no text for ${prettify(fieldId)}.`, 'warning');
    }
  } catch (error) {
    console.error(error);
    const detail = error.data?.gate?.blockers?.map(b => b.message).join('; ') || error.message;
    showToast(`Regeneration failed: ${detail}`, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function approveAllSections() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  const entries = getSectionEntries();
  if (!entries.length) {
    showToast('No generated sections to approve.', 'warning');
    return;
  }

  setButtonBusy(refs.approveAll, true, 'Approving');

  try {
    for (const [fieldId, payload] of entries) {
      await api(`/api/cases/${S.caseId}/outputs/${fieldId}`, {
        method: 'PATCH',
        body: { text: payload.text || '' }
      });

      await api(`/api/cases/${S.caseId}/sections/${fieldId}/status`, {
        method: 'PATCH',
        body: { status: 'approved' }
      });
    }

    await loadCase(S.caseId, { silent: true });
    showToast(`Approved ${entries.length} section${entries.length === 1 ? '' : 's'}.`, 'success');
  } catch (error) {
    console.error(error);
    showToast(`Unable to approve all sections: ${error.message}`, 'error');
  } finally {
    setButtonBusy(refs.approveAll, false);
  }
}

function renderInsertSummary() {
  const entries = getSectionEntries();
  const approved = entries.filter(([, payload]) => payload.approved).length;

  refs.insertSummary.innerHTML = entries.length
    ? `
      <div class="summary-card-grid">
        <div class="summary-card"><span>Approved</span><strong>${approved}</strong></div>
        <div class="summary-card"><span>Total sections</span><strong>${entries.length}</strong></div>
        <div class="summary-card"><span>Ready rate</span><strong>${entries.length ? Math.round((approved / entries.length) * 100) : 0}%</strong></div>
      </div>
    `
    : `
      <div class="empty-state compact">
        <h3>No sections ready</h3>
        <p>Generate and approve narratives before inserting them into ACI.</p>
      </div>
    `;

  refs.insertChecklist.innerHTML = `
    <div class="checklist-item ${S.caseId ? 'is-complete' : ''}"><span></span>Case selected</div>
    <div class="checklist-item ${entries.length ? 'is-complete' : ''}"><span></span>Generated sections available</div>
    <div class="checklist-item ${approved > 0 ? 'is-complete' : ''}"><span></span>Approved sections ready</div>
  `;
}

async function insertAll() {
  if (!S.caseId) {
    showToast('Select a case first.', 'warning');
    return;
  }

  refs.insertResults.innerHTML = '<div class="summary-note loading-note"><div class="spinner spinner-small"></div><span>Running QC checks</span></div>';
  setButtonBusy(refs.insertButton, true, 'Inserting');

  try {
    await api('/api/qc/run', {
      method: 'POST',
      body: { caseId: S.caseId }
    });
    refs.insertResults.innerHTML = '<div class="summary-note loading-note"><div class="spinner spinner-small"></div><span>Inserting approved sections into ACI</span></div>';

    const result = await api(`/api/cases/${S.caseId}/insert-all`, {
      method: 'POST',
      body: { skipQcBlockers: true }
    });

    renderInsertResults(result);
    await loadCase(S.caseId, { silent: true });

    const insertedCount = result.inserted || (result.insertedSections || []).length;
    const errorCount = (result.errors || []).length;
    const skippedCount = (result.skipped || []).length;

    if (errorCount > 0 && insertedCount === 0) {
      showToast(`Insertion finished with ${errorCount} error${errorCount === 1 ? '' : 's'}.`, 'error');
    } else if (errorCount > 0 || skippedCount > 0) {
      showToast(`Inserted ${insertedCount} section(s) with ${errorCount} error${errorCount === 1 ? '' : 's'} and ${skippedCount} skipped.`, 'warning');
    } else {
      showToast(`Inserted ${insertedCount} section(s) into ACI.`, 'success');
    }
  } catch (error) {
    console.error(error);
    refs.insertResults.innerHTML = `
      <div class="summary-note error-note">
        <strong>Insertion failed</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
    showToast(`Insertion failed: ${error.message}`, 'error');
  } finally {
    setButtonBusy(refs.insertButton, false);
  }
}

function renderInsertResults(result = {}) {
  const insertedSections = result.insertedSections || [];
  const skipped = result.skipped || [];
  const errors = result.errors || [];

  refs.insertResults.innerHTML = `
    <div class="results-summary">
      <strong>${escapeHtml(String(result.inserted || insertedSections.length))} section${(result.inserted || insertedSections.length) === 1 ? '' : 's'} inserted</strong>
      <span>ACI insertion finished at ${escapeHtml(new Date().toLocaleTimeString())}</span>
    </div>
    ${insertedSections.length ? insertedSections.map((item) => `
      <div class="result-row success">
        <strong>${escapeHtml(item.title || item.fieldId || 'Section')}</strong>
        <span>${escapeHtml(String(item.charCount || 0))} chars inserted</span>
      </div>
    `).join('') : ''}
    ${skipped.length ? `<div class="results-group-title">Skipped</div>${skipped.map((item) => `
      <div class="result-row muted">
        <strong>${escapeHtml(item.fieldId || 'Section')}</strong>
        <span>${escapeHtml(item.reason || 'Skipped')}</span>
      </div>
    `).join('')}` : ''}
    ${errors.length ? `<div class="results-group-title">Errors</div>${errors.map((item) => `
      <div class="result-row danger">
        <strong>${escapeHtml(item.fieldId || item.field || 'Section')}</strong>
        <span>${escapeHtml(item.message || item.error || 'Unknown error')}</span>
      </div>
    `).join('')}` : ''}
  `;
}

function setConnection(ok, message) {
  refs.connectionBadge.classList.toggle('offline', !ok);
  refs.statusDot.classList.toggle('offline', !ok);
  refs.connectionText.textContent = message;
}

function setRefreshButtonsBusy(isBusy) {
  setButtonBusy(refs.refreshCases, isBusy, 'Refreshing');
  setButtonBusy(refs.headerRefresh, isBusy, 'Refreshing');
}

function setButtonBusy(button, isBusy, busyLabel = 'Working') {
  if (!button) return;

  if (isBusy) {
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.disabled = true;
    button.dataset.busy = 'true';
    button.textContent = busyLabel;
    return;
  }

  button.disabled = false;
  button.dataset.busy = 'false';
  if (button.dataset.defaultLabel) button.textContent = button.dataset.defaultLabel;
}

function setDropzoneBusy(type, isBusy) {
  const zone = document.querySelector(`.dropzone[data-type="${type}"]`);
  if (!zone) return;

  zone.classList.toggle('is-busy', isBusy);
  const button = zone.querySelector('button');
  if (button) setButtonBusy(button, isBusy, 'Uploading');
}

function setGlobalLoading(isVisible, message = 'Working') {
  refs.globalLoading.classList.toggle('hidden', !isVisible);
  refs.globalLoadingText.textContent = message;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<strong>${escapeHtml(prettify(type))}</strong><span>${escapeHtml(message)}</span>`;
  refs.toastRegion.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 220);
  }, 3600);
}

function getCaseSummary(item = {}) {
  return {
    id: item.caseId || item.id || item._id || item.case_id || '',
    address: getCaseAddress(item),
    borrower: getCaseBorrower(item),
    formType: getCaseFormType(item),
    workflowStatus: item.workflowStatus || item.status || item.meta?.workflowStatus || 'new',
    updatedAt: item.updatedAt || item.meta?.updatedAt || item.createdAt || ''
  };
}

function getCaseAddress(item = {}) {
  return item.address || item.subject?.address?.value || item.subject?.address || item.meta?.address || item.assignment?.propertyAddress?.value || '';
}

function getCaseBorrower(item = {}) {
  return item.borrower || item.borrowerName || item.subject?.borrower || item.assignment?.borrower?.value || item.meta?.borrower || '';
}

function getCaseLender(item = {}) {
  return item.lender || item.assignment?.lender?.value || item.meta?.lender || '';
}

function getCaseFormType(item = {}) {
  return item.formType || item.assignment?.formType?.value || item.meta?.formType || '';
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatElapsed(startedAt) {
  if (!startedAt) return 'Starting';
  const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  return `${seconds}s elapsed`;
}

function prettify(value = '') {
  return String(value)
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
