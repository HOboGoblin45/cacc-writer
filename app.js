const API_BASE = 'http://localhost:5178';
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
}

function restoreUiPrefs() {
  S.ui.sidebarCollapsed = localStorage.getItem('cacc-sidebar-collapsed') === '1';
  document.body.classList.toggle('sidebar-collapsed', S.ui.sidebarCollapsed);
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
    }
  });
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
    options.push(`<option value="${escapeAttr(summary.id)}">${escapeHtml(summary.address || 'Untitled case')} · ${escapeHtml(summary.borrower || 'Unknown borrower')}</option>`);
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
  if (!S.caseMeta || !S.caseId) {
    refs.headerCaseTitle.textContent = 'Select a case to begin';
    refs.headerCaseMeta.textContent = 'Import a new XML and order package or open an existing case from the sidebar.';
    refs.heroCaseId.textContent = '--';
    refs.heroCaseForm.textContent = 'Form --';
    refs.heroDocCount.textContent = '0';
    refs.heroSectionCount.textContent = '0';
    refs.heroApprovedCount.textContent = '0 approved';
    return;
  }

  const address = getCaseAddress(S.caseMeta) || 'Untitled case';
  const borrower = getCaseBorrower(S.caseMeta) || 'Unknown borrower';
  const formType = getCaseFormType(S.caseMeta) || '--';
  const workflowStatus = prettify(S.caseMeta.workflowStatus || 'in progress');
  const sectionCount = getSectionEntries().length;
  const approvedCount = Object.values(S.outputs || {}).filter((item) => item && item.approved).length;

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

  const address = getCaseAddress(S.caseMeta) || '—';
  const borrower = getCaseBorrower(S.caseMeta) || '—';
  const lender = getCaseLender(S.caseMeta) || '—';
  const formType = getCaseFormType(S.caseMeta) || '—';
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
  const endpoint = type === 'xml' ? '/api/intake/xml' : '/api/intake/order';
  setDropzoneBusy(type, true);

  refs.importSummary.innerHTML = `
    <div class="summary-note loading-note">
      <div class="spinner spinner-small"></div>
      <span>Uploading ${escapeHtml(file.name)}</span>
    </div>
  `;

  try {
    const formData = new FormData();
    formData.append('file', file);

    const data = await api(endpoint, { method: 'POST', body: formData });
    const caseId = data.caseId || data.id || data.case?.id || S.caseId;

    if (caseId) {
      S.caseId = caseId;
      localStorage.setItem('cacc-last-case', caseId);
      await refreshCases();
      await loadCase(caseId, { silent: true });
      renderCaseSelect();
      renderSidebarCases();
      showToast(`${file.name} imported successfully.`, 'success');
    }

    renderImportSummary();
  } catch (error) {
    console.error(error);
    refs.importSummary.innerHTML = `
      <div class="summary-note error-note">
        <strong>Upload failed</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
    setConnection(false, 'Import failed');
    showToast(`Unable to import ${file.name}: ${error.message}`, 'error');
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

    refs.docsInput.value = '';
    refs.docSummary.textContent = `Processed ${files.length} document${files.length === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}.`;
    await loadCase(S.caseId, { silent: true });
    showToast(`Uploaded ${files.length} supporting document${files.length === 1 ? '' : 's'}.`, 'success');
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

  const address = getCaseAddress(S.caseMeta) || '—';
  const borrower = getCaseBorrower(S.caseMeta) || '—';
  const formType = getCaseFormType(S.caseMeta) || '—';
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
  S.generation.lastMessage = S.generation.stages[0];

  pushGenerationLog(S.generation.stages[0]);

  S.generation.timer = window.setInterval(() => {
    const nextIndex = Math.min(S.generation.stageIndex + 1, S.generation.stages.length - 1);
    if (nextIndex !== S.generation.stageIndex) {
      S.generation.stageIndex = nextIndex;
      pushGenerationLog(S.generation.stages[nextIndex]);
    }
    renderGenerationStatus();
  }, 2500);

  renderGenerationStatus();
}

function stopGenerationMonitor(resetMessage = true) {
  if (S.generation.timer) {
    window.clearInterval(S.generation.timer);
    S.generation.timer = null;
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
  const stageTotal = Math.max(1, S.generation.stages.length - 1);
  const runningProgress = 20 + Math.round((S.generation.stageIndex / stageTotal) * 65);
  const progress = S.generation.running ? runningProgress : (generatedSections ? 100 : 0);

  refs.generationProgressFill.style.width = `${progress}%`;
  refs.generateStatus.textContent = S.generation.running
    ? `${S.generation.stages[S.generation.stageIndex]} · ${formatElapsed(S.generation.startedAt)}`
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
    const charCount = String((payload.text || '').length);
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
            <span class="section-char-count">${escapeHtml(charCount)} chars</span>
            <span class="section-updated">${escapeHtml(updatedAt || 'Not saved yet')}</span>
          </div>
          <div class="section-actions">
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

  if (countEl) countEl.textContent = `${(payload.text || '').length} chars`;
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
    showToast(`Inserted ${result.inserted || (result.insertedSections || []).length} section(s) into ACI.`, 'success');
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
