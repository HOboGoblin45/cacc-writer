// ====== CONSTANTS & STATE ======
const DEFAULT_SERVER = 'http://localhost:5178';
const FORM_CONFIGS_CACHE = {};
const STATE = {
  caseId: null,
  facts: {},
  provenance: {},
  outputs: {},
  caseRecord: null,
  factsObj: null,
  questionnaire: [],
  formType: '1004',
  formConfig: null,
  meta: {},                    // assignment metadata (new)
  _pendingGenFields: null,     // fields waiting for missing-facts confirmation
};

// ====== UTILS ======
const $ = id => document.getElementById(id);
const esc = s => (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const server = () => DEFAULT_SERVER;
function setStatus(id, msg, kind='') { const el=$(id); if(!el)return; el.className='status '+kind; el.textContent=msg; }
function showErr(id, text) { const el=$(id); if(!el)return; el.style.display=text?'block':'none'; el.textContent=text||''; }
const CACC_API_KEY = 'cacc-local-key-2026';
async function apiFetch(path, opts={}) {
  const timeout=opts.timeout??120000, ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),timeout);
  try {
    const r=await fetch(server()+path,{headers:{'Content-Type':'application/json','X-API-Key':CACC_API_KEY},...opts,signal:ctrl.signal,body:opts.body?(typeof opts.body==='string'?opts.body:JSON.stringify(opts.body)):undefined});
    const text=await r.text();
    try{return JSON.parse(text);}catch{return{ok:false,error:'Non-JSON: '+text.slice(0,300)};}
  } catch(e) {
    if(e.name==='AbortError')return{ok:false,error:'Request timed out after '+(timeout/1000)+'s'};
    throw e;
  } finally { clearTimeout(timer); }
}

// ====== TABS ======
// Tools dropdown: primary tabs shown in main nav; all others accessible via dropdown
const PRIMARY_TABS = ['intake','case','workspace','voice'];
const TOOLS_TAB_LABELS = {
  generate:'⚡ Generate', facts:'📋 Facts', qc:'✅ QC Grade', docs:'📁 Docs',
  intel:'🔍 Intel', valuation:'💰 Valuation', memory:'🧠 Memory', pipeline:'🔄 Pipeline',
  inspect:'🔬 Inspect', governance:'📜 Governance', learning:'📖 Learning', system:'⚙️ System'
};

function showTab(name) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const tabPage = $('tab-'+name);
  if(tabPage) tabPage.classList.add('active');
  // Update primary nav tabs
  document.querySelectorAll('.primary-nav .tab[data-tab]').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab===name);
  });
  // Mark Tools button active if a tools-tab is selected
  const isToolsTab = !PRIMARY_TABS.includes(name);
  const toolsBtn = $('toolsMenuBtn');
  if(toolsBtn) {
    toolsBtn.classList.toggle('active', isToolsTab);
    const lbl = $('toolsMenuLabel');
    if(lbl) lbl.textContent = isToolsTab && TOOLS_TAB_LABELS[name] ? TOOLS_TAB_LABELS[name]+' ' : '';
  }
  // Highlight active item in dropdown
  document.querySelectorAll('.tools-dropdown-item').forEach(item=>{
    item.classList.toggle('active-tool', item.getAttribute('onclick')?.includes("'"+name+"'"));
  });
  closeToolsMenu();
  if(name==='workspace' && typeof workspaceOnTabOpen==='function')workspaceOnTabOpen();
  if(name==='facts')loadNeighborhoodTemplates();
  if(name==='voice'){loadVoiceExamples();setTimeout(refreshVoiceLibrary,200);}
  if(name==='docs')loadDocsTab();
  if(name==='memory')memLoadAll();
  if(name==='qc')qcOnTabOpen();
  if(name==='valuation' && typeof valOnTabOpen==='function')valOnTabOpen();
  if(name==='governance' && typeof govOnTabOpen==='function')govOnTabOpen();
  if(name==='learning' && typeof lrnOnTabOpen==='function')lrnOnTabOpen();
  if(name==='pipeline' && typeof dpOnTabOpen==='function')dpOnTabOpen();
  if(name==='inspect' && typeof inspOnTabOpen==='function')inspOnTabOpen();
  if(name==='system' && typeof sysOnTabOpen==='function')sysOnTabOpen();
}

// Tools dropdown controls
function toggleToolsMenu(e) {
  if(e) e.stopPropagation();
  const dd = $('toolsDropdown');
  if(dd) dd.classList.toggle('open');
}
function closeToolsMenu(e) {
  const dd = $('toolsDropdown');
  if(!dd) return;
  if(!e || !e.target?.closest('.tools-menu-wrap')) dd.classList.remove('open');
}

// Active case bar
function updateActiveCaseBar(caseRecord, meta) {
  const bar = $('activeCaseBar');
  if(!bar) return;
  if(!STATE.caseId) { bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  const acbName = $('acbName');
  const acbForm = $('acbForm');
  if(acbName) {
    const addr = meta?.address || STATE.caseId;
    const borrower = meta?.borrower ? ' · ' + meta.borrower : '';
    acbName.textContent = addr + borrower;
  }
  if(acbForm) {
    const ft = meta?.formType || STATE.formType || '1004';
    acbForm.textContent = ft.toUpperCase();
    acbForm.style.display = 'inline-flex';
  }
}

// Pipeline stage helper
function getPipelineStage(cs) {
  const wf = cs.workflowStatus || '';
  const outputs = cs.outputCount || 0;
  if(wf === 'complete' || wf === 'submitted') return 'complete';
  if(wf === 'inserting') return 'inserting';
  if(wf === 'review') return 'review';
  if(outputs > 0) return 'generating';
  const facts = cs.factCount || 0;
  if(facts > 3) return 'facts';
  return 'intake';
}
function stagePill(stage) {
  const labels = { intake:'Intake', facts:'Facts', generating:'Generating', review:'Review', inserting:'Inserting', complete:'Complete' };
  return `<span class="stage-pill stage-${stage}">${labels[stage]||stage}</span>`;
}

// ====== FORM REGISTRY ======
function getActiveFields() { return STATE.formConfig?.fields || []; }
function getActiveDocTypes() { return STATE.formConfig?.docTypes || []; }
function getActiveVoiceFields() { return STATE.formConfig?.voiceFields || []; }

async function fetchFormConfig(formType) {
  if(FORM_CONFIGS_CACHE[formType])return FORM_CONFIGS_CACHE[formType];
  const d=await apiFetch('/api/forms/'+formType);
  if(d.ok&&d.config){FORM_CONFIGS_CACHE[formType]=d.config;return d.config;}
  return null;
}

async function setActiveFormConfig(formType) {
  const cfg=await fetchFormConfig(formType||'1004');
  if(!cfg)return;
  STATE.formType=cfg.id;
  STATE.formConfig=cfg;
  // Update header subtitle
  const sub=$('headerSub');
  if(sub)sub.textContent=cfg.label+' — Case-based, fact-grounded, Cresci voice';
  // Update case badge form label
  const fb=$('caseFormBadge');
  if(fb){
    fb.textContent=cfg.id.toUpperCase();
    fb.style.display='inline-flex';
    fb.className='form-badge'+(isDeferredFormId(cfg.id)?' deferred':'');
  }
  // Update active case bar form badge
  const acbForm=$('acbForm');
  if(acbForm){ acbForm.textContent=cfg.id.toUpperCase(); acbForm.style.display='inline-flex'; }
  // Re-render field list and doc slots
  renderFieldList();
  if(STATE.caseId)renderDocSlots(STATE._lastDocSummary||{});
  // Update both form type selectors to match
  const vft=$('voiceFormType');
  if(vft)vft.value=cfg.id;
  const nft2=$('newFormType');
  if(nft2)nft2.value=cfg.id;
  // Sync form picker selection highlight
  document.querySelectorAll('.form-picker-option').forEach(o => {
    o.classList.toggle('selected', o.dataset.formId === cfg.id);
  });
  // Update subject summary label based on form type
  const ssl=$('subjectSummaryLabel');
  if(ssl){
    if(cfg.id==='commercial')ssl.textContent='Property summary (type/GBA/class/condition/use)';
    else if(cfg.id==='1073')ssl.textContent='Subject summary (unit/floor/beds/baths/GLA/HOA/condition)';
    else if(cfg.id==='1025')ssl.textContent='Subject summary (units/beds/baths/GLA/condition/updates)';
    else if(cfg.id==='1004c')ssl.textContent='Subject summary (MH type/GLA/foundation/HUD/condition)';
    else ssl.textContent='Subject summary (beds/baths/GLA/condition/updates)';
  }
  // ── Scope enforcement: show/hide deferred banner + disable generate ────────
  if(isDeferredFormId(cfg.id)) {
    showDeferredFormBanner(cfg.id,
      `Form type "${cfg.id}" is outside active production scope. ` +
      `Generation and insertion are not available. Active forms: ${_activeFormIds.join(', ')}.`
    );
    setScopeGenerateEnabled(false);
  } else {
    hideDeferredFormBanner();
    setScopeGenerateEnabled(true);
  }
}

// ── ACTIVE_SCOPE / DEFERRED_SCOPE (populated from /api/forms) ────────────────
let _activeFormIds  = ['1004', 'commercial'];
let _deferredFormIds = ['1025', '1073', '1004c'];

function isActiveFormId(id)   { return _activeFormIds.includes(String(id||'').toLowerCase()); }
function isDeferredFormId(id) { return _deferredFormIds.includes(String(id||'').toLowerCase()); }

// ── Form picker helpers ───────────────────────────────────────────────────────

/** Called when user clicks a form picker option row */
function selectFormFromPicker(formId, el) {
  // Deselect all options
  document.querySelectorAll('.form-picker-option').forEach(o => o.classList.remove('selected'));
  // Select clicked option
  if(el) el.classList.add('selected');
  // Sync hidden select
  const nft = $('newFormType');
  if(nft) nft.value = formId;
  // Load config
  setActiveFormConfig(formId);
}

/** Toggle the deferred/future section open/closed */
function toggleDeferredSection() {
  const body = $('deferredFormOptions');
  const btn  = $('deferredToggleBtn');
  if(!body) return;
  const open = body.classList.toggle('open');
  if(btn) btn.textContent = open ? 'Hide' : 'Show';
}

/** Show the deferred form banner with a message */
function showDeferredFormBanner(formType, message) {
  const banner = $('deferredFormBanner');
  const text   = $('deferredFormBannerText');
  if(!banner) return;
  if(text) text.textContent = message || `Form type "${formType}" is outside active production scope. Generation and insertion are not available.`;
  banner.classList.add('visible');
}

/** Hide the deferred form banner */
function hideDeferredFormBanner() {
  const banner = $('deferredFormBanner');
  if(banner) banner.classList.remove('visible');
}

/** Enable or disable generate buttons based on scope */
function setScopeGenerateEnabled(enabled) {
  const genBtns = document.querySelectorAll('#tab-generate button:not(.ghost):not(.sec)');
  genBtns.forEach(btn => {
    if(btn.textContent.includes('Generate')) {
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? '' : '0.4';
      btn.title = enabled ? '' : 'Generation not available for deferred form types.';
    }
  });
}

async function initFormRegistry() {
  const d = await apiFetch('/api/forms');
  if(!d.ok || !d.forms) return;

  // Store scope arrays from server
  if(d.activeScope)   _activeFormIds   = d.activeScope;
  if(d.deferredScope) _deferredFormIds = d.deferredScope;

  const activeForms   = d.activeForms   || d.forms.filter(f => isActiveFormId(f.id));
  const deferredForms = d.deferredForms || d.forms.filter(f => isDeferredFormId(f.id));

  // ── Populate active form picker options ───────────────────────────────────
  const activeContainer = $('activeFormOptions');
  if(activeContainer) {
    activeContainer.innerHTML = activeForms.map((f, i) =>
      `<div class="form-picker-option${i===0?' selected':''}" data-form-id="${esc(f.id)}" onclick="selectFormFromPicker('${esc(f.id)}',this)">
        <div class="form-picker-radio"></div>
        <span class="form-picker-label">${esc(f.label)}</span>
        <span class="form-picker-badge active-badge">Active</span>
      </div>`
    ).join('');
  }

  // ── Populate deferred form picker options ─────────────────────────────────
  const deferredContainer = $('deferredFormOptions');
  if(deferredContainer) {
    deferredContainer.innerHTML = deferredForms.map(f =>
      `<div class="form-picker-option deferred-option" data-form-id="${esc(f.id)}" onclick="selectFormFromPicker('${esc(f.id)}',this)">
        <div class="form-picker-radio"></div>
        <span class="form-picker-label">${esc(f.label)}</span>
        <span class="form-picker-badge deferred-badge">Deferred</span>
      </div>`
    ).join('');
  }

  // ── Sync hidden #newFormType select ───────────────────────────────────────
  const nft = $('newFormType');
  if(nft) {
    nft.innerHTML = d.forms.map(f => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('');
  }

  // ── Populate voiceFormType with optgroups ─────────────────────────────────
  const vft = $('voiceFormType');
  if(vft) {
    const activeOpts   = activeForms.map(f   => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('');
    const deferredOpts = deferredForms.map(f => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('');
    vft.innerHTML =
      `<optgroup label="Active Production">${activeOpts}</optgroup>` +
      (deferredOpts ? `<optgroup label="Deferred / Future">${deferredOpts}</optgroup>` : '');
  }

  // Pre-cache all configs
  for(const f of d.forms) fetchFormConfig(f.id);

  // Load default
  await setActiveFormConfig(d.defaultFormType || '1004');
}

// ====== HEALTH ======
async function pingServer() {
  try {
    const d=await apiFetch('/api/health');
    $('serverDot').className=d.ok?'dot ok':'dot err';
    $('serverBadge').textContent=d.ok?'Server OK ('+(d.model||'')+')':'Server error';
  } catch { $('serverDot').className='dot err'; $('serverBadge').textContent='Server offline'; }
}

// ====== CASE MANAGEMENT ======
let _caseFilter='all';
function setCaseFilter(filter,btn) {
  _caseFilter=filter;
  document.querySelectorAll('.filt-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderCaseList(window._allCases||[]);
}

function collectUnresolvedIssues() {
  const raw=$('unresolvedIssues')?.value||'';
  const lines=raw
    .split('\n')
    .map(s=>s.trim())
    .filter(Boolean);
  const unique=[];
  const seen=new Set();
  for(const line of lines){
    const key=line.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
    if(unique.length>=100) break;
  }
  return unique;
}

function countFactLeaves(node) {
  if(!node || typeof node!=='object') return 0;
  if(Array.isArray(node)) {
    return node.reduce((acc,item)=>acc+countFactLeaves(item),0);
  }
  let total=0;
  for(const [k,v] of Object.entries(node)) {
    if(k==='updatedAt'||k==='extractedAt'||k==='workspace1004') continue;
    if(v && typeof v==='object') {
      if(Object.prototype.hasOwnProperty.call(v,'value')) total++;
      else total+=countFactLeaves(v);
    } else if(v!=='' && v!==null && v!==undefined) {
      total++;
    }
  }
  return total;
}

function renderCaseStripMeta(detail={}) {
  const el=$('caseStripMeta');
  if(!el) return;
  if(!STATE.caseId){
    el.textContent='No case selected';
    return;
  }
  const docs=Object.keys(detail.docSummary||{}).length;
  const facts=countFactLeaves(detail.facts||{});
  const sources=Object.keys(detail.provenance||{}).length;
  const issues=Array.isArray(detail.meta?.unresolvedIssues)?detail.meta.unresolvedIssues.length:0;
  const wf=detail.meta?.workflowStatus||'facts_incomplete';
  const wfLabel=WF_LABELS[wf]||wf;
  const ft=(detail.meta?.formType||STATE.formType||'').toUpperCase();
  const parts=[ft,`Docs ${docs}`,`Facts ${facts}`,`Sources ${sources}`,`Issues ${issues}`,wfLabel].filter(Boolean);
  el.textContent=parts.join(' • ');
}
function renderCaseList(cases) {
  window._allCases=cases;
  // Sort most recent first
  const sorted=[...cases].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
  const filtered=_caseFilter==='all'?sorted:sorted.filter(cs=>(cs.status||'active')===_caseFilter);
  const list=$('caseList');
  if(!filtered.length){list.innerHTML='<div class="hint" style="padding:14px 16px;">No '+(_caseFilter==='all'?'':''+_caseFilter+' ')+'cases.</div>';return;}
  list.innerHTML=filtered.map(cs=>{
    const st=cs.status||'active', isActive=STATE.caseId===cs.caseId;
    const cid=JSON.stringify(cs.caseId||''), sid=JSON.stringify(st);
    const isDeferred = isDeferredFormId(cs.formType||'');
    const formLabel=cs.formType?`<span class="form-badge${isDeferred?' deferred':''}">${esc(cs.formType.toUpperCase())}</span>`:'';
    // Pipeline stage
    const stage = getPipelineStage(cs);
    // Fee chip
    const feeChip = cs.fee ? `<span class="meta-chip purpose">$${esc(String(cs.fee))}</span>` : '';
    const condChip=cs.subjectCondition?`<span class="meta-chip cond-rating">${esc(cs.subjectCondition)}</span>`:'';
    const geoChip=cs.city?`<span class="meta-chip geo">${esc(cs.city)}</span>`:'';
    return `<div class="case-card${isActive?' active':''}" onclick="loadCase(${cid})">
      <div class="case-card-header">
        <div class="case-card-addr">${esc(cs.address||cs.caseId)}</div>
        ${formLabel}
        <button class="ghost sm" style="font-size:10px;padding:2px 6px;color:var(--danger);border-color:rgba(255,92,92,.2);flex-shrink:0;" onclick="event.stopPropagation();deleteCase(${cid},this)">&times;</button>
      </div>
      ${cs.borrower?`<div class="case-card-borrower">${esc(cs.borrower)}</div>`:''}
      <div class="case-card-meta">
        ${stagePill(stage)}
        ${feeChip}${condChip}${geoChip}
        <span class="case-status cs-${st}" style="cursor:pointer" onclick="event.stopPropagation();cycleStatus(${cid},${sid},this)">${st.charAt(0).toUpperCase()+st.slice(1)}</span>
      </div>
      <div class="case-card-actions">
        <button class="case-card-action primary" onclick="event.stopPropagation();loadCase(${cid}).then(()=>showTab('workspace'))">✏️ Open</button>
        <button class="case-card-action" onclick="event.stopPropagation();loadCase(${cid}).then(()=>showTab('generate'))">⚡ Generate</button>
        <button class="case-card-action" onclick="event.stopPropagation();loadCase(${cid}).then(()=>{generateAll();})" title="Generate all then insert into ACI">⤵ Insert</button>
        <span style="flex:1;"></span>
        <span style="font-size:10px;color:var(--muted);">${new Date(cs.updatedAt||Date.now()).toLocaleDateString()}</span>
      </div>
    </div>`;
  }).join('');
}
async function loadCases() {
  const d=await apiFetch('/api/cases');
  if(!d.ok){setStatus('caseStatus','Failed to load cases','err');return;}
  renderCaseList(d.cases);
}
async function createCase() {
  const address=$('newAddress').value.trim();
  if(!address){setStatus('caseStatus','Enter an address first.','err');return;}
  const formType=$('newFormType').value||'1004';
  setStatus('caseStatus','Creating...','warn');
  const d=await apiFetch('/api/cases/create',{method:'POST',body:{
    address,
    borrower:   $('newBorrower').value.trim(),
    formType,
    notes:      $('caseNotes')?.value.trim()||'',
    // ── Assignment metadata (new 4-card fields) ──────────────────────────
    assignmentPurpose:   $('assignmentPurpose')?.value||null,
    loanProgram:         $('loanProgram')?.value||null,
    propertyType:        $('propertyType')?.value||null,
    occupancyType:       $('occupancyType')?.value||null,
    reportConditionMode: $('reportConditionMode')?.value||null,
    subjectCondition:    $('subjectCondition')?.value||null,
    clientName:          $('clientName')?.value.trim()||'',
    lenderName:          $('lenderName')?.value.trim()||'',
    amcName:             $('amcName')?.value.trim()||'',
    state:               $('metaState')?.value.trim()||'IL',
    county:              $('metaCounty')?.value.trim()||'',
    city:                $('metaCity')?.value.trim()||'',
    marketArea:          $('marketArea')?.value.trim()||'',
    neighborhood:        $('metaNeighborhood')?.value.trim()||'',
    marketType:          $('marketType')?.value||null,
    assignmentNotes:     $('assignmentNotes')?.value.trim()||'',
    unresolvedIssues:    collectUnresolvedIssues(),
  }});
  if(!d.ok){setStatus('caseStatus','Error: '+d.error,'err');return;}
  await loadCase(d.caseId);
  await loadCases();
  setStatus('caseStatus','Case created: '+d.caseId,'ok');
}
async function loadCase(caseId) {
  if(!caseId)return;
  const d=await apiFetch('/api/cases/'+caseId);
  if(!d.ok){setStatus('caseStatus','Failed: '+d.error,'err');return;}
  STATE.caseId=caseId;
  STATE.facts=d.facts||{};
  STATE.provenance=d.provenance||{};
  STATE.outputs=d.outputs||{};
  STATE.caseRecord=d.caseRecord||null;
  STATE.meta=d.meta||{};
  STATE._lastDocSummary=d.docSummary||{};
  $('caseBadge').style.display='flex';
  $('caseAddrBadge').textContent=d.meta.address||caseId;
  $('docHint').style.display='none';
  $('newAddress').value=d.meta.address||'';
  $('newBorrower').value=d.meta.borrower||'';
  const notesEl=$('caseNotes');
  if(notesEl)notesEl.value=d.meta.notes||'';
  // ── Update active case bar ────────────────────────────────────────────────
  updateActiveCaseBar(d.caseRecord, d.meta);
  // ── Populate all 4 assignment cards ──────────────────────────────────────
  populateAssignmentFields(d.meta);
  // ── Render metadata chips + workflow badge ────────────────────────────────
  renderCaseMetadata(d.meta);
  updateWorkflowBadge(d.meta.workflowStatus||'facts_incomplete');
  renderCaseStripMeta(d);
  // Set form config for this case (also handles scope banner + generate enable/disable)
  await setActiveFormConfig(d.meta.formType||'1004');
  // ── Deferred-form legacy case: show scope warning from server ─────────────
  if(d.scopeStatus==='deferred' && d.scopeWarning) {
    showDeferredFormBanner(d.meta.formType, d.scopeWarning.message);
    setScopeGenerateEnabled(false);
    // Open the deferred section in the picker so the selected form is visible
    const deferredBody = $('deferredFormOptions');
    const deferredBtn  = $('deferredToggleBtn');
    if(deferredBody && !deferredBody.classList.contains('open')) {
      deferredBody.classList.add('open');
      if(deferredBtn) deferredBtn.textContent = 'Hide';
    }
  }
  renderDocSlots(d.docSummary||{});
  renderFacts(d.facts||{});
  renderFactSourcesEditor(STATE.provenance);
  renderOutputsFromState();
  autoFillGenerateInputs(d.facts||{},d.meta);
  setStatus('genStatus','Ready.','');
  _updateGenStrip();
  if(typeof workspaceOnCaseLoaded==='function')workspaceOnCaseLoaded();
  showCaseBusinessCards();
  renderQuestionnaire([]);
  setStatus('questionnaireStatus','','');
  if(d.facts&&Object.keys(d.facts).filter(k=>k!=='extractedAt'&&k!=='updatedAt'&&k!=='workspace1004').length>0)await generateQuestions(true);
  document.querySelectorAll('.case-item').forEach(el=>el.classList.toggle('active',el.getAttribute('onclick')&&el.getAttribute('onclick').includes(caseId)));
}
async function updateCase() {
  if(!STATE.caseId){setStatus('caseStatus','No case selected to update.','err');return;}
  const address=$('newAddress').value.trim();
  if(!address){setStatus('caseStatus','Address is required.','err');return;}
  const formType=$('newFormType').value||'1004';
  setStatus('caseStatus','Updating...','warn');
  const d=await apiFetch('/api/cases/'+STATE.caseId,{method:'PATCH',body:{
    address,
    borrower:   $('newBorrower').value.trim(),
    formType,
    notes:      $('caseNotes')?.value.trim()||'',
    // ── Assignment metadata (new 4-card fields) ──────────────────────────
    assignmentPurpose:   $('assignmentPurpose')?.value||null,
    loanProgram:         $('loanProgram')?.value||null,
    propertyType:        $('propertyType')?.value||null,
    occupancyType:       $('occupancyType')?.value||null,
    reportConditionMode: $('reportConditionMode')?.value||null,
    subjectCondition:    $('subjectCondition')?.value||null,
    clientName:          $('clientName')?.value.trim()||'',
    lenderName:          $('lenderName')?.value.trim()||'',
    amcName:             $('amcName')?.value.trim()||'',
    state:               $('metaState')?.value.trim()||'IL',
    county:              $('metaCounty')?.value.trim()||'',
    city:                $('metaCity')?.value.trim()||'',
    marketArea:          $('marketArea')?.value.trim()||'',
    neighborhood:        $('metaNeighborhood')?.value.trim()||'',
    marketType:          $('marketType')?.value||null,
    assignmentNotes:     $('assignmentNotes')?.value.trim()||'',
    unresolvedIssues:    collectUnresolvedIssues(),
  }});
  if(!d.ok){setStatus('caseStatus','Error: '+d.error,'err');return;}
  await loadCase(STATE.caseId);
  await loadCases();
  setStatus('caseStatus','Case updated.','ok');
}
async function deleteCase(caseId,btn) {
  if(!confirm('Delete case '+caseId+'? This cannot be undone.'))return;
  if(btn)btn.disabled=true;
  const d=await apiFetch('/api/cases/'+caseId,{method:'DELETE'});
  if(!d.ok){alert('Error: '+d.error);if(btn)btn.disabled=false;return;}
  if(STATE.caseId===caseId){
    STATE.caseId=null;STATE.facts={};STATE.provenance={};STATE.outputs={};STATE.caseRecord=null;STATE.factsObj=null;
    $('caseBadge').style.display='none';$('caseFormBadge').style.display='none';
    $('docSlots').innerHTML='';$('docHint').style.display='';
    $('factsDisplay').innerHTML='<div class="hint">No facts extracted yet. Upload documents then click Extract Facts from Docs.</div>';
    const fsj=$('factSourceJson'); if(fsj) fsj.value='';
    setStatus('factSourceStatus','');
    renderCaseStripMeta({});
    $('output').innerHTML='';setStatus('genStatus','Ready.','');
    if(typeof workspaceReset==='function')workspaceReset();
  }
  await loadCases();
}
function toggleEl(id,btn){const el=$(id);if(!el)return;const open=el.style.display!=='none';el.style.display=open?'none':'block';if(btn)btn.textContent=open?'Preview':'Hide';}
async function cycleStatus(caseId,current,badge) {
  const order=['active','submitted','archived'];
  const next=order[(order.indexOf(current)+1)%order.length];
  const d=await apiFetch('/api/cases/'+caseId+'/status',{method:'PATCH',body:{status:next}});
  if(d.ok){badge.textContent=next.charAt(0).toUpperCase()+next.slice(1);badge.className='case-status cs-'+next;const cs=(window._allCases||[]).find(c=>c.caseId===caseId);if(cs)cs.status=next;}
}

// ====== DOCUMENT SLOTS ======
function renderDocSlots(docSummary) {
  const wrap=$('docSlots'), docTypes=getActiveDocTypes();
  if(!docTypes.length){wrap.innerHTML='<div class="hint">No document types configured for this form.</div>';return;}
  wrap.innerHTML=docTypes.map(dt=>{
    const s=docSummary[dt.id], uploaded=!!s;
    return `<div class="doc-slot" id="slot-${dt.id}">
      <div class="ds-label">${esc(dt.label)}</div>
      <div class="ds-status${uploaded?' uploaded':''}" id="slotStatus-${dt.id}">${uploaded?(s.wordCount+' words'):'Not uploaded'}</div>
      <input type="file" accept=".pdf" style="display:none;" id="file-${dt.id}" onchange="uploadDoc('${dt.id}',this)"/>
      <button class="sec sm" onclick="$('file-${dt.id}').click()">${uploaded?'Replace':'Upload'}</button>
    </div>`;
  }).join('');
}
async function uploadDoc(docType,input) {
  if(!STATE.caseId){alert('Select a case first.');return;}
  const file=input.files[0]; if(!file)return;
  const statusEl=$('slotStatus-'+docType);
  const slotEl=$('slot-'+docType);
  statusEl.textContent='Uploading... (OCR may take 30-60s for scanned PDFs)';statusEl.className='ds-status warn';
  setStatus('docStatus','Uploading '+docType+'... OCR in progress, please wait.','warn');showErr('docErrBox','');
  const form=new FormData();form.append('file',file);form.append('docType',docType);
  try {
    const r=await fetch(server()+'/api/cases/'+STATE.caseId+'/upload',{method:'POST',body:form});
    const d=await r.json();
    if(d.ok){
      statusEl.textContent=d.wordCount+' words, '+d.pages+' pages';
      statusEl.className='ds-status uploaded';
      // Update button text from "Upload" to "Replace"
      const btn=slotEl?.querySelector('button.sec');
      if(btn)btn.textContent='Replace';
      setStatus('docStatus','Uploaded: '+docType+' ('+d.wordCount+' words, '+d.pages+' pages)','ok');
    } else {
      statusEl.textContent='Upload failed';statusEl.className='ds-status err';
      setStatus('docStatus','Upload error: '+d.error,'err');showErr('docErrBox',d.error);
    }
  } catch(e){statusEl.textContent='Error';statusEl.className='ds-status err';setStatus('docStatus','Network error: '+e.message,'err');}
  input.value='';
}

// ====== QUESTIONNAIRE ======
function collectQuestionnaireAnswers() {
  const answers={};
  document.querySelectorAll('.q-answer').forEach((el,idx)=>{const v=(el.value||'').trim();if(!v)return;answers[el.dataset.qid||('q_'+(idx+1))]=v;});
  return answers;
}
function renderQuestionnaire(questions) {
  const list=$('questionnaireList'),btns=$('questionnaireBtns');
  if(!list||!btns)return;
  STATE.questionnaire=Array.isArray(questions)?questions:[];
  if(!STATE.questionnaire.length){list.innerHTML='<div class="hint">No follow-up questions right now.</div>';btns.style.display='none';return;}
  list.innerHTML=STATE.questionnaire.map((q,idx)=>{
    const qid=String((q&&q.id)||('q_'+(idx+1)));
    const label=(q&&q.question)||'Provide additional detail.';
    const hint=(q&&q.hint)?'<div class="hint" style="margin-top:4px;">'+esc(q.hint)+'</div>':'';
    const field=(q&&q.field)?'<div style="font-size:10px;color:var(--muted);margin-top:3px;">Field: '+esc(q.field)+'</div>':'';
    return '<div style="margin:10px 0 12px;border:1px solid var(--border);border-radius:10px;padding:10px;background:rgba(0,0,0,.12);">'
      +'<div style="font-size:12px;font-weight:600;line-height:1.35;">'+esc(label)+'</div>'+field
      +'<textarea class="q-answer" data-qid="'+esc(qid)+'" placeholder="Type answer..." style="margin-top:8px;min-height:70px;"></textarea>'+hint+'</div>';
  }).join('');
  btns.style.display='flex';
}
async function generateQuestions(silent=false) {
  if(!STATE.caseId){if(!silent)alert('Select a case first.');return;}
  if(!silent)setStatus('questionnaireStatus','Generating follow-up questions...','warn');
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/questionnaire',{method:'POST',body:{}});
  if(!d.ok){if(!silent)setStatus('questionnaireStatus','Question generation failed: '+(d.error||'unknown error'),'err');return;}
  renderQuestionnaire(d.questions||[]);
  if(!silent)setStatus('questionnaireStatus','Questions updated.','ok');
}
async function extractFacts(extraAnswers=null) {
  if(!STATE.caseId){alert('Select a case first.');return;}
  const answers=extraAnswers&&typeof extraAnswers==='object'?extraAnswers:{};
  // Show status in both Case tab (docStatus) and Facts tab (questionnaireStatus)
  setStatus('docStatus','Extracting facts from documents... this may take 30-60 seconds.','warn');
  setStatus('questionnaireStatus','Extracting facts from documents...','warn');
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/extract-facts',{method:'POST',body:Object.keys(answers).length?{answers}:{}});
  if(!d.ok){
    setStatus('docStatus','Fact extraction failed: '+(d.error||'unknown error'),'err');
    setStatus('questionnaireStatus','Fact extraction failed: '+(d.error||'unknown error'),'err');
    return;
  }
  STATE.facts=d.facts||{};STATE.factsObj=JSON.parse(JSON.stringify(STATE.facts));
  renderFacts(STATE.facts);
  setStatus('docStatus','Facts extracted successfully. Switch to the Facts tab to review.','ok');
  setStatus('questionnaireStatus','Facts updated from documents.','ok');
  await generateQuestions(true);
}
async function saveAnswers() {
  if(!STATE.caseId){alert('Select a case first.');return;}
  const answers=collectQuestionnaireAnswers();
  if(!Object.keys(answers).length){setStatus('questionnaireStatus','Add at least one answer before saving.','err');return;}
  await extractFacts(answers);
}

// ====== FACTS DISPLAY ======
function renderFacts(facts) {
  const wrap=$('factsDisplay');
  const keys=facts?Object.keys(facts).filter(k=>k!=='extractedAt'&&k!=='updatedAt'&&k!=='workspace1004'):[];
  if(!keys.length){wrap.innerHTML='<div class="hint">No facts extracted yet. Upload documents then click Extract Facts from Docs.</div>';return;}
  STATE.factsObj=JSON.parse(JSON.stringify(facts));
  let html='';
  for(const secKey of keys) {
    const secData=facts[secKey];
    if(Array.isArray(secData)) {
      const singLabel=secKey.replace(/s$/,'');
      html+='<div class="facts-section"><h4>'+esc(secKey.charAt(0).toUpperCase()+secKey.slice(1))+'</h4>';
      secData.forEach((item,i)=>{
        html+='<div style="margin-bottom:10px;"><b style="font-size:12px;">'+esc(singLabel.charAt(0).toUpperCase()+singLabel.slice(1))+' '+(i+1)+'</b>';
        for(const [field,fobj] of Object.entries(item)){
          if(field==='number')continue;
          const val=fobj&&fobj.value!=null?String(fobj.value):'', conf=fobj?(fobj.confidence||'low'):'low';
          html+='<div class="fact-row-edit"><div class="fact-label">'+esc(field)+' <span class="conf-'+conf+'">'+conf+'</span></div>'
            +'<input class="fact-val-input" data-sec="'+esc(secKey)+'" data-comp="'+i+'" data-field="'+esc(field)+'" value="'+esc(val)+'" placeholder="[missing]"/></div>';
        }
        html+='</div>';
      });
      html+='</div>';
    } else if(secData&&typeof secData==='object') {
      const label=secKey.charAt(0).toUpperCase()+secKey.slice(1).replace(/_/g,' ');
      html+='<div class="facts-section"><h4>'+esc(label)+'</h4>';
      for(const [field,fobj] of Object.entries(secData)){
        const val=fobj&&fobj.value!=null?String(fobj.value):'', conf=fobj?(fobj.confidence||'low'):'low';
        html+='<div class="fact-row-edit"><div class="fact-label">'+esc(field)+' <span class="conf-'+conf+'">'+conf+'</span></div>'
          +'<input class="fact-val-input" data-sec="'+esc(secKey)+'" data-field="'+esc(field)+'" value="'+esc(val)+'" placeholder="[missing]"/></div>';
      }
      html+='</div>';
    }
  }
  wrap.innerHTML=html;
  renderFactsCompleteness(facts);
}
function renderFactsCompleteness(facts) {
  const bar=$('factsCompleteness');
  if(!bar)return;
  const keys=facts?Object.keys(facts).filter(k=>k!=='extractedAt'&&k!=='updatedAt'&&k!=='workspace1004'):[];
  if(!keys.length){bar.style.display='none';return;}
  let total=0,filled=0;
  for(const secKey of keys){
    const sec=facts[secKey];
    if(Array.isArray(sec)){sec.forEach(item=>{Object.entries(item).forEach(([k,fobj])=>{if(k==='number')return;total++;if(fobj&&fobj.value!=null&&String(fobj.value).trim()!=='')filled++;});});}
    else if(sec&&typeof sec==='object'){Object.entries(sec).forEach(([,fobj])=>{total++;if(fobj&&fobj.value!=null&&String(fobj.value).trim()!=='')filled++;});}
  }
  const pct=total?Math.round((filled/total)*100):0;
  const color=pct>=80?'var(--ok)':pct>=50?'var(--warn)':'var(--danger)';
  bar.style.display='flex';bar.style.alignItems='center';bar.style.gap='8px';bar.style.marginBottom='10px';
  bar.innerHTML='<div style="flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+color+';transition:width .3s;"></div></div><span style="font-size:10px;color:'+color+';white-space:nowrap;">'+filled+'/'+total+' facts ('+pct+'%)</span>';
}
function autoFillGenerateInputs(facts, meta) {
  const s=(facts&&facts.subject)||{},m=(facts&&facts.market)||{},imp=(facts&&facts.improvements)||{};
  const v=o=>(o&&o.value!=null?String(o.value):'');
  // ── Subject city/area: prefer meta geography, fall back to facts ──────────
  const metaCity=(meta&&meta.city)||'';
  const metaState=(meta&&meta.state)||'';
  const factsCity=v(s.city), factsState=v(s.state);
  const city=metaCity||factsCity, state=metaState||factsState;
  if(city||state)$('subject_area').value=[city,state].filter(Boolean).join(', ');
  if(STATE.formType==='commercial'){
    if(v(m.submarket))$('market_stat').value=v(m.submarket);
    const parts=[];
    if(v(imp.propertyType))parts.push(v(imp.propertyType));
    if(v(imp.buildingClass))parts.push('Class '+v(imp.buildingClass));
    if(v(imp.grossBuildingArea))parts.push(v(imp.grossBuildingArea)+' sf GBA');
    if(v(imp.yearBuilt))parts.push('built '+v(imp.yearBuilt));
    if(v(imp.condition))parts.push(v(imp.condition)+' condition');
    if(v(s.zoning))parts.push('zoning: '+v(s.zoning));
    if(parts.length)$('subject_summary').value=parts.join(', ');
  } else {
    if(v(m.trendStat))$('market_stat').value=v(m.trendStat);
    const parts=[];
    if(v(s.style))parts.push(v(s.style));if(v(s.beds))parts.push(v(s.beds)+' bed');if(v(s.baths))parts.push(v(s.baths)+' bath');
    if(v(s.gla))parts.push(v(s.gla)+' sf GLA');if(v(s.basement))parts.push(v(s.basement));if(v(s.garage))parts.push(v(s.garage));
    if(v(s.condition))parts.push(v(s.condition)+' condition');if(v(s.quality))parts.push(v(s.quality)+' quality');
    if(parts.length)$('subject_summary').value=parts.join(', ');
  }
}
function buildPrompt(tpl) {
  const area=$('subject_area').value.trim()||'[INSERT area]';
  const summary=$('subject_summary').value.trim()||'[INSERT subject summary]';
  const mstat=$('market_stat').value.trim()||'';
  return tpl.replaceAll('{{area}}',area).replaceAll('{{summary}}',summary).replaceAll('{{market_stat}}',mstat);
}
async function saveFacts() {
  if(!STATE.caseId){alert('Select a case first.');return;}
  const inputs=document.querySelectorAll('.fact-val-input');
  const facts=STATE.factsObj?JSON.parse(JSON.stringify(STATE.factsObj)):{};
  inputs.forEach(inp=>{
    const sec=inp.dataset.sec,field=inp.dataset.field,val=inp.value.trim()||null;
    if(inp.dataset.comp !== undefined && inp.dataset.comp !== ''){
      const idx=parseInt(inp.dataset.comp);
      if(!facts[sec])facts[sec]=[];
      while(facts[sec].length<=idx)facts[sec].push({});
      facts[sec][idx][field]={value:val,confidence:'high',source:'appraiser'};
    } else {
      if(!facts[sec])facts[sec]={};
      facts[sec][field]={value:val,confidence:'high',source:'appraiser'};
    }
  });
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/facts',{method:'PUT',body:facts});
  if(d.ok){
    STATE.factsObj=d.facts;
    STATE.facts=d.facts;
    renderFacts(d.facts||{});
    renderCaseStripMeta({
      meta: STATE.meta||{},
      facts: STATE.facts||{},
      provenance: STATE.provenance||{},
      docSummary: STATE._lastDocSummary||{},
    });
    setStatus('questionnaireStatus','Facts saved.','ok');
    setTimeout(()=>setStatus('questionnaireStatus','',''),3000);
  }
  else setStatus('questionnaireStatus','Save failed: '+d.error,'err');
}

function renderFactSourcesEditor(sources={}) {
  const ta=$('factSourceJson');
  if(!ta) return;
  const safe=(sources&&typeof sources==='object'&&!Array.isArray(sources))?sources:{};
  ta.value=JSON.stringify(safe,null,2);
}

async function reloadFactSources() {
  if(!STATE.caseId){setStatus('factSourceStatus','Select a case first.','err');return;}
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/fact-sources');
  if(!d.ok){
    setStatus('factSourceStatus','Load failed: '+(d.error||'Unknown error'),'err');
    return;
  }
  STATE.provenance=d.sources||{};
  renderFactSourcesEditor(STATE.provenance);
  renderCaseStripMeta({
    meta: STATE.meta||{},
    facts: STATE.facts||{},
    provenance: STATE.provenance||{},
    docSummary: STATE._lastDocSummary||{},
  });
  setStatus('factSourceStatus','Loaded '+(d.count||0)+' source link(s).','ok');
}

async function saveFactSources() {
  if(!STATE.caseId){setStatus('factSourceStatus','Select a case first.','err');return;}
  const raw=$('factSourceJson')?.value||'{}';
  let parsed;
  try {
    parsed=JSON.parse(raw);
  } catch(e) {
    setStatus('factSourceStatus','Invalid JSON: '+e.message,'err');
    return;
  }
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/fact-sources',{
    method:'PUT',
    body:{sources:parsed,replace:true},
  });
  if(!d.ok){
    setStatus('factSourceStatus','Save failed: '+(d.error||'Unknown error'),'err');
    return;
  }
  STATE.provenance=d.sources||{};
  renderFactSourcesEditor(STATE.provenance);
  renderCaseStripMeta({
    meta: STATE.meta||{},
    facts: STATE.facts||{},
    provenance: STATE.provenance||{},
    docSummary: STATE._lastDocSummary||{},
  });
  setStatus('factSourceStatus','Saved '+(d.count||0)+' source link(s).','ok');
}

// ====== GENERATE ======
function renderFieldList() {
  const wrap=$('fieldList'), fields=getActiveFields();
  if(!fields.length){wrap.innerHTML='<div class="hint">Load a case to see fields.</div>';return;}
  wrap.innerHTML=fields.map(f=>`<div class="fitem"><input type="checkbox" id="cb-${f.id}" checked/><div><div class="ftitle">${esc(f.title)}</div><div class="fmeta">${esc(f.note||'')}</div></div></div>`).join('');
}
function checkAll(v) { getActiveFields().forEach(f=>{const cb=$('cb-'+f.id);if(cb)cb.checked=v;}); }
function selectedFields() { return getActiveFields().filter(f=>$('cb-'+f.id)?.checked).map(f=>({id:f.id,title:f.title,prompt:buildPrompt(f.tpl)})); }
async function generateSelected() {
  const fields=selectedFields();
  if(!fields.length){setStatus('genStatus','No fields selected.','err');return;}
  if(STATE.caseId){
    const warnings=await checkMissingFacts(fields.map(f=>f.id));
    if(warnings&&warnings.length){showMissingFactsPanel(warnings,fields);return;}
  }
  await runBatch(fields);
}
async function generateAll() {
  const fields=getActiveFields().map(f=>({id:f.id,title:f.title,prompt:buildPrompt(f.tpl)}));
  if(STATE.caseId){
    const warnings=await checkMissingFacts(fields.map(f=>f.id));
    if(warnings&&warnings.length){showMissingFactsPanel(warnings,fields);return;}
  }
  await runBatch(fields);
}

async function generateAllAndInsertAll() {
  // Generate all fields first
  const fields = getActiveFields().map(f => ({ id: f.id, title: f.title, prompt: buildPrompt(f.tpl) }));
  if (!fields.length) { alert('No fields to generate. Select a case and form type first.'); return; }

  const btn = document.getElementById('genInsertAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Generating…'; }

  setStatus('genStatus', 'Generating ' + fields.length + ' fields…', 'warn');

  // Run generation
  await runBatch(fields);

  // Check if agent is running
  const isCommercial = STATE.formType === 'commercial';
  const agentOk = isCommercial ? _agentStatus.rq : _agentStatus.aci;
  if (!agentOk) {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate All + Insert All'; }
    alert('Generation complete! Agent not running — please insert manually or start the ACI agent and try again.');
    return;
  }

  // Insert all generated fields
  setStatus('genStatus', 'Inserting all generated sections into ACI…', 'warn');
  if (btn) btn.textContent = '⚡ Inserting…';

  const endpoint = isCommercial ? '/api/insert-rq' : '/api/insert-aci';
  const outCards = document.querySelectorAll('.outcard');
  let insertedCount = 0;
  let failedFields = [];

  for (const card of outCards) {
    const fieldId = card.dataset.fieldId;
    const editArea = card.querySelector('.editArea');
    const outBody = card.querySelector('.outbody');
    const text = ((editArea ? editArea.value : '') || (outBody ? outBody.textContent : '') || '').trim();
    if (!text || text === 'Working...') continue;

    try {
      const d = await apiFetch(endpoint, {
        method: 'POST',
        body: { fieldId, text, formType: STATE.formType }
      });
      if (d.ok) {
        insertedCount++;
        // Visual feedback on the card
        const tools = card.querySelector('.otools');
        if (tools) {
          const chip = document.createElement('span');
          chip.className = 'chip ok';
          chip.textContent = '✓ Inserted';
          tools.prepend(chip);
        }
      } else {
        failedFields.push(fieldId + ': ' + (d.error || 'failed'));
      }
    } catch (e) {
      failedFields.push(fieldId + ': ' + e.message);
    }
    // Small delay between insertions to be safe
    await new Promise(r => setTimeout(r, 400));
  }

  if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate All + Insert All'; }

  if (failedFields.length) {
    setStatus('genStatus', `Done. ${insertedCount} inserted, ${failedFields.length} failed.`, 'warn');
    alert('Inserted ' + insertedCount + ' fields.\nFailed:\n' + failedFields.join('\n'));
  } else {
    setStatus('genStatus', `✓ All ${insertedCount} fields generated and inserted into ACI.`, 'ok');
  }
}
async function runBatch(fields) {
  showErr('genErrBox','');setStatus('genStatus','Generating '+fields.length+' field(s)...','warn');
  const _regenIds=new Set(fields.map(f=>f.id));
  const out=$('output'), activeFields=getActiveFields();
  // Remove stale cards and insert skeleton placeholders in field order
  document.querySelectorAll('.outcard').forEach(card=>{if(_regenIds.has(card.dataset.fieldId))card.remove();});
  for(const f of fields){
    const sk=document.createElement('div');sk.className='outcard';sk.id='sk-'+f.id;sk.dataset.fieldId=f.id;
    sk.innerHTML='<div class="outhead"><div class="otitle">'+esc(f.title)+'</div><div class="otools"><span class="chip warn">Generating...</span></div></div><div class="outbody" style="color:var(--muted);font-style:italic;min-height:60px;">Working...</div>';
    const fieldsAfter=activeFields.slice(activeFields.findIndex(af=>af.id===f.id)+1).map(ff=>ff.id);
    const ins=Array.from(out.querySelectorAll('.outcard')).find(c=>fieldsAfter.includes(c.dataset.fieldId));
    if(ins)out.insertBefore(sk,ins);else out.appendChild(sk);
  }
  const body={fields};if(STATE.caseId)body.caseId=STATE.caseId;
  let d;
  try{d=await apiFetch('/api/generate-batch',{method:'POST',body});}
  catch(e){fields.forEach(f=>{const s=$('sk-'+f.id);if(s)s.remove();});setStatus('genStatus','Network error: '+e.message,'err');showErr('genErrBox',String(e));return;}
  if(!d.ok){fields.forEach(f=>{const s=$('sk-'+f.id);if(s)s.remove();});setStatus('genStatus','Error: '+d.error,'err');showErr('genErrBox',JSON.stringify(d,null,2));return;}
  if(d.results)Object.assign(STATE.outputs,d.results);
  for(const f of activeFields){
    const sk=$('sk-'+f.id);if(sk)sk.remove();
    const r=d.results?.[f.id];if(!r)continue;
    const newCard=makeOutputCard(f.id,r.title||f.title,r.text,buildPrompt(f.tpl));
    const fieldsAfter=activeFields.slice(activeFields.indexOf(f)+1).map(ff=>ff.id);
    const ins=Array.from(out.querySelectorAll('.outcard')).find(c=>fieldsAfter.includes(c.dataset.fieldId));
    if(ins)out.insertBefore(newCard,ins);else out.appendChild(newCard);
  }
  const errs=Object.keys(d.errors||{});
  if(errs.length){
    window._lastFailedFields=fields.filter(f=>d.errors[f.id]);
    const retryBtn=$('retryBtn');if(retryBtn)retryBtn.style.display='inline-flex';
    setStatus('genStatus','Done ('+errs.length+' field error(s))','err');
    showErr('genErrBox','Field errors:\n'+JSON.stringify(d.errors,null,2));
  } else {
    window._lastFailedFields=[];
    const retryBtn=$('retryBtn');if(retryBtn)retryBtn.style.display='none';
    setStatus('genStatus','Done. '+Object.keys(d.results).length+' field(s) generated.','ok');
  }
  // Auto-scroll to first new output card
  const firstCard=out.querySelector('.outcard');
  if(firstCard)firstCard.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderOutputsFromState() {
  const out=$('output');if(!out)return;out.innerHTML='';
  for(const f of getActiveFields()){const r=STATE.outputs[f.id];if(!r||!r.text)continue;out.appendChild(makeOutputCard(f.id,r.title||f.title,r.text,''));}
}
// ====== CLIPBOARD HELPER (with execCommand fallback for non-HTTPS / older browsers) ======
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  // Fallback: document.execCommand
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { return document.execCommand('copy'); } catch { return false; }
  finally { document.body.removeChild(ta); }
}

// ====== SECTION STATUS BADGE ======
/**
 * sectionStatusBadge(status)
 * Returns HTML for a section lifecycle status badge.
 * Statuses: not_started | drafted | reviewed | approved | inserted | verified | error
 */
function sectionStatusBadge(status) {
  const labels = {
    not_started: 'Not Started',
    drafted:     'Drafted',
    reviewed:    'Reviewed',
    approved:    'Approved',
    inserted:    'Inserted',
    verified:    'Verified ✓',
    copied:      '📋 Copied (paste required)',
    error:       'Error',
  };
  const s = status || 'not_started';
  return `<span class="ss-badge ss-${s}">${labels[s] || s}</span>`;
}

function makeOutputCard(fieldId, title, text, prompt, opts = {}) {
  const card = document.createElement('div');
  card.className = 'outcard';
  card.dataset.fieldId = fieldId;
  card.dataset.originalText = text;
  if (opts.sectionStatus) card.dataset.sectionStatus = opts.sectionStatus;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const agentLabel = STATE.formType === 'commercial' ? 'RQ' : 'ACI';
  const insertBtn = STATE.caseId ? '<button class="ghost sm insertBtn" onclick="insertField(this)">→ ' + agentLabel + '</button>' : '';
  const statusBadge = opts.sectionStatus ? ' ' + sectionStatusBadge(opts.sectionStatus) : '';
  card.innerHTML =
    '<div class="outhead">'
    + '<div class="otitle">' + esc(title) + statusBadge + '</div>'
    + '<div class="otools">'
    + '<span class="chip">' + wordCount + 'w / ' + text.length + 'c</span>'
    + '<button class="sec sm copyBtn">Copy</button>'
    + '<button class="ghost sm" onclick="toggleEdit(this)">Edit</button>'
    + '<button class="ghost sm" onclick="showHistory(this)">History</button>'
    + insertBtn
    + '<button class="thumb up" onclick="rate(this,\'up\')">+1</button>'
    + '<button class="thumb down" onclick="rate(this,\'down\')">-1</button>'
    + '</div></div>'
    + '<div class="outbody">' + esc(text) + '</div>'
    + '<div class="outedit" style="display:none;"><label>Edit narrative:</label>'
    + '<textarea class="editArea">' + esc(text) + '</textarea>'
    + '<div class="btnrow"><button class="sm" onclick="saveEdit(this)">Save Edit + Rate +1</button>'
    + '<button class="ghost sm" onclick="toggleEdit(this.closest(\'.outcard\').querySelector(\'.ghost\'))">Cancel</button>'
    + '</div></div>'
    + '<div class="hist-drop" id="hist-' + fieldId + '"></div>';
  card.querySelector('.copyBtn').onclick = async () => {
    const txt = card.querySelector('.editArea').value || text;
    const ok = await copyToClipboard(txt);
    card.querySelector('.copyBtn').textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => (card.querySelector('.copyBtn').textContent = 'Copy'), 900);
  };
  card._prompt = prompt;
  card._title = title;
  return card;
}
function toggleEdit(btn) {
  const card=btn.closest('.outcard'),editDiv=card.querySelector('.outedit'),showing=editDiv.style.display!=='none';
  editDiv.style.display=showing?'none':'block';btn.textContent=showing?'Edit':'Done';
}
async function rate(btn,rating) {
  const card=btn.closest('.outcard'),fieldId=card.dataset.fieldId;
  card.querySelectorAll('.thumb').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  if(!STATE.caseId)return;
  await apiFetch('/api/cases/'+STATE.caseId+'/feedback',{method:'POST',body:{fieldId,fieldTitle:card._title||fieldId,originalText:card.dataset.originalText||'',editedText:card.querySelector('.editArea').value,rating,prompt:card._prompt||''}});
}
async function saveEdit(btn) {
  const card=btn.closest('.outcard'),fieldId=card.dataset.fieldId,editedText=card.querySelector('.editArea').value;
  card.querySelector('.outbody').textContent=editedText;card.classList.add('edited');
  if(STATE.caseId)await apiFetch('/api/cases/'+STATE.caseId+'/feedback',{method:'POST',body:{fieldId,fieldTitle:card._title||fieldId,originalText:card.dataset.originalText||'',editedText,rating:'up',prompt:card._prompt||''}});
  if(STATE.outputs[fieldId])STATE.outputs[fieldId].text=editedText;
  toggleEdit(card.querySelector('.outhead .ghost'));
}
function clearOutput(){$('output').innerHTML='';showErr('genErrBox','');setStatus('genStatus','Ready.','');window._lastFailedFields=[];const rb=$('retryBtn');if(rb)rb.style.display='none';}
async function retryFailed(){
  if(!window._lastFailedFields||!window._lastFailedFields.length){setStatus('genStatus','No failed fields to retry.','err');return;}
  await runBatch(window._lastFailedFields);
}
async function copyAll() {
  const cards=document.querySelectorAll('.outcard');if(!cards.length)return;
  const text=Array.from(cards).map(card=>(card.querySelector('.editArea')?.value||card.querySelector('.outbody')?.textContent||'').trim()).filter(Boolean).join('\n\n---\n\n');
  await navigator.clipboard.writeText(text);setStatus('genStatus','Copied '+cards.length+' field(s).','ok');
}

// ====== QC GRADE ======
async function gradeNarratives() {
  if(!STATE.caseId){alert('Select a case first.');return;}
  setStatus('qcStatus','Grading narratives...','warn');showErr('qcErrBox','');
  $('gradeDisplay').innerHTML='<div class="hint">Grading in progress...</div>';
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/grade',{method:'POST',body:{pastedText:$('pastedText').value}});
  if(!d.ok){setStatus('qcStatus','Error: '+d.error,'err');showErr('qcErrBox',d.error);$('gradeDisplay').innerHTML='<div class="hint">Grading failed.</div>';return;}
  renderGrade(d.grade);
  const score=d.grade.score||0;setStatus('qcStatus','Score: '+score+'/100',score>=80?'ok':score>=60?'warn':'err');
}
function renderGrade(g) {
  if(!g)return;const wrap=$('gradeDisplay');
  const sc=g.score>=80?'var(--ok)':g.score>=60?'var(--warn)':'var(--danger)';
  let html=`<div class="score-ring"><div class="score-num" style="color:${sc}">${g.score}</div><div class="score-label">out of 100</div></div><p style="font-size:13px;margin-bottom:14px;color:var(--muted);">${esc(g.summary||'')}</p>`;
  const section=(title,items,render)=>{if(!items||!items.length)return'';return'<div class="grade-section"><h4>'+title+'</h4>'+items.map(render).join('')+'</div>';};
  html+=section('Missing Items',g.missing,x=>`<div class="grade-item ${x.severity||'minor'}"><span class="sev ${x.severity||'minor'}">${x.severity||'minor'}</span><div><b>${esc(x.field||'')}</b> &mdash; ${esc(x.issue||'')}</div></div>`);
  html+=section('Unsupported Claims',g.unsupportedClaims,x=>`<div class="grade-item major"><span class="sev major">unsupported</span><div><b>${esc(x.field||'')}</b>: "${esc(x.claim||'')}"${x.fix?'<br/><span style="font-size:11px;color:var(--muted);">Fix: '+esc(x.fix)+'</span>':''}</div></div>`);
  html+=section('Inconsistencies',g.inconsistencies,x=>`<div class="grade-item ${x.severity||'minor'}"><span class="sev ${x.severity||'minor'}">${x.severity||'minor'}</span><div>${esc(x.description||'')}</div></div>`);
  html+=section('Likely Underwriter Questions',g.underwriterQuestions,q=>`<div class="grade-item major"><span class="sev major">UW</span><div>${esc(typeof q==='string'?q:((q&&(q.question||q.text))||JSON.stringify(q)))}</div></div>`);
  html+=section('USPAP Issues',g.uspapIssues,x=>`<div class="grade-item critical"><span class="sev critical">USPAP</span><div>${esc(x.issue||'')}${x.citation?'<br/><span style="font-size:10px;color:var(--muted);">'+esc(x.citation)+'</span>':''}</div></div>`);
  html+=section('Strengths',g.strengths,s=>`<div class="grade-item strength">${esc(typeof s==='string'?s:((s&&(s.strength||s.text))||JSON.stringify(s)))}</div>`);
  wrap.innerHTML=html;
}

// ====== PHASE 7 — QC REVIEW AUTOMATION ======

/** @type {{ currentRunId: string|null, findings: Array, summary: object|null, history: Array }} */
const QC_STATE = { currentRunId: null, findings: [], summary: null, history: [] };

/** Called when QC tab is opened */
async function qcOnTabOpen() {
  if (!STATE.caseId) return;
  await qcLoadLatestRun();
  qcLoadHistory();
  qcLoadRegistryStats();
}

/** Run QC on the current case's latest draft package */
async function qcRunQC() {
  if (!STATE.caseId) { alert('Select a case first.'); return; }
  setStatus('qcStatus', 'Running QC checks…', 'warn');
  showErr('qcErrBox', '');
  $('qcSummaryDisplay').innerHTML = '<div class="hint">Running QC…</div>';
  $('qcFindingsDisplay').innerHTML = '<div class="hint">Running QC…</div>';

  const d = await apiFetch('/api/qc/run', { method: 'POST', body: { caseId: STATE.caseId } });
  if (!d.ok) {
    setStatus('qcStatus', 'QC failed: ' + (d.error || 'unknown'), 'err');
    showErr('qcErrBox', d.error || 'QC run failed');
    $('qcSummaryDisplay').innerHTML = '<div class="hint">QC run failed.</div>';
    $('qcFindingsDisplay').innerHTML = '';
    return;
  }

  QC_STATE.currentRunId = d.qcRunId || (d.run && d.run.id);
  setStatus('qcStatus', 'QC complete.', 'ok');

  // Load the results
  if (QC_STATE.currentRunId) {
    await qcLoadSummary(QC_STATE.currentRunId);
    await qcLoadFindings(QC_STATE.currentRunId);
    qcLoadHistory();
  }
}

/** Load the latest QC run for the current case */
async function qcLoadLatestRun() {
  if (!STATE.caseId) return;
  const d = await apiFetch('/api/cases/' + STATE.caseId + '/qc-runs');
  if (!d.ok || !d.runs || !d.runs.length) {
    $('qcSummaryDisplay').innerHTML = '<div class="hint">No QC runs yet. Click Run QC to start.</div>';
    $('qcFindingsDisplay').innerHTML = '<div class="hint">No findings to display.</div>';
    return;
  }
  const latest = d.runs[0];
  QC_STATE.currentRunId = latest.id;
  await qcLoadSummary(latest.id);
  await qcLoadFindings(latest.id);
}

/** Load and render QC summary for a given run */
async function qcLoadSummary(qcRunId) {
  const d = await apiFetch('/api/qc/runs/' + qcRunId + '/summary');
  if (!d.ok) {
    $('qcSummaryDisplay').innerHTML = '<div class="hint">Could not load summary.</div>';
    return;
  }
  QC_STATE.summary = d.summary;
  qcRenderSummary(d.summary);
}

/** Load and render QC findings for a given run */
async function qcLoadFindings(qcRunId, filters) {
  let url = '/api/qc/runs/' + qcRunId + '/findings';
  const params = [];
  if (filters) {
    if (filters.severity) params.push('severity=' + encodeURIComponent(filters.severity));
    if (filters.category) params.push('category=' + encodeURIComponent(filters.category));
    if (filters.status) params.push('status=' + encodeURIComponent(filters.status));
  }
  if (params.length) url += '?' + params.join('&');

  const d = await apiFetch(url);
  if (!d.ok) {
    $('qcFindingsDisplay').innerHTML = '<div class="hint">Could not load findings.</div>';
    return;
  }
  QC_STATE.findings = d.findings || [];
  qcRenderFindings(QC_STATE.findings);
}

/** Apply filter dropdowns and reload findings */
function qcApplyFilters() {
  if (!QC_STATE.currentRunId) return;
  const severity = $('qcFilterSeverity').value;
  const category = $('qcFilterCategory').value;
  const status = $('qcFilterStatus').value;
  qcLoadFindings(QC_STATE.currentRunId, { severity, category, status });
}

/** Load QC run history for the current case */
async function qcLoadHistory() {
  if (!STATE.caseId) return;
  const d = await apiFetch('/api/cases/' + STATE.caseId + '/qc-runs');
  if (!d.ok || !d.runs || !d.runs.length) {
    $('qcRunHistory').innerHTML = '<div class="hint">No QC runs yet.</div>';
    return;
  }
  QC_STATE.history = d.runs;
  const wrap = $('qcRunHistory');
  wrap.innerHTML = d.runs.map(r => {
    const ts = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
    const isActive = r.id === QC_STATE.currentRunId ? ' active' : '';
    const stats = r.summary_stats ? (typeof r.summary_stats === 'string' ? JSON.parse(r.summary_stats) : r.summary_stats) : null;
    const total = stats ? (stats.totalFindings || 0) : '?';
    const readiness = stats ? (stats.readinessLabel || stats.draftReadiness || '') : '';
    return `<div class="qc-run-item${isActive}" onclick="qcSwitchRun('${esc(r.id)}')">
      <div><b>${ts}</b> &mdash; ${total} findings</div>
      <div class="qc-run-meta">${readiness ? '<span class="chip">' + esc(readiness) + '</span>' : ''} v${esc(r.rule_set_version || '?')}</div>
    </div>`;
  }).join('');
}

/** Switch to a different QC run from history */
async function qcSwitchRun(qcRunId) {
  QC_STATE.currentRunId = qcRunId;
  await qcLoadSummary(qcRunId);
  await qcLoadFindings(qcRunId);
  // Update active state in history list
  document.querySelectorAll('.qc-run-item').forEach(el => el.classList.remove('active'));
  // Re-highlight
  qcLoadHistory();
}

/** Load and render registry stats */
async function qcLoadRegistryStats() {
  const d = await apiFetch('/api/qc/registry/stats');
  if (!d.ok) {
    $('qcRegistryStats').innerHTML = '<div class="hint">Could not load registry stats.</div>';
    return;
  }
  const s = d.stats;
  let html = '<div style="font-size:12px;line-height:1.8;">';
  html += '<b>Total Rules:</b> ' + (s.totalRules || 0) + '<br>';
  html += '<b>Active:</b> ' + (s.activeRules || 0) + '<br>';
  if (s.byCategory) {
    html += '<b>By Category:</b><br>';
    Object.entries(s.byCategory).forEach(([cat, count]) => {
      html += '&nbsp;&nbsp;' + esc(cat) + ': ' + count + '<br>';
    });
  }
  if (s.byType) {
    html += '<b>By Type:</b><br>';
    Object.entries(s.byType).forEach(([type, count]) => {
      html += '&nbsp;&nbsp;' + esc(type) + ': ' + count + '<br>';
    });
  }
  html += '</div>';
  $('qcRegistryStats').innerHTML = html;
}

/** Render QC summary into the summary display area */
function qcRenderSummary(summary) {
  if (!summary) { $('qcSummaryDisplay').innerHTML = '<div class="hint">No summary available.</div>'; return; }
  const s = summary;
  const sev = s.severityCounts || {};
  const total = s.totalFindings || 0;
  const readiness = s.draftReadiness || 'not_ready';
  const readinessLabel = s.readinessLabel || readiness;
  const readinessDesc = s.readinessDescription || '';
  const readinessColor = s.readinessColor || 'var(--muted)';

  // Update readiness badge in card header
  const badge = $('qcReadinessBadge');
  if (badge) {
    badge.textContent = readinessLabel;
    badge.className = 'qc-readiness ' + readiness;
    badge.style.display = 'inline-block';
  }

  // Update finding count chip
  const countChip = $('qcFindingCount');
  if (countChip) {
    countChip.textContent = total + ' finding' + (total !== 1 ? 's' : '');
    countChip.style.display = total > 0 ? 'inline-block' : 'none';
  }

  let html = '';

  // Readiness ring
  const ringColor = readiness === 'ready' ? 'var(--ok)' : readiness === 'review_recommended' ? 'var(--warn)' : readiness === 'needs_review' ? '#ff9800' : 'var(--danger)';
  const ringScore = readiness === 'ready' ? 100 : readiness === 'review_recommended' ? 75 : readiness === 'needs_review' ? 50 : 25;
  html += `<div style="display:flex;align-items:center;gap:18px;margin-bottom:14px;">
    <div class="score-ring"><div class="score-num" style="color:${ringColor}">${ringScore}</div><div class="score-label">${esc(readinessLabel)}</div></div>
    <div style="flex:1;font-size:12px;color:var(--muted);line-height:1.6;">${esc(readinessDesc)}</div>
  </div>`;

  // Severity grid
  html += '<div class="qc-summary-grid">';
  const sevOrder = ['blocker', 'high', 'medium', 'low', 'advisory'];
  sevOrder.forEach(sv => {
    const count = sev[sv] || 0;
    html += `<div class="qc-summary-cell ${sv}"><div style="font-size:20px;font-weight:800;">${count}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;">${sv}</div></div>`;
  });
  html += '</div>';

  // Top review risks
  if (s.topReviewRisks && s.topReviewRisks.length) {
    html += '<div class="grade-section"><h4>Top Review Risks</h4>';
    s.topReviewRisks.forEach(r => {
      html += `<div class="qc-risk-item"><span class="sev ${esc(r.severity || 'medium')}">${esc(r.severity || '?')}</span> ${esc(r.message || r.ruleId || '')}</div>`;
    });
    html += '</div>';
  }

  // Missing commentary families
  if (s.missingCommentaryFamilies && s.missingCommentaryFamilies.length) {
    html += '<div class="grade-section"><h4>Missing Commentary Families</h4>';
    s.missingCommentaryFamilies.forEach(f => {
      html += `<div class="qc-risk-item"><span class="sev high">missing</span> ${esc(f)}</div>`;
    });
    html += '</div>';
  }

  // Cross-section conflicts
  if (s.crossSectionConflicts && s.crossSectionConflicts > 0) {
    html += `<div class="grade-section"><h4>Cross-Section Conflicts</h4><div class="hint">${s.crossSectionConflicts} conflict(s) detected across sections.</div></div>`;
  }

  // Placeholder issues
  if (s.placeholderIssues && s.placeholderIssues > 0) {
    html += `<div class="grade-section"><h4>Placeholder Issues</h4><div class="hint">${s.placeholderIssues} unresolved placeholder(s) detected.</div></div>`;
  }

  // Fields needing attention
  if (s.fieldsNeedingAttention && s.fieldsNeedingAttention.length) {
    html += '<div class="grade-section"><h4>Fields Needing Attention</h4><div style="display:flex;flex-wrap:wrap;gap:4px;">';
    s.fieldsNeedingAttention.forEach(f => {
      html += `<span class="chip">${esc(f)}</span>`;
    });
    html += '</div></div>';
  }

  // Cleared sections
  if (s.clearedSections && s.clearedSections.length) {
    html += '<div class="grade-section"><h4>Cleared Sections</h4><div style="display:flex;flex-wrap:wrap;gap:4px;">';
    s.clearedSections.forEach(sec => {
      html += `<span class="chip" style="border-color:var(--ok);color:var(--ok);">✓ ${esc(sec)}</span>`;
    });
    html += '</div></div>';
  }

  $('qcSummaryDisplay').innerHTML = html;
}

/** Render QC findings list */
function qcRenderFindings(findings) {
  const wrap = $('qcFindingsDisplay');
  if (!findings || !findings.length) {
    wrap.innerHTML = '<div class="hint">No findings to display.</div>';
    return;
  }

  wrap.innerHTML = findings.map(f => {
    const sev = f.severity || 'medium';
    const cat = f.category || '';
    const status = f.status || 'open';
    const statusClass = status === 'dismissed' ? ' dismissed' : status === 'resolved' ? ' resolved' : '';

    let actionsHtml = '';
    if (status === 'open') {
      actionsHtml = `<button class="ghost sm" onclick="qcDismissFinding('${esc(f.id)}')">Dismiss</button>
        <button class="ghost sm" onclick="qcResolveFinding('${esc(f.id)}')">Resolve</button>`;
    } else if (status === 'dismissed' || status === 'resolved') {
      actionsHtml = `<button class="ghost sm" onclick="qcReopenFinding('${esc(f.id)}')">Reopen</button>`;
    }

    const metaParts = [];
    if (f.ruleId) metaParts.push(f.ruleId);
    if (f.sectionId) metaParts.push('Section: ' + f.sectionId);
    if (f.field) metaParts.push('Field: ' + f.field);

    let detailHtml = '';
    if (f.suggestion) {
      detailHtml += `<div class="qc-finding-detail"><b>Suggestion:</b> ${esc(f.suggestion)}</div>`;
    }
    if (f.metadata && typeof f.metadata === 'object') {
      const md = f.metadata;
      if (md.detailedMessage) {
        detailHtml += `<div class="qc-finding-detail">${esc(md.detailedMessage)}</div>`;
      }
      if (md.evidence) {
        const ev = typeof md.evidence === 'string' ? md.evidence : JSON.stringify(md.evidence);
        detailHtml += `<div class="qc-finding-detail" style="font-family:var(--mono);font-size:10px;opacity:.7;">${esc(ev).substring(0, 300)}</div>`;
      }
    }

    return `<div class="qc-finding-row ${sev}${statusClass}">
      <div class="qc-finding-body">
        <div class="qc-finding-msg"><span class="sev ${sev}">${esc(sev)}</span> ${esc(f.message || '')}</div>
        ${detailHtml}
        <div class="qc-finding-meta">${metaParts.map(p => '<span class="chip">' + esc(p) + '</span>').join(' ')}
          ${status !== 'open' ? '<span class="chip" style="border-color:var(--muted);">' + esc(status) + '</span>' : ''}
        </div>
      </div>
      <div class="qc-finding-actions">${actionsHtml}</div>
    </div>`;
  }).join('');
}

/** Dismiss a finding */
async function qcDismissFinding(findingId) {
  const note = prompt('Dismissal note (optional):') || '';
  const d = await apiFetch('/api/qc/findings/' + findingId + '/dismiss', {
    method: 'POST', body: { note, dismissedBy: 'appraiser' }
  });
  if (d.ok && QC_STATE.currentRunId) {
    qcApplyFilters();
    qcLoadSummary(QC_STATE.currentRunId);
  }
}

/** Resolve a finding */
async function qcResolveFinding(findingId) {
  const note = prompt('Resolution note (optional):') || '';
  const d = await apiFetch('/api/qc/findings/' + findingId + '/resolve', {
    method: 'POST', body: { note }
  });
  if (d.ok && QC_STATE.currentRunId) {
    qcApplyFilters();
    qcLoadSummary(QC_STATE.currentRunId);
  }
}

/** Reopen a finding */
async function qcReopenFinding(findingId) {
  const d = await apiFetch('/api/qc/findings/' + findingId + '/reopen', { method: 'POST' });
  if (d.ok && QC_STATE.currentRunId) {
    qcApplyFilters();
    qcLoadSummary(QC_STATE.currentRunId);
  }
}

// ====== NEIGHBORHOOD TEMPLATES ======
async function loadNeighborhoodTemplates(){const d=await apiFetch('/api/templates/neighborhood');renderTemplateList(d.templates||[]);}
function renderTemplateList(templates){
  const list=$('templateList');if(!list)return;
  if(!templates.length){list.innerHTML='<div class="hint">No templates saved.</div>';return;}
  window._templateStore={};templates.forEach(t=>{window._templateStore[t.id]=t;});
  list.innerHTML=templates.map(t=>'<div class="tpl-item"><span class="tpl-name" onclick="applyTemplateById('+JSON.stringify(t.id)+')">'+esc(t.name)+'</span><button class="ghost sm" onclick="deleteTemplate('+JSON.stringify(t.id||'')+')">X</button></div>').join('');
}
async function saveAsTemplate(){
  if(!STATE.factsObj){alert('No facts loaded.');return;}
  const n=STATE.factsObj.neighborhood||{};
  const boundaries=(n.boundaries&&n.boundaries.value)?n.boundaries.value:'';
  const description=(n.description&&n.description.value)?n.description.value:'';
  if(!boundaries&&!description){alert('No neighborhood facts to save.');return;}
  const name=prompt('Template name (e.g. "Veterans Pkwy Corridor"):');if(!name)return;
  const d=await apiFetch('/api/templates/neighborhood',{method:'POST',body:{name,boundaries,description}});
  if(d.ok)renderTemplateList(d.templates);
}
function applyTemplateById(id){const t=window._templateStore&&window._templateStore[id];if(t)applyTemplate(t);}
async function applyTemplate(t){
  if(!STATE.caseId){alert('Select a case first.');return;}
  if(!STATE.factsObj)STATE.factsObj={};if(!STATE.factsObj.neighborhood)STATE.factsObj.neighborhood={};
  if(t.boundaries)STATE.factsObj.neighborhood.boundaries={value:t.boundaries,confidence:'high',source:'template'};
  if(t.description)STATE.factsObj.neighborhood.description={value:t.description,confidence:'high',source:'template'};
  renderFacts(STATE.factsObj);await saveFacts();
}
async function deleteTemplate(id){
  if(!confirm('Delete this template?'))return;
  const d=await apiFetch('/api/templates/neighborhood/'+id,{method:'DELETE'});
  if(d.ok)renderTemplateList(d.templates);
}

// ====== VERSION HISTORY ======
async function showHistory(btn){
  if(!STATE.caseId){alert('Select a case first.');return;}
  const card=btn.closest('.outcard'),fieldId=card.dataset.fieldId,drop=card.querySelector('.hist-drop');
  if(drop.classList.contains('open')){drop.classList.remove('open');btn.textContent='History';return;}
  btn.textContent='Loading...';
  const d=await apiFetch('/api/cases/'+STATE.caseId+'/history');btn.textContent='History';
  if(!d.ok)return;
  const versions=(d.history||{})[fieldId]||[];
  if(!versions.length){drop.innerHTML='<div class="hist-meta" style="padding:8px;">No previous versions yet.</div>';}
  else{drop.innerHTML=versions.map((v,i)=>'<div class="hist-item"><div class="hist-meta">v'+(i+1)+' &bull; '+new Date(v.savedAt).toLocaleString()+'</div><div class="hist-preview">'+esc((v.text||'').slice(0,200))+'</div><button class="ghost sm" style="margin-top:5px;" onclick="restoreVersion(this,'+i+')">Restore</button></div>').join('');drop._versions=versions;}
  drop.classList.add('open');
}
function restoreVersion(btn,idx){
  const card=btn.closest('.outcard'),drop=card.querySelector('.hist-drop');
  if(!drop._versions||!drop._versions[idx])return;
  const v=drop._versions[idx];card.querySelector('.editArea').value=v.text;card.querySelector('.outbody').textContent=v.text;
  drop.classList.remove('open');card.querySelector('[onclick="showHistory(this)"]').textContent='History';
}

// ====== EXPORT ======
function exportAll(){
  const cards=document.querySelectorAll('.outcard');if(!cards.length){alert('No outputs to export.');return;}
  let txt='CRESCI APPRAISAL WRITER - NARRATIVE EXPORT\nCase: '+(STATE.caseId||'Unknown')+'\nForm: '+(STATE.formType||'1004')+'\nDate: '+new Date().toLocaleString()+'\n'+'='.repeat(60)+'\n\n';
  cards.forEach(card=>{const title=card._title||card.dataset.fieldId||'Field';const text=card.querySelector('.editArea').value||card.querySelector('.outbody').textContent||'';txt+=title.toUpperCase()+'\n'+'-'.repeat(title.length)+'\n'+text.trim()+'\n\n';});
  const blob=new Blob([txt],{type:'text/plain'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='narratives-'+(STATE.caseId||'export')+'.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

// ====== VOICE TRAINING ======

// ── Drag-and-drop multi-PDF upload ────────────────────────────────────────────

function handleVoiceDrop(e) {
  e.preventDefault();
  document.getElementById('voice-drop-zone').style.borderColor = 'var(--border)';
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (files.length) processVoiceFiles(files);
  else setStatus('voiceImportStatus', 'Please drop PDF files only.', 'err');
}

function handleVoiceFileSelect(fileList) {
  processVoiceFiles(Array.from(fileList));
}

async function processVoiceFiles(files) {
  const formType = $('voiceFormType')?.value || STATE.formType || '1004';
  const queueEl = $('voice-upload-queue');
  if (queueEl) queueEl.innerHTML = '';
  setStatus('voiceImportStatus', `Uploading ${files.length} file${files.length !== 1 ? 's' : ''}...`, 'warn');

  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const safeId = 'vstatus_' + file.name.replace(/[^a-z0-9]/gi, '_');
    if (queueEl) {
      const itemEl = document.createElement('div');
      itemEl.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;';
      itemEl.innerHTML = `<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(file.name)}</span><span id="${safeId}" style="color:var(--warn);white-space:nowrap;">uploading…</span>`;
      queueEl.appendChild(itemEl);
    }

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('formType', formType);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      const r = await fetch(server() + '/api/voice/import-pdf', {
        method: 'POST',
        headers: { 'X-API-Key': CACC_API_KEY },
        body: fd,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await r.json();
      const statusEl = document.getElementById(safeId);
      if (data.ok) {
        if (statusEl) { statusEl.textContent = `✓ ${(data.extracted || data.extractedCount || 0)} examples`; statusEl.style.color = 'var(--ok)'; }
        successCount++;
      } else {
        if (statusEl) { statusEl.textContent = `✗ ${data.error || 'failed'}`; statusEl.style.color = 'var(--danger)'; }
        errorCount++;
      }
    } catch (err) {
      const statusEl = document.getElementById(safeId);
      if (statusEl) { statusEl.textContent = err.name === 'AbortError' ? '✗ timeout' : '✗ error'; statusEl.style.color = 'var(--danger)'; }
      errorCount++;
    }
  }

  if (errorCount === 0) {
    setStatus('voiceImportStatus', `✓ ${successCount} file${successCount !== 1 ? 's' : ''} imported successfully.`, 'ok');
  } else if (successCount > 0) {
    setStatus('voiceImportStatus', `${successCount} imported, ${errorCount} failed.`, 'warn');
  } else {
    setStatus('voiceImportStatus', `All ${errorCount} file${errorCount !== 1 ? 's' : ''} failed to import.`, 'err');
  }

  setTimeout(() => loadVoiceExamples(), 500);
}

// ── ACI XML upload for voice training ────────────────────────────────────────

function handleVoiceXmlDrop(e) {
  e.preventDefault();
  document.getElementById('voice-xml-drop-zone').style.borderColor = 'var(--border)';
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.xml'));
  if (files.length) processVoiceXmlFiles(files);
  else setStatus('voiceXmlImportStatus', 'Please drop .xml files only.', 'err');
}

function handleVoiceXmlSelect(fileList) {
  processVoiceXmlFiles(Array.from(fileList));
}

async function processVoiceXmlFiles(files) {
  const queueEl = $('voice-xml-queue');
  if (queueEl) queueEl.innerHTML = '';
  setStatus('voiceXmlImportStatus', `Processing ${files.length} XML file${files.length !== 1 ? 's' : ''}...`, 'warn');

  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const safeId = 'vxmlstatus_' + file.name.replace(/[^a-z0-9]/gi, '_');
    if (queueEl) {
      const itemEl = document.createElement('div');
      itemEl.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;';
      itemEl.innerHTML = `<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📋 ${esc(file.name)}</span><span id="${safeId}" style="color:var(--warn);white-space:nowrap;">parsing…</span>`;
      queueEl.appendChild(itemEl);
    }

    try {
      const fd = new FormData();
      fd.append('file', file);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300000);
      const r = await fetch(server() + '/api/intake/xml', {
        method: 'POST',
        headers: { 'X-API-Key': CACC_API_KEY },
        body: fd,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await r.json();
      const statusEl = document.getElementById(safeId);
      if (data.ok) {
        const parts = [];
        if (data.comps && data.comps.length) parts.push(`${data.comps.length} comps`);
        if (data.narrativeKeys && data.narrativeKeys.length) parts.push(`${data.narrativeKeys.length} sections`);
        if (data.hasPdf) parts.push('PDF saved');
        if (statusEl) {
          statusEl.textContent = `✓ Case ${data.caseId}${parts.length ? ' · ' + parts.join(', ') : ''}`;
          statusEl.style.color = 'var(--ok)';
        }
        successCount++;
      } else {
        if (statusEl) { statusEl.textContent = `✗ ${data.error || 'failed'}`; statusEl.style.color = 'var(--danger)'; }
        errorCount++;
      }
    } catch (err) {
      const statusEl = document.getElementById(safeId);
      if (statusEl) { statusEl.textContent = err.name === 'AbortError' ? '✗ timeout' : '✗ error'; statusEl.style.color = 'var(--danger)'; }
      errorCount++;
    }
  }

  if (errorCount === 0) {
    setStatus('voiceXmlImportStatus', `✓ ${successCount} XML${successCount !== 1 ? 's' : ''} imported. Cases created with full facts + comps.`, 'ok');
  } else if (successCount > 0) {
    setStatus('voiceXmlImportStatus', `${successCount} imported, ${errorCount} failed.`, 'warn');
  } else {
    setStatus('voiceXmlImportStatus', `All ${errorCount} XML${errorCount !== 1 ? 's' : ''} failed.`, 'err');
  }

  // Reload examples in case PDFs were extracted and voice-imported
  setTimeout(() => loadVoiceExamples(), 1000);
}

// ── Voice Training Library (folder status for all form types) ─────────────────

const VOICE_FORM_TYPES = [
  { id: '1004', label: '1004 Single Family' },
  { id: '1025', label: '1025 Small Income' },
  { id: '1073', label: '1073 Condo' },
  { id: 'commercial', label: 'Commercial' },
  { id: '1004c', label: '1004C Manufactured' },
];

async function refreshVoiceLibrary() {
  const el = $('voiceLibraryStatus');
  if (el) el.innerHTML = '<span style="color:var(--muted)">Checking folders…</span>';

  const results = await Promise.allSettled(
    VOICE_FORM_TYPES.map(ft =>
      apiFetch('/api/voice/folder-status?formType=' + encodeURIComponent(ft.id))
        .then(d => ({ ft, d }))
    )
  );

  if (!el) return;
  el.innerHTML = '';

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { ft, d } = result.value;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);gap:8px;';

    if (!d.ok || !d.folderExists || !d.total) {
      row.innerHTML = `<span style="font-size:12px;color:var(--muted);">${esc(ft.label)}</span><span style="font-size:11px;color:var(--muted);">no folder</span>`;
    } else {
      const newCount = d.newCount || 0;
      const importBtn = newCount > 0
        ? `<button class="sm" onclick="bulkImportVoiceFolder('${ft.id}',this)" style="white-space:nowrap;">Import ${newCount} New</button>`
        : `<span style="font-size:10px;color:var(--ok);">✓ all imported</span>`;
      row.innerHTML = `<div style="flex:1;min-width:0;"><div style="font-size:12px;color:var(--text);">${esc(ft.label)}</div><div style="font-size:10px;color:var(--muted);">${d.total} PDF${d.total !== 1 ? 's' : ''} in folder${newCount > 0 ? ` · ${newCount} new` : ''}</div></div>${importBtn}`;
    }
    el.appendChild(row);
  }

  if (!el.children.length) {
    el.innerHTML = '<span style="color:var(--muted);font-size:12px;">No voice_pdfs/ subfolders found. Drop PDFs into voice_pdfs/1004/, voice_pdfs/1025/, etc.</span>';
  }
}

async function bulkImportVoiceFolder(formType, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Importing…';
  const d = await apiFetch('/api/voice/import-folder', { method: 'POST', body: { formType }, timeout: 300000 });
  if (d.ok) {
    const imported = d.imported || [];
    btn.textContent = imported.length ? `✓ ${imported.length} done` : '✓ none new';
    btn.style.color = 'var(--ok)';
    if (imported.length) await loadVoiceExamples();
  } else {
    btn.textContent = '✗ error';
    btn.style.color = 'var(--danger)';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = origText; btn.style.color = ''; }, 3000);
  }
  // Refresh library counts
  setTimeout(() => refreshVoiceLibrary(), 500);
}

async function uploadVoicePdf(){
  const fileInput=$('voicePdfFile');
  if(!fileInput.files||!fileInput.files[0]){alert('Select a PDF file first.');return;}
  const file=fileInput.files[0];
  if(!file.name.toLowerCase().endsWith('.pdf')){alert('Only PDF files are supported.');return;}
  const formType=$('voiceFormType').value||STATE.formType||'1004';
  setStatus('voiceImportStatus','Extracting narratives... this may take 30-60 seconds.','warn');
  const formData=new FormData();formData.append('file',file);formData.append('formType',formType);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),180000);
  try {
    const r=await fetch(server()+'/api/voice/import-pdf',{method:'POST',body:formData,signal:ctrl.signal});
    clearTimeout(timer);const d=await r.json();
    if(!d.ok){setStatus('voiceImportStatus','Error: '+d.error,'err');return;}
    setStatus('voiceImportStatus','Imported '+d.extracted.length+' fields from '+d.filename,'ok');
    fileInput.value='';await loadVoiceExamples();
  } catch(e){clearTimeout(timer);if(e.name==='AbortError'){setStatus('voiceImportStatus','Timed out after 3 minutes.','err');return;}setStatus('voiceImportStatus','Error: '+e.message,'err');}
}
async function loadVoiceExamples(){const ft=$('voiceFormType')?.value||STATE.formType||'1004';const d=await apiFetch('/api/voice/examples?formType='+encodeURIComponent(ft));if(!d.ok)return;renderVoiceExamples(d);}
function renderVoiceExamples(data){
  const wrap=$('voiceExamplesList');
  if(!data.imports||!data.imports.length){wrap.innerHTML='<div class="hint">No reports imported yet.</div>';return;}
  wrap.innerHTML='<div class="hint" style="margin-bottom:10px;">'+data.total+' total examples across '+data.imports.length+' report(s).</div>';
  for(const imp of data.imports){
    const div=document.createElement('div');div.className='voice-import';
    const date=imp.importedAt?new Date(imp.importedAt).toLocaleDateString():'';
    const formCfg=FORM_CONFIGS_CACHE[imp.formType||'1004']||STATE.formConfig;
    const voiceFields=formCfg?formCfg.voiceFields:getActiveVoiceFields();
    const fieldCount=voiceFields?voiceFields.length:0;
    const chips=(voiceFields||[]).map(f=>{const has=imp.fields.includes(f.id);return'<span class="vchip'+(has?'':' missing')+'" title="'+esc(f.title)+'">'+esc(f.title)+'</span>';}).join('');
    const formLabel=imp.formType?'<span class="form-badge" style="margin-left:6px;">'+esc((imp.formType||'').toUpperCase())+'</span>':'';
    const prevId='prev-'+imp.importId;
    const previewsHtml=Object.entries(imp.previews||{}).map(([fid,text])=>{
      const title=(voiceFields||[]).find(f=>f.id===fid)?.title||fid;
      return'<div style="margin-bottom:10px;"><div style="font-size:10px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">'+esc(title)+'</div>'
        +'<div style="font-size:11px;color:var(--text);font-family:var(--mono);line-height:1.5;white-space:pre-wrap;opacity:.85;">'+esc(text)+'</div></div>';
    }).join('<div class="sep" style="margin:8px 0;"></div>');
    div.innerHTML='<div class="voice-import-head"><div><div class="voice-import-filename">'+esc(imp.filename)+formLabel+'</div><div class="voice-import-meta">Imported '+date+' &bull; '+imp.fields.length+'/'+fieldCount+' fields extracted</div></div>'
      +'<div style="display:flex;gap:6px;">'
      +(previewsHtml?'<button class="ghost sm" onclick="toggleEl(\''+prevId+'\',this)">Preview</button>':'')
      +'<button class="sm danger" onclick="deleteVoiceImport('+JSON.stringify(imp.importId)+',this)">Remove</button>'
      +'</div></div>'
      +'<div class="voice-field-chips">'+chips+'</div>'
      +'<div id="'+prevId+'" style="display:none;padding:10px 14px;border-top:1px solid var(--border);max-height:320px;overflow-y:auto;">'+previewsHtml+'</div>';
    wrap.appendChild(div);
  }
}
async function deleteVoiceImport(importId,btn){
  if(!confirm('Remove this imported report from voice training?'))return;
  btn.disabled=true;btn.textContent='...';
  const d=await apiFetch('/api/voice/examples/import/'+importId,{method:'DELETE'});
  if(!d.ok){alert('Error: '+d.error);btn.disabled=false;btn.textContent='Remove';return;}
  await loadVoiceExamples();
}

// ====== FOLDER SCAN ======
async function checkFolderStatus() {
  const ft=$('voiceFormType')?.value||STATE.formType||'1004';
  const statusEl=$('folderStatus');
  if(statusEl)statusEl.textContent='Checking...';
  const d=await apiFetch('/api/voice/folder-status?formType='+encodeURIComponent(ft));
  if(!d.ok){if(statusEl)statusEl.textContent='Error: '+d.error;return;}
  if(!d.folderExists){if(statusEl)statusEl.textContent='Folder voice_pdfs/'+ft+'/ not found.';return;}
  if(!d.total){if(statusEl)statusEl.textContent='voice_pdfs/'+ft+'/ is empty — drop PDFs in to get started.';return;}
  const newCount=d.newCount||0;
  const msg=newCount>0
    ?newCount+' new PDF'+(newCount>1?'s':'')+' ready to import ('+d.total+' total in folder)'
    :'All '+d.total+' PDF'+(d.total>1?'s':'')+' already imported — drop new ones in to add more';
  if(statusEl)statusEl.textContent=msg;
  // Show file list in folderScanStatus
  const scanEl=$('folderScanStatus');
  if(scanEl&&d.files&&d.files.length){
    scanEl.className='status';
    scanEl.innerHTML=d.files.map(f=>'<span style="display:inline-block;margin:2px 4px 2px 0;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid '+(f.imported?'rgba(85,209,143,.3)':'rgba(245,200,66,.3)')+';color:'+(f.imported?'var(--ok)':'var(--warn)')+';">'+esc(f.filename)+(f.imported?' ✓':' NEW')+'</span>').join('');
  }
}

async function scanVoiceFolder() {
  const ft=$('voiceFormType')?.value||STATE.formType||'1004';
  const statusEl=$('folderScanStatus');
  const folderStatusEl=$('folderStatus');
  setStatus('folderScanStatus','Scanning voice_pdfs/'+ft+'/ ...','warn');
  if(folderStatusEl)folderStatusEl.textContent='';
  const d=await apiFetch('/api/voice/import-folder',{method:'POST',body:{formType:ft},timeout:300000});
  if(!d.ok){setStatus('folderScanStatus','Error: '+d.error,'err');return;}
  const imported=d.imported||[],skipped=d.skipped||[],errors=d.errors||[];
  if(!d.scanned){
    setStatus('folderScanStatus','No PDFs found in voice_pdfs/'+ft+'/. Drop PDF files into that folder first.','warn');
    return;
  }
  if(!imported.length&&!errors.length){
    setStatus('folderScanStatus','All '+skipped.length+' PDF'+(skipped.length!==1?'s':'')+' already imported. Drop new PDFs into voice_pdfs/'+ft+'/ to add more.','ok');
    return;
  }
  let msg='Scanned '+d.scanned+' PDF'+(d.scanned!==1?'s':'')+'. ';
  if(imported.length)msg+='Imported '+imported.length+' new ('+imported.map(f=>f.filename).join(', ')+').';
  if(skipped.length)msg+=' Skipped '+skipped.length+' already imported.';
  if(errors.length)msg+=' '+errors.length+' error'+(errors.length!==1?'s':'')+': '+errors.map(e=>e.filename+' — '+e.error).join('; ');
  setStatus('folderScanStatus',msg,errors.length&&!imported.length?'err':imported.length?'ok':'warn');
  if(imported.length)await loadVoiceExamples();
}

// ====== GENERATE CORE SECTIONS (Phase 2 — active scope: 1004 + commercial) ======

/**
 * generateCoreSections()
 * One-click: calls POST /api/cases/:caseId/generate-core (draft + two-pass review).
 * Active production scope only: 1004 (ACI) and commercial (Real Quantum).
 * Deferred form types are blocked client-side before the request is sent.
 */
async function generateCoreSections() {
  if (!STATE.caseId) { alert('Select a case first.'); return; }
  if (isDeferredFormId(STATE.formType)) {
    alert(
      `⚡ Core Sections is not available for form type "${STATE.formType}".\n` +
      `Active forms: ${_activeFormIds.join(', ')}.`
    );
    return;
  }

  const btn = $('genCoreBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Generating…'; }
  setStatus('genStatus', 'Generating core sections (draft + review pass)…', 'warn');
  showErr('genErrBox', '');

  // Show core panel with loading state
  const panel = $('coreSectionsPanel');
  const list  = $('coreSectionsList');
  if (panel) panel.classList.add('visible');
  if (list)  list.innerHTML = '<div class="hint" style="padding:4px 0;">Generating…</div>';

  try {
    const d = await apiFetch('/api/cases/' + STATE.caseId + '/generate-core', {
      method:  'POST',
      body:    { twoPass: true },
      timeout: 360000, // 6 min — 5 sections × 2-pass each
    });

    if (!d.ok) {
      const msg = d.error || d.message || 'Unknown error';
      setStatus('genStatus', 'Core generation failed: ' + msg, 'err');
      showErr('genErrBox', JSON.stringify(d, null, 2));
      if (list) list.innerHTML = '<div class="hint" style="color:var(--danger);">Failed: ' + esc(msg) + '</div>';
      return;
    }

    // Merge results into STATE.outputs
    if (d.results) Object.assign(STATE.outputs, d.results);

    // Render results into the output panel
    renderCoreSectionResults(d);

    // Update core panel with per-section status rows
    if (list && d.coreSections) {
      list.innerHTML = d.coreSections.map(sid => {
        const r   = (d.results || {})[sid];
        const err = (d.errors  || {})[sid];
        const status = err ? 'error' : (r?.sectionStatus || 'drafted');
        const name   = r?.title || sid;
        return '<div class="core-section-row">'
          + '<span class="core-section-name">' + esc(name) + '</span>'
          + sectionStatusBadge(status)
          + (err ? '<span style="font-size:10px;color:var(--danger);margin-left:4px;">' + esc(err) + '</span>' : '')
          + '</div>';
      }).join('') || '<div class="hint">No sections returned.</div>';
    }

    const gen  = d.generated || 0;
    const fail = d.failed    || 0;
    setStatus(
      'genStatus',
      `Core sections: ${gen} generated${fail ? ', ' + fail + ' failed' : ''}.`,
      fail && !gen ? 'err' : gen ? 'ok' : 'warn'
    );

    // Auto-scroll to first new output card
    const firstCard = $('output')?.querySelector('.outcard');
    if (firstCard) firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (e) {
    setStatus('genStatus', 'Network error: ' + e.message, 'err');
    showErr('genErrBox', String(e));
    if (list) list.innerHTML = '<div class="hint" style="color:var(--danger);">Network error: ' + esc(e.message) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Core Sections'; }
  }
}

/**
 * renderCoreSectionResults(data)
 * Renders generate-core results into the #output panel.
 * Replaces any existing cards for those fields; inserts in active field order.
 */
function renderCoreSectionResults(data) {
  const out = $('output');
  if (!out) return;
  const results     = data.results     || {};
  const coreSections = data.coreSections || Object.keys(results);
  const activeFields = getActiveFields();

  for (const sid of coreSections) {
    const r = results[sid];
    if (!r || !r.text) continue;

    // Remove existing card for this field
    const existing = out.querySelector(`.outcard[data-field-id="${sid}"]`);
    if (existing) existing.remove();

    const card = makeOutputCard(sid, r.title || sid, r.text, '', {
      sectionStatus: r.sectionStatus || 'drafted',
    });

    // Insert in active field order (same logic as runBatch)
    const idx = activeFields.findIndex(af => af.id === sid);
    const fieldsAfter = activeFields.slice(idx + 1).map(ff => ff.id);
    const ins = Array.from(out.querySelectorAll('.outcard'))
      .find(c => fieldsAfter.includes(c.dataset.fieldId));
    if (ins) out.insertBefore(card, ins);
    else out.appendChild(card);
  }
}

// ====== INSERT TO AGENT ======
// Routes to ACI (residential) or Real Quantum (commercial) based on active form type.
async function insertField(btn) {
  const card = btn.closest('.outcard');
  const fieldId = card.dataset.fieldId;
  const text = (card.querySelector('.editArea').value || card.querySelector('.outbody').textContent || '').trim();
  if (!text) { alert('No text to insert.'); return; }

  const isCommercial = STATE.formType === 'commercial';
  const endpoint = isCommercial ? '/api/insert-rq' : '/api/insert-aci';
  const agentLabel = isCommercial ? 'RQ' : 'ACI';

  btn.disabled = true;
  btn.textContent = 'Inserting…';

  const d = await apiFetch(endpoint, {
    method: 'POST',
    body: { fieldId, text, formType: STATE.formType }
  });

  if (d.ok) {
    btn.textContent = '✓ Inserted';
    btn.classList.add('ok');
    setTimeout(() => {
      btn.textContent = '→ ' + agentLabel;
      btn.classList.remove('ok');
      btn.disabled = false;
    }, 2500);
  } else {
    const msg = d.error || 'Unknown error';
    const agentNotRunning = msg.includes('not running') || msg.includes('ECONNREFUSED');

    if (agentNotRunning) {
      // Agent not running — offer clipboard fallback
      const useFallback = confirm(
        `${agentLabel} agent is not running.\n\n` +
        `Would you like to copy the text to clipboard instead?\n` +
        `(You will need to paste it manually into ${agentLabel}.)`
      );
      if (useFallback) {
        btn.textContent = '→ ' + agentLabel;
        btn.disabled = false;
        await clipboardFallback(fieldId, 'Agent not running: ' + agentLabel);
        return;
      }
    } else {
      alert('Insert failed: ' + msg);
    }

    btn.textContent = '→ ' + agentLabel;
    btn.disabled = false;
  }
}

/**
 * clipboardFallback(fieldId)
 * Server-side clipboard fallback — calls POST /api/cases/:caseId/sections/:fieldId/copy.
 *
 * This is the EXPLICIT manual completion path when automatic insertion fails.
 * The server marks the section as 'copied' (distinct from 'inserted'/'verified').
 * The UI must clearly show that manual paste is still required.
 *
 * @param {string} fieldId
 * @param {string} [failureReason] - optional reason why auto-insert failed
 */
async function clipboardFallback(fieldId, failureReason) {
  if (!STATE.caseId) {
    alert('No case selected. Cannot activate clipboard fallback.');
    return;
  }

  // Find the output card for this field
  const card = document.querySelector(`.outcard[data-field-id="${fieldId}"]`);
  const btn  = card?.querySelector('.insertBtn');

  if (btn) { btn.disabled = true; btn.textContent = '📋 Copying…'; }

  try {
    const d = await apiFetch(
      '/api/cases/' + STATE.caseId + '/sections/' + encodeURIComponent(fieldId) + '/copy',
      {
        method:  'POST',
        body:    failureReason ? { failureReason } : {},
        timeout: 10000,
      }
    );

    if (!d.ok) {
      alert('Clipboard fallback failed: ' + (d.error || 'Unknown error'));
      if (btn) { btn.disabled = false; btn.textContent = '→ ' + (STATE.formType === 'commercial' ? 'RQ' : 'ACI'); }
      return;
    }

    // Copy the returned text to the system clipboard
    const copied = await copyToClipboard(d.text || '');

    // Update the card's status badge to 'copied'
    if (card) {
      card.dataset.sectionStatus = 'copied';
      const existingBadge = card.querySelector('.ss-badge');
      if (existingBadge) existingBadge.outerHTML = sectionStatusBadge('copied');
    }

    // Update the insert button to show clipboard state
    if (btn) {
      btn.textContent = copied ? '📋 Copied' : '📋 Copy failed';
      btn.classList.add('ok');
      btn.disabled = false;
      setTimeout(() => {
        btn.textContent = '→ ' + (STATE.formType === 'commercial' ? 'RQ' : 'ACI');
        btn.classList.remove('ok');
      }, 4000);
    }

    // Show a clear manual-paste-required message
    const targetLabel = d.target?.label || (STATE.formType === 'commercial' ? 'Real Quantum' : 'ACI');
    const msg = copied
      ? `📋 Text copied to clipboard.\n\nManual paste required — automatic insertion did not complete.\n\nPaste into ${targetLabel} for field: "${fieldId}".\n\nSection status is now "copied" — this is NOT a verified insertion.`
      : `⚠ Clipboard copy failed.\n\nPlease manually copy the text from the output card and paste it into ${targetLabel} for field: "${fieldId}".`;
    alert(msg);

  } catch (e) {
    alert('Clipboard fallback error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '→ ' + (STATE.formType === 'commercial' ? 'RQ' : 'ACI'); }
  }
}

// ====== CONCESSION CALCULATOR ======
function concCalc(){
  const price=parseFloat($('concSalePrice').value)||0,conc=parseFloat($('concAmount').value)||0,res=$('concResult');
  if(!price){res.style.display='none';return;}
  const net=price-conc,pct=((conc/price)*100).toFixed(2);
  $('concNet').textContent='$'+net.toLocaleString();$('concPct').textContent=pct+'%';
  $('concText').textContent='Comp sale price of $'+price.toLocaleString()+' includes seller concessions of $'+conc.toLocaleString()+' ('+pct+'%). Net adjusted price: $'+net.toLocaleString()+'.';
  res.style.display='block';
}
function insertConcession(){const txt=$('concText').textContent;if(!txt)return;navigator.clipboard.writeText(txt).then(()=>alert('Copied to clipboard. Paste into ACI notes or SCA prompt.'));}

// ====== AGENT MANAGEMENT ======
let _agentStatus = { aci: false, rq: false, openai: null };

async function checkAgentStatus() {
  try {
    const d = await apiFetch('/api/agents/status', { timeout: 5000 });
    if (!d.ok) return;
    _agentStatus.aci = !!d.aci;
    _agentStatus.rq  = !!d.rq;
    updateAgentBadge('aci', _agentStatus.aci);
    updateAgentBadge('rq',  _agentStatus.rq);
  } catch {}
  // Also update OpenAI status from health/detailed
  try {
    const h = await apiFetch('/api/health/detailed', { timeout: 6000 });
    if (h.ok) {
      const openaiReady = h.ai && h.ai.ready;
      _agentStatus.openai = openaiReady;
      const dot = document.getElementById('openaiDot');
      const label = document.getElementById('openaiLabel');
      if (dot) dot.className = 'dot ' + (openaiReady ? 'ok' : (h.aiKeySet ? 'warn' : 'err'));
      if (label) label.textContent = openaiReady ? 'OpenAI ✓' : (h.aiKeySet ? 'OpenAI ⚠' : 'OpenAI ✗');
      if (!dot) {} // badge not present, skip
    }
  } catch {}
}

function updateAgentBadge(type, online) {
  const dot   = $(type + 'Dot');
  const label = $(type + 'Label');
  const btn   = $(type + 'Btn');
  if (!dot) return;
  dot.className = 'dot ' + (online ? 'ok' : 'err');
  if (label) label.textContent = type.toUpperCase() + (online ? ' Online' : ' Offline');
  if (btn) {
    btn.textContent = online ? 'Stop' : 'Start';
    btn.style.color = online ? 'var(--danger)' : 'var(--text)';
    btn.style.borderColor = online ? 'rgba(255,92,92,.35)' : 'var(--border)';
    btn.disabled = false;
  }
}

async function toggleAgent(type) {
  const btn = $(type + 'Btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const online = _agentStatus[type];
  const endpoint = online ? `/api/agents/${type}/stop` : `/api/agents/${type}/start`;
  try {
    await apiFetch(endpoint, { method: 'POST', body: {}, timeout: 8000 });
  } catch {}
  // Re-check after a short delay (give Python time to start/stop)
  setTimeout(checkAgentStatus, online ? 600 : 2500);
}

// ====== ASSIGNMENT METADATA HELPERS ======

/**
 * populateAssignmentFields(meta)
 * Fills all 4 assignment cards from a loaded case meta object.
 * Handles null/undefined gracefully for backward-compatible old cases.
 */
function populateAssignmentFields(meta) {
  if(!meta) return;
  const set = (id, val) => { const el=$(id); if(el) el.value = val||''; };
  const setSelect = (id, val) => {
    const el=$(id); if(!el) return;
    // Only set if the value exists as an option; otherwise leave at default
    if(val && Array.from(el.options).some(o=>o.value===val)) el.value=val;
    else el.value='';
  };
  // Card 1: Basic Assignment Info
  setSelect('newFormType',        meta.formType);
  setSelect('propertyType',       meta.propertyType);
  setSelect('assignmentPurpose',  meta.assignmentPurpose);
  setSelect('loanProgram',        meta.loanProgram);
  // Card 2: Assignment Details
  setSelect('occupancyType',      meta.occupancyType);
  setSelect('subjectCondition',   meta.subjectCondition);
  setSelect('reportConditionMode',meta.reportConditionMode);
  set('clientName',               meta.clientName);
  set('lenderName',               meta.lenderName);
  set('amcName',                  meta.amcName);
  // Card 3: Location & Market
  set('metaState',                meta.state||'IL');
  set('metaCounty',               meta.county);
  set('metaCity',                 meta.city);
  set('marketArea',               meta.marketArea);
  set('metaNeighborhood',         meta.neighborhood);
  setSelect('marketType',         meta.marketType);
  // Card 4: Notes
  set('assignmentNotes',          meta.assignmentNotes);
  set('unresolvedIssues',         Array.isArray(meta.unresolvedIssues)?meta.unresolvedIssues.join('\n'):'');
}

/**
 * renderCaseMetadata(meta)
 * Renders metadata summary chips in the Notes card (#metaChips).
 */
function renderCaseMetadata(meta) {
  const wrap=$('metaChips');
  if(!wrap) return;
  const chips=[];
  if(meta.assignmentPurpose) chips.push(`<span class="meta-chip purpose">${esc(meta.assignmentPurpose)}</span>`);
  if(meta.loanProgram)       chips.push(`<span class="meta-chip loan">${esc(meta.loanProgram)}</span>`);
  if(meta.propertyType)      chips.push(`<span class="meta-chip">${esc(meta.propertyType)}</span>`);
  if(meta.subjectCondition)  chips.push(`<span class="meta-chip cond-rating">${esc(meta.subjectCondition)}</span>`);
  if(meta.reportConditionMode) chips.push(`<span class="meta-chip condition">${esc(meta.reportConditionMode)}</span>`);
  const geo=[meta.city,meta.county,meta.state].filter(Boolean).join(', ');
  if(geo) chips.push(`<span class="meta-chip geo">${esc(geo)}</span>`);
  if(meta.marketType) chips.push(`<span class="meta-chip">${esc(meta.marketType)}</span>`);
  if(Array.isArray(meta.unresolvedIssues)&&meta.unresolvedIssues.length){
    chips.push(`<span class="meta-chip status">Issues: ${meta.unresolvedIssues.length}</span>`);
  }
  if(!chips.length){ wrap.style.display='none'; return; }
  wrap.style.display='flex';
  wrap.innerHTML=chips.join('');
}

// ── Workflow status label + CSS class map ─────────────────────────────────────
const WF_LABELS = {
  facts_incomplete:       'Facts Incomplete',
  ready_for_generation:   'Ready to Generate',
  generation_in_progress: 'Generating…',
  sections_drafted:       'Sections Drafted',
  awaiting_review:        'Awaiting Review',
  automation_ready:       'Automation Ready',
  insertion_in_progress:  'Inserting…',
  verified:               'Verified ✓',
  exception_flagged:      'Exception Flagged',
};
const WF_CLASS = {
  facts_incomplete:       'wf-err',
  ready_for_generation:   'wf-ok',
  generation_in_progress: 'wf-warn',
  sections_drafted:       'wf-warn',
  awaiting_review:        'wf-warn',
  automation_ready:       'wf-ok',
  insertion_in_progress:  'wf-warn',
  verified:               'wf-ok',
  exception_flagged:      'wf-err',
};

/**
 * updateWorkflowBadge(status)
 * Updates the header workflow status badge.
 */
function updateWorkflowBadge(status) {
  const badge=$('workflowBadge');
  if(!badge) return;
  if(!status){ badge.style.display='none'; return; }
  badge.style.display='inline-flex';
  badge.className='wf-badge '+(WF_CLASS[status]||'wf-warn');
  badge.textContent=WF_LABELS[status]||status;
}

// ====== MISSING FACTS PANEL ======

/**
 * checkMissingFacts(fieldIds)
 * Calls /api/cases/:id/missing-facts and returns warnings array.
 * Returns [] if no warnings or if the endpoint is unavailable.
 */
async function checkMissingFacts(fieldIds) {
  if(!STATE.caseId||!fieldIds||!fieldIds.length) return [];
  try {
    const d=await apiFetch('/api/cases/'+STATE.caseId+'/missing-facts',{
      method:'POST',
      body:{fieldIds},
      timeout:8000,
    });
    if(!d.ok) return [];
    return d.warnings||[];
  } catch { return []; }
}

/**
 * showMissingFactsPanel(warnings, pendingFields)
 * Renders the warning panel and stores pending fields for proceedWithGeneration().
 */
function showMissingFactsPanel(warnings, pendingFields) {
  STATE._pendingGenFields = pendingFields;
  const panel=$('missingFactsPanel');
  const list=$('missingFactsList');
  if(!panel||!list) return;
  list.innerHTML=warnings.map(w=>{
    const cls=w.severity==='required'?'req':'rec';
    const icon=w.severity==='required'?'✗':'○';
    return `<div class="missing-item ${cls}">${icon} <b>${esc(w.field||w.fieldId||'')}</b>: ${esc(w.message||w.reason||'Missing')}</div>`;
  }).join('');
  panel.classList.add('visible');
  // Scroll panel into view
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/**
 * dismissMissingFacts()
 * Hides the warning panel and clears pending fields.
 */
function dismissMissingFacts() {
  STATE._pendingGenFields=null;
  const panel=$('missingFactsPanel');
  if(panel) panel.classList.remove('visible');
}

/**
 * proceedWithGeneration()
 * Called when user clicks "Generate with Placeholders" in the warning panel.
 */
async function proceedWithGeneration() {
  const fields=STATE._pendingGenFields;
  dismissMissingFacts();
  if(!fields||!fields.length){ setStatus('genStatus','No fields to generate.','err'); return; }
  await runBatch(fields);
}

// ══════════════════════════════════════════════════════════════════════════════
// DESKTOP PRODUCTION PHASE — Health Panel, Version Display, Export Bundle
// ══════════════════════════════════════════════════════════════════════════════

/**
 * initVersionDisplay()
 * Sets the version badge text.
 * In Electron: reads from window.electronAPI.version (injected by preload.cjs).
 * In browser: reads from /api/health and falls back to "2.0.0".
 */
async function initVersionDisplay() {
  try {
    let version = '2.0.0';
    if (window.electronAPI?.version) {
      version = window.electronAPI.version;
    } else {
      // Try to read from server health endpoint
      try {
        const r = await fetch(server() + '/api/health');
        if (r.ok) {
          const d = await r.json();
          if (d.version) version = d.version;
        }
      } catch { /* non-fatal */ }
    }
    const badge = document.getElementById('versionBadge');
    if (badge) badge.textContent = 'v' + version;
  } catch { /* non-fatal */ }
}

/**
 * renderHealthChip(id, status, detail)
 * Updates a single health strip chip's visual state.
 * @param {string} id       - Element id (e.g. 'hs-server')
 * @param {string} status   - 'healthy' | 'degraded' | 'offline' | 'checking'
 * @param {string} [detail] - Optional tooltip detail
 */
function renderHealthChip(id, status, detail) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'hs-chip ' + (status || 'checking');
  if (detail) el.title = detail;
}

/**
 * renderHealthPanel(services)
 * Renders all 5 service chips from the /api/health/services response.
 * @param {object} services - { server, aciAgent, rqAgent, knowledgeBase, approvedNarratives }
 */
function renderHealthPanel(services) {
  if (!services) return;
  const map = {
    'hs-server':     services.server,
    'hs-aciAgent':   services.aciAgent,
    'hs-rqAgent':    services.rqAgent,
    'hs-kb':         services.knowledgeBase,
    'hs-narratives': services.approvedNarratives,
  };
  for (const [id, svc] of Object.entries(map)) {
    if (svc) renderHealthChip(id, svc.status, svc.detail || '');
  }
}

/**
 * loadHealthStatus()
 * Fetches /api/health/services and updates the health strip.
 * Called on load, every 30s, and after major actions.
 */
async function loadHealthStatus() {
  // Set all chips to "checking" while polling
  ['hs-server','hs-aciAgent','hs-rqAgent','hs-kb','hs-narratives'].forEach(id => {
    renderHealthChip(id, 'checking', 'Checking...');
  });
  try {
    const r = await fetch(server() + '/api/health/services', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.ok && d.services) {
      renderHealthPanel(d.services);
    }
  } catch (err) {
    // Server unreachable — mark server offline, others unknown
    renderHealthChip('hs-server', 'offline', 'Server not reachable: ' + err.message);
    ['hs-aciAgent','hs-rqAgent','hs-kb','hs-narratives'].forEach(id => {
      renderHealthChip(id, 'offline', 'Server offline');
    });
  }
}

/**
 * showExportToast(msg, isErr, durationMs)
 * Shows a brief toast notification for export results.
 */
function showExportToast(msg, isErr = false, durationMs = 4000) {
  const toast = document.getElementById('exportToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'export-toast' + (isErr ? ' err' : '') + ' visible';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('visible');
  }, durationMs);
}

/**
 * createSupportBundle()
 * Calls POST /api/export/bundle to create a ZIP support bundle.
 * Shows toast on success/failure. Disables button during export.
 */
async function createSupportBundle() {
  const btn = document.getElementById('exportBundleBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Exporting...'; }
  try {
    const r = await fetch(server() + '/api/export/bundle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ zip: true, includeAllLogs: false }),
    });
    const d = await r.json();
    if (d.ok) {
      const name = d.bundlePath ? d.bundlePath.split(/[\\/]/).pop() : 'bundle';
      showExportToast('✓ Bundle created: ' + name, false, 5000);
    } else {
      showExportToast('✗ Export failed: ' + (d.error || 'unknown error'), true);
    }
  } catch (err) {
    showExportToast('✗ Export error: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Export Bundle'; }
    // Refresh health after export (KB write probe)
    setTimeout(loadHealthStatus, 1000);
  }
}

// ====== COMPARABLE SALES COMMENTARY ======

/**
 * generateCompCommentary()
 * Reads inputs from the Comp Commentary Panel and calls
 * POST /api/cases/:caseId/generate-comp-commentary.
 * Active scope: 1004 (ACI) and commercial (RQ) only.
 */
async function generateCompCommentary() {
  if (!STATE.caseId) { alert('Select a case first.'); return; }
  if (isDeferredFormId(STATE.formType)) {
    alert(
      `Comp Commentary is not available for form type "${STATE.formType}".\n` +
      `Active forms: ${_activeFormIds.join(', ')}.`
    );
    return;
  }

  // Collect checked adjustment categories
  const adjCategories = Array.from(
    document.querySelectorAll('#compAdjGrid input[type=checkbox]:checked')
  ).map(cb => cb.value);

  const mktAdj      = parseFloat($('compMktTimeAdj')?.value) || 0;
  const compCount   = parseInt($('compCount')?.value)        || 3;
  const searchNotes = ($('compSearchNotes')?.value || '').trim();

  // Pull subject context from loaded case meta
  const subjectCondition    = STATE.meta?.subjectCondition || '';
  const subjectPropertyType = STATE.meta?.propertyType
    || (STATE.formType === 'commercial' ? 'Commercial' : 'Single Family');
  const marketArea = STATE.meta?.marketArea || STATE.meta?.city || '';

  // ── UI: loading state ────────────────────────────────────────────────────
  const btn      = $('compGenBtn');
  const statusEl = $('compGenStatus');
  const chipEl   = $('compCommStatus');
  const outArea  = $('compOutArea');
  const outMeta  = $('compOutMeta');
  const copyBtn  = $('compCopyBtn');
  const insBtn   = $('compInsertBtn');

  if (btn)      { btn.disabled = true; btn.textContent = 'Generating…'; }
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'status warn'; statusEl.textContent = 'Generating commentary…'; }
  if (chipEl)   { chipEl.style.display = 'inline-flex'; chipEl.className = 'chip warn'; chipEl.textContent = 'Generating…'; }
  if (outArea)  outArea.classList.remove('visible');
  if (outMeta)  outMeta.style.display = 'none';
  if (copyBtn)  copyBtn.style.display = 'none';
  if (insBtn)   insBtn.style.display  = 'none';

  try {
    const d = await apiFetch(
      '/api/cases/' + STATE.caseId + '/generate-comp-commentary',
      {
        method:  'POST',
        body: {
          marketTimeAdjustmentPercent: mktAdj,
          compCount,
          adjustmentCategories: adjCategories,
          compSearchNotes:      searchNotes,
          subjectCondition,
          subjectPropertyType,
          marketArea,
          formType: STATE.formType,
        },
        timeout: 60000,
      }
    );

    if (!d.ok) {
      const msg = d.error || 'Unknown error';
      if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = 'Error: ' + msg; }
      if (chipEl)   { chipEl.className = 'chip err'; chipEl.textContent = 'Error'; }
      return;
    }

    // ── Render output text ─────────────────────────────────────────────────
    const text = d.text || '';
    if (outArea) { outArea.textContent = text; outArea.classList.add('visible'); }

    // ── Render metadata row (sources, phrases, adj summary) ───────────────
    if (outMeta) {
      const parts = [];
      if (d.sources   && d.sources.length)    parts.push('Sources: '  + d.sources.length);
      if (d.phraseIds && d.phraseIds.length)   parts.push('Phrases: '  + d.phraseIds.join(', '));
      if (adjCategories.length)                parts.push('Adj: '      + adjCategories.join(', '));
      if (mktAdj)                              parts.push('Mkt time: ' + mktAdj + '%');
      outMeta.textContent = parts.join(' · ');
      outMeta.style.display = parts.length ? 'block' : 'none';
    }

    // ── Show action buttons ────────────────────────────────────────────────
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    // Insert into ACI only for 1004 (sca_summary destination exists)
    if (insBtn && STATE.formType !== 'commercial') insBtn.style.display = 'inline-flex';

    // ── Status chip ────────────────────────────────────────────────────────
    const wc = text.trim().split(/\s+/).filter(Boolean).length;
    if (statusEl) { statusEl.className = 'status ok'; statusEl.textContent = 'Generated (' + wc + ' words).'; }
    if (chipEl)   { chipEl.className = 'chip ok'; chipEl.textContent = wc + 'w'; }

  } catch (e) {
    if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = 'Network error: ' + e.message; }
    if (chipEl)   { chipEl.className = 'chip err'; chipEl.textContent = 'Error'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Commentary'; }
  }
}

/**
 * clearCompCommentary()
 * Clears the comp commentary output area and resets all UI state.
 */
function clearCompCommentary() {
  const outArea  = $('compOutArea');
  const outMeta  = $('compOutMeta');
  const copyBtn  = $('compCopyBtn');
  const insBtn   = $('compInsertBtn');
  const statusEl = $('compGenStatus');
  const chipEl   = $('compCommStatus');
  if (outArea)  { outArea.textContent = ''; outArea.classList.remove('visible'); }
  if (outMeta)  { outMeta.textContent = ''; outMeta.style.display = 'none'; }
  if (copyBtn)  copyBtn.style.display = 'none';
  if (insBtn)   insBtn.style.display  = 'none';
  if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
  if (chipEl)   { chipEl.style.display = 'none'; chipEl.textContent = ''; }
}

/**
 * copyCompCommentary()
 * Copies the comp commentary text to the system clipboard.
 */
async function copyCompCommentary() {
  const outArea = $('compOutArea');
  const text = outArea?.textContent?.trim() || '';
  if (!text) return;
  const btn = $('compCopyBtn');
  const ok = await copyToClipboard(text);
  if (btn) {
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
  }
}

/**
 * insertCompCommentary()
 * Inserts the comp commentary into ACI via the desktop agent.
 * Uses the sca_summary destination (1004 only).
 * Falls back to clipboard copy if the agent is not running.
 */
async function insertCompCommentary() {
  const outArea = $('compOutArea');
  const text = outArea?.textContent?.trim() || '';
  if (!text) { alert('No commentary to insert.'); return; }

  const btn = $('compInsertBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Inserting…'; }

  const d = await apiFetch('/api/insert-aci', {
    method: 'POST',
    body: { fieldId: 'sca_summary', text, formType: STATE.formType },
  });

  if (d.ok) {
    if (btn) {
      btn.textContent = '✓ Inserted';
      setTimeout(() => { btn.textContent = 'Insert into ACI'; btn.disabled = false; }, 2500);
    }
  } else {
    const msg = d.error || 'Unknown error';
    const agentNotRunning = msg.includes('not running') || msg.includes('ECONNREFUSED');
    if (agentNotRunning) {
      const useFallback = confirm(
        'ACI agent is not running.\n\nCopy to clipboard instead?\n(Paste manually into ACI.)'
      );
      if (useFallback) await copyCompCommentary();
    } else {
      alert('Insert failed: ' + msg);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Insert into ACI'; }
  }
}

// ====== FULL DRAFT ORCHESTRATOR UI ==========================================
// New path: POST /api/cases/:caseId/generate-full-draft
// Polls GET /api/generation/runs/:runId/status every 1.5s until complete.
// On completion, renders metrics and enables "Load Sections into Output".
// The legacy generate path (runBatch, generateCoreSections) is UNCHANGED.
// ============================================================================

/** In-memory state for the active full-draft run */
const _FD = {
  runId:       null,
  caseId:      null,
  pollTimer:   null,
  startedAt:   null,
  elapsedTimer: null,
  lastStatus:  null,
};

/** Phase → progress % mapping (approximate) */
const FD_PHASE_PCT = {
  pending:    2,
  context:    10,
  plan:       18,
  retrieval:  28,
  analysis:   40,
  drafting:   80,
  validation: 92,
  assembly:   96,
  complete:   100,
  error:      100,
};

/** Phase IDs in order */
const FD_PHASES = ['context', 'plan', 'retrieval', 'analysis', 'drafting', 'validation'];

/**
 * generateFullDraft()
 * Triggered by the "⚡ Full Draft" button.
 * Calls POST /api/cases/:caseId/generate-full-draft, then starts polling.
 */
async function generateFullDraft() {
  if (!STATE.caseId) { alert('Select a case first.'); return; }
  if (isDeferredFormId(STATE.formType)) {
    alert(
      `Full Draft is not available for form type "${STATE.formType}".\n` +
      `Active forms: ${_activeFormIds.join(', ')}.`
    );
    return;
  }

  // Stop any existing poll
  _fdStopPoll();

  const btn = $('genFullDraftBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Starting…'; }
  setStatus('genStatus', 'Starting full-draft orchestrator…', 'warn');
  showErr('genErrBox', '');

  // Show panel immediately in loading state
  _fdShowPanel();
  _fdResetPanel();
  _fdSetPhase('context');
  _fdSetProgress(2, 'Building assignment context…');

  try {
    const d = await apiFetch(
      '/api/cases/' + STATE.caseId + '/generate-full-draft',
      { method: 'POST', body: { formType: STATE.formType }, timeout: 15000 }
    );

    if (!d.ok || !d.runId) {
      const msg = d.error || 'Orchestrator failed to start';
      setStatus('genStatus', 'Full draft error: ' + msg, 'err');
      showErr('genErrBox', msg);
      _fdSetProgress(0, 'Failed to start: ' + msg);
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Full Draft'; }
      return;
    }

    _FD.runId   = d.runId;
    _FD.caseId  = STATE.caseId;
    _FD.startedAt = Date.now();

    // Start elapsed timer
    _fdStartElapsedTimer();

    // Start polling
    _fdStartPoll();

    setStatus('genStatus', 'Full draft running… (run: ' + d.runId + ')', 'warn');
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Full Draft'; }

  } catch (e) {
    setStatus('genStatus', 'Network error: ' + e.message, 'err');
    showErr('genErrBox', String(e));
    _fdSetProgress(0, 'Network error');
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Full Draft'; }
  }
}

/** Start polling the run status every 1.5 seconds */
function _fdStartPoll() {
  _FD.pollTimer = setInterval(_fdPollOnce, 1500);
  // Also poll immediately
  _fdPollOnce();
}

/** Stop the poll interval */
function _fdStopPoll() {
  if (_FD.pollTimer) { clearInterval(_FD.pollTimer); _FD.pollTimer = null; }
  if (_FD.elapsedTimer) { clearInterval(_FD.elapsedTimer); _FD.elapsedTimer = null; }
}

/** Single poll tick */
async function _fdPollOnce() {
  if (!_FD.runId) return;
  try {
    const status = await apiFetch('/api/generation/runs/' + _FD.runId + '/status', { timeout: 8000 });
    if (!status.ok) return;
    _FD.lastStatus = status;
    renderFullDraftProgress(status);

    // Stop polling when terminal state reached
    if (status.status === 'complete' || status.status === 'error' || status.status === 'failed') {
      _fdStopPoll();
      _fdOnComplete(status);
    }
  } catch { /* non-fatal — keep polling */ }
}

/** Start the elapsed time display */
function _fdStartElapsedTimer() {
  const el = $('fdElapsed');
  _FD.elapsedTimer = setInterval(() => {
    if (!_FD.startedAt || !el) return;
    const s = ((Date.now() - _FD.startedAt) / 1000).toFixed(1);
    el.textContent = s + 's';
  }, 200);
}

/**
 * renderFullDraftProgress(status)
 * Updates the full-draft panel from a run status object.
 * Called on every poll tick.
 *
 * @param {object} status — response from GET /api/generation/runs/:runId/status
 */
function renderFullDraftProgress(status) {
  if (!status) return;

  const phase    = status.phase || status.status || 'pending';
  const sections = status.sectionStatuses || {};
  const total    = status.sectionsTotal   || Object.keys(sections).length || 0;
  const done     = status.sectionsCompleted || Object.values(sections).filter(s => s === 'complete' || s === 'done').length;

  // ── Phase strip ────────────────────────────────────────────────────────────
  _fdSetPhase(phase);

  // ── Progress bar ───────────────────────────────────────────────────────────
  let pct = FD_PHASE_PCT[phase] ?? 50;
  // Refine pct during drafting based on section completion
  if ((phase === 'drafting' || phase === 'running') && total > 0) {
    const sectionPct = (done / total) * 40; // 40% of bar is drafting phase
    pct = 40 + sectionPct;
  }
  const label = _fdPhaseLabel(phase, done, total);
  _fdSetProgress(Math.min(pct, 99), label);

  // ── Section rows ───────────────────────────────────────────────────────────
  const secWrap = $('fdSections');
  if (secWrap && Object.keys(sections).length > 0) {
    secWrap.innerHTML = Object.entries(sections).map(([sid, st]) => {
      const cls  = st === 'complete' || st === 'done' ? 'done'
                 : st === 'running'  ? 'running'
                 : st === 'error'    ? 'error'
                 : 'pending';
      const icon = cls === 'done'    ? '✓'
                 : cls === 'running' ? '⟳'
                 : cls === 'error'   ? '✗'
                 : '○';
      const name = sid.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const ms   = status.sectionTimings?.[sid] ? status.sectionTimings[sid] + 'ms' : '';
      return `<div class="fd-section-row ${cls}">
        <span class="fd-section-icon">${icon}</span>
        <span class="fd-section-name">${esc(name)}</span>
        <span class="fd-section-ms">${esc(ms)}</span>
      </div>`;
    }).join('');
  }
  _updateInspector(status);
}

/**
 * _fdOnComplete(status)
 * Called when the run reaches a terminal state.
 * Renders final metrics, warnings, and enables the "Load Sections" button.
 */
function _fdOnComplete(status) {
  const ok = status.status === 'complete';

  // Final progress bar
  _fdSetProgress(ok ? 100 : 100, ok ? 'Complete ✓' : 'Finished with errors');
  _fdSetPhase(ok ? 'complete' : 'error');

  // Mark all phases done if complete
  if (ok) {
    FD_PHASES.forEach(p => {
      const el = $('fdp-' + p);
      if (el) { el.classList.remove('active'); el.classList.add('done'); }
    });
  }

  // Render metrics
  renderRunMetrics(status.phaseTimings, status.retrieval, status);

  // Render warnings
  const warnings = status.warnings || [];
  const warnWrap = $('fdWarnings');
  if (warnWrap) {
    if (warnings.length) {
      warnWrap.innerHTML = warnings.map(w =>
        `<div class="fd-warning-item">⚠ ${esc(typeof w === 'string' ? w : (w.message || JSON.stringify(w)))}</div>`
      ).join('');
      warnWrap.classList.add('visible');
    } else {
      warnWrap.classList.remove('visible');
    }
  }

  // Show post-run actions
  const actions = $('fdRunActions');
  if (actions) actions.style.display = 'flex';

  // Update genStatus
  const secCount = status.sectionsCompleted || status.sectionsTotal || 0;
  const errCount = status.errorCount || 0;
  setStatus(
    'genStatus',
    ok
      ? `Full draft complete: ${secCount} sections generated${errCount ? ', ' + errCount + ' error(s)' : ''}.`
      : `Full draft finished with errors. ${secCount} sections generated.`,
    ok && !errCount ? 'ok' : 'warn'
  );
  _updateInspector(status);
}

/**
 * renderRunMetrics(phaseTimings, retrieval, status)
 * Renders the metrics grid in the full-draft panel.
 */
function renderRunMetrics(phaseTimings, retrieval, status) {
  const grid = $('fdMetricsGrid');
  const wrap = $('fdMetrics');
  if (!grid || !wrap) return;

  const pt = phaseTimings || {};
  const rt = retrieval    || {};

  // Total elapsed
  const totalMs = _FD.startedAt ? (Date.now() - _FD.startedAt) : (pt.totalMs || 0);
  const totalS  = (totalMs / 1000).toFixed(1);

  // Performance grade
  const grade = totalMs < 12000 ? 'ok' : totalMs < 20000 ? 'warn' : 'err';

  const metrics = [
    { label: 'Total',      value: totalS + 's',                    cls: grade },
    { label: 'Context',    value: _fmtMs(pt.contextBuildMs),       cls: '' },
    { label: 'Plan',       value: _fmtMs(pt.reportPlanMs),         cls: '' },
    { label: 'Retrieval',  value: _fmtMs(pt.retrievalMs),          cls: '' },
    { label: 'Analysis',   value: _fmtMs(pt.analysisMs),           cls: '' },
    { label: 'Drafting',   value: _fmtMs(pt.parallelDraftMs),      cls: '' },
    { label: 'Validation', value: _fmtMs(pt.validationMs),         cls: '' },
    { label: 'Cache',      value: rt.fromCache ? 'HIT' : 'MISS',   cls: rt.fromCache ? 'ok' : '' },
    { label: 'Memory',     value: (rt.totalMemoryScanned || 0) + ' scanned', cls: '' },
    { label: 'Used',       value: (rt.totalExamplesUsed  || 0) + ' examples', cls: '' },
    { label: 'Sections',   value: (status?.sectionsCompleted || 0) + '/' + (status?.sectionsTotal || 0), cls: '' },
    { label: 'Retries',    value: String(status?.retryCount || 0), cls: (status?.retryCount || 0) > 0 ? 'warn' : '' },
  ];

  grid.innerHTML = metrics.map(m =>
    `<div class="fd-metric-item">
      <span class="fd-metric-label">${esc(m.label)}</span>
      <span class="fd-metric-value${m.cls ? ' ' + m.cls : ''}">${esc(m.value || '—')}</span>
    </div>`
  ).join('');

  wrap.classList.add('visible');
}

/**
 * loadFullDraftResult()
 * Fetches the completed run result and renders all sections into the output panel.
 * Called when user clicks "Load Sections into Output".
 */
async function loadFullDraftResult() {
  if (!_FD.runId) { alert('No active run to load.'); return; }

  const btn = $('fdLoadResultBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    const d = await apiFetch('/api/generation/runs/' + _FD.runId + '/result', { timeout: 15000 });
    if (!d.ok) {
      alert('Failed to load result: ' + (d.error || 'Unknown error'));
      if (btn) { btn.disabled = false; btn.textContent = 'Load Sections into Output'; }
      return;
    }

    const sections = d.sections || {};
    const out = $('output');
    if (!out) return;

    const activeFields = getActiveFields();
    let loaded = 0;

    // Insert sections in active field order
    for (const f of activeFields) {
      const sec = sections[f.id];
      if (!sec || !sec.text) continue;

      // Remove existing card for this field
      const existing = out.querySelector(`.outcard[data-field-id="${f.id}"]`);
      if (existing) existing.remove();

      const card = makeOutputCard(f.id, f.title || f.id, sec.text, '', {
        sectionStatus: sec.approved ? 'approved' : 'drafted',
      });

      // Insert in field order
      const idx = activeFields.findIndex(af => af.id === f.id);
      const fieldsAfter = activeFields.slice(idx + 1).map(ff => ff.id);
      const ins = Array.from(out.querySelectorAll('.outcard'))
        .find(c => fieldsAfter.includes(c.dataset.fieldId));
      if (ins) out.insertBefore(card, ins);
      else out.appendChild(card);

      // Update STATE.outputs
      STATE.outputs[f.id] = { text: sec.text, title: f.title };
      loaded++;
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Load Sections into Output'; }

    setStatus('genStatus', `Loaded ${loaded} section(s) from full draft run.`, 'ok');

    // Scroll to first output card
    const firstCard = out.querySelector('.outcard');
    if (firstCard) firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Switch to generate tab if not already there
    showTab('generate');

  } catch (e) {
    alert('Error loading result: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Load Sections into Output'; }
  }
}

/** Close and reset the full-draft panel */
function closeFullDraftPanel() {
  _fdStopPoll();
  const panel = $('fullDraftPanel');
  if (panel) panel.classList.remove('visible');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _fdShowPanel() {
  const panel = $('fullDraftPanel');
  if (panel) panel.classList.add('visible');
}

function _fdResetPanel() {
  // Reset phase strip
  FD_PHASES.forEach(p => {
    const el = $('fdp-' + p);
    if (el) { el.className = 'fd-phase'; }
  });
  // Reset sections
  const sec = $('fdSections'); if (sec) sec.innerHTML = '';
  // Reset metrics
  const met = $('fdMetrics'); if (met) met.classList.remove('visible');
  const grid = $('fdMetricsGrid'); if (grid) grid.innerHTML = '';
  // Reset warnings
  const warn = $('fdWarnings'); if (warn) { warn.classList.remove('visible'); warn.innerHTML = ''; }
  // Reset actions
  const act = $('fdRunActions'); if (act) act.style.display = 'none';
  // Reset elapsed
  const el = $('fdElapsed'); if (el) el.textContent = '';
}

function _fdSetPhase(phase) {
  // Map run status phases to phase IDs
  const phaseMap = {
    pending:    null,
    context:    'context',
    plan:       'plan',
    retrieval:  'retrieval',
    analysis:   'analysis',
    drafting:   'drafting',
    running:    'drafting',
    validation: 'validation',
    assembly:   'validation',
    complete:   null,
    error:      null,
    failed:     null,
  };
  const activePhase = phaseMap[phase] || null;

  FD_PHASES.forEach((p, idx) => {
    const el = $('fdp-' + p);
    if (!el) return;
    const phaseIdx = FD_PHASES.indexOf(activePhase);
    if (activePhase === null && (phase === 'complete')) {
      el.className = 'fd-phase done';
    } else if (activePhase === null && (phase === 'error' || phase === 'failed')) {
      el.className = 'fd-phase error';
    } else if (p === activePhase) {
      el.className = 'fd-phase active';
    } else if (idx < phaseIdx) {
      el.className = 'fd-phase done';
    } else {
      el.className = 'fd-phase';
    }
  });
}

function _fdSetProgress(pct, label) {
  const fill  = $('fdProgressFill');
  const lbl   = $('fdProgressLabel');
  const pctEl = $('fdProgressPct');
  if (fill)  fill.style.width  = Math.min(pct, 100) + '%';
  if (lbl)   lbl.textContent   = label || '';
  if (pctEl) pctEl.textContent = pct < 100 ? Math.round(pct) + '%' : '';
}

function _fdPhaseLabel(phase, done, total) {
  const labels = {
    pending:    'Starting…',
    context:    'Building assignment context…',
    plan:       'Planning report sections…',
    retrieval:  'Retrieving narrative memory…',
    analysis:   'Running analysis jobs…',
    drafting:   total > 0 ? `Drafting sections (${done}/${total})…` : 'Drafting sections…',
    running:    total > 0 ? `Drafting sections (${done}/${total})…` : 'Drafting sections…',
    validation: 'Validating draft…',
    assembly:   'Assembling draft package…',
    complete:   'Complete ✓',
    error:      'Finished with errors',
    failed:     'Failed',
  };
  return labels[phase] || phase;
}

function _fmtMs(ms) {
  if (ms == null || ms === undefined) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

// ====== GENERATE TAB — COMMAND STRIP + INSPECTOR ============================

/**
 * _updateGenStrip()
 * Updates the command strip with the current case name and form type.
 * Called from loadCase() after STATE.meta and STATE.formType are set.
 */
function _updateGenStrip() {
  const caseEl   = $('genStripCase');
  const reportEl = $('genStripReport');
  const healthEl = $('genStripHealth');
  if (caseEl) {
    caseEl.textContent = STATE.meta?.address || 'No case selected';
  }
  if (reportEl) {
    const ft = STATE.formType ? STATE.formType.toUpperCase() : '';
    reportEl.textContent  = ft;
    reportEl.style.display = ft ? '' : 'none';
  }
  if (healthEl) {
    healthEl.textContent = STATE.caseId ? 'Health \u2713' : '';
  }
  // Update last-run meta if available
  const lastRunEl = $('genStripLastRun');
  if (lastRunEl && _FD.startedAt && _FD.lastStatus) {
    const elapsed = _FD.startedAt
      ? ((Date.now() - _FD.startedAt) / 1000).toFixed(1) + 's'
      : '';
    if (elapsed) lastRunEl.textContent = 'Last run: ' + elapsed;
  }
}

/**
 * _updateInspector(status)
 * Updates the right inspector cards from a full-draft run status object.
 * Called from renderFullDraftProgress() and _fdOnComplete().
 *
 * @param {object} status — run status from GET /api/generation/runs/:runId/status
 */
function _updateInspector(status) {
  if (!status) return;

  const phase   = status.phase || status.status || 'pending';
  const done    = status.sectionsCompleted || 0;
  const total   = status.sectionsTotal    || 0;
  const retries = status.retryCount       || 0;

  // ── Run Status card ────────────────────────────────────────────────────────
  const inspStatus    = $('inspStatus');
  const inspElapsed   = $('inspElapsed');
  const inspCompleted = $('inspCompleted');
  const inspRetries   = $('inspRetries');

  if (inspStatus)    inspStatus.textContent    = phase;
  if (inspCompleted) inspCompleted.textContent = total > 0 ? done + ' / ' + total : '\u2014';
  if (inspRetries)   inspRetries.textContent   = retries > 0 ? String(retries) : '\u2014';

  // Mirror elapsed from fdElapsed (updated by _fdStartElapsedTimer)
  const fdEl = $('fdElapsed');
  if (inspElapsed) inspElapsed.textContent = (fdEl && fdEl.textContent) ? fdEl.textContent : '\u2014';

  // Update command strip last-run on completion
  const lastRunEl = $('genStripLastRun');
  if (lastRunEl && (phase === 'complete' || phase === 'error' || phase === 'failed')) {
    const elapsed = fdEl?.textContent || '';
    if (elapsed) lastRunEl.textContent = 'Last run: ' + elapsed;
  }

  // ── Memory Used card ───────────────────────────────────────────────────────
  const ret = status.retrieval || {};
  const inspNarratives = $('inspNarratives');
  const inspPhrases    = $('inspPhrases');
  const inspVoice      = $('inspVoice');
  const inspCache      = $('inspCache');

  if (inspNarratives) inspNarratives.textContent = ret.approvedNarratives != null ? String(ret.approvedNarratives) : '\u2014';
  if (inspPhrases)    inspPhrases.textContent    = ret.phraseBank         != null ? String(ret.phraseBank)         : '\u2014';
  if (inspVoice)      inspVoice.textContent      = ret.voiceExamples      != null ? String(ret.voiceExamples)      : '\u2014';
  if (inspCache)      inspCache.textContent      = ret.fromCache != null ? (ret.fromCache ? 'Hit' : 'Miss') : '\u2014';

  // ── Warnings card ──────────────────────────────────────────────────────────
  const warnings  = status.warnings || [];
  const warnBody  = $('inspWarningsBody');
  if (warnBody) {
    if (warnings.length) {
      warnBody.innerHTML = warnings.map(w => {
        const msg = typeof w === 'string' ? w : (w.message || JSON.stringify(w));
        return '<div class="gen-insp-warn-item">' + esc(msg) + '</div>';
      }).join('');
    } else {
      warnBody.innerHTML = '<div class="gen-insp-empty">No warnings</div>';
    }
  }
}

// ====== INTELLIGENCE TAB (Phase 4) ======

let _intelBundle = null;

async function buildIntelligence() {
  const caseId = currentCaseId;
  if (!caseId) return setStatus('intelStatus', 'No case selected.', 'error');
  setStatus('intelStatus', 'Building intelligence bundle...', 'info');
  try {
    const res = await fetch(`/api/cases/${caseId}/intelligence/build`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Build failed');
    _intelBundle = data.bundle;
    setStatus('intelStatus', `Built in ${_intelBundle._buildMs}ms`, 'ok');
    renderIntelligence(_intelBundle);
  } catch (e) {
    setStatus('intelStatus', e.message, 'error');
  }
}

async function loadIntelligence() {
  const caseId = currentCaseId;
  if (!caseId) return setStatus('intelStatus', 'No case selected.', 'error');
  setStatus('intelStatus', 'Loading cached bundle...', 'info');
  try {
    const res = await fetch(`/api/cases/${caseId}/intelligence`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Not found');
    _intelBundle = data.bundle;
    setStatus('intelStatus', `Loaded (built ${new Date(_intelBundle._builtAt).toLocaleString()})`, 'ok');
    renderIntelligence(_intelBundle);
  } catch (e) {
    setStatus('intelStatus', e.message, 'error');
  }
}

function renderIntelligence(b) {
  if (!b) return;

  // Summary
  const ctx = b.context || {};
  const fs = b.flagSummary || {};
  const sp = b.sectionPlan || {};
  document.getElementById('intelSummary').innerHTML = [
    `<b>Form:</b> ${esc(ctx.formType || '?')}`,
    `<b>Report Family:</b> ${esc(b.reportFamily?.displayName || '?')}`,
    `<b>Purpose:</b> ${esc(ctx.assignmentPurpose || '?')}`,
    `<b>Loan:</b> ${esc(ctx.loanProgram || '?')}`,
    `<b>Property:</b> ${esc(ctx.propertyType || '?')}`,
    `<b>Condition:</b> ${esc(ctx.valueCondition || '?')}`,
    `<b>Active Flags:</b> ${fs.count || 0} / ${fs.total || 0}`,
    `<b>Sections Planned:</b> ${sp.totalSections || 0} (${sp.requiredCount || 0} required, ${sp.commentaryCount || 0} commentary)`,
    `<b>Fields:</b> ${b.canonicalFields?.totalApplicable || 0} applicable`,
    `<b>Version:</b> ${esc(b._version || '?')}`,
  ].join('<br>');

  // Flags — show active flags with green, inactive grayed
  const flags = b.flags || {};
  const flagEntries = Object.entries(flags);
  const activeFlags = flagEntries.filter(([,v]) => v === true);
  const inactiveFlags = flagEntries.filter(([,v]) => v !== true);
  document.getElementById('intelFlags').innerHTML =
    (activeFlags.length > 0
      ? '<div style="margin-bottom:8px;color:var(--ds-ok,#4ade80);">' + activeFlags.map(([k]) => k).join('<br>') + '</div>'
      : '<div style="color:var(--ds-muted,#888);">No active flags</div>') +
    '<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--ds-muted,#888);font-size:11px;">Inactive (' + inactiveFlags.length + ')</summary>' +
    '<div style="color:var(--ds-muted,#666);margin-top:4px;">' + inactiveFlags.map(([k]) => k).join('<br>') + '</div></details>';

  // Compliance
  const comp = b.compliance || {};
  const overlays = [];
  if (comp.uspap_applicable) overlays.push('USPAP');
  if (comp.fha_overlay) overlays.push('FHA');
  if (comp.usda_overlay) overlays.push('USDA');
  if (comp.va_overlay) overlays.push('VA');
  document.getElementById('intelCompliance').innerHTML = [
    `<b>Overlays:</b> ${overlays.join(', ') || 'None'}`,
    `<b>Report Family:</b> ${esc(comp.report_family || '?')}`,
    comp.property_type_implications?.length
      ? '<b>Property Implications:</b><ul style="margin:2px 0 6px 18px;">' + comp.property_type_implications.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>'
      : '',
    comp.assignment_condition_implications?.length
      ? '<b>Assignment Conditions:</b><ul style="margin:2px 0 6px 18px;">' + comp.assignment_condition_implications.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>'
      : '',
    comp.likely_commentary_families?.length
      ? '<b>Commentary Families:</b> ' + comp.likely_commentary_families.map(f => '<span style="background:var(--ds-surface-3,#222);padding:1px 6px;border-radius:3px;margin:1px;">' + esc(f) + '</span>').join(' ')
      : '',
    comp.likely_qc_categories?.length
      ? '<br><b>QC Categories:</b> ' + comp.likely_qc_categories.map(c => '<span style="background:var(--ds-surface-3,#222);padding:1px 6px;border-radius:3px;margin:1px;">' + esc(c) + '</span>').join(' ')
      : '',
  ].filter(Boolean).join('<br>');

  // Report family
  const rf = b.reportFamily || {};
  document.getElementById('intelReportFamily').innerHTML = [
    `<b>${esc(rf.displayName || '?')}</b>`,
    rf.sectionGroups?.length
      ? '<div style="margin-top:6px;">' + rf.sectionGroups.map(g =>
          '<span style="display:inline-block;background:var(--ds-accent-bg,rgba(200,168,74,.1));border:1px solid var(--ds-accent-bd,rgba(200,168,74,.22));padding:2px 8px;border-radius:3px;margin:2px;font-size:11px;">' +
          esc(g.label) + '</span>'
        ).join('') + '</div>'
      : '',
    `<div style="margin-top:6px;color:var(--ds-muted,#888);font-size:11px;">Destination: ${esc(rf.destinationHints?.primary || '?')}</div>`,
  ].join('');

  // Section plan
  const sections = sp.sections || [];
  const excluded = sp.excludedSections || [];
  let spHtml = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  spHtml += '<tr style="border-bottom:1px solid var(--ds-border,rgba(255,255,255,.07));"><th style="text-align:left;padding:4px;">Section</th><th>Type</th><th>Required</th><th>Profile</th><th>Depends On</th></tr>';
  for (const s of sections) {
    const reqBadge = s.required
      ? '<span style="color:var(--ds-ok,#4ade80);">Yes</span>'
      : '<span style="color:var(--ds-muted,#888);">No</span>';
    const depStr = s.dependsOn?.length > 0 ? s.dependsOn.join(', ') : '-';
    spHtml += `<tr style="border-bottom:1px solid var(--ds-border,rgba(255,255,255,.04));">
      <td style="padding:3px 4px;">${esc(s.label || s.id)}</td>
      <td style="padding:3px 4px;text-align:center;"><span style="background:var(--ds-surface-3,#222);padding:1px 5px;border-radius:3px;font-size:10px;">${esc(s.contentType)}</span></td>
      <td style="padding:3px 4px;text-align:center;">${reqBadge}</td>
      <td style="padding:3px 4px;text-align:center;font-size:10px;">${esc(s.generatorProfile)}</td>
      <td style="padding:3px 4px;font-size:10px;color:var(--ds-muted,#888);">${esc(depStr)}</td>
    </tr>`;
  }
  spHtml += '</table>';
  if (excluded.length > 0) {
    spHtml += '<details style="margin-top:8px;"><summary style="cursor:pointer;color:var(--ds-muted,#888);font-size:11px;">Excluded (' + excluded.length + ')</summary>';
    spHtml += '<div style="margin-top:4px;font-size:11px;color:var(--ds-muted,#666);">' +
      excluded.map(e => `${esc(e.label || e.fieldId)}: ${esc(e.reason)}`).join('<br>') + '</div></details>';
  }
  document.getElementById('intelSectionPlan').innerHTML = spHtml;

  // Canonical fields by group
  const fieldGroups = b.canonicalFields?.byGroup || {};
  let cfHtml = '';
  for (const [group, fieldIds] of Object.entries(fieldGroups)) {
    cfHtml += `<div style="margin-bottom:8px;"><b style="text-transform:capitalize;">${esc(group.replace(/_/g, ' '))}</b><br>`;
    cfHtml += fieldIds.map(id =>
      '<span style="display:inline-block;background:var(--ds-surface-3,#222);padding:1px 6px;border-radius:3px;margin:2px;font-size:11px;">' + esc(id) + '</span>'
    ).join('');
    cfHtml += '</div>';
  }
  document.getElementById('intelCanonicalFields').innerHTML = cfHtml || '<div class="hint">No fields.</div>';

  // Context JSON (collapsible)
  const ctxJson = JSON.stringify(ctx, null, 2);
  document.getElementById('intelContext').innerHTML =
    '<pre style="white-space:pre-wrap;word-break:break-all;margin:0;">' + esc(ctxJson) + '</pre>';
}

// ====== PHASE 5 — DOCUMENTS TAB ======

async function uploadDocument() {
  if (!_caseId) return alert('Select a case first.');
  const fileInput = document.getElementById('docFileInput');
  const typeSelect = document.getElementById('docUploadType');
  const statusEl = document.getElementById('docUploadStatus');
  if (!fileInput.files.length) return alert('Choose a PDF file.');
  const file = fileInput.files[0];
  statusEl.innerHTML = '<span style="color:var(--ds-accent,#4af);">Uploading and processing...</span>';
  const fd = new FormData();
  fd.append('file', file);
  const docType = typeSelect.value;
  if (docType) fd.append('docType', docType);
  try {
    const r = await fetch(`/api/cases/${_caseId}/documents/upload`, { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Upload failed');
    statusEl.innerHTML =
      `<span style="color:var(--ds-green,#4c6);">Uploaded: ${esc(d.classification?.label || d.docType)}</span>` +
      `<br><span style="font-size:11px;">` +
      `${d.wordCount} words | ${d.pageCount} pages | classified by ${d.classification?.method} (${Math.round((d.classification?.confidence || 0) * 100)}%)` +
      (d.extraction ? ` | ${d.extraction.factsExtracted} facts, ${d.extraction.sectionsExtracted} sections extracted` : '') +
      `</span>`;
    fileInput.value = '';
    typeSelect.value = '';
    loadDocuments();
    loadExtractionSummary();
    if (d.extraction?.factsExtracted > 0) loadExtractedFacts('pending');
    if (d.extraction?.sectionsExtracted > 0) loadExtractedSections('pending');
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--ds-red,#f44);">' + esc(e.message) + '</span>';
  }
}

async function loadDocuments() {
  if (!_caseId) return;
  const el = document.getElementById('docList');
  try {
    const r = await fetch(`/api/cases/${_caseId}/documents`);
    const d = await r.json();
    if (!d.ok || !d.documents.length) { el.innerHTML = '<div class="hint">No documents uploaded yet.</div>'; return; }
    let html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--ds-border,#333);">File</th>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--ds-border,#333);">Type</th>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--ds-border,#333);">Classification</th>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--ds-border,#333);">Extraction</th>' +
      '<th style="text-align:center;padding:4px 6px;border-bottom:1px solid var(--ds-border,#333);">Actions</th>' +
      '</tr></thead><tbody>';
    for (const doc of d.documents) {
      const confPct = Math.round((doc.classification_confidence || 0) * 100);
      const sizeKb = Math.round((doc.file_size_bytes || 0) / 1024);
      html += '<tr>' +
        `<td style="padding:4px 6px;border-bottom:1px solid var(--ds-border-dim,#222);">${esc(doc.original_filename)}<br><span style="font-size:10px;color:var(--ds-text-muted,#888);">${sizeKb}KB | ${doc.page_count || 0}p</span></td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid var(--ds-border-dim,#222);"><span style="display:inline-block;background:var(--ds-surface-3,#222);padding:1px 6px;border-radius:3px;font-size:11px;">${esc(doc.label || doc.doc_type)}</span></td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid var(--ds-border-dim,#222);font-size:11px;">${esc(doc.classification_method || '')} (${confPct}%)</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid var(--ds-border-dim,#222);"><span style="color:${doc.extraction_status === 'extracted' ? 'var(--ds-green,#4c6)' : 'var(--ds-text-muted,#888)'};">${esc(doc.extraction_status || 'pending')}</span></td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid var(--ds-border-dim,#222);text-align:center;">` +
        `<button class="ghost sm" onclick="reExtractDoc('${doc.id}')" title="Re-extract">Re-extract</button> ` +
        `<button class="ghost sm" onclick="deleteDoc('${doc.id}')" title="Delete" style="color:var(--ds-red,#f44);">Del</button>` +
        `</td></tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--ds-red,#f44);">' + esc(e.message) + '</div>';
  }
}

async function loadExtractionSummary() {
  if (!_caseId) return;
  const el = document.getElementById('docExtractionSummary');
  try {
    const r = await fetch(`/api/cases/${_caseId}/extraction-summary`);
    const d = await r.json();
    if (!d.ok) { el.innerHTML = '<div class="hint">No data.</div>'; return; }
    let html = `<b>${d.totalDocuments}</b> documents uploaded<br>`;
    const types = d.documentsByType || {};
    if (Object.keys(types).length) {
      html += '<div style="margin:4px 0;">' + Object.entries(types).map(([t, c]) =>
        `<span style="display:inline-block;background:var(--ds-surface-3,#222);padding:1px 6px;border-radius:3px;margin:2px;font-size:11px;">${esc(t)}: ${c}</span>`
      ).join('') + '</div>';
    }
    html += `<div style="margin-top:6px;">`;
    html += `<b style="color:var(--ds-accent,#4af);">${d.pendingFacts}</b> facts pending review | `;
    html += `<b style="color:var(--ds-green,#4c6);">${d.mergedFacts}</b> merged<br>`;
    html += `<b style="color:var(--ds-accent,#4af);">${d.pendingSections}</b> sections pending | `;
    html += `<b style="color:var(--ds-green,#4c6);">${d.approvedSections}</b> approved to memory`;
    html += '</div>';
    el.innerHTML = html;
  } catch { el.innerHTML = '<div class="hint">Error loading summary.</div>'; }
}

async function loadExtractedFacts(status) {
  if (!_caseId) return;
  const el = document.getElementById('docExtractedFacts');
  try {
    const url = status ? `/api/cases/${_caseId}/extracted-facts?status=${status}` : `/api/cases/${_caseId}/extracted-facts`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.ok || !d.facts.length) { el.innerHTML = '<div class="hint">No extracted facts found.</div>'; return; }
    let html = '<div style="max-height:400px;overflow:auto;">';
    for (const f of d.facts) {
      const statusColor = f.review_status === 'merged' ? 'var(--ds-green,#4c6)' :
        f.review_status === 'rejected' ? 'var(--ds-red,#f44)' :
        f.review_status === 'accepted' ? 'var(--ds-accent,#4af)' : 'var(--ds-text-muted,#888)';
      html += `<div style="padding:6px 0;border-bottom:1px solid var(--ds-border-dim,#222);display:flex;gap:8px;align-items:flex-start;">`;
      if (f.review_status === 'pending') {
        html += `<input type="checkbox" class="fact-check" data-fact-id="${f.id}" style="margin-top:3px;">`;
      }
      html += `<div style="flex:1;">` +
        `<b>${esc(f.fact_path)}</b>: <span style="color:var(--ds-green,#4c6);">${esc(f.fact_value || '')}</span>` +
        `<br><span style="font-size:10px;color:var(--ds-text-muted,#888);">` +
        `confidence: ${f.confidence} | from: ${esc(f.original_filename || '')} | ` +
        `<span style="color:${statusColor};">${f.review_status}</span>` +
        `</span>`;
      if (f.source_text) html += `<br><span style="font-size:10px;color:var(--ds-text-dim,#666);font-style:italic;">"${esc(f.source_text.slice(0, 120))}"</span>`;
      html += `</div>`;
      if (f.review_status === 'pending') {
        html += `<button class="ghost sm" onclick="reviewFactAction('${f.id}','rejected')" style="color:var(--ds-red,#f44);">Reject</button>`;
      }
      html += `</div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--ds-red,#f44);">' + esc(e.message) + '</div>';
  }
}

async function mergeSelectedFacts() {
  if (!_caseId) return;
  const checks = document.querySelectorAll('.fact-check:checked');
  if (!checks.length) return alert('Select facts to merge using the checkboxes.');
  const factIds = Array.from(checks).map(c => c.dataset.factId);
  try {
    const r = await fetch(`/api/cases/${_caseId}/extracted-facts/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factIds }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    alert(`Merged ${d.merged} facts into case.`);
    loadExtractedFacts('pending');
    loadExtractionSummary();
  } catch (e) { alert('Merge failed: ' + e.message); }
}

async function reviewFactAction(factId, action) {
  if (!_caseId) return;
  try {
    await fetch(`/api/cases/${_caseId}/extracted-facts/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId, action }),
    });
    loadExtractedFacts('pending');
    loadExtractionSummary();
  } catch (e) { alert('Review failed: ' + e.message); }
}

async function loadExtractedSections(status) {
  if (!_caseId) return;
  const el = document.getElementById('docExtractedSections');
  try {
    const url = status ? `/api/cases/${_caseId}/extracted-sections?status=${status}` : `/api/cases/${_caseId}/extracted-sections`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.ok || !d.sections.length) { el.innerHTML = '<div class="hint">No extracted sections found.</div>'; return; }
    let html = '';
    for (const s of d.sections) {
      const statusColor = s.review_status === 'approved' ? 'var(--ds-green,#4c6)' :
        s.review_status === 'rejected' ? 'var(--ds-red,#f44)' : 'var(--ds-text-muted,#888)';
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--ds-border-dim,#222);">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
      html += `<span><b>${esc(s.section_label || s.section_type)}</b> ` +
        `<span style="font-size:10px;color:var(--ds-text-muted,#888);">${s.word_count}w | ${esc(s.form_type || '')} | ` +
        `<span style="color:${statusColor};">${s.review_status}</span> | from: ${esc(s.original_filename || '')}</span></span>`;
      if (s.review_status === 'pending') {
        html += `<span>` +
          `<button class="ghost sm" onclick="approveSectionAction('${s.id}')" style="color:var(--ds-green,#4c6);">Approve</button> ` +
          `<button class="ghost sm" onclick="rejectSectionAction('${s.id}')" style="color:var(--ds-red,#f44);">Reject</button>` +
          `</span>`;
      }
      html += `</div>`;
      html += `<details style="margin-top:4px;"><summary style="font-size:11px;cursor:pointer;color:var(--ds-text-muted,#888);">Preview text</summary>` +
        `<pre style="font-size:11px;white-space:pre-wrap;margin:4px 0;padding:6px;background:var(--ds-surface-2,#1a1a1a);border-radius:4px;max-height:200px;overflow:auto;">${esc(s.text)}</pre></details>`;
      html += `</div>`;
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--ds-red,#f44);">' + esc(e.message) + '</div>';
  }
}

async function approveSectionAction(sectionId) {
  if (!_caseId) return;
  try {
    const r = await fetch(`/api/cases/${_caseId}/extracted-sections/${sectionId}/approve`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    loadExtractedSections('pending');
    loadExtractionSummary();
  } catch (e) { alert('Approve failed: ' + e.message); }
}

async function rejectSectionAction(sectionId) {
  if (!_caseId) return;
  try {
    const r = await fetch(`/api/cases/${_caseId}/extracted-sections/${sectionId}/reject`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    loadExtractedSections('pending');
    loadExtractionSummary();
  } catch (e) { alert('Reject failed: ' + e.message); }
}

async function reExtractDoc(docId) {
  if (!_caseId) return;
  try {
    const r = await fetch(`/api/cases/${_caseId}/documents/${docId}/extract`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    alert(`Re-extracted: ${d.factsExtracted} facts, ${d.sectionsExtracted} sections.`);
    loadDocuments();
    loadExtractionSummary();
    loadExtractedFacts('pending');
    loadExtractedSections('pending');
  } catch (e) { alert('Re-extraction failed: ' + e.message); }
}

async function deleteDoc(docId) {
  if (!_caseId) return;
  if (!confirm('Delete this document and all its extractions?')) return;
  try {
    const r = await fetch(`/api/cases/${_caseId}/documents/${docId}`, { method: 'DELETE' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    loadDocuments();
    loadExtractionSummary();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function loadDocsTab() {
  if (!_caseId) return;
  loadDocuments();
  loadExtractionSummary();
}

// ====== PHASE 6 — MEMORY, VOICE & RETRIEVAL UI ==============================

/** Load all Memory tab sub-panels */
function memLoadAll() {
  memLoadSummary();
  memLoadApproved();
  memLoadStaged();
  memLoadCompCommentary();
  memLoadVoiceProfile();
}

// ── Memory Summary ───────────────────────────────────────────────────────────

async function memLoadSummary() {
  const el = $('memSummaryDisplay');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const d = await apiFetch('/api/memory/summary');
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error || 'Failed') + '</div>'; return; }
    const am = d.approvedMemory || {};
    const sc = d.stagingCandidates || {};
    const vp = d.voiceProfiles || 0;
    const cc = d.compCommentary || {};
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px;">
        <div><b style="color:var(--gold);">${am.total || 0}</b> approved memory items</div>
        <div><b style="color:var(--warn);">${sc.pending || 0}</b> pending candidates</div>
        <div><b>${am.byBucket?.narrative_section || 0}</b> narrative sections</div>
        <div><b>${am.byBucket?.section_fragment || 0}</b> section fragments</div>
        <div><b>${am.byBucket?.phrase_bank || 0}</b> phrase bank items</div>
        <div><b>${am.byBucket?.voice_exemplar || 0}</b> voice exemplars</div>
        <div><b>${cc.total || 0}</b> comp commentary items</div>
        <div><b>${vp}</b> voice profile(s)</div>
        <div><b>${sc.approved || 0}</b> approved candidates</div>
        <div><b>${sc.rejected || 0}</b> rejected candidates</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}

// ── Approved Memory ──────────────────────────────────────────────────────────

async function memLoadApproved() {
  const el = $('memApprovedList');
  const statusEl = $('memApprovedStatus');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading…</div>';
  const bucket = $('memApprovedFilter')?.value || '';
  const qs = bucket ? '?bucket=' + encodeURIComponent(bucket) + '&limit=50' : '?limit=50';
  try {
    const d = await apiFetch('/api/memory/approved' + qs);
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error) + '</div>'; return; }
    const items = d.items || [];
    if (!items.length) { el.innerHTML = '<div class="hint">No approved memory items' + (bucket ? ' for this type' : '') + '.</div>'; return; }
    el.innerHTML = items.map(item => _memApprovedCard(item)).join('');
    if (statusEl) { statusEl.className = 'status ok'; statusEl.textContent = items.length + ' item(s) loaded' + (d.total > items.length ? ' of ' + d.total : ''); }
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}

function _memApprovedCard(item) {
  const id = esc(item.id || '');
  const bucket = esc(item.bucket || '');
  const field = esc(item.canonicalFieldId || '');
  const family = esc(item.reportFamily || '');
  const quality = item.qualityScore != null ? item.qualityScore : '—';
  const active = item.active !== false;
  const preview = esc((item.text || '').slice(0, 200));
  const tags = (item.styleTags || []).map(t => '<span class="chip" style="font-size:9px;padding:1px 5px;">' + esc(t) + '</span>').join(' ');
  return `<div class="mem-item" style="padding:8px 0;border-bottom:1px solid var(--border);" data-mem-id="${id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="flex:1;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="chip" style="font-size:9px;padding:1px 6px;background:rgba(215,179,90,.15);color:var(--gold);">${bucket}</span>
          ${field ? '<span style="font-size:10px;color:var(--muted);">field: ' + field + '</span>' : ''}
          ${family ? '<span style="font-size:10px;color:var(--muted);">family: ' + family + '</span>' : ''}
          <span style="font-size:10px;color:var(--muted);">q: ${quality}</span>
          ${!active ? '<span style="font-size:10px;color:var(--danger);">INACTIVE</span>' : ''}
        </div>
        <div style="font-size:11px;margin-top:4px;color:var(--text);line-height:1.4;font-family:var(--mono);opacity:.85;">${preview}${(item.text || '').length > 200 ? '…' : ''}</div>
        ${tags ? '<div style="margin-top:3px;">' + tags + '</div>' : ''}
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="ghost sm" onclick="memToggleActive('${id}',${active ? 0 : 1})" title="${active ? 'Deactivate' : 'Activate'}">${active ? '⏸' : '▶'}</button>
        <button class="ghost sm" onclick="memEditApproved('${id}')" title="Edit">✎</button>
      </div>
    </div>
  </div>`;
}

async function memToggleActive(memId, newActive) {
  try {
    if (newActive) {
      await apiFetch('/api/memory/approved/' + memId, { method: 'PATCH', body: { active: true } });
    } else {
      await apiFetch('/api/memory/approved/' + memId, { method: 'DELETE' });
    }
    memLoadApproved();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

async function memEditApproved(memId) {
  try {
    const d = await apiFetch('/api/memory/approved/' + memId);
    if (!d.ok || !d.item) { alert('Failed to load item.'); return; }
    const item = d.item;
    const newText = prompt('Edit content text:', item.text || '');
    if (newText === null) return;
    const newTags = prompt('Style tags (comma-separated):', (item.styleTags || []).join(', '));
    if (newTags === null) return;
    const newField = prompt('Canonical field ID:', item.canonicalFieldId || '');
    if (newField === null) return;
    await apiFetch('/api/memory/approved/' + memId, {
      method: 'PATCH',
      body: { text: newText, styleTags: newTags.split(',').map(s => s.trim()).filter(Boolean), canonicalFieldId: newField }
    });
    memLoadApproved();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Staged Candidates ────────────────────────────────────────────────────────

async function memLoadStaged() {
  const el = $('memStagedList');
  const statusEl = $('memStagedStatus');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading…</div>';
  const filter = $('memStagedFilter')?.value || '';
  const qs = filter ? '?reviewStatus=' + encodeURIComponent(filter) + '&limit=50' : '?limit=50';
  try {
    const d = await apiFetch('/api/memory/staging' + qs);
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error) + '</div>'; return; }
    const items = d.items || [];
    if (!items.length) { el.innerHTML = '<div class="hint">No staged candidates' + (filter ? ' with status "' + filter + '"' : '') + '.</div>'; return; }
    el.innerHTML = items.map(item => _memStagedCard(item)).join('');
    if (statusEl) { statusEl.className = 'status'; statusEl.textContent = items.length + ' candidate(s)' + (d.total > items.length ? ' of ' + d.total : ''); }
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}

function _memStagedCard(item) {
  const id = esc(item.id || '');
  const sourceType = esc(item.candidateSource || '');
  const status = item.reviewStatus || 'pending';
  const preview = esc((item.text || '').slice(0, 200));
  const field = esc(item.canonicalFieldId || '');
  const family = esc(item.reportFamily || '');
  const quality = item.qualityScore != null ? item.qualityScore : '';
  const statusColor = status === 'approved' ? 'var(--ok)' : status === 'rejected' ? 'var(--danger)' : 'var(--warn)';
  const isPending = status === 'pending';
  return `<div class="mem-staged-item" style="padding:8px 0;border-bottom:1px solid var(--border);" data-staged-id="${id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="flex:1;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="chip" style="font-size:9px;padding:1px 6px;">${sourceType}</span>
          <span style="font-size:10px;color:${statusColor};font-weight:600;">${esc(status.toUpperCase())}</span>
          ${field ? '<span style="font-size:10px;color:var(--muted);">field: ' + field + '</span>' : ''}
          ${family ? '<span style="font-size:10px;color:var(--muted);">family: ' + family + '</span>' : ''}
          ${quality ? '<span style="font-size:10px;color:var(--muted);">q: ' + quality + '</span>' : ''}
        </div>
        <div style="font-size:11px;margin-top:4px;color:var(--text);line-height:1.4;font-family:var(--mono);opacity:.85;">${preview}${(item.text || '').length > 200 ? '…' : ''}</div>
      </div>
      ${isPending ? `<div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="sm" style="font-size:10px;padding:2px 8px;color:var(--ok);border-color:rgba(85,209,143,.3);" onclick="memApproveCandidate('${id}')">Approve</button>
        <button class="ghost sm" style="font-size:10px;padding:2px 8px;color:var(--danger);border-color:rgba(255,92,92,.2);" onclick="memRejectCandidate('${id}')">Reject</button>
        <button class="ghost sm" style="font-size:10px;padding:2px 8px;" onclick="memEditBeforeApprove('${id}')" title="Edit then approve">✎</button>
      </div>` : ''}
    </div>
  </div>`;
}

async function memApproveCandidate(candidateId) {
  try {
    const d = await apiFetch('/api/memory/staging/' + candidateId + '/approve', { method: 'POST', body: {} });
    if (!d.ok) { alert('Approve failed: ' + (d.error || 'Unknown')); return; }
    memLoadStaged();
    memLoadApproved();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

async function memRejectCandidate(candidateId) {
  const reason = prompt('Rejection reason (optional):');
  if (reason === null) return;
  try {
    const d = await apiFetch('/api/memory/staging/' + candidateId + '/reject', { method: 'POST', body: { reason } });
    if (!d.ok) { alert('Reject failed: ' + (d.error || 'Unknown')); return; }
    memLoadStaged();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

async function memEditBeforeApprove(candidateId) {
  try {
    const d = await apiFetch('/api/memory/staging/' + candidateId);
    if (!d.ok || !d.item) { alert('Failed to load candidate.'); return; }
    const item = d.item;
    const newText = prompt('Edit content before approving:', item.text || '');
    if (newText === null) return;
    const newField = prompt('Canonical field ID:', item.canonicalFieldId || '');
    if (newField === null) return;
    const newFamily = prompt('Report family:', item.reportFamily || '');
    if (newFamily === null) return;
    const newTags = prompt('Style tags (comma-separated):', (item.styleTags || []).join(', '));
    if (newTags === null) return;
    // Approve with overrides
    const body = {
      text: newText,
      canonicalFieldId: newField,
      reportFamily: newFamily,
      styleTags: newTags.split(',').map(s => s.trim()).filter(Boolean),
    };
    const r = await apiFetch('/api/memory/staging/' + candidateId + '/approve', { method: 'POST', body });
    if (!r.ok) { alert('Approve failed: ' + (r.error || 'Unknown')); return; }
    memLoadStaged();
    memLoadApproved();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Comparable Commentary Memory ─────────────────────────────────────────────

async function memLoadCompCommentary() {
  const el = $('memCompList');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const d = await apiFetch('/api/memory/comp-commentary?limit=30');
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error) + '</div>'; return; }
    const items = d.items || [];
    if (!items.length) { el.innerHTML = '<div class="hint">No comparable commentary memory items yet.</div>'; return; }
    el.innerHTML = items.map(item => {
      const id = esc(item.id || '');
      const preview = esc((item.text || '').slice(0, 200));
      const compType = esc(item.commentaryType || '');
      const propType = esc(item.subjectPropertyType || '');
      const quality = item.qualityScore != null ? item.qualityScore : '—';
      const active = item.active !== false;
      const tags = (item.issueTags || []).map(t => '<span class="chip" style="font-size:9px;padding:1px 5px;">' + esc(t) + '</span>').join(' ');
      return `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="chip" style="font-size:9px;padding:1px 6px;background:rgba(85,209,143,.12);color:var(--ok);">${compType || 'comp'}</span>
          ${propType ? '<span style="font-size:10px;color:var(--muted);">' + propType + '</span>' : ''}
          <span style="font-size:10px;color:var(--muted);">q: ${quality}</span>
          ${!active ? '<span style="font-size:10px;color:var(--danger);">INACTIVE</span>' : ''}
        </div>
        <div style="font-size:11px;margin-top:4px;color:var(--text);line-height:1.4;font-family:var(--mono);opacity:.85;">${preview}${(item.text || '').length > 200 ? '…' : ''}</div>
        ${tags ? '<div style="margin-top:3px;">' + tags + '</div>' : ''}
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}

// ── Voice Profile ────────────────────────────────────────────────────────────

async function memLoadVoiceProfile() {
  const el = $('memVoiceProfileList');
  const statusEl = $('memVoiceProfileStatus');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const d = await apiFetch('/api/memory/voice/profiles');
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error) + '</div>'; return; }
    const profiles = d.profiles || [];
    if (!profiles.length) {
      el.innerHTML = '<div class="hint">No voice profiles created yet. Use the form below to create one.</div>';
      if (statusEl) { statusEl.className = 'status'; statusEl.textContent = '0 profiles'; }
      return;
    }
    el.innerHTML = profiles.map(p => _memVoiceProfileCard(p)).join('');
    if (statusEl) { statusEl.className = 'status ok'; statusEl.textContent = profiles.length + ' profile(s)'; }
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}

function _memVoiceProfileCard(p) {
  const id = esc(p.id || '');
  const name = esc(p.name || 'Unnamed');
  const scope = esc(p.scope || 'global');
  const family = esc(p.reportFamily || '');
  const field = esc(p.canonicalFieldId || '');
  // Build dimensions from flat fields
  const dims = {};
  if (p.tone) dims.tone = p.tone;
  if (p.sentenceLength) dims['sentence length'] = p.sentenceLength;
  if (p.hedgingDegree) dims.hedging = p.hedgingDegree;
  if (p.terminologyPreference) dims.terminology = p.terminologyPreference;
  if (p.reconciliationStyle) dims.reconciliation = p.reconciliationStyle;
  if (p.sectionOpeningStyle) dims.opening = p.sectionOpeningStyle;
  if (p.sectionClosingStyle) dims.closing = p.sectionClosingStyle;
  const dimEntries = Object.entries(dims);
  const disallowed = (p.forbiddenPhrases || []);
  const preferred = (p.preferredPhrases || []);
  return `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <b style="font-size:12px;">${name}</b>
        <span class="chip" style="font-size:9px;padding:1px 6px;margin-left:6px;">${scope}</span>
        ${family ? '<span style="font-size:10px;color:var(--muted);margin-left:4px;">family: ' + family + '</span>' : ''}
        ${field ? '<span style="font-size:10px;color:var(--muted);margin-left:4px;">field: ' + field + '</span>' : ''}
      </div>
      <button class="ghost sm" onclick="memDeleteVoiceProfile('${id}')" style="color:var(--danger);font-size:10px;">Delete</button>
    </div>
    ${dimEntries.length ? '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">' + dimEntries.map(([k, v]) => '<span style="font-size:10px;background:rgba(215,179,90,.1);padding:1px 6px;border-radius:3px;border:1px solid rgba(215,179,90,.15);">' + esc(k) + ': ' + esc(String(v)) + '</span>').join('') + '</div>' : ''}
    ${preferred.length ? '<div style="margin-top:4px;font-size:10px;color:var(--ok);">Preferred: ' + preferred.slice(0, 5).map(ph => '"' + esc(ph) + '"').join(', ') + (preferred.length > 5 ? ' (+' + (preferred.length - 5) + ')' : '') + '</div>' : ''}
    ${disallowed.length ? '<div style="margin-top:4px;font-size:10px;color:var(--danger);">Disallowed: ' + disallowed.slice(0, 5).map(ph => '"' + esc(ph) + '"').join(', ') + (disallowed.length > 5 ? ' (+' + (disallowed.length - 5) + ')' : '') + '</div>' : ''}
  </div>`;
}

async function memSaveVoiceProfile() {
  const name = $('memVpName')?.value.trim();
  if (!name) { alert('Profile name is required.'); return; }
  const scope = $('memVpScope')?.value || 'global';
  const reportFamily = $('memVpReportFamily')?.value.trim() || null;
  const canonicalFieldId = $('memVpCanonicalField')?.value.trim() || null;
  const tone = $('memVpTone')?.value.trim() || null;
  const sentenceLength = $('memVpSentLen')?.value || null;
  const hedgingDegree = $('memVpHedging')?.value || null;
  const terminologyPreference = $('memVpTerminology')?.value.trim() || null;
  const reconciliationStyle = $('memVpReconStyle')?.value.trim() || null;
  const sectionOpeningStyle = $('memVpOpening')?.value.trim() || null;
  const sectionClosingStyle = $('memVpClosing')?.value.trim() || null;
  const disallowedRaw = $('memVpDisallowed')?.value || '';
  const forbiddenPhrases = disallowedRaw.split('\n').map(s => s.trim()).filter(Boolean);
  try {
    const d = await apiFetch('/api/memory/voice/profiles', {
      method: 'POST',
      body: {
        name, scope, reportFamily, canonicalFieldId,
        tone, sentenceLength, hedgingDegree, terminologyPreference,
        reconciliationStyle, sectionOpeningStyle, sectionClosingStyle,
        forbiddenPhrases,
      }
    });
    if (!d.ok) { alert('Save failed: ' + (d.error || 'Unknown')); return; }
    // Clear form
    if ($('memVpName')) $('memVpName').value = '';
    if ($('memVpTone')) $('memVpTone').value = '';
    if ($('memVpSentLen')) $('memVpSentLen').value = '';
    if ($('memVpHedging')) $('memVpHedging').value = '';
    if ($('memVpTerminology')) $('memVpTerminology').value = '';
    if ($('memVpReconStyle')) $('memVpReconStyle').value = '';
    if ($('memVpOpening')) $('memVpOpening').value = '';
    if ($('memVpClosing')) $('memVpClosing').value = '';
    if ($('memVpDisallowed')) $('memVpDisallowed').value = '';
    memLoadVoiceProfile();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

async function memAddVoiceRule() {
  const profileId = prompt('Voice profile ID to add rule to:');
  if (!profileId) return;
  const ruleType = prompt('Rule type (prefer / avoid / pattern / opening / closing / terminology):') || 'prefer';
  const ruleValue = prompt('Rule value:');
  if (!ruleValue) return;
  const canonicalFieldId = prompt('Canonical field ID (leave blank for all fields):') || null;
  const priority = parseInt(prompt('Priority (1-100, higher = more important):', '50')) || 50;
  try {
    const d = await apiFetch('/api/memory/voice/profiles/' + encodeURIComponent(profileId) + '/rules', {
      method: 'POST',
      body: { ruleType, ruleValue, canonicalFieldId, priority }
    });
    if (!d.ok) { alert('Failed: ' + (d.error || 'Unknown')); return; }
    memLoadVoiceProfile();
  } catch (e) { alert('Error: ' + e.message); }
}

async function memDeleteVoiceProfile(profileId) {
  if (!confirm('Delete this voice profile?')) return;
  try {
    await apiFetch('/api/memory/voice/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' });
    memLoadVoiceProfile();
    memLoadSummary();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Retrieval Preview ────────────────────────────────────────────────────────

async function memPreviewRetrieval() {
  const el = $('memRetrievalPreview');
  if (!el) return;
  const canonicalFieldId = $('memRetSection')?.value.trim();
  const reportFamily = $('memRetFamily')?.value.trim() || undefined;
  const propertyType = $('memRetPropType')?.value.trim() || undefined;
  if (!canonicalFieldId) { el.innerHTML = '<div class="hint" style="color:var(--danger);">Enter a section / canonical field ID.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading retrieval preview…</div>';
  try {
    const d = await apiFetch('/api/memory/retrieval/preview', {
      method: 'POST',
      body: {
        canonicalFieldId,
        reportFamily,
        formType: STATE.formType || '1004',
        assignmentContext: {
          propertyType,
          reportFamily,
          formType: STATE.formType || '1004',
        },
      }
    });
    if (!d.ok) { el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(d.error) + '</div>'; return; }
    const pack = d.pack || {};
    let html = '<div style="font-size:11px;margin-bottom:8px;color:var(--muted);">Retrieval pack for <b>' + esc(canonicalFieldId) + '</b>';
    if (pack.metadata) html += ' — scanned ' + (pack.metadata.totalScanned || 0) + ' items in ' + (pack.metadata.durationMs || 0) + 'ms';
    html += '</div>';

    // Voice hints
    if (pack.voiceHints) {
      html += '<details style="margin-bottom:6px;"><summary style="font-size:11px;cursor:pointer;color:var(--gold);">Voice Hints</summary>';
      html += '<pre style="font-size:10px;white-space:pre-wrap;margin:4px 0;padding:6px;background:rgba(0,0,0,.2);border-radius:4px;max-height:150px;overflow:auto;">' + esc(JSON.stringify(pack.voiceHints, null, 2)) + '</pre></details>';
    }

    // Disallowed phrases
    if (pack.disallowedPhrases && pack.disallowedPhrases.length) {
      html += '<details style="margin-bottom:6px;"><summary style="font-size:11px;cursor:pointer;color:var(--danger);">' + pack.disallowedPhrases.length + ' disallowed phrase(s)</summary>';
      html += '<div style="font-size:10px;padding:4px;color:var(--danger);">' + pack.disallowedPhrases.map(p => '"' + esc(p) + '"').join(', ') + '</div></details>';
    }

    // Narrative examples
    const examples = pack.narrativeExamples || [];
    html += '<div style="font-size:11px;margin:6px 0;"><b>' + examples.length + '</b> narrative example(s)</div>';
    for (const ex of examples) {
      const score = ex.score != null ? (typeof ex.score === 'object' ? ex.score.totalScore : ex.score) : '—';
      const reasons = ex.score?.matchReasons || [];
      html += `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="chip" style="font-size:9px;padding:1px 5px;">${esc(ex.bucket || ex.sourceType || '')}</span>
          <span style="font-size:10px;color:var(--gold);">score: ${score}</span>
          ${ex.rationale ? '<span style="font-size:9px;color:var(--muted);">' + esc(ex.rationale) + '</span>' : ''}
        </div>
        <div style="font-size:10px;margin-top:3px;font-family:var(--mono);opacity:.8;">${esc((ex.text || '').slice(0, 150))}${(ex.text || '').length > 150 ? '…' : ''}</div>
        ${reasons.length ? '<details style="margin-top:3px;"><summary style="font-size:10px;cursor:pointer;color:var(--muted);">Score breakdown</summary><div style="font-size:10px;padding:4px;color:var(--muted);">' + reasons.map(r => esc(r)).join('<br>') + '</div></details>' : ''}
      </div>`;
    }

    // Phrase bank
    const phrases = pack.phraseBankItems || [];
    if (phrases.length) {
      html += '<div style="font-size:11px;margin:8px 0;"><b>' + phrases.length + '</b> phrase bank item(s)</div>';
      for (const ph of phrases) {
        html += '<div style="font-size:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-family:var(--mono);opacity:.8;">' + esc((ph.text || '').slice(0, 120)) + ' <span style="color:var(--muted);">(score: ' + (ph.score || 0) + ')</span></div>';
      }
    }

    // Voice exemplars
    const exemplars = pack.voiceExemplars || [];
    if (exemplars.length) {
      html += '<div style="font-size:11px;margin:8px 0;"><b>' + exemplars.length + '</b> voice exemplar(s)</div>';
      for (const ve of exemplars) {
        html += '<div style="font-size:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);font-family:var(--mono);opacity:.8;">' + esc((ve.text || '').slice(0, 120)) + ' <span style="color:var(--gold);">(score: ' + (ve.score || 0) + ')</span></div>';
      }
    }

    // Comp commentary
    const comps = pack.compCommentary || [];
    if (comps.length) {
      html += '<div style="font-size:11px;margin:8px 0;"><b>' + comps.length + '</b> comp commentary example(s)</div>';
      for (const cc of comps) {
        html += '<div style="font-size:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span class="chip" style="font-size:9px;padding:1px 5px;background:rgba(85,209,143,.12);color:var(--ok);">' + esc(cc.commentaryType || 'general') + '</span> ' + esc((cc.text || '').slice(0, 120)) + ' <span style="color:var(--muted);">(score: ' + (cc.score || 0) + ')</span></div>';
      }
    }

    // Metadata
    if (pack.metadata) {
      html += '<details style="margin-top:8px;"><summary style="font-size:10px;cursor:pointer;color:var(--muted);">Pack metadata</summary>';
      html += '<pre style="font-size:9px;white-space:pre-wrap;margin:4px 0;padding:6px;background:rgba(0,0,0,.2);border-radius:4px;max-height:120px;overflow:auto;">' + esc(JSON.stringify(pack.metadata, null, 2)) + '</pre></details>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="hint" style="color:var(--danger);">' + esc(e.message) + '</div>';
  }
}
/* ═══════════════════════════════════════════════════════════════════════════
   Phase 10 — Business Operations Layer (Timeline, Archive, Export, Health)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Load case timeline and render into the Case tab timeline card */
async function loadCaseTimeline() {
  if (!STATE.caseId) return;
  const card = $('caseTimelineCard');
  const body = $('caseTimelineBody');
  if (!card || !body) return;
  card.style.display = '';
  body.innerHTML = '<div class="hint">Loading timeline…</div>';
  try {
    const r = await fetch(server() + '/api/operations/timeline/' + STATE.caseId + '?limit=50');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const events = data.events || data.timeline || data || [];
    if (!events.length) {
      body.innerHTML = '<div class="hint">No timeline events yet.</div>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:2px;">';
    for (const ev of events) {
      const icon = ev.icon || '●';
      const ts = ev.created_at || ev.timestamp || '';
      const tsShort = ts ? new Date(ts).toLocaleString() : '';
      const cat = ev.category || ev.event_type || '';
      const desc = ev.description || ev.detail || ev.event_type || '';
      html += '<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid var(--gen-border);font-size:12px;">';
      html += '<span style="font-size:14px;flex-shrink:0;width:20px;text-align:center;">' + esc(icon) + '</span>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-weight:600;">' + esc(desc) + '</div>';
      html += '<div style="font-size:10px;color:var(--gen-fg-muted);margin-top:2px;">' + esc(cat) + ' · ' + esc(tsShort) + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="hint" style="color:var(--gen-danger);">Failed to load timeline: ' + esc(e.message) + '</div>';
  }
}

/** Show timeline + ops cards when a case is loaded */
function showCaseOpsCards() {
  const tlCard = $('caseTimelineCard');
  const opsCard = $('caseOpsCard');
  if (tlCard) tlCard.style.display = STATE.caseId ? '' : 'none';
  if (opsCard) opsCard.style.display = STATE.caseId ? '' : 'none';
}

/** Archive the current case */
async function archiveCurrentCase() {
  if (!STATE.caseId) return alert('No case selected.');
  if (!confirm('Archive this case? It can be restored later.')) return;
  try {
    const r = await fetch(server() + '/api/operations/archive/' + STATE.caseId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    alert(data.message || 'Case archived.');
    await loadCases();
  } catch (e) {
    alert('Archive failed: ' + e.message);
  }
}

/** Export current case manifest */
async function exportCurrentCase() {
  if (!STATE.caseId) return alert('No case selected.');
  try {
    const r = await fetch(server() + '/api/operations/export/' + STATE.caseId);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    // Download as JSON
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'case-export-' + STATE.caseId + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

// Hook into loadCase to show ops cards
const _origLoadCaseForOps = typeof loadCase === 'function' ? loadCase : null;
if (_origLoadCaseForOps) {
  const _wrappedLoadCase = async function(id) {
    await _origLoadCaseForOps(id);
    showCaseOpsCards();
    loadCaseTimeline();
  };
  // We can't reassign loadCase if it's a function declaration, so we patch via a post-hook approach
  // Instead, we'll call showCaseOpsCards from the init flow
}

// Ensure ops cards show/hide on tab switch
const _origShowTabForOps = typeof showTab === 'function' ? showTab : null;

(async()=>{
  await pingServer();
  await initFormRegistry();
  await loadCases();
  renderCaseStripMeta({});
  renderFactSourcesEditor({});
  await checkAgentStatus();
  await initVersionDisplay();
  await loadHealthStatus();
  // Phase 10: show ops cards if case already loaded
  showCaseOpsCards();
})();
setInterval(pingServer, 30000);
setInterval(checkAgentStatus, 15000);
setInterval(loadHealthStatus, 30000);

// Phase 10: periodically refresh timeline if on case tab
setInterval(() => {
  if (STATE.caseId && document.querySelector('#tab-case.active')) {
    loadCaseTimeline();
  }
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3: Governance Cards, Readiness Checklists, Missing-Facts Dashboard,
//          Business Status Summary, Due-Date / Pipeline Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

// ── Case Business Status ──────────────────────────────────────────────────────
async function loadCaseBusinessStatus() {
  const el = $('caseBusinessBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const [engRes, invRes, pipRes] = await Promise.all([
    apiFetch('/api/business/engagements?caseId=' + STATE.caseId).catch(() => ({ ok: false })),
    apiFetch('/api/business/invoices/summary').catch(() => ({ ok: false })),
    apiFetch('/api/business/pipeline/summary').catch(() => ({ ok: false })),
  ]);
  const eng = engRes.ok ? (engRes.engagements || [])[0] : null;
  const invSummary = invRes.ok ? invRes : {};
  const pipSummary = pipRes.ok ? pipRes : {};

  const fee = eng?.fee || eng?.agreedFee || '-';
  const dueDate = eng?.dueDate ? new Date(eng.dueDate).toLocaleDateString() : '-';
  const engStatus = eng?.status || '-';
  const totalPipeline = pipSummary.totalPipelineValue || 0;
  const totalInvoiced = invSummary.totalIssued || invSummary.totalInvoiced || 0;
  const totalPaid = invSummary.totalPaid || 0;
  const totalOverdue = invSummary.overdueCount || 0;

  el.innerHTML =
    `<div class="biz-status-grid">` +
      `<div class="biz-metric"><span class="biz-metric-label">Fee</span><span class="biz-metric-value">${esc(typeof fee === 'number' ? '$' + fee.toLocaleString() : String(fee))}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Due Date</span><span class="biz-metric-value">${esc(dueDate)}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Engagement</span><span class="biz-metric-value">${esc(String(engStatus).replace(/_/g,' '))}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Pipeline Value</span><span class="biz-metric-value">$${Number(totalPipeline).toLocaleString()}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Invoiced</span><span class="biz-metric-value">$${Number(totalInvoiced).toLocaleString()}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Paid</span><span class="biz-metric-value ok">$${Number(totalPaid).toLocaleString()}</span></div>` +
      (totalOverdue > 0
        ? `<div class="biz-metric"><span class="biz-metric-label">Overdue</span><span class="biz-metric-value err">${totalOverdue}</span></div>`
        : '') +
    `</div>`;
}

// ── Case Readiness Checklist ──────────────────────────────────────────────────
async function loadCaseReadiness() {
  const el = $('caseReadinessBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const [preDraft, qcGate, freshness] = await Promise.all([
    apiFetch(`/api/cases/${STATE.caseId}/pre-draft-check`).catch(() => ({ ok: false })),
    apiFetch(`/api/cases/${STATE.caseId}/qc-approval-gate`).catch(() => ({ ok: false })),
    apiFetch(`/api/governance/freshness/${STATE.caseId}`).catch(() => ({ ok: false })),
  ]);

  const gate = preDraft.ok ? preDraft.gate : null;
  const approval = qcGate.ok ? qcGate.gate : null;
  const fresh = freshness.ok ? freshness : null;

  const items = [];

  // Pre-draft gate
  if (gate) {
    items.push(rdnsItem(gate.ok, 'Pre-Draft Gate', gate.ok ? 'All required facts verified' : `${gate.summary?.missingRequiredFacts || 0} missing facts, ${gate.summary?.blockerConflicts || 0} blocker conflicts`));
    items.push(rdnsItem(
      (gate.summary?.provenanceCoveragePct || 0) >= 80,
      'Provenance Coverage',
      `${gate.summary?.provenanceCoveragePct || 0}% of facts have sources`,
      (gate.summary?.provenanceCoveragePct || 0) >= 50 && (gate.summary?.provenanceCoveragePct || 0) < 80 ? 'warn' : null
    ));
  }

  // Freshness
  if (fresh) {
    const allCurrent = (fresh.stale || 0) === 0;
    items.push(rdnsItem(allCurrent, 'Section Freshness', allCurrent ? `All ${fresh.current || 0} sections current` : `${fresh.stale || 0} stale sections`));
  }

  // QC approval gate
  if (approval) {
    items.push(rdnsItem(approval.ok, 'QC Approval Gate', approval.ok ? 'Ready for finalization' : (approval.message || approval.code || 'Not ready')));
    if (approval.openBlockerCount > 0) {
      items.push(rdnsItem(false, 'QC Blockers', `${approval.openBlockerCount} open blocker findings`));
    }
    if (approval.staleSectionCount > 0) {
      items.push(rdnsItem(false, 'Stale Sections', `${approval.staleSectionCount} sections need regeneration`));
    }
    if (approval.contradictionSummary && approval.contradictionSummary.open > 0) {
      items.push(rdnsItem(false, 'Contradictions', `${approval.contradictionSummary.open} open contradictions`));
    }
  }

  if (!items.length) {
    el.innerHTML = '<div class="hint">Load a case with generated sections to see readiness.</div>';
    return;
  }

  el.innerHTML = `<div class="rdns-checklist">${items.join('')}</div>`;
}

function rdnsItem(pass, label, detail, override) {
  const state = override || (pass ? 'pass' : 'fail');
  const icon = state === 'pass' ? '&#x2713;' : state === 'warn' ? '&#x26A0;' : '&#x2717;';
  const iconColor = state === 'pass' ? 'var(--ok)' : state === 'warn' ? 'var(--warn)' : 'var(--danger)';
  return (
    `<div class="rdns-item ${state}">` +
      `<span class="rdns-icon" style="color:${iconColor}">${icon}</span>` +
      `<span class="rdns-label">${esc(label)}</span>` +
      `<span class="rdns-detail">${esc(detail)}</span>` +
    `</div>`
  );
}

// ── Missing-Facts Dashboard ───────────────────────────────────────────────────
async function loadCaseMissingFacts() {
  const el = $('caseMissingFactsBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/cases/${STATE.caseId}/section-audit`).catch(() => ({ ok: false }));
  if (!res.ok) {
    el.innerHTML = '<div class="hint" style="color:var(--warn)">Failed to load section audit data.</div>';
    return;
  }

  const audits = res.sectionAudits || {};
  const sections = Object.entries(audits).filter(([, a]) => {
    const policy = a.policy || {};
    const missing = policy.missingFacts || {};
    return (missing.required?.length > 0) || (missing.recommended?.length > 0);
  });

  if (!sections.length) {
    el.innerHTML = '<div class="hint" style="color:var(--ok)">All sections have required facts available.</div>';
    return;
  }

  const sectionHtml = sections.map(([sectionId, audit]) => {
    const policy = audit.policy || {};
    const missing = policy.missingFacts || {};
    const required = missing.required || [];
    const recommended = missing.recommended || [];
    const sLabel = policy.profileLabel || policy.sectionId || sectionId;

    const factRows = [
      ...required.map(path => `<div class="mf-fact-row"><span class="mf-fact-path">${esc(path)}</span><span class="mf-fact-sev required">Required</span></div>`),
      ...recommended.map(path => `<div class="mf-fact-row"><span class="mf-fact-path">${esc(path)}</span><span class="mf-fact-sev recommended">Recommended</span></div>`),
    ].join('');

    const countLabel = required.length
      ? `<span style="color:var(--danger);font-size:10px;font-weight:700;">${required.length} required</span>`
      : `<span style="color:var(--warn);font-size:10px;">${recommended.length} recommended</span>`;

    return (
      `<div class="mf-section">` +
        `<div class="mf-section-head"><span>${esc(sLabel)}</span>${countLabel}</div>` +
        `<div class="mf-section-body">${factRows}</div>` +
      `</div>`
    );
  }).join('');

  el.innerHTML = `<div class="mf-dashboard">${sectionHtml}</div>`;
}

// ── Due-Date Queue ────────────────────────────────────────────────────────────
async function loadDueDateQueue() {
  const el = $('dueDateQueueBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch('/api/business/engagements/upcoming').catch(() => ({ ok: false }));
  const overdueRes = await apiFetch('/api/business/engagements/overdue').catch(() => ({ ok: false }));

  const upcoming = res.ok ? (res.engagements || []) : [];
  const overdue = overdueRes.ok ? (overdueRes.engagements || []) : [];
  const combined = [...overdue.map(e => ({ ...e, _overdue: true })), ...upcoming];

  if (!combined.length) {
    el.innerHTML = '<div class="hint">No upcoming or overdue assignments.</div>';
    return;
  }

  const now = Date.now();
  el.innerHTML = `<div class="due-queue">` + combined.slice(0, 15).map(eng => {
    const due = eng.dueDate ? new Date(eng.dueDate) : null;
    const daysLeft = due ? Math.ceil((due - now) / 86400000) : null;
    const isOverdue = eng._overdue || (daysLeft !== null && daysLeft < 0);
    const isUrgent = !isOverdue && daysLeft !== null && daysLeft <= 3;
    const itemClass = isOverdue ? 'overdue' : isUrgent ? 'urgent' : '';
    const daysClass = isOverdue ? 'past' : (daysLeft <= 3 ? 'soon' : 'ok');
    const daysLabel = daysLeft === null ? '-' : (isOverdue ? `${Math.abs(daysLeft)}d late` : `${daysLeft}d`);
    const addr = eng.propertyAddress || eng.address || eng.caseId || 'Unknown';
    const dateStr = due ? due.toLocaleDateString() : '-';

    return (
      `<div class="due-item ${itemClass}" onclick="${eng.caseId ? `loadCase('${esc(eng.caseId)}');showTab('case')` : ''}">` +
        `<span class="due-item-addr">${esc(addr)}</span>` +
        `<span class="due-item-date">${esc(dateStr)}</span>` +
        `<span class="due-item-days ${daysClass}">${esc(daysLabel)}</span>` +
      `</div>`
    );
  }).join('') + `</div>`;
}

// ── Pipeline Summary ──────────────────────────────────────────────────────────
async function loadPipelineSummary() {
  const el = $('pipelineSummaryBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch('/api/business/pipeline/summary').catch(() => ({ ok: false }));
  if (!res.ok) {
    el.innerHTML = '<div class="hint">No pipeline data available.</div>';
    return;
  }

  const byStage = res.byStage || {};
  const stageOrder = ['prospect','quoted','engaged','in_progress','review','submitted','invoiced','paid','closed'];
  const stageChips = stageOrder
    .filter(s => (byStage[s] || 0) > 0)
    .map(s => `<span class="pipeline-stage">${esc(s.replace(/_/g,' '))}<span class="ps-count">${byStage[s]}</span></span>`)
    .join('');

  const totalValue = res.totalPipelineValue || 0;
  const avgDays = res.averageDaysInStage || 0;

  el.innerHTML =
    (stageChips ? `<div class="pipeline-stages">${stageChips}</div>` : '') +
    `<div class="biz-status-grid">` +
      `<div class="biz-metric"><span class="biz-metric-label">Pipeline Value</span><span class="biz-metric-value">$${Number(totalValue).toLocaleString()}</span></div>` +
      `<div class="biz-metric"><span class="biz-metric-label">Avg Days/Stage</span><span class="biz-metric-value">${avgDays.toFixed(1)}</span></div>` +
    `</div>`;
}

// ── Show business cards when case loads ───────────────────────────────────────
function showCaseBusinessCards() {
  const row = $('caseBusinessRow');
  const mfCard = $('caseMissingFactsCard');
  if (row) row.style.display = STATE.caseId ? 'flex' : 'none';
  if (mfCard) mfCard.style.display = STATE.caseId ? 'block' : 'none';
  if (STATE.caseId) {
    loadCaseBusinessStatus();
    loadCaseReadiness();
    loadCaseMissingFacts();
  }
}

// ── Enhanced section governance card for workspace assistant ──────────────────
function workspaceRenderGovernanceCard(sectionId) {
  const summary = typeof workspaceSectionPolicySummary === 'function' ? workspaceSectionPolicySummary() : {};
  const audit = summary[sectionId];
  if (!audit) return '';

  const fs = audit.freshnessStatus || 'not_generated';
  const fsClass = fs === 'current' ? 'current' : fs === 'stale' ? 'stale' : fs === 'regenerating' ? 'regenerating' : 'not_generated';
  const fsLabel = fs.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Quality bar
  let qualityHtml = '';
  if (audit.qualityScore !== null && audit.qualityScore !== undefined) {
    const q = audit.qualityScore;
    const qClass = q >= 70 ? 'high' : q >= 40 ? 'mid' : 'low';
    const qColor = q >= 70 ? 'var(--ok)' : q >= 40 ? 'var(--warn)' : 'var(--danger)';
    qualityHtml =
      `<div class="gov-quality-bar">` +
        `<div class="gov-quality-track"><div class="gov-quality-fill ${qClass}" style="width:${q}%"></div></div>` +
        `<span class="gov-quality-label" style="color:${qColor}">${q}</span>` +
      `</div>`;
  }

  // Dependency chips
  let depHtml = '';
  if (audit.requiredPaths && audit.requiredPaths.length) {
    const chips = audit.requiredPaths.slice(0, 8).map(p => {
      const present = !audit.missingRequiredPaths || !audit.missingRequiredPaths.includes(p);
      return `<span class="gov-dep-chip ${present ? 'present' : 'missing'}">${esc(p.split('.').pop())}</span>`;
    }).join('');
    depHtml = `<div class="gov-dep-list">${chips}</div>`;
  }

  // Stale reasons
  let staleHtml = '';
  if (audit.staleReasons && audit.staleReasons.length) {
    staleHtml = `<div style="font-size:10px;color:var(--warn);margin-top:4px;">${esc(audit.staleReasons.join('; '))}</div>`;
  }

  // Generation info
  let genHtml = '';
  if (audit.generatedAt) {
    genHtml += `<div style="font-size:10px;color:var(--muted);margin-top:4px;">Generated: ${esc(new Date(audit.generatedAt).toLocaleString())}`;
    if (audit.regenerationCount > 0) genHtml += ` (${audit.regenerationCount} regenerations)`;
    genHtml += '</div>';
  }

  return (
    `<div class="gov-card">` +
      `<div class="gov-card-head">` +
        `<span class="gov-card-title">Section Governance</span>` +
        `<span class="gov-card-badge ${fsClass}">${esc(fsLabel)}</span>` +
      `</div>` +
      `<div style="font-size:10px;color:var(--muted);">Prompt v${esc(audit.promptVersion || '-')} | ${esc(audit.profileId || 'default')}</div>` +
      qualityHtml +
      depHtml +
      staleHtml +
      genHtml +
      `<div style="margin-top:6px;">` +
        `<button class="sec sm" onclick="workspaceLoadSectionAudit('${esc(sectionId)}')">Full Audit</button>` +
      `</div>` +
    `</div>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4: Unified Valuation Desk
// ═══════════════════════════════════════════════════════════════════════════════

let _valQueueFilter = 'all';

function valDeskShowPanel(panelId) {
  document.querySelectorAll('.val-desk-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.val-desk-tab').forEach(t => t.classList.remove('active'));
  const panel = $('valPanel-' + panelId);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.val-desk-tab').forEach(t => {
    if (t.getAttribute('onclick') && t.getAttribute('onclick').includes("'" + panelId + "'")) t.classList.add('active');
  });
  // Auto-load data for the panel
  if (panelId === 'compQueue' && STATE.caseId) { valLoadCompGrid(); valLoadCompQueue(); }
  if (panelId === 'adjustments' && STATE.caseId) { valLoadAdjustments(); valLoadBurden(); }
  if (panelId === 'approaches' && STATE.caseId) { valLoadGridSummary(); valLoadIncome(); valLoadCost(); }
  if (panelId === 'reconciliation' && STATE.caseId) { valLoadRecon(); }
}

// ── Comp Grid Status ──────────────────────────────────────────────────────────
async function valLoadCompGrid() {
  const el = $('valCompGridStatus');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/valuation/grid/${STATE.caseId}/summary`).catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">No grid data yet.</div>';
    return;
  }
  const slots = res.slots || res.grid || [];
  const filled = Array.isArray(slots) ? slots.filter(s => s && s.address).length : 0;
  const total = 3;
  el.innerHTML =
    `<div style="font-size:12px;">` +
      `<div style="display:flex;justify-content:space-between;"><span>Grid Slots Filled</span><strong>${filled}/${total}</strong></div>` +
      (Array.isArray(slots) ? slots.map((s, i) => {
        if (!s || !s.address) return `<div style="padding:4px 0;color:var(--muted);font-size:11px;">Comp ${i+1}: <em>Empty</em></div>`;
        return `<div style="padding:4px 0;font-size:11px;"><strong>Comp ${i+1}:</strong> ${esc(s.address || '')} <span style="color:var(--gold);">${s.salePrice ? '$' + Number(s.salePrice).toLocaleString() : ''}</span></div>`;
      }).join('') : '') +
    `</div>`;
}

// ── Comp Queue ────────────────────────────────────────────────────────────────
async function valLoadCompQueue() {
  const el = $('valCompQueueBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading candidates...</div>';
  const res = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence`).catch(() => ({ ok: false }));
  if (!res.ok) {
    el.innerHTML = '<div class="hint">No comparable intelligence data. Build intelligence and run comp analysis first.</div>';
    return;
  }
  const candidates = res.candidates || [];
  _valRenderCompQueue(el, candidates);
}

function valFilterQueue(filter, btn) {
  _valQueueFilter = filter;
  document.querySelectorAll('#valPanel-compQueue .filt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  valLoadCompQueue();
}

function _valRenderCompQueue(el, candidates) {
  const filtered = _valQueueFilter === 'all' ? candidates
    : candidates.filter(c => {
      const status = (c.reviewStatus || c.status || 'pending').toLowerCase();
      if (_valQueueFilter === 'pending') return status === 'pending' || status === 'recommended';
      return status === _valQueueFilter;
    });

  if (!filtered.length) {
    el.innerHTML = `<div class="hint">No ${_valQueueFilter === 'all' ? '' : _valQueueFilter + ' '}candidates.</div>`;
    return;
  }

  el.innerHTML = filtered.map(c => {
    const status = (c.reviewStatus || c.status || 'pending').toLowerCase();
    const statusClass = status === 'accepted' ? 'accepted' : status === 'held' ? 'held' : status === 'rejected' ? 'rejected' : '';
    const price = c.salePrice ? '$' + Number(c.salePrice).toLocaleString() : '';
    const date = c.saleDate || c.dateOfSale || '';
    const tier = c.tierLabel || c.tier || '';
    const relevance = c.relevanceScore != null ? c.relevanceScore : '';
    const addr = c.address || 'Unknown';
    const cid = c.id || c.candidateId || '';
    const reasonHistory = c.reasonHistory || c.rejectReasonCode || c.holdReason || '';

    return (
      `<div class="comp-queue-item ${statusClass}">` +
        `<div class="comp-queue-head">` +
          `<div>` +
            `<div class="comp-queue-addr">${esc(addr)}</div>` +
            `<div style="font-size:10px;color:var(--muted);">${esc(date)}</div>` +
          `</div>` +
          `<div class="comp-queue-price">${esc(price)}</div>` +
        `</div>` +
        `<div class="comp-queue-meta">` +
          (tier ? `<span class="chip">${esc(tier)}</span>` : '') +
          (relevance !== '' ? `<span class="chip">${esc(String(relevance))}</span>` : '') +
          `<span class="chip ${status === 'accepted' ? 'ok' : status === 'rejected' ? 'err' : status === 'held' ? 'warn' : ''}">${esc(status)}</span>` +
          (c.keyMatches ? `<span class="chip ok">${c.keyMatches} matches</span>` : '') +
          (c.keyMismatches ? `<span class="chip warn">${c.keyMismatches} mismatches</span>` : '') +
        `</div>` +
        (reasonHistory ? `<div class="comp-queue-reason">${esc(String(reasonHistory))}</div>` : '') +
        (status !== 'rejected'
          ? `<div class="comp-queue-actions">` +
              (status !== 'accepted' ? `<button class="sm" onclick="workspaceAcceptComparableCandidate('${esc(cid)}')">Accept</button>` : '') +
              (status !== 'held' && status !== 'accepted' ? `<button class="sec sm" onclick="workspaceHoldComparableCandidate('${esc(cid)}')">Hold</button>` : '') +
              `<button class="sm" onclick="workspaceAcceptComparableCandidate('${esc(cid)}','comp1')">Comp 1</button>` +
              `<button class="sm" onclick="workspaceAcceptComparableCandidate('${esc(cid)}','comp2')">Comp 2</button>` +
              `<button class="sm" onclick="workspaceAcceptComparableCandidate('${esc(cid)}','comp3')">Comp 3</button>` +
              `<select id="valRejectReason-${esc(cid)}" style="font-size:10px;padding:2px 4px;max-width:120px;">` +
                `<option value="too_distant">Too distant</option>` +
                `<option value="poor_condition">Poor condition</option>` +
                `<option value="poor_market_match">Poor market match</option>` +
                `<option value="atypical_sale">Atypical sale</option>` +
                `<option value="other">Other</option>` +
              `</select>` +
              `<button class="ghost sm" onclick="valRejectCandidate('${esc(cid)}')">Reject</button>` +
            `</div>`
          : '') +
      `</div>`
    );
  }).join('');
}

async function valRejectCandidate(candidateId) {
  if (!STATE.caseId) return;
  const sel = $('valRejectReason-' + candidateId);
  const reasonCode = sel ? sel.value : 'other';
  await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence/candidates/${candidateId}/reject`, {
    method: 'POST', body: { rejectedBy: 'appraiser', reasonCode }
  });
  valLoadCompQueue();
}

// ── Burden Metrics ────────────────────────────────────────────────────────────
async function valLoadBurden() {
  const el = $('valBurdenBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence`).catch(() => ({ ok: false }));
  if (!res.ok || !res.acceptedSlots?.length) {
    el.innerHTML = '<div class="hint">Accept and load comps to see burden metrics.</div>';
    return;
  }
  const slots = res.acceptedSlots;
  el.innerHTML = slots.map(slot => {
    const b = slot.burdenMetrics || {};
    const stability = b.overallStabilityScore || 0;
    const stabColor = stability >= 0.75 ? 'var(--ok)' : stability >= 0.55 ? 'var(--warn)' : 'var(--danger)';
    const contradictions = (slot.contradictions || []);
    return (
      `<div class="burden-card">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<strong style="font-size:12px;">${esc(slot.gridSlotLabel || 'Comp')}: ${esc(slot.address || '')}</strong>` +
          `<span class="chip" style="color:${stabColor}">${(stability * 100).toFixed(0)}% stable</span>` +
        `</div>` +
        _valBurdenMeter('Gross Adj', b.grossAdjustmentPercent || 0, 25) +
        _valBurdenMeter('Net Adj', Math.abs(b.netAdjustmentPercent || 0), 15) +
        _valBurdenMeter('Data Confidence', (b.dataConfidenceScore || 0) * 100, 0, true) +
        _valBurdenMeter('Date Relevance', (b.dateRelevanceScore || 0) * 100, 0, true) +
        _valBurdenMeter('Location', (b.locationConfidenceScore || 0) * 100, 0, true) +
        `<div style="font-size:10px;color:var(--muted);margin-top:6px;">Major mismatches: ${b.majorMismatchCount || 0}</div>` +
        (contradictions.length
          ? `<div style="margin-top:6px;font-size:10px;">` +
              contradictions.map(f => `<div style="color:var(--warn);padding:2px 0;"><strong>${esc(f.code || f.category || '')}</strong>: ${esc(f.message || '')}</div>`).join('') +
            `</div>`
          : '') +
      `</div>`
    );
  }).join('');
}

function _valBurdenMeter(label, value, threshold, inverted = false) {
  const pct = Math.min(100, Math.max(0, value));
  const bad = inverted ? pct < 50 : pct > threshold;
  const color = bad ? (inverted ? 'var(--danger)' : 'var(--warn)') : 'var(--ok)';
  return (
    `<div class="burden-meter">` +
      `<span style="font-size:10px;color:var(--muted);min-width:80px;">${esc(label)}</span>` +
      `<div class="burden-meter-track"><div class="burden-meter-fill" style="width:${pct}%;background:${color};"></div></div>` +
      `<span class="burden-meter-label" style="color:${color}">${pct.toFixed(0)}%</span>` +
    `</div>`
  );
}

// ── Adjustment Notebook ───────────────────────────────────────────────────────
async function valLoadAdjustments() {
  const el = $('valAdjNotebookBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence`).catch(() => ({ ok: false }));
  if (!res.ok || !res.acceptedSlots?.length) {
    el.innerHTML = '<div class="hint">Accept comps and run analysis to see adjustment support.</div>';
    return;
  }

  const slots = res.acceptedSlots;
  const html = slots.map(slot => {
    const support = slot.adjustmentSupport || [];
    if (!support.length) return '';
    const slotLabel = slot.gridSlotLabel || 'Comp';
    return (
      `<div style="margin-bottom:16px;">` +
        `<div style="font-size:12px;font-weight:800;color:var(--gold);margin-bottom:8px;">${esc(slotLabel)}: ${esc(slot.address || '')}</div>` +
        `<div class="adj-notebook">` +
          support.map(adj => {
            const amount = adj.finalAmount ?? adj.suggestedAmount ?? 0;
            const amtClass = amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'zero';
            const amtLabel = amount === 0 ? '$0' : `${amount > 0 ? '+' : '-'}$${Math.abs(amount).toLocaleString()}`;
            const amtColor = amount > 0 ? 'pos' : amount < 0 ? 'neg' : '';
            const strength = adj.supportStrength || adj.strength || '';
            const strClass = strength === 'high' ? 'high' : strength === 'medium' ? 'medium' : strength === 'low' ? 'low' : '';
            const decision = adj.decisionStatus || '';
            const gridSlot = slot.gridSlot || slot.gridSlotLabel || '';
            const cat = adj.adjustmentCategory || adj.label || '';
            return (
              `<div class="adj-row ${amtClass}">` +
                `<span class="adj-cat">${esc(adj.label || cat)}</span>` +
                `<span class="adj-subj">${esc(adj.subjectValue || '-')}</span>` +
                `<span class="adj-comp">${esc(adj.compValue || '-')}</span>` +
                `<span class="adj-amount ${amtColor}">${esc(amtLabel)}</span>` +
                (strength ? `<span class="adj-strength ${strClass}">${esc(strength)}</span>` : '') +
                (decision ? `<span class="chip ${decision === 'accepted' ? 'ok' : decision === 'modified' ? 'warn' : decision === 'rejected' ? 'err' : ''}" style="font-size:9px;">${esc(decision)}</span>` : '') +
                `<button class="ghost sm" style="font-size:9px;padding:2px 6px;" onclick="workspaceSaveAdjustmentSupportDecision('${esc(gridSlot)}','${esc(cat)}','accepted')">&#x2713;</button>` +
                `<button class="ghost sm" style="font-size:9px;padding:2px 6px;" onclick="workspaceModifyAdjustmentSupportDecision('${esc(gridSlot)}','${esc(cat)}')">&#x270E;</button>` +
              `</div>`
            );
          }).join('') +
        `</div>` +
      `</div>`
    );
  }).join('');

  el.innerHTML = html || '<div class="hint">No adjustment support records found.</div>';
}

// ── Sales Comparison Summary ──────────────────────────────────────────────────
async function valLoadGridSummary() {
  const el = $('valSalesBody');
  if (!el || !STATE.caseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/valuation/grid/${STATE.caseId}/summary`).catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">No sales comparison data yet.</div>';
    return;
  }
  const slots = res.slots || res.grid || [];
  const indication = res.indicatedValue || res.weightedValue || null;
  const range = res.range || {};

  let html = '';
  if (Array.isArray(slots) && slots.length) {
    html += `<table style="width:100%;font-size:11px;border-collapse:collapse;">` +
      `<thead><tr style="border-bottom:1px solid var(--border);">` +
        `<th style="text-align:left;padding:4px 6px;">Comp</th>` +
        `<th style="text-align:left;padding:4px 6px;">Address</th>` +
        `<th style="text-align:right;padding:4px 6px;">Sale Price</th>` +
        `<th style="text-align:right;padding:4px 6px;">Adj. Price</th>` +
        `<th style="text-align:right;padding:4px 6px;">Net %</th>` +
        `<th style="text-align:right;padding:4px 6px;">Gross %</th>` +
      `</tr></thead><tbody>`;
    for (const s of slots) {
      if (!s || !s.address) continue;
      html += `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">` +
        `<td style="padding:4px 6px;font-weight:700;">${esc(s.gridSlotLabel || s.slot || '')}</td>` +
        `<td style="padding:4px 6px;">${esc(s.address || '')}</td>` +
        `<td style="padding:4px 6px;text-align:right;font-family:var(--mono);">$${Number(s.salePrice || 0).toLocaleString()}</td>` +
        `<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--gold);">$${Number(s.adjustedPrice || s.adjustedSalePrice || 0).toLocaleString()}</td>` +
        `<td style="padding:4px 6px;text-align:right;">${s.netAdjustmentPercent || 0}%</td>` +
        `<td style="padding:4px 6px;text-align:right;">${s.grossAdjustmentPercent || 0}%</td>` +
      `</tr>`;
    }
    html += `</tbody></table>`;
  }

  if (indication) {
    html += `<div style="margin-top:12px;padding:10px;border:1px solid rgba(85,209,143,.3);border-radius:8px;background:rgba(85,209,143,.04);">` +
      `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Indicated Value</div>` +
      `<div style="font-size:20px;font-weight:900;color:var(--ok);font-family:var(--mono);">$${Number(indication).toLocaleString()}</div>` +
      (range.low && range.high ? `<div style="font-size:10px;color:var(--muted);">Range: $${Number(range.low).toLocaleString()} - $${Number(range.high).toLocaleString()}</div>` : '') +
    `</div>`;
  }

  html += `<div class="btnrow" style="margin-top:8px;"><button class="sm" onclick="valCalcSales()">Calculate Indication</button></div>`;
  el.innerHTML = html || '<div class="hint">No grid data.</div>';
}

async function valCalcSales() {
  if (!STATE.caseId) return;
  const res = await apiFetch(`/api/valuation/grid/${STATE.caseId}/summary`).catch(() => null);
  if (res) valLoadGridSummary();
}

// ── Income Approach ───────────────────────────────────────────────────────────
async function valLoadIncome() {
  if (!STATE.caseId) return;
  const res = await apiFetch(`/api/valuation/income/${STATE.caseId}`).catch(() => null);
  if (!res || res.error) return;
  if (res.monthlyRent) $('valIncomeRent').value = res.monthlyRent;
  if (res.grm) $('valIncomeGrm').value = res.grm;
  if (res.indicatedValue) {
    setStatus('valIncomeResult', `Indicated: $${Number(res.indicatedValue).toLocaleString()}`, 'ok');
  }
}

async function valCalcIncome() {
  if (!STATE.caseId) return;
  const rent = parseFloat($('valIncomeRent').value);
  const grm = parseFloat($('valIncomeGrm').value);
  if (!rent || !grm) { setStatus('valIncomeResult', 'Enter rent and GRM', 'err'); return; }
  setStatus('valIncomeResult', 'Calculating...', 'warn');
  await apiFetch(`/api/valuation/income/${STATE.caseId}/rent-comps`, {
    method: 'PUT', body: { rentComps: [{ monthlyRent: rent }] }
  }).catch(() => null);
  const res = await apiFetch(`/api/valuation/income/${STATE.caseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    const val = res.indicatedValue || rent * grm * 12;
    setStatus('valIncomeResult', `Indicated: $${Number(val).toLocaleString()}`, 'ok');
  } else {
    const val = rent * grm;
    setStatus('valIncomeResult', `Indicated (local): $${Number(val).toLocaleString()}`, 'ok');
  }
}

// ── Cost Approach ─────────────────────────────────────────────────────────────
async function valLoadCost() {
  if (!STATE.caseId) return;
  const res = await apiFetch(`/api/valuation/cost/${STATE.caseId}`).catch(() => null);
  if (!res || res.error) return;
  if (res.siteValue) $('valCostSite').value = res.siteValue;
  if (res.dwellingCostNew || res.replacementCost) $('valCostDwelling').value = res.dwellingCostNew || res.replacementCost;
  if (res.depreciation || res.totalDepreciation) $('valCostDepr').value = res.depreciation || res.totalDepreciation;
  if (res.indicatedValue) {
    setStatus('valCostResult', `Indicated: $${Number(res.indicatedValue).toLocaleString()}`, 'ok');
  }
}

async function valCalcCost() {
  if (!STATE.caseId) return;
  const site = parseFloat($('valCostSite').value);
  const dwelling = parseFloat($('valCostDwelling').value);
  const depr = parseFloat($('valCostDepr').value) || 0;
  if (!site || !dwelling) { setStatus('valCostResult', 'Enter site value and dwelling cost', 'err'); return; }
  setStatus('valCostResult', 'Calculating...', 'warn');
  await apiFetch(`/api/valuation/cost/${STATE.caseId}/land`, { method: 'PUT', body: { siteValue: site } }).catch(() => null);
  await apiFetch(`/api/valuation/cost/${STATE.caseId}/replacement`, { method: 'PUT', body: { dwellingCostNew: dwelling } }).catch(() => null);
  await apiFetch(`/api/valuation/cost/${STATE.caseId}/depreciation`, { method: 'PUT', body: { totalDepreciation: depr } }).catch(() => null);
  const res = await apiFetch(`/api/valuation/cost/${STATE.caseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    const val = res.indicatedValue || (site + dwelling - depr);
    setStatus('valCostResult', `Indicated: $${Number(val).toLocaleString()}`, 'ok');
  } else {
    const val = site + dwelling - depr;
    setStatus('valCostResult', `Indicated (local): $${Number(val).toLocaleString()}`, 'ok');
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────
async function valLoadRecon() {
  const apprEl = $('valReconApproaches');
  if (!apprEl || !STATE.caseId) return;
  apprEl.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/valuation/reconciliation/${STATE.caseId}`).catch(() => null);
  if (!res || res.error) {
    apprEl.innerHTML = '<div class="hint">No reconciliation data yet. Calculate approach values first.</div>';
    return;
  }

  const approaches = [
    { name: 'Sales Comparison', key: 'salesComparison', value: res.salesComparisonValue || res.salesComparison?.value, weight: res.salesComparisonWeight || res.weights?.salesComparison || 0 },
    { name: 'Income Approach', key: 'income', value: res.incomeValue || res.income?.value, weight: res.incomeWeight || res.weights?.income || 0 },
    { name: 'Cost Approach', key: 'cost', value: res.costValue || res.cost?.value, weight: res.costWeight || res.weights?.cost || 0 },
  ];

  apprEl.innerHTML = approaches.map(a => (
    `<div class="recon-approach">` +
      `<div class="recon-approach-head">` +
        `<span class="recon-approach-name">${esc(a.name)}</span>` +
        `<span class="recon-approach-value">${a.value ? '$' + Number(a.value).toLocaleString() : '-'}</span>` +
      `</div>` +
      `<div class="recon-weight-row">` +
        `<span style="font-size:10px;color:var(--muted);">Weight:</span>` +
        `<input class="recon-weight-input" type="text" value="${a.weight}" data-recon-key="${a.key}" onchange="valUpdateWeight(this)"/>` +
        `<span style="font-size:10px;color:var(--muted);">%</span>` +
      `</div>` +
    `</div>`
  )).join('');

  // Load narrative
  if (res.narrative) {
    const narEl = $('valReconNarrative');
    if (narEl) narEl.value = res.narrative;
  }

  // Show final value if available
  if (res.finalValue || res.weightedValue) {
    setStatus('valReconResult', `Final Value: $${Number(res.finalValue || res.weightedValue).toLocaleString()}`, 'ok');
  }
}

function valUpdateWeight(input) {
  // Weights are saved when reconciliation is calculated
}

async function valCalcRecon() {
  if (!STATE.caseId) return;
  setStatus('valReconResult', 'Calculating...', 'warn');
  // Gather weights from inputs
  const weights = {};
  document.querySelectorAll('[data-recon-key]').forEach(input => {
    weights[input.dataset.reconKey] = parseFloat(input.value) || 0;
  });
  await apiFetch(`/api/valuation/reconciliation/${STATE.caseId}/weights`, {
    method: 'PUT', body: weights
  }).catch(() => null);
  const res = await apiFetch(`/api/valuation/reconciliation/${STATE.caseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    const val = res.finalValue || res.weightedValue || res.indicatedValue || 0;
    setStatus('valReconResult', `Final Value: $${Number(val).toLocaleString()}`, 'ok');
  } else {
    setStatus('valReconResult', 'Could not calculate. Ensure approach values are saved.', 'err');
  }
}

async function valSaveReconNarrative() {
  if (!STATE.caseId) return;
  const narrative = $('valReconNarrative').value.trim();
  if (!narrative) { setStatus('valReconResult', 'Enter a narrative first.', 'err'); return; }
  const res = await apiFetch(`/api/valuation/reconciliation/${STATE.caseId}/narrative`, {
    method: 'PUT', body: { narrative }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('valReconResult', 'Narrative saved.', 'ok');
  } else {
    setStatus('valReconResult', 'Failed to save narrative.', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5: Learning Dashboard, Why-This-Suggestion, Memory Health
// ═══════════════════════════════════════════════════════════════════════════════

// ── Learning Dashboard ──────────────────────────────────────────────────────

async function learnLoadDashboard() {
  const el = $('learnDashBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading learning metrics...</div>';

  // Fetch acceptance rate and patterns in parallel
  const [rateRes, patternsRes, archivesRes] = await Promise.all([
    apiFetch('/api/learning/acceptance-rate').catch(() => null),
    apiFetch('/api/learning/patterns?limit=20').catch(() => null),
    STATE.caseId ? apiFetch(`/api/learning/revision-diffs/${STATE.caseId}/stats`).catch(() => null) : null,
  ]);

  let html = '<div class="learn-dash">';

  // ── Acceptance / Rejection Metrics ──
  const rate = rateRes && !rateRes.error ? rateRes : null;
  const total = rate?.total || 0;
  const accepted = rate?.accepted || 0;
  const modified = rate?.modified || 0;
  const rejected = rate?.rejected || 0;
  const acceptRate = rate?.acceptanceRate != null ? Math.round(rate.acceptanceRate * 100) : null;
  const modRate = rate?.modificationRate != null ? Math.round(rate.modificationRate * 100) : null;

  html += `<div class="learn-stat-grid">`;
  html += _learnStat(total, 'Total Suggestions', '');
  html += _learnStat(accepted, 'Accepted', 'good');
  html += _learnStat(modified, 'Modified', 'mid');
  html += _learnStat(rejected, 'Rejected', 'low');
  html += _learnStat(acceptRate != null ? acceptRate + '%' : '—', 'Accept Rate', acceptRate > 70 ? 'good' : acceptRate > 40 ? 'mid' : 'low');
  html += _learnStat(modRate != null ? modRate + '%' : '—', 'Modify Rate', 'mid');
  html += `</div>`;

  // ── Learned Patterns ──
  const patterns = (patternsRes && !patternsRes.error) ? (patternsRes.patterns || patternsRes.rows || []) : [];
  if (patterns.length) {
    html += `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted);margin-top:8px;">Learned Patterns (${patterns.length})</h4>`;
    html += `<div class="learn-pattern-list">`;
    patterns.forEach(p => {
      const conf = p.confidence != null ? Math.round(p.confidence * 100) : 0;
      const confClass = conf >= 70 ? 'var(--ok)' : conf >= 40 ? 'var(--warn)' : 'var(--danger)';
      html +=
        `<div class="learn-pattern">` +
          `<div style="display:flex;align-items:center;gap:6px;">` +
            `<span class="learn-pattern-type">${esc(p.patternType || p.pattern_type || '')}</span>` +
            `<span>${esc(p.patternKey || p.pattern_key || '')}</span>` +
          `</div>` +
          `<div style="display:flex;align-items:center;gap:6px;">` +
            `<div class="learn-conf-bar"><div class="learn-conf-fill" style="width:${conf}%;background:${confClass};"></div></div>` +
            `<span style="font-size:10px;font-weight:700;font-family:var(--mono);color:${confClass};">${conf}%</span>` +
          `</div>` +
        `</div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="hint" style="margin-top:8px;">No learned patterns yet. Complete and archive assignments to build patterns.</div>`;
  }

  // ── Revision Diff Stats (current case) ──
  if (archivesRes && !archivesRes.error) {
    const diffStats = archivesRes;
    const changed = diffStats.sectionsChanged || 0;
    const totalSections = diffStats.totalSections || 0;
    const avgChange = diffStats.averageChangeRatio != null ? Math.round(diffStats.averageChangeRatio * 100) : 0;
    const mostChanged = diffStats.mostChangedSections || [];

    html += `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted);margin-top:8px;">Revision Diffs (Current Case)</h4>`;
    html += `<div class="learn-stat-grid">`;
    html += _learnStat(changed + '/' + totalSections, 'Sections Changed', '');
    html += _learnStat(avgChange + '%', 'Avg Change Ratio', avgChange < 30 ? 'good' : avgChange < 60 ? 'mid' : 'low');
    html += `</div>`;

    if (mostChanged.length) {
      html += `<div class="learn-revision-list" style="margin-top:6px;">`;
      mostChanged.forEach(s => {
        const ratio = s.changeRatio != null ? Math.round(s.changeRatio * 100) : 0;
        const cls = ratio < 30 ? 'good' : ratio < 60 ? 'mid' : 'low';
        html +=
          `<div class="learn-revision">` +
            `<span class="learn-revision-section">${esc(s.sectionId || s.section_id || '')}</span>` +
            `<span class="learn-revision-ratio learn-stat-value ${cls}">${ratio}%</span>` +
          `</div>`;
      });
      html += `</div>`;
    }
  }

  html += `</div>`;
  el.innerHTML = html;
}

function _learnStat(value, label, cls) {
  return (
    `<div class="learn-stat">` +
      `<div class="learn-stat-value ${cls}">${esc(String(value))}</div>` +
      `<div class="learn-stat-label">${esc(label)}</div>` +
    `</div>`
  );
}

// ── Why This Suggestion (for workspace) ─────────────────────────────────────

async function workspaceLoadWhySuggestion(fieldId) {
  const container = $('whySuggestionDrawer_' + fieldId);
  if (!container) return;
  // Toggle visibility
  if (container.style.display === 'block') { container.style.display = 'none'; return; }
  container.style.display = 'block';
  container.innerHTML = '<div class="hint">Loading explanation...</div>';
  if (!STATE.caseId) { container.innerHTML = '<div class="hint">No case loaded.</div>'; return; }

  // Load influence explanation for the current section
  const sectionId = WORKSPACE_STATE?.sectionId || '';
  const formType = STATE.formType || '';
  const propertyType = STATE.caseRecord?.propertyType || STATE.factsObj?.subject?.propertyType || '';

  const [influenceRes, historyRes] = await Promise.all([
    apiFetch(`/api/learning/influence/${encodeURIComponent(sectionId)}?formType=${encodeURIComponent(formType)}&propertyType=${encodeURIComponent(propertyType)}`).catch(() => null),
    apiFetch(`/api/learning/suggestion-history/${STATE.caseId}`).catch(() => null),
  ]);

  let html = '<div class="why-drawer">';
  html += '<div class="why-drawer-head"><span class="why-drawer-title">Why This Suggestion</span></div>';

  // Influence factors
  const influence = (influenceRes && !influenceRes.error) ? influenceRes : null;
  if (influence && influence.influenceFactors) {
    const factors = influence.influenceFactors;
    html += '<div style="margin-bottom:8px;">';
    if (factors.suggestion_acceptance != null) {
      html += _whyFactor('Suggestion Acceptance', factors.suggestion_acceptance, factors.suggestion_acceptance);
    }
    if (factors.modification_rate != null) {
      html += _whyFactor('Modification Rate', factors.modification_rate, 1 - factors.modification_rate);
    }
    if (factors.revision_patterns != null) {
      html += _whyFactor('Revision Patterns', factors.revision_patterns, factors.revision_patterns);
    }
    html += '</div>';
  }

  // Top patterns from influence
  if (influence && influence.topPatterns && influence.topPatterns.length) {
    html += '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px;">TOP PATTERNS</div>';
    influence.topPatterns.forEach(p => {
      const rate = p.acceptanceRate != null ? Math.round(p.acceptanceRate * 100) : 0;
      html +=
        `<div class="why-factor">` +
          `<span class="why-factor-name">${esc(p.type || p.suggestionType || '')}</span>` +
          `<span class="why-factor-value">${rate}% accepted</span>` +
        `</div>`;
    });
  }

  // Revision stats from influence
  if (influence && influence.revisionStats) {
    const rs = influence.revisionStats;
    html += `<div style="font-size:10px;margin-top:6px;color:var(--muted);">` +
      `Avg change ratio: <strong>${rs.averageChangeRatio != null ? Math.round(rs.averageChangeRatio * 100) + '%' : '—'}</strong> | ` +
      `Sections changed: <strong>${rs.sectionsChanged || 0}/${rs.totalSections || 0}</strong>` +
    `</div>`;
  }

  // Recent suggestion history for this case (field-specific)
  const history = (historyRes && !historyRes.error) ? (historyRes.outcomes || historyRes.rows || []) : [];
  const fieldHistory = history.filter(h => h.sectionId === sectionId || h.section_id === sectionId);
  if (fieldHistory.length) {
    html += '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-top:8px;margin-bottom:4px;">RECENT DECISIONS</div>';
    fieldHistory.slice(0, 5).forEach(h => {
      const accepted = h.accepted;
      const modified = h.modified;
      const icon = accepted ? (modified ? '~' : '+') : 'x';
      const iconColor = accepted ? 'var(--ok)' : 'var(--danger)';
      const text = h.suggestedText || h.suggested_text || '';
      html +=
        `<div style="display:flex;align-items:flex-start;gap:6px;padding:2px 0;font-size:10px;">` +
          `<span style="color:${iconColor};font-weight:900;min-width:10px;">${icon}</span>` +
          `<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px;">${esc(text.slice(0, 80))}</span>` +
        `</div>`;
    });
  }

  if (!influence && !fieldHistory.length) {
    html += '<div class="hint">No learning data available for this section yet. Complete assignments to build history.</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

function _whyFactor(name, value, barRatio) {
  const pct = Math.round((value || 0) * 100);
  const barWidth = Math.round((barRatio || 0) * 100);
  return (
    `<div class="why-factor">` +
      `<span class="why-factor-name">${esc(name)}</span>` +
      `<div class="why-factor-bar"><div class="why-factor-fill" style="width:${barWidth}%;"></div></div>` +
      `<span class="why-factor-value">${pct}%</span>` +
    `</div>`
  );
}

// ── Memory Health Tools ─────────────────────────────────────────────────────

async function memHealthScan() {
  const statsEl = $('memHealthStats');
  const bodyEl = $('memHealthBody');
  if (!bodyEl) return;
  if (statsEl) statsEl.innerHTML = '';
  bodyEl.innerHTML = '<div class="hint">Scanning memory health...</div>';

  // Fetch KB status and approved memory for analysis
  const [kbRes, approvedRes, stagingRes] = await Promise.all([
    apiFetch('/api/kb/status').catch(() => null),
    apiFetch('/api/memory/approved?limit=500').catch(() => null),
    apiFetch('/api/memory/staging/summary').catch(() => null),
  ]);

  // KB stats
  const kb = (kbRes && !kbRes.error) ? kbRes : {};
  const totalItems = kb.totalItems || kb.approvedCount || 0;
  const stagingPending = stagingRes?.pending || stagingRes?.pendingCount || 0;

  // Analyze approved items for health issues
  const items = (approvedRes && !approvedRes.error) ? (approvedRes.items || approvedRes.rows || []) : [];

  const now = Date.now();
  const STALE_DAYS = 180;
  const WEAK_QUALITY = 30;

  // Detect stale items (not updated in 180+ days)
  const staleItems = items.filter(item => {
    const updated = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
    if (!updated) return false;
    const age = (now - new Date(updated).getTime()) / (1000 * 60 * 60 * 24);
    return age > STALE_DAYS;
  });

  // Detect weak items (quality score < 30)
  const weakItems = items.filter(item => {
    const qs = item.qualityScore ?? item.quality_score;
    return qs != null && qs < WEAK_QUALITY;
  });

  // Detect duplicates (same text hash)
  const hashMap = {};
  const duplicateItems = [];
  items.forEach(item => {
    const hash = item.textHash || item.text_hash;
    if (!hash) return;
    if (hashMap[hash]) {
      duplicateItems.push(item);
    } else {
      hashMap[hash] = item;
    }
  });

  // Render stats
  if (statsEl) {
    statsEl.innerHTML =
      `<div class="mem-health-grid">` +
        _memHealthStat(totalItems, 'Total Items') +
        _memHealthStat(stagingPending, 'Pending Review') +
        _memHealthStat(staleItems.length, 'Stale (180d+)') +
        _memHealthStat(duplicateItems.length, 'Duplicates') +
        _memHealthStat(weakItems.length, 'Weak (QS<30)') +
      `</div>`;
  }

  // Render issues
  let html = '';
  const totalIssues = staleItems.length + duplicateItems.length + weakItems.length;

  if (totalIssues === 0) {
    html = '<div class="hint" style="margin-top:8px;">Memory is healthy. No stale, duplicate, or weak items detected.</div>';
  } else {
    html += `<div style="margin-top:8px;">`;

    if (staleItems.length) {
      html += `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--warn);margin-bottom:6px;">Stale Items (${staleItems.length})</h4>`;
      staleItems.slice(0, 10).forEach(item => {
        html += _memHealthItemRow(item, 'stale');
      });
      if (staleItems.length > 10) html += `<div class="hint">${staleItems.length - 10} more stale items...</div>`;
      html += `<div class="mem-health-actions"><button class="sm sec" onclick="memHealthPruneStale()">Archive All Stale</button></div>`;
    }

    if (duplicateItems.length) {
      html += `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#8ac4ff;margin-top:10px;margin-bottom:6px;">Duplicates (${duplicateItems.length})</h4>`;
      duplicateItems.slice(0, 10).forEach(item => {
        html += _memHealthItemRow(item, 'duplicate');
      });
      if (duplicateItems.length > 10) html += `<div class="hint">${duplicateItems.length - 10} more duplicates...</div>`;
      html += `<div class="mem-health-actions"><button class="sm sec" onclick="memHealthPruneDuplicates()">Remove Duplicates</button></div>`;
    }

    if (weakItems.length) {
      html += `<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--danger);margin-top:10px;margin-bottom:6px;">Weak Quality (${weakItems.length})</h4>`;
      weakItems.slice(0, 10).forEach(item => {
        const qs = item.qualityScore ?? item.quality_score ?? 0;
        html += _memHealthItemRow(item, 'weak', `QS: ${qs}`);
      });
      if (weakItems.length > 10) html += `<div class="hint">${weakItems.length - 10} more weak items...</div>`;
      html += `<div class="mem-health-actions"><button class="sm sec" onclick="memHealthPruneWeak()">Archive Weak Items</button></div>`;
    }

    html += `</div>`;
  }

  bodyEl.innerHTML = html;
}

function _memHealthStat(value, label) {
  return (
    `<div class="mem-health-stat">` +
      `<div class="mem-health-value">${esc(String(value))}</div>` +
      `<div class="mem-health-label">${esc(label)}</div>` +
    `</div>`
  );
}

function _memHealthItemRow(item, cls, extra) {
  const text = item.text || '';
  const bucket = item.bucket || item.source_type || '';
  return (
    `<div class="mem-health-item ${cls}">` +
      `<span class="learn-pattern-type">${esc(bucket)}</span>` +
      `<span class="mem-health-item-text">${esc(text.slice(0, 80))}</span>` +
      (extra ? `<span style="font-size:10px;font-weight:700;font-family:var(--mono);">${esc(extra)}</span>` : '') +
    `</div>`
  );
}

async function memHealthPruneStale() {
  if (!confirm('Archive all memory items older than 180 days?')) return;
  const bodyEl = $('memHealthBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="hint">Archiving stale items...</div>';
  const res = await apiFetch('/api/memory/approved?limit=500').catch(() => null);
  const items = (res && !res.error) ? (res.items || res.rows || []) : [];
  const now = Date.now();
  const staleIds = items.filter(item => {
    const updated = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
    return updated && (now - new Date(updated).getTime()) / (1000 * 60 * 60 * 24) > 180;
  }).map(i => i.id);

  let archived = 0;
  for (const id of staleIds) {
    const r = await apiFetch(`/api/memory/approved/${id}`, { method: 'PATCH', body: { active: false } }).catch(() => null);
    if (r && !r.error) archived++;
  }
  memHealthScan();
}

async function memHealthPruneDuplicates() {
  if (!confirm('Remove duplicate memory items (keeps the first occurrence)?')) return;
  const bodyEl = $('memHealthBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="hint">Removing duplicates...</div>';
  const res = await apiFetch('/api/memory/approved?limit=500').catch(() => null);
  const items = (res && !res.error) ? (res.items || res.rows || []) : [];
  const seen = {};
  const dupeIds = [];
  items.forEach(item => {
    const hash = item.textHash || item.text_hash;
    if (!hash) return;
    if (seen[hash]) dupeIds.push(item.id);
    else seen[hash] = true;
  });

  let removed = 0;
  for (const id of dupeIds) {
    const r = await apiFetch(`/api/memory/approved/${id}`, { method: 'DELETE' }).catch(() => null);
    if (r && !r.error) removed++;
  }
  memHealthScan();
}

async function memHealthPruneWeak() {
  if (!confirm('Archive all memory items with quality score below 30?')) return;
  const bodyEl = $('memHealthBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="hint">Archiving weak items...</div>';
  const res = await apiFetch('/api/memory/approved?limit=500').catch(() => null);
  const items = (res && !res.error) ? (res.items || res.rows || []) : [];
  const weakIds = items.filter(i => {
    const qs = i.qualityScore ?? i.quality_score;
    return qs != null && qs < 30;
  }).map(i => i.id);

  let archived = 0;
  for (const id of weakIds) {
    const r = await apiFetch(`/api/memory/approved/${id}`, { method: 'PATCH', body: { active: false } }).catch(() => null);
    if (r && !r.error) archived++;
  }
  memHealthScan();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6: System Reliability — Backup Scheduler, Restore Verification, Audit Log
// ═══════════════════════════════════════════════════════════════════════════════

let _sysAuditOffset = 0;
const _sysAuditLimit = 50;

function sysOnTabOpen() {
  sysLoadHealth();
  sysLoadSchedule();
  sysLoadBackups();
  sysLoadDR();
}

// ── System Health ───────────────────────────────────────────────────────────

async function sysLoadHealth() {
  const el = $('sysHealthBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Checking...</div>';
  const res = await apiFetch('/api/operations/health/diagnostics').catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">Could not load diagnostics.</div>';
    return;
  }

  const checks = res.checks || res;
  const dbStats = res.dbStats || {};
  let html = '<div class="sys-stat-grid">';

  // Service statuses
  const services = ['database', 'documentStorage', 'orchestrator', 'qcEngine', 'aciAgent', 'rqAgent'];
  services.forEach(svc => {
    const status = checks[svc]?.status || checks[svc] || 'unknown';
    const cls = status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'unavailable';
    const label = svc.replace(/([A-Z])/g, ' $1').trim();
    html += `<div class="sys-stat"><div class="sys-stat-value ${cls}">${esc(status)}</div><div class="sys-stat-label">${esc(label)}</div></div>`;
  });

  // DB stats
  if (dbStats.dbSizeMB != null) {
    html += `<div class="sys-stat"><div class="sys-stat-value">${dbStats.dbSizeMB}</div><div class="sys-stat-label">DB Size (MB)</div></div>`;
  }
  if (dbStats.tableCount != null) {
    html += `<div class="sys-stat"><div class="sys-stat-value">${dbStats.tableCount}</div><div class="sys-stat-label">Tables</div></div>`;
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Backup Schedule ─────────────────────────────────────────────────────────

async function sysLoadSchedule() {
  const el = $('sysScheduleBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch('/api/security/backups/schedule').catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">No schedule configured.</div>';
    return;
  }
  const sched = res.schedule || res;
  // Populate form fields
  const enabledEl = $('sysSchedEnabled');
  const intervalEl = $('sysSchedInterval');
  const retentionEl = $('sysSchedRetention');
  const maxEl = $('sysSchedMax');
  if (enabledEl) enabledEl.value = sched.enabled ? '1' : '0';
  if (intervalEl) intervalEl.value = sched.interval_hours || sched.intervalHours || 24;
  if (retentionEl) retentionEl.value = sched.retention_days || sched.retentionDays || 30;
  if (maxEl) maxEl.value = sched.max_backups || sched.maxBackups || 10;

  const statusText = sched.enabled ? 'Active' : 'Disabled';
  const statusCls = sched.enabled ? 'ok' : '';
  el.innerHTML =
    `<div style="font-size:11px;">` +
      `<div>Status: <strong class="${statusCls}">${statusText}</strong></div>` +
      `<div>Every <strong>${sched.interval_hours || sched.intervalHours || 24}h</strong> · Keep <strong>${sched.retention_days || sched.retentionDays || 30} days</strong> · Max <strong>${sched.max_backups || sched.maxBackups || 10}</strong></div>` +
    `</div>`;
}

async function sysSaveSchedule() {
  const enabled = $('sysSchedEnabled')?.value === '1';
  const interval_hours = parseInt($('sysSchedInterval')?.value) || 24;
  const retention_days = parseInt($('sysSchedRetention')?.value) || 30;
  const max_backups = parseInt($('sysSchedMax')?.value) || 10;
  const res = await apiFetch('/api/security/backups/schedule', {
    method: 'PUT',
    body: { enabled, interval_hours, retention_days, max_backups }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('sysScheduleStatus', 'Schedule saved.', 'ok');
    sysLoadSchedule();
  } else {
    setStatus('sysScheduleStatus', 'Failed to save schedule.', 'err');
  }
}

// ── Backup History ──────────────────────────────────────────────────────────

async function sysLoadBackups() {
  const el = $('sysBackupList');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading backups...</div>';
  const res = await apiFetch('/api/security/backups').catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">No backups found.</div>';
    return;
  }
  const backups = res.backups || res.rows || [];
  if (!backups.length) {
    el.innerHTML = '<div class="hint">No backups yet. Click Create Backup to make one.</div>';
    return;
  }

  el.innerHTML = '<div class="bkp-list">' + backups.map(b => {
    const status = b.status || 'pending';
    const statusCls = status === 'verified' ? 'verified' : status === 'failed' ? 'failed' : 'pending';
    const sizeMB = b.file_size_bytes ? (b.file_size_bytes / (1024 * 1024)).toFixed(1) + ' MB' : '—';
    const date = b.created_at ? new Date(b.created_at).toLocaleString() : '—';
    const id = b.id || '';
    return (
      `<div class="bkp-item">` +
        `<div class="bkp-item-icon">${status === 'verified' ? '&#x2705;' : '&#x1F4BE;'}</div>` +
        `<div class="bkp-item-info">` +
          `<div class="bkp-item-name">${esc(b.backup_type || 'manual')} — ${esc(date)}</div>` +
          `<div class="bkp-item-meta">${esc(sizeMB)} · ${esc(b.file_hash ? b.file_hash.slice(0, 12) + '...' : 'no hash')}</div>` +
        `</div>` +
        `<span class="bkp-item-status ${statusCls}">${esc(status)}</span>` +
        `<div class="bkp-item-actions">` +
          `<button class="ghost sm" onclick="sysVerifyBackup('${esc(id)}')" title="Verify integrity">Verify</button>` +
          `<button class="ghost sm" onclick="sysStartRestore('${esc(id)}')" title="Start restore workflow">Restore</button>` +
        `</div>` +
      `</div>`
    );
  }).join('') + '</div>';
}

async function sysCreateBackup() {
  setStatus('sysBackupStatus', 'Creating backup...', '');
  const res = await apiFetch('/api/security/backups/create', { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    setStatus('sysBackupStatus', 'Backup created successfully.', 'ok');
    sysLoadBackups();
  } else {
    setStatus('sysBackupStatus', 'Backup failed: ' + (res?.error || 'unknown error'), 'err');
  }
}

async function sysVerifyBackup(backupId) {
  setStatus('sysBackupStatus', 'Verifying...', '');
  const res = await apiFetch(`/api/security/backups/${backupId}/verify`, { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    const valid = res.valid !== false;
    setStatus('sysBackupStatus', valid ? 'Backup verified — integrity OK.' : 'Verification failed: ' + (res.reason || 'corrupt'), valid ? 'ok' : 'err');
    sysLoadBackups();
  } else {
    setStatus('sysBackupStatus', 'Verification failed.', 'err');
  }
}

// ── Restore Verification Workflow ───────────────────────────────────────────

async function sysStartRestore(backupId) {
  const el = $('sysRestoreBody');
  if (!el) return;
  el.innerHTML =
    `<div class="restore-steps">` +
      `<div class="restore-step active" id="restoreStep1">` +
        `<div class="restore-step-num">1</div>` +
        `<div style="flex:1;"><strong>Verify Backup Integrity</strong><div style="font-size:10px;color:var(--muted);">Checking file hash, size, and table counts...</div></div>` +
      `</div>` +
      `<div class="restore-step" id="restoreStep2">` +
        `<div class="restore-step-num">2</div>` +
        `<div style="flex:1;"><strong>Review Backup Contents</strong><div style="font-size:10px;color:var(--muted);">Inspect what will be restored.</div></div>` +
      `</div>` +
      `<div class="restore-step" id="restoreStep3">` +
        `<div class="restore-step-num">3</div>` +
        `<div style="flex:1;"><strong>Confirm & Restore</strong><div style="font-size:10px;color:var(--muted);">Final confirmation before overwrite.</div></div>` +
      `</div>` +
    `</div>`;

  // Step 1: Verify
  const verifyRes = await apiFetch(`/api/security/backups/${backupId}/verify`, { method: 'POST', body: {} }).catch(() => null);
  const step1 = $('restoreStep1');
  const step2 = $('restoreStep2');
  const step3 = $('restoreStep3');

  if (!verifyRes || verifyRes.error || verifyRes.valid === false) {
    if (step1) { step1.className = 'restore-step'; step1.querySelector('div:last-child').innerHTML = '<strong>Verify Backup Integrity</strong><div style="font-size:10px;color:var(--danger);">Verification failed. Cannot proceed.</div>'; }
    setStatus('sysRestoreStatus', 'Backup failed verification. Choose a different backup.', 'err');
    return;
  }

  if (step1) step1.className = 'restore-step done';
  if (step2) step2.className = 'restore-step active';

  // Step 2: Show backup details
  const backup = verifyRes.backup || verifyRes;
  const tables = backup.table_counts_json ? (typeof backup.table_counts_json === 'string' ? JSON.parse(backup.table_counts_json) : backup.table_counts_json) : {};
  const sizeMB = backup.file_size_bytes ? (backup.file_size_bytes / (1024 * 1024)).toFixed(1) + ' MB' : '—';
  const date = backup.created_at ? new Date(backup.created_at).toLocaleString() : '—';

  let detailHtml =
    `<div style="font-size:11px;padding:6px 0;">` +
      `<div><strong>Created:</strong> ${esc(date)}</div>` +
      `<div><strong>Size:</strong> ${esc(sizeMB)}</div>` +
      `<div><strong>Tables:</strong></div>`;
  Object.entries(tables).forEach(([table, count]) => {
    detailHtml += `<div style="padding-left:12px;font-size:10px;color:var(--muted);">${esc(table)}: <strong>${count}</strong></div>`;
  });
  detailHtml +=
    `</div>` +
    `<div class="btnrow"><button class="sm" onclick="sysConfirmRestore('${esc(backupId)}')">Confirm Restore</button><button class="sec sm" onclick="sysCancelRestore()">Cancel</button></div>`;

  if (step2) step2.querySelector('div:last-child').innerHTML = '<strong>Review Backup Contents</strong>' + detailHtml;
}

async function sysConfirmRestore(backupId) {
  if (!confirm('This will restore the database from backup. Current data will be overwritten. Proceed?')) return;
  const step2 = $('restoreStep2');
  const step3 = $('restoreStep3');
  if (step2) step2.className = 'restore-step done';
  if (step3) step3.className = 'restore-step active';

  setStatus('sysRestoreStatus', 'Restoring...', '');
  const res = await apiFetch(`/api/security/backups/${backupId}/restore`, { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    if (step3) step3.className = 'restore-step done';
    setStatus('sysRestoreStatus', 'Restore complete. Status: ' + (res.status || 'done'), 'ok');
  } else {
    setStatus('sysRestoreStatus', 'Restore failed: ' + (res?.error || 'unknown'), 'err');
  }
}

function sysCancelRestore() {
  const el = $('sysRestoreBody');
  if (el) el.innerHTML = '<div class="hint">Restore cancelled. Select a backup to try again.</div>';
  setStatus('sysRestoreStatus', '', '');
}

// ── Disaster Recovery Status ────────────────────────────────────────────────

async function sysLoadDR() {
  const el = $('sysDRBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Checking DR readiness...</div>';
  const res = await apiFetch('/api/security/dr-status').catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">Could not load DR status.</div>';
    return;
  }

  const dr = res.status || res;
  const checks = dr.checks || [];
  const overall = dr.ready || dr.overall || 'unknown';
  const overallCls = overall === true || overall === 'ready' ? 'healthy' : 'degraded';

  let html = `<div style="font-size:12px;margin-bottom:8px;">Overall: <strong class="sys-stat-value ${overallCls}" style="font-size:12px;">${overall === true ? 'READY' : esc(String(overall).toUpperCase())}</strong></div>`;
  html += '<div class="dr-status">';

  if (Array.isArray(checks) && checks.length) {
    checks.forEach(c => {
      const ok = c.passed || c.ok;
      const icon = ok ? '<span style="color:var(--ok);">&#x2713;</span>' : '<span style="color:var(--danger);">&#x2717;</span>';
      html += `<div class="dr-check"><div class="dr-check-icon">${icon}</div><span>${esc(c.label || c.name || '')}</span></div>`;
    });
  } else if (typeof dr === 'object') {
    Object.entries(dr).forEach(([key, val]) => {
      if (key === 'ready' || key === 'overall') return;
      const ok = val === true || val === 'ok' || val === 'healthy';
      const icon = ok ? '<span style="color:var(--ok);">&#x2713;</span>' : '<span style="color:var(--danger);">&#x2717;</span>';
      html += `<div class="dr-check"><div class="dr-check-icon">${icon}</div><span>${esc(key.replace(/_/g, ' '))}: ${esc(String(val))}</span></div>`;
    });
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Audit Log Viewer ────────────────────────────────────────────────────────

async function sysLoadAuditLog() {
  const el = $('sysAuditBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading audit events...</div>';

  const category = $('sysAuditCategory')?.value || '';
  const severity = $('sysAuditSeverity')?.value || '';
  const since = $('sysAuditSince')?.value || '';

  let qs = `?limit=${_sysAuditLimit}&offset=${_sysAuditOffset}`;
  if (category) qs += '&category=' + encodeURIComponent(category);
  if (severity) qs += '&severity=' + encodeURIComponent(severity);
  if (since) qs += '&since=' + encodeURIComponent(since);

  const res = await apiFetch('/api/operations/audit' + qs).catch(() => null);
  if (!res || res.error) {
    el.innerHTML = '<div class="hint">No audit events found.</div>';
    return;
  }

  const events = res.events || res.rows || [];
  const total = res.total || events.length;

  if (!events.length) {
    el.innerHTML = '<div class="hint">No matching audit events.</div>';
    _sysRenderAuditPager(total);
    return;
  }

  el.innerHTML = '<div class="audit-log-list">' + events.map(e => {
    const icon = _sysAuditIcon(e.category || e.event_type || '');
    const time = e.created_at ? new Date(e.created_at).toLocaleString() : '';
    const caseLabel = e.case_id ? ` · Case ${esc(e.case_id.slice(0, 8))}` : '';
    return (
      `<div class="audit-event">` +
        `<div class="audit-event-icon">${icon}</div>` +
        `<div class="audit-event-body">` +
          `<div class="audit-event-summary">${esc(e.summary || '')}</div>` +
          `<div class="audit-event-meta">${esc(time)}${caseLabel}</div>` +
        `</div>` +
        `<span class="audit-event-type">${esc(e.event_type || '')}</span>` +
      `</div>`
    );
  }).join('') + '</div>';

  _sysRenderAuditPager(total);
}

function _sysRenderAuditPager(total) {
  const pager = $('sysAuditPager');
  if (!pager) return;
  const hasPrev = _sysAuditOffset > 0;
  const hasNext = _sysAuditOffset + _sysAuditLimit < total;
  pager.innerHTML =
    (hasPrev ? `<button class="sm sec" onclick="sysAuditPage(-1)">&#x25C0; Prev</button>` : '') +
    `<span style="font-size:10px;color:var(--muted);padding:4px;">Showing ${_sysAuditOffset + 1}–${Math.min(_sysAuditOffset + _sysAuditLimit, total)} of ${total}</span>` +
    (hasNext ? `<button class="sm sec" onclick="sysAuditPage(1)">Next &#x25B6;</button>` : '');
}

function sysAuditPage(dir) {
  _sysAuditOffset = Math.max(0, _sysAuditOffset + dir * _sysAuditLimit);
  sysLoadAuditLog();
}

function _sysAuditIcon(category) {
  const icons = {
    case: '&#x1F4C1;', document: '&#x1F4C4;', generation: '&#x2699;', memory: '&#x1F9E0;',
    qc: '&#x2705;', insertion: '&#x1F4E5;', system: '&#x1F5A5;', security: '&#x1F512;'
  };
  return icons[category] || '&#x25CF;';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7: Inspection Capture — Photo Upload, Checklists, Measurements, Conditions
// ═══════════════════════════════════════════════════════════════════════════════

let _inspActiveId = null;

function inspOnTabOpen() {
  inspLoadList();
  inspLoadChecklist();
}

// ── Inspection List ─────────────────────────────────────────────────────────

async function inspLoadList() {
  const el = $('inspListBody');
  if (!el) return;
  if (!activeCaseId) { el.innerHTML = '<div class="hint">Select a case first.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No inspections.</div>'; return; }
  const items = res.inspections || res.rows || [];
  if (!items.length) { el.innerHTML = '<div class="hint">No inspections yet.</div>'; return; }

  el.innerHTML = items.map(i => {
    const active = i.id === _inspActiveId ? ' active' : '';
    const st = i.status || 'scheduled';
    const date = i.scheduled_date ? new Date(i.scheduled_date).toLocaleDateString() : '—';
    return `<div class="insp-item${active}" onclick="inspSelect('${esc(i.id)}')">` +
      `<span class="insp-item-status ${st}">${esc(st)}</span>` +
      `<span style="flex:1;font-weight:700;">${esc(i.inspection_type || 'General')}</span>` +
      `<span style="font-size:10px;color:var(--muted);">${esc(date)}</span>` +
    `</div>`;
  }).join('');
}

async function inspCreate() {
  if (!activeCaseId) { setStatus('inspListStatus', 'Select a case first.', 'err'); return; }
  const type = prompt('Inspection type (interior, exterior, full, drive_by):', 'full');
  if (!type) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections`, {
    method: 'POST', body: { inspection_type: type, scheduled_date: new Date().toISOString().split('T')[0] }
  }).catch(() => null);
  if (res && !res.error) {
    _inspActiveId = res.id;
    inspLoadList();
    setStatus('inspListStatus', 'Inspection created.', 'ok');
  } else {
    setStatus('inspListStatus', res?.error || 'Failed to create inspection.', 'err');
  }
}

async function inspSelect(id) {
  _inspActiveId = id;
  inspLoadList();
  inspLoadPhotos();
  inspLoadConditions();
  inspLoadMeasurements();
}

// ── Checklist Templates ─────────────────────────────────────────────────────

const INSP_CHECKLISTS = {
  interior: {
    'Living Areas': ['Living Room', 'Family Room', 'Dining Room', 'Den/Study', 'Bonus Room'],
    'Kitchen': ['Countertops', 'Cabinets', 'Appliances', 'Flooring', 'Backsplash', 'Pantry'],
    'Bedrooms': ['Primary Bedroom', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4', 'Closets'],
    'Bathrooms': ['Primary Bath', 'Full Bath', 'Half Bath', 'Fixtures', 'Tile/Surround'],
    'Other': ['Laundry Room', 'Basement', 'Attic Access', 'Stairs/Hallways', 'Storage']
  },
  exterior: {
    'Structure': ['Foundation', 'Framing Visible', 'Roof Covering', 'Gutters/Downspouts', 'Fascia/Soffit'],
    'Siding/Facade': ['Primary Material', 'Secondary Material', 'Paint/Stain Condition', 'Trim'],
    'Openings': ['Windows', 'Exterior Doors', 'Garage Door', 'Storm Windows/Doors'],
    'Outdoor': ['Porch/Patio', 'Deck', 'Fencing', 'Landscaping', 'Driveway', 'Walkways']
  },
  site: {
    'Lot': ['Shape/Topography', 'Drainage', 'View', 'Street Scene', 'Setbacks'],
    'Improvements': ['Garage/Carport', 'Shed/Outbuilding', 'Pool/Spa', 'Retaining Walls'],
    'Utilities': ['Public Water', 'Public Sewer', 'Electric Service', 'Gas Service', 'Well/Septic']
  },
  mechanical: {
    'HVAC': ['Heating Type', 'Cooling Type', 'Age/Condition', 'Ductwork Visible', 'Thermostat'],
    'Electrical': ['Panel Amperage', 'Panel Condition', 'Wiring Type', 'GFCI Present'],
    'Plumbing': ['Supply Piping', 'Drain Piping', 'Water Heater', 'Sump Pump']
  }
};

function inspLoadChecklist() {
  const el = $('inspChecklistBody');
  if (!el) return;
  const type = $('inspChecklistType')?.value || 'interior';
  const checklist = INSP_CHECKLISTS[type] || {};
  let html = '';
  Object.entries(checklist).forEach(([group, items]) => {
    html += `<div class="checklist-group"><div class="checklist-group-head">${esc(group)}</div>`;
    items.forEach(item => {
      const id = `ck_${type}_${item.replace(/\W/g,'_')}`;
      html += `<div class="checklist-item"><input type="checkbox" id="${id}"/><label for="${id}">${esc(item)}</label></div>`;
    });
    html += '</div>';
  });
  el.innerHTML = html;
}

// ── Photo Capture ───────────────────────────────────────────────────────────

async function inspLoadPhotos() {
  const el = $('inspPhotoGrid');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading photos...</div>';
  const endpoint = _inspActiveId
    ? `/api/cases/${activeCaseId}/inspections/${_inspActiveId}/photos`
    : `/api/cases/${activeCaseId}/photos`;
  const res = await apiFetch(endpoint).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No photos.</div>'; return; }
  const photos = res.photos || res.rows || [];
  if (!photos.length) { el.innerHTML = '<div class="hint">No photos yet. Upload files or paste Dropbox/URL links.</div>'; return; }

  el.innerHTML = photos.map(p => {
    const isUrl = p.file_path && (p.file_path.startsWith('http') || p.file_path.startsWith('dropbox'));
    const imgSrc = isUrl ? p.file_path : (p.file_path ? `/cases/${activeCaseId}/photos/${p.file_name || p.id}` : '');
    const imgContent = imgSrc
      ? `<img src="${esc(imgSrc)}" alt="${esc(p.label || '')}" onerror="this.parentElement.innerHTML='&#x1F4F7;'"/>`
      : '&#x1F4F7;';
    const tags = [p.photo_category, p.label].filter(Boolean);
    return `<div class="photo-card">` +
      `<div class="photo-card-img">${imgContent}</div>` +
      `<div class="photo-card-info">` +
        `<div class="photo-card-label">${esc(p.label || p.photo_category || 'Photo')}</div>` +
        `<div class="photo-card-meta">${esc(p.file_name || (isUrl ? 'URL link' : '—'))}</div>` +
        tags.map(t => `<span class="photo-card-tag">${esc(t)}</span>`).join('') +
      `</div>` +
    `</div>`;
  }).join('');
}

function inspAddPhotoFile() {
  const input = $('inspPhotoFileInput');
  if (input) input.click();
}

async function inspHandleFileUpload(input) {
  if (!activeCaseId || !_inspActiveId) { setStatus('inspPhotoStatus', 'Select an inspection first.', 'err'); return; }
  const files = Array.from(input.files || []);
  if (!files.length) return;

  let added = 0;
  for (const file of files) {
    const category = prompt(`Category for "${file.name}" (front, rear, street, interior, kitchen, bathroom, bedroom, garage, other):`, 'interior');
    if (!category) continue;
    const label = prompt(`Label for "${file.name}" (e.g., "Front Elevation", "Kitchen Overview"):`, file.name.replace(/\.[^.]+$/, ''));
    const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/photos`, {
      method: 'POST',
      body: {
        photo_category: category,
        label: label || file.name,
        file_name: file.name,
        file_path: file.name,
        mime_type: file.type,
        file_size: file.size
      }
    }).catch(() => null);
    if (res && !res.error) added++;
  }
  input.value = '';
  setStatus('inspPhotoStatus', `${added} photo(s) added.`, 'ok');
  inspLoadPhotos();
}

async function inspAddPhotoUrl() {
  if (!activeCaseId || !_inspActiveId) { setStatus('inspPhotoStatus', 'Select an inspection first.', 'err'); return; }
  const url = prompt('Paste photo URL (Dropbox shared link, Google Drive, or direct image URL):');
  if (!url) return;
  const category = prompt('Photo category (front, rear, street, interior, kitchen, bathroom, other):', 'exterior');
  if (!category) return;
  const label = prompt('Photo label:', '');

  // Normalize Dropbox URL for direct access
  let filePath = url;
  if (url.includes('dropbox.com') && url.includes('dl=0')) {
    filePath = url.replace('dl=0', 'dl=1');
  }

  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/photos`, {
    method: 'POST',
    body: {
      photo_category: category,
      label: label || 'Linked photo',
      file_path: filePath,
      file_name: url.split('/').pop()?.split('?')[0] || 'photo',
      mime_type: 'image/jpeg',
      notes: 'Source: ' + (url.includes('dropbox') ? 'Dropbox' : 'URL')
    }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('inspPhotoStatus', 'Photo link added.', 'ok');
    inspLoadPhotos();
  } else {
    setStatus('inspPhotoStatus', res?.error || 'Failed to add photo.', 'err');
  }
}

// ── Condition Findings ──────────────────────────────────────────────────────

async function inspLoadConditions() {
  const el = $('inspCondBody');
  if (!el || !activeCaseId || !_inspActiveId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/conditions`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No conditions logged.</div>'; return; }
  const items = res.conditions || res.rows || [];
  if (!items.length) { el.innerHTML = '<div class="hint">No findings yet. Add observations as you inspect.</div>'; return; }

  el.innerHTML = items.map(c => {
    const sev = (c.severity || c.condition_rating || 'fair').toLowerCase();
    const sevCls = sev === 'good' || sev === 'c1' ? 'good' : sev === 'poor' || sev === 'c5' || sev === 'c6' ? 'poor' : 'fair';
    return `<div class="cond-item">` +
      `<span class="cond-sev ${sevCls}">${esc(c.condition_rating || sev)}</span>` +
      `<div style="flex:1;"><strong>${esc(c.component || c.category || '')}</strong>` +
        `<div style="font-size:10px;color:var(--muted);">${esc(c.observation || c.notes || '')}</div>` +
      `</div>` +
    `</div>`;
  }).join('');
}

async function inspAddCondition() {
  if (!activeCaseId || !_inspActiveId) { setStatus('inspCondStatus', 'Select an inspection first.', 'err'); return; }
  const component = prompt('Component (e.g., Kitchen, Roof, Foundation, HVAC):');
  if (!component) return;
  const category = prompt('Category (interior, exterior, mechanical, structural):', 'interior');
  const rating = prompt('Condition rating (C1=new, C2=minor, C3=maintained, C4=needed repairs, C5=obvious deficiencies, C6=major issues):', 'C3');
  const observation = prompt('Observation notes:');

  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/conditions`, {
    method: 'POST',
    body: { component, category, condition_rating: rating, observation, severity: rating }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('inspCondStatus', 'Condition finding added.', 'ok');
    inspLoadConditions();
  } else {
    setStatus('inspCondStatus', res?.error || 'Failed.', 'err');
  }
}

// ── Measurements ────────────────────────────────────────────────────────────

async function inspLoadMeasurements() {
  const el = $('inspMeasBody');
  if (!el || !activeCaseId || !_inspActiveId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/measurements`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No measurements.</div>'; return; }
  const items = res.measurements || res.rows || [];
  if (!items.length) { el.innerHTML = '<div class="hint">Add room measurements.</div>'; return; }

  el.innerHTML = items.map(m => {
    const area = (m.length_ft && m.width_ft) ? (m.length_ft * m.width_ft).toFixed(0) : '—';
    return `<div class="meas-row">` +
      `<span class="meas-row-label">${esc(m.room_name || m.label || '')}</span>` +
      `<span class="meas-row-dim">${m.length_ft || '—'} × ${m.width_ft || '—'}</span>` +
      `<span class="meas-row-area">${area} sf</span>` +
      `<span style="color:var(--muted);font-size:9px;">${esc(m.level || '')}</span>` +
    `</div>`;
  }).join('');
}

async function inspAddMeasurement() {
  if (!activeCaseId || !_inspActiveId) { setStatus('inspMeasStatus', 'Select an inspection first.', 'err'); return; }
  const room = prompt('Room name (e.g., Living Room, Kitchen, Primary Bedroom):');
  if (!room) return;
  const length = parseFloat(prompt('Length (feet):', '12'));
  const width = parseFloat(prompt('Width (feet):', '10'));
  const level = prompt('Level (main, upper, lower, basement):', 'main');

  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/measurements`, {
    method: 'POST',
    body: { room_name: room, label: room, length_ft: length, width_ft: width, level, measurement_type: 'room' }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('inspMeasStatus', 'Measurement added.', 'ok');
    inspLoadMeasurements();
  } else {
    setStatus('inspMeasStatus', res?.error || 'Failed.', 'err');
  }
}

async function inspCalcGLA() {
  if (!activeCaseId || !_inspActiveId) return;
  const el = $('inspGLAResult');
  if (!el) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/measurements/gla`).catch(() => null);
  if (res && !res.error) {
    const gla = res.gla || res.totalGLA || res.total || 0;
    el.innerHTML = `<div style="font-size:14px;font-weight:900;font-family:var(--mono);color:var(--gold);">GLA: ${Number(gla).toLocaleString()} SF</div>`;
  } else {
    el.innerHTML = '<div class="hint">Could not calculate GLA.</div>';
  }
}

// ── Inspection Summary & Push to Context ────────────────────────────────────

async function inspBuildSummary() {
  const el = $('inspSummaryBody');
  if (!el || !activeCaseId || !_inspActiveId) { setStatus('inspSummaryStatus', 'Select an inspection first.', 'err'); return; }
  el.innerHTML = '<div class="hint">Building summary...</div>';
  const res = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/summary`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">Could not build summary.</div>'; return; }

  const s = res.summary || res;
  let html = '<div style="font-size:11px;">';
  html += `<div><strong>Type:</strong> ${esc(s.inspection_type || '—')}</div>`;
  html += `<div><strong>Status:</strong> ${esc(s.status || '—')}</div>`;
  if (s.photos_count != null) html += `<div><strong>Photos:</strong> ${s.photos_count}</div>`;
  if (s.measurements_count != null) html += `<div><strong>Measurements:</strong> ${s.measurements_count}</div>`;
  if (s.conditions_count != null) html += `<div><strong>Conditions:</strong> ${s.conditions_count}</div>`;
  if (s.gla) html += `<div><strong>GLA:</strong> ${Number(s.gla).toLocaleString()} SF</div>`;

  // Show conditions summary if available
  if (s.conditions_summary) {
    html += '<div style="margin-top:6px;"><strong>Condition Summary:</strong></div>';
    if (typeof s.conditions_summary === 'string') {
      html += `<div style="padding:6px;background:var(--surface);border-radius:6px;font-size:10px;margin-top:4px;white-space:pre-wrap;">${esc(s.conditions_summary)}</div>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;

  // Show push button
  const btn = $('inspPushBtn');
  if (btn) btn.style.display = '';
}

async function inspPushToContext() {
  if (!activeCaseId || !_inspActiveId) return;
  setStatus('inspSummaryStatus', 'Pushing to prompt context...', '');
  const summaryRes = await apiFetch(`/api/cases/${activeCaseId}/inspections/${_inspActiveId}/summary`).catch(() => null);
  if (!summaryRes || summaryRes.error) { setStatus('inspSummaryStatus', 'Failed to get summary.', 'err'); return; }

  // Store as a fact/context item for the case
  const contextPayload = {
    category: 'inspection',
    field_name: 'inspection_summary',
    value: JSON.stringify(summaryRes.summary || summaryRes),
    source: 'inspection_capture',
    confidence: 1.0
  };
  const res = await apiFetch(`/api/cases/${activeCaseId}/facts`, { method: 'POST', body: contextPayload }).catch(() => null);
  if (res && !res.error) {
    setStatus('inspSummaryStatus', 'Inspection summary pushed to case facts for generation context.', 'ok');
  } else {
    setStatus('inspSummaryStatus', 'Could not push to facts: ' + (res?.error || 'unknown'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7: Insertion Reliability Panel — Readback Verification & Replay
// ═══════════════════════════════════════════════════════════════════════════════

async function insLoadReliability() {
  const el = $('insReliabilityBody');
  if (!el || !activeCaseId) { if (el) el.innerHTML = '<div class="hint">Select a case first.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/insertion/runs?caseId=${activeCaseId}&limit=1`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No insertion runs.</div>'; return; }
  const runs = res.runs || res.rows || [];
  if (!runs.length) { el.innerHTML = '<div class="hint">No insertion runs for this case.</div>'; return; }

  const run = runs[0];
  const itemsRes = await apiFetch(`/api/insertion/runs/${run.id}/items`).catch(() => null);
  const items = (itemsRes && !itemsRes.error) ? (itemsRes.items || itemsRes.rows || []) : [];

  const verified = items.filter(i => i.status === 'verified' || i.readback_match === true).length;
  const failed = items.filter(i => i.status === 'failed' || i.readback_match === false).length;
  const pending = items.filter(i => !i.status || i.status === 'pending' || i.status === 'clipboard').length;

  let html = `<div style="font-size:11px;margin-bottom:6px;">`;
  html += `<div>Run: <strong>${esc(run.id?.slice(0, 12) || '')}</strong> · ${esc(run.status || '—')}</div>`;
  html += `<div style="margin-top:4px;">`;
  html += `<span style="color:var(--ok);font-weight:700;">${verified} verified</span> · `;
  html += `<span style="color:var(--danger);font-weight:700;">${failed} failed</span> · `;
  html += `<span style="color:var(--muted);">${pending} pending</span>`;
  html += `</div></div>`;

  // Show individual field items (limit to 15)
  const shown = items.slice(0, 15);
  html += shown.map(item => {
    const st = item.status || (item.readback_match === true ? 'verified' : item.readback_match === false ? 'failed' : 'pending');
    const stCls = st === 'verified' ? 'verified' : st === 'failed' ? 'failed' : st === 'clipboard' ? 'clipboard' : 'pending';
    return `<div class="ins-field-item">` +
      `<span class="ins-field-status ${stCls}">${esc(st)}</span>` +
      `<span style="flex:1;font-weight:600;">${esc(item.field_id || item.fieldId || '')}</span>` +
      (st === 'failed' ? `<button class="ghost sm" onclick="insRetryField('${esc(run.id)}','${esc(item.id || item.field_id)}')">Retry</button>` : '') +
    `</div>`;
  }).join('');

  if (items.length > 15) html += `<div class="hint" style="margin-top:4px;">+ ${items.length - 15} more fields...</div>`;
  el.innerHTML = html;
}

async function insShowRunHistory() {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/insertion/runs?caseId=${activeCaseId}&limit=10`).catch(() => null);
  if (!res || res.error) { setStatus('insReliabilityStatus', 'No runs found.', 'err'); return; }
  const runs = res.runs || res.rows || [];
  const el = $('insReliabilityBody');
  if (!el) return;

  el.innerHTML = '<div style="font-size:10px;font-weight:700;margin-bottom:6px;text-transform:uppercase;color:var(--muted);">Run History</div>' +
    runs.map(r => {
      const date = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
      const dest = r.destination || r.target_software || '—';
      return `<div class="ins-run-item">` +
        `<span style="font-weight:700;">${esc(dest)}</span>` +
        `<span style="flex:1;color:var(--muted);font-size:10px;">${esc(date)}</span>` +
        `<span class="ins-field-status ${r.status === 'completed' ? 'verified' : r.status === 'failed' ? 'failed' : 'pending'}">${esc(r.status || '—')}</span>` +
      `</div>`;
    }).join('');
}

async function insReplayFailed() {
  if (!activeCaseId) return;
  setStatus('insReliabilityStatus', 'Replaying failed fields...', '');
  const runsRes = await apiFetch(`/api/insertion/runs?caseId=${activeCaseId}&limit=1`).catch(() => null);
  const runs = (runsRes && !runsRes.error) ? (runsRes.runs || runsRes.rows || []) : [];
  if (!runs.length) { setStatus('insReliabilityStatus', 'No runs to replay.', 'err'); return; }

  const res = await apiFetch(`/api/insertion/runs/${runs[0].id}/replay`, { method: 'POST', body: { failedOnly: true } }).catch(() => null);
  if (res && !res.error) {
    setStatus('insReliabilityStatus', 'Replay completed. ' + (res.replayed || 0) + ' fields retried.', 'ok');
    insLoadReliability();
  } else {
    setStatus('insReliabilityStatus', 'Replay failed: ' + (res?.error || 'unknown'), 'err');
  }
}

async function insRetryField(runId, fieldId) {
  const res = await apiFetch(`/api/insertion/runs/${runId}/items/${fieldId}/retry`, { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    setStatus('insReliabilityStatus', 'Field retried.', 'ok');
    insLoadReliability();
  } else {
    setStatus('insReliabilityStatus', 'Retry failed.', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7: Pipeline Enhancements — Fact Cards, Verification Queue, Dedup
// ═══════════════════════════════════════════════════════════════════════════════

function dpOnTabOpen() {
  loadDueDateQueue();
  loadPipelineSummary();
  dpLoadVerificationQueue();
}

// ── Extracted Fact Cards rendering (enhances existing dpRenderExtractedData) ─

function dpRenderFactCards(data, source) {
  const el = $('dpExtractedPreview');
  if (!el) return;
  if (!data || typeof data !== 'object') {
    el.innerHTML = '<div class="hint">No structured data extracted.</div>';
    return;
  }

  const entries = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({ field: k, value: v }));
  if (!entries.length) { el.innerHTML = '<div class="hint">No fields extracted.</div>'; return; }

  el.innerHTML = entries.map(item => {
    const field = item.field || item.field_name || item.key || '—';
    const value = item.value ?? '—';
    const prov = item.source || item.provenance || source || 'web crawl';
    const conflict = item.conflict || item.conflictWith || null;
    return `<div class="fact-card">` +
      `<div class="fact-card-head">` +
        `<span class="fact-card-field">${esc(String(field))}</span>` +
        `<span class="fact-card-value">${esc(String(value))}</span>` +
      `</div>` +
      `<div class="fact-card-prov">Source: ${esc(prov)}</div>` +
      (conflict ? `<div class="fact-card-conflict">Conflicts with: ${esc(conflict)}</div>` : '') +
    `</div>`;
  }).join('');
}

// ── Duplicate Detection ─────────────────────────────────────────────────────

async function dpCheckDuplicates() {
  const el = $('dpDupeResults');
  if (!el) return;
  el.innerHTML = '<div class="hint">Checking for duplicate data...</div>';

  // Check extracted data against case facts
  if (!activeCaseId) { el.innerHTML = '<div class="hint">Select a case to check duplicates.</div>'; return; }
  const factsRes = await apiFetch(`/api/cases/${activeCaseId}/facts`).catch(() => null);
  const facts = (factsRes && !factsRes.error) ? (factsRes.facts || factsRes.rows || []) : [];

  // Count field-name duplicates
  const fieldCounts = {};
  facts.forEach(f => {
    const key = f.field_name || f.key || '';
    fieldCounts[key] = (fieldCounts[key] || 0) + 1;
  });
  const dupes = Object.entries(fieldCounts).filter(([, c]) => c > 1);

  if (!dupes.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--ok);font-weight:700;">No duplicates detected.</div>';
  } else {
    el.innerHTML = '<div style="font-size:10px;font-weight:700;color:var(--warn);margin-bottom:4px;">Potential Duplicates:</div>' +
      dupes.map(([field, count]) =>
        `<div style="font-size:11px;padding:2px 0;"><strong>${esc(field)}</strong> — ${count} entries</div>`
      ).join('');
  }
}

// ── Verification Queue ──────────────────────────────────────────────────────

let _dpVerifItems = [];

async function dpLoadVerificationQueue() {
  const el = $('dpVerifQueue');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/cases/${activeCaseId}/facts?source=web_crawl&limit=100`).catch(() =>
    apiFetch(`/api/cases/${activeCaseId}/facts?limit=100`).catch(() => null)
  );
  if (!res || res.error) { el.innerHTML = '<div class="hint">No facts from web sources.</div>'; return; }
  const items = (res.facts || res.rows || []).filter(f =>
    !f.verified && (f.source === 'web_crawl' || f.source === 'crawl' || f.source === 'pipeline' || f.source === 'extracted')
  );
  _dpVerifItems = items;

  if (!items.length) { el.innerHTML = '<div class="hint">All extracted data verified or no web-sourced facts.</div>'; return; }

  el.innerHTML = items.slice(0, 20).map(f => {
    const field = f.field_name || f.key || '—';
    const value = f.value ?? '—';
    return `<div class="fact-card">` +
      `<div class="fact-card-head">` +
        `<span class="fact-card-field">${esc(String(field))}</span>` +
        `<span class="fact-card-value">${esc(String(value).slice(0, 60))}</span>` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-top:4px;">` +
        `<button class="ghost sm" onclick="dpVerifySingle('${esc(f.id)}')">Verify</button>` +
        `<button class="ghost sm" onclick="dpRejectSingle('${esc(f.id)}')">Reject</button>` +
      `</div>` +
    `</div>`;
  }).join('') + (items.length > 20 ? `<div class="hint">+ ${items.length - 20} more...</div>` : '');
}

async function dpVerifySingle(factId) {
  const res = await apiFetch(`/api/cases/${activeCaseId}/facts/${factId}`, { method: 'PATCH', body: { verified: true } }).catch(() => null);
  if (res && !res.error) dpLoadVerificationQueue();
}

async function dpRejectSingle(factId) {
  const res = await apiFetch(`/api/cases/${activeCaseId}/facts/${factId}`, { method: 'DELETE' }).catch(() => null);
  if (res && !res.error) dpLoadVerificationQueue();
}

async function dpVerifyAll() {
  if (!_dpVerifItems.length) return;
  if (!confirm(`Mark ${_dpVerifItems.length} items as verified?`)) return;
  let ok = 0;
  for (const f of _dpVerifItems) {
    const res = await apiFetch(`/api/cases/${activeCaseId}/facts/${f.id}`, { method: 'PATCH', body: { verified: true } }).catch(() => null);
    if (res && !res.error) ok++;
  }
  setStatus('dpVerifStatus', `${ok} items verified.`, 'ok');
  dpLoadVerificationQueue();
}

async function dpRejectUnverified() {
  if (!_dpVerifItems.length) return;
  if (!confirm(`Reject ${_dpVerifItems.length} unverified items?`)) return;
  let ok = 0;
  for (const f of _dpVerifItems) {
    const res = await apiFetch(`/api/cases/${activeCaseId}/facts/${f.id}`, { method: 'DELETE' }).catch(() => null);
    if (res && !res.error) ok++;
  }
  setStatus('dpVerifStatus', `${ok} items rejected.`, 'ok');
  dpLoadVerificationQueue();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 8: Golden-Path Validation — In-Browser E2E Test Runner
// ═══════════════════════════════════════════════════════════════════════════════

const GP_STEPS = [
  { id: 'case_create',      label: 'Create case from assignment',         dod: '#1' },
  { id: 'facts_load',       label: 'Load facts with provenance',          dod: '#3' },
  { id: 'facts_verify',     label: 'Verify all facts have source/confidence', dod: '#3' },
  { id: 'workspace_check',  label: 'Workspace matches form type',         dod: '#4' },
  { id: 'pre_draft_gate',   label: 'Pre-draft gate enforced',             dod: '#3' },
  { id: 'generation_run',   label: 'Generate all priority sections',      dod: '#5' },
  { id: 'sections_exist',   label: 'All expected sections created',       dod: '#5' },
  { id: 'qc_run',           label: 'QC run executes without crash',       dod: '#7' },
  { id: 'qc_findings',      label: 'QC findings have severity levels',    dod: '#7' },
  { id: 'insertion_prepare', label: 'Insertion run prepares successfully', dod: '#8' },
  { id: 'insertion_items',   label: 'Insertion maps fields correctly',     dod: '#8' },
  { id: 'audit_events',     label: 'Audit trail records lifecycle events', dod: '#10' },
  { id: 'case_archive',     label: 'Case can be archived and restored',   dod: '#9' },
  { id: 'backup_create',    label: 'Backup creates and verifies',         dod: '#10' },
];

// Fixture data (inline for browser execution)
const GP_FIXTURES = {
  '1004': {
    formType: '1004',
    caseCreate: {
      property_address: '9999 Golden Path Test Lane',
      property_city: 'Normal', property_state: 'IL', property_zip: '61761',
      property_county: 'McLean', borrower_name: 'GP Test Borrower',
      lender_client: 'GP Test Bank', form_type: '1004',
      assignment_type: 'Purchase', property_type: 'Single Family', status: 'active',
    },
    facts: [
      { field_name: 'property_address', value: '9999 Golden Path Test Lane', category: 'subject', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'sale_price', value: '285000', category: 'contract', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'year_built', value: '2004', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'gla', value: '1850', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'bedrooms', value: '4', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'bathrooms', value: '2.5', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'lot_size', value: '10200 sf', category: 'site', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'zoning', value: 'R-1', category: 'site', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'neighborhood_name', value: 'Oak Park', category: 'neighborhood', source: 'test_fixture', confidence: 0.9 },
      { field_name: 'condition', value: 'C3', category: 'improvements', source: 'test_fixture', confidence: 0.9 },
    ],
  },
  'commercial': {
    formType: 'commercial',
    caseCreate: {
      property_address: '8888 Commerce Test Drive',
      property_city: 'Bloomington', property_state: 'IL', property_zip: '61704',
      property_county: 'McLean', borrower_name: 'GP Commercial LLC',
      lender_client: 'GP Business Bank', form_type: 'commercial',
      assignment_type: 'Refinance', property_type: 'Office', status: 'active',
    },
    facts: [
      { field_name: 'property_address', value: '8888 Commerce Test Drive', category: 'subject', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'year_built', value: '2008', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'gba', value: '15000', category: 'improvements', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'noi', value: '175000', category: 'income', source: 'test_fixture', confidence: 0.9 },
      { field_name: 'cap_rate_market', value: '7.5%', category: 'income', source: 'test_fixture', confidence: 0.8 },
      { field_name: 'lot_size', value: '52272 sf', category: 'site', source: 'test_fixture', confidence: 0.95 },
      { field_name: 'zoning', value: 'B-2', category: 'site', source: 'test_fixture', confidence: 1.0 },
      { field_name: 'occupancy_rate', value: '92%', category: 'income', source: 'test_fixture', confidence: 0.95 },
    ],
  },
};

let _gpResults = [];

function gpRenderTestPlan() {
  const el = $('gpStepList');
  if (!el) return;
  el.innerHTML = GP_STEPS.map(s =>
    `<div class="gp-step" id="gp_${s.id}">` +
      `<span class="gp-step-icon" id="gp_icon_${s.id}">&#x25CB;</span>` +
      `<span style="flex:1;">${esc(s.label)}</span>` +
      `<span class="gp-step-dod">${esc(s.dod)}</span>` +
    `</div>`
  ).join('');
}

function _gpSetStep(stepId, status) {
  const icon = $(`gp_icon_${stepId}`);
  const row = $(`gp_${stepId}`);
  if (!icon || !row) return;
  const icons = { pass: '&#x2713;', fail: '&#x2717;', running: '&#x25CF;', pending: '&#x25CB;' };
  icon.innerHTML = icons[status] || icons.pending;
  icon.className = `gp-step-icon ${status}`;
  row.className = `gp-step ${status}`;
}

async function _gpRunFixture(fixture) {
  const results = [];
  let caseId = null;

  async function step(id, fn) {
    _gpSetStep(id, 'running');
    const t0 = performance.now();
    try {
      await fn();
      const ms = Math.round(performance.now() - t0);
      _gpSetStep(id, 'pass');
      results.push({ id, status: 'pass', ms });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      _gpSetStep(id, 'fail');
      results.push({ id, status: 'fail', ms, error: err.message });
    }
  }

  await step('case_create', async () => {
    const res = await apiFetch('/api/cases', { method: 'POST', body: fixture.caseCreate });
    if (res.error) throw new Error(res.error);
    caseId = res.id || res.caseId;
    if (!caseId) throw new Error('No case ID returned');
  });
  if (!caseId) return results;

  await step('facts_load', async () => {
    let ok = 0;
    for (const f of fixture.facts) {
      const r = await apiFetch(`/api/cases/${caseId}/facts`, { method: 'POST', body: f });
      if (r && !r.error) ok++;
    }
    if (ok < fixture.facts.length * 0.8) throw new Error(`Only ${ok}/${fixture.facts.length} facts loaded`);
  });

  await step('facts_verify', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/facts`);
    const facts = res.facts || res.rows || [];
    if (!facts.length) throw new Error('No facts found');
    const missing = facts.filter(f => !f.source && !f.provenance);
    if (missing.length) throw new Error(`${missing.length} facts missing source`);
  });

  await step('workspace_check', async () => {
    const res = await apiFetch(`/api/cases/${caseId}`);
    const ft = res.form_type || res.formType || (res.case && (res.case.form_type || res.case.formType));
    if (ft !== fixture.formType) throw new Error(`Expected ${fixture.formType}, got ${ft}`);
  });

  await step('pre_draft_gate', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/pre-draft-gate`);
    if (res == null) throw new Error('No gate response');
  });

  await step('generation_run', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/generate`, { method: 'POST', body: { formType: fixture.formType } });
    if (res.error && !res.runId && !res.id) throw new Error(res.error);
  });

  await step('sections_exist', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/sections`);
    const sections = res.sections || res.rows || [];
    if (!Array.isArray(sections)) throw new Error('Sections not an array');
  });

  await step('qc_run', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/qc/run`, { method: 'POST', body: {} });
    if (res.error && !res.runId && !res.id && res.findings == null) throw new Error(res.error || 'QC crashed');
  });

  await step('qc_findings', async () => {
    const res = await apiFetch(`/api/cases/${caseId}/qc/latest`);
    const findings = res.findings || res.rows || [];
    if (!Array.isArray(findings)) throw new Error('Findings not an array');
  });

  await step('insertion_prepare', async () => {
    const sw = fixture.formType === '1004' ? 'aci' : 'realquantum';
    const res = await apiFetch('/api/insertion/prepare', { method: 'POST', body: { caseId, formType: fixture.formType, targetSoftware: sw } });
    if (res == null) throw new Error('No response');
  });

  await step('insertion_items', async () => {
    const sw = fixture.formType === '1004' ? 'aci' : 'realquantum';
    const res = await apiFetch(`/api/insertion/preview/${caseId}?formType=${fixture.formType}&targetSoftware=${sw}`);
    if (res == null) throw new Error('No response');
  });

  await step('audit_events', async () => {
    const res = await apiFetch(`/api/operations/audit?caseId=${caseId}&limit=5`);
    const events = res.events || res.rows || [];
    if (!Array.isArray(events)) throw new Error('Audit events not an array');
  });

  await step('case_archive', async () => {
    const a = await apiFetch(`/api/operations/archive/${caseId}`, { method: 'POST', body: {} });
    if (a.error) throw new Error(a.error);
    const r = await apiFetch(`/api/operations/restore/${caseId}`, { method: 'POST', body: {} });
    if (r.error) throw new Error(r.error);
  });

  await step('backup_create', async () => {
    const c = await apiFetch('/api/security/backups/create', { method: 'POST', body: {} });
    if (c.error) throw new Error(c.error);
    const bid = c.id || c.backupId;
    if (bid) {
      const v = await apiFetch(`/api/security/backups/${bid}/verify`, { method: 'POST', body: {} });
      if (v.error) throw new Error(v.error);
    }
  });

  // Cleanup
  await apiFetch(`/api/cases/${caseId}`, { method: 'DELETE' }).catch(() => {});
  return results;
}

function _gpRenderResults(allResults) {
  const summaryEl = $('gpResultsSummary');
  const bodyEl = $('gpResultsBody');
  if (!summaryEl || !bodyEl) return;

  const passed = allResults.filter(r => r.status === 'pass').length;
  const failed = allResults.filter(r => r.status === 'fail').length;
  const totalMs = allResults.reduce((a, r) => a + (r.ms || 0), 0);

  summaryEl.innerHTML =
    `<div class="gp-summary">` +
      `<span class="gp-summary-pass">${passed} passed</span>` +
      `<span class="gp-summary-fail">${failed} failed</span>` +
      `<span class="gp-summary-time">${(totalMs / 1000).toFixed(1)}s total</span>` +
    `</div>`;

  bodyEl.innerHTML = allResults.map(r => {
    const cls = r.status === 'pass' ? 'pass' : 'fail';
    const icon = r.status === 'pass' ? '&#x2713;' : '&#x2717;';
    return `<div class="gp-step ${cls}">` +
      `<span class="gp-step-icon ${cls}">${icon}</span>` +
      `<span style="flex:1;">${esc(r.label || r.id)}</span>` +
      `<span style="font-size:10px;color:var(--muted);font-family:var(--mono);">${r.ms}ms</span>` +
      (r.error ? `<span style="font-size:9px;color:var(--danger);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.error)}">${esc(r.error.slice(0, 50))}</span>` : '') +
    `</div>`;
  }).join('');
}

async function gpRun1004() {
  gpRenderTestPlan();
  setStatus('gpStatus', 'Running 1004 golden path...', '');
  const t0 = performance.now();
  const results = await _gpRunFixture(GP_FIXTURES['1004']);
  results.forEach(r => { r.label = `[1004] ${GP_STEPS.find(s => s.id === r.id)?.label || r.id}`; });
  _gpResults = results;
  _gpRenderResults(results);
  const ms = Math.round(performance.now() - t0);
  const failed = results.filter(r => r.status === 'fail').length;
  setStatus('gpStatus', `1004 golden path: ${results.length - failed}/${results.length} passed (${(ms / 1000).toFixed(1)}s)`, failed ? 'err' : 'ok');
}

async function gpRunCommercial() {
  gpRenderTestPlan();
  setStatus('gpStatus', 'Running Commercial golden path...', '');
  const t0 = performance.now();
  const results = await _gpRunFixture(GP_FIXTURES['commercial']);
  results.forEach(r => { r.label = `[Commercial] ${GP_STEPS.find(s => s.id === r.id)?.label || r.id}`; });
  _gpResults = results;
  _gpRenderResults(results);
  const ms = Math.round(performance.now() - t0);
  const failed = results.filter(r => r.status === 'fail').length;
  setStatus('gpStatus', `Commercial golden path: ${results.length - failed}/${results.length} passed (${(ms / 1000).toFixed(1)}s)`, failed ? 'err' : 'ok');
}

async function gpRunBoth() {
  gpRenderTestPlan();
  setStatus('gpStatus', 'Running both golden paths...', '');
  const t0 = performance.now();

  const r1004 = await _gpRunFixture(GP_FIXTURES['1004']);
  r1004.forEach(r => { r.label = `[1004] ${GP_STEPS.find(s => s.id === r.id)?.label || r.id}`; });

  // Reset step icons for commercial run
  GP_STEPS.forEach(s => _gpSetStep(s.id, 'pending'));

  const rComm = await _gpRunFixture(GP_FIXTURES['commercial']);
  rComm.forEach(r => { r.label = `[Commercial] ${GP_STEPS.find(s => s.id === r.id)?.label || r.id}`; });

  const all = [...r1004, ...rComm];
  _gpResults = all;
  _gpRenderResults(all);

  const ms = Math.round(performance.now() - t0);
  const passed = all.filter(r => r.status === 'pass').length;
  const failed = all.filter(r => r.status === 'fail').length;
  setStatus('gpStatus', `Both golden paths: ${passed}/${all.length} passed, ${failed} failed (${(ms / 1000).toFixed(1)}s)`, failed ? 'err' : 'ok');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 9: Unified Valuation Desk — Comp Grid, Candidates, Adjustments,
//          Income/Cost Approaches, Reconciliation Memo Builder
// ═══════════════════════════════════════════════════════════════════════════════

let _valIntel = null;

function valOnTabOpen() {
  valLoadCandidates();
  valLoadGrid();
  valLoadReconciliation();
  valLoadIncome();
  valLoadCost();
}

// ── Comp Candidate Queue ────────────────────────────────────────────────────

async function valBuildIntel() {
  if (!activeCaseId) { setStatus('valCandidateStatus', 'Select a case first.', 'err'); return; }
  setStatus('valCandidateStatus', 'Building intelligence...', '');
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence`).catch(() => null);
  if (!res || res.error) { setStatus('valCandidateStatus', res?.error || 'Failed.', 'err'); return; }
  _valIntel = res;
  setStatus('valCandidateStatus', `${(res.candidates || []).length} candidates scored.`, 'ok');
  valRenderCandidates(res);
  valLoadGrid();
  valLoadBurden();
}

async function valLoadCandidates() {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence`).catch(() => null);
  if (!res || res.error) return;
  _valIntel = res;
  valRenderCandidates(res);
}

function valRenderCandidates(intel) {
  const el = $('valCandidateList');
  if (!el) return;
  const candidates = intel.candidates || [];
  if (!candidates.length) { el.innerHTML = '<div class="hint">No candidates. Add comps via Pipeline tab or build intelligence.</div>'; return; }

  // Sort by score descending
  const sorted = [...candidates].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  el.innerHTML = sorted.map(c => {
    const score = ((c.relevanceScore || 0) * 100).toFixed(0);
    const tier = c.tier || 4;
    const tierCls = `t${tier}`;
    const status = c.reviewStatus || 'pending';
    const addr = c.candidate?.address || c.sourceKey || '—';
    const price = c.candidate?.salePrice || c.candidate?.sale_price;
    const priceStr = price ? '$' + Number(price).toLocaleString() : '';
    return `<div class="val-cand">` +
      `<div class="val-cand-score ${tierCls}">${score}</div>` +
      `<div style="flex:1;">` +
        `<div style="font-weight:700;">${esc(addr)}</div>` +
        `<div style="font-size:10px;color:var(--muted);">${priceStr} · Tier ${tier} · ${esc(status)}</div>` +
        (c.keyMatches?.length ? `<div style="font-size:9px;color:var(--ok);">+ ${c.keyMatches.slice(0, 3).map(m => esc(m)).join(', ')}</div>` : '') +
        (c.keyMismatches?.length ? `<div style="font-size:9px;color:var(--danger);">- ${c.keyMismatches.slice(0, 3).map(m => esc(m)).join(', ')}</div>` : '') +
      `</div>` +
      `<span class="val-cand-tier">T${tier}</span>` +
      `<div class="val-cand-actions">` +
        (status !== 'accepted' ? `<button class="ghost sm" onclick="valAcceptCandidate('${esc(c.id)}')">Accept</button>` : '') +
        (status !== 'held' ? `<button class="ghost sm" onclick="valHoldCandidate('${esc(c.id)}')">Hold</button>` : '') +
        (status !== 'rejected' ? `<button class="ghost sm" onclick="valRejectCandidate('${esc(c.id)}')">Reject</button>` : '') +
      `</div>` +
    `</div>`;
  }).join('');
}

async function valAcceptCandidate(candidateId) {
  if (!activeCaseId) return;
  const slot = prompt('Grid slot (1-6):', '1');
  if (!slot) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence/candidates/${candidateId}/accept`, {
    method: 'POST', body: { gridSlot: parseInt(slot), acceptedBy: 'appraiser' }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('valCandidateStatus', 'Candidate accepted into grid.', 'ok');
    valLoadCandidates();
    valLoadGrid();
    valLoadBurden();
  } else {
    setStatus('valCandidateStatus', res?.error || 'Failed.', 'err');
  }
}

async function valHoldCandidate(candidateId) {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence/candidates/${candidateId}/hold`, {
    method: 'POST', body: {}
  }).catch(() => null);
  if (res && !res.error) { valLoadCandidates(); }
}

async function valRejectCandidate(candidateId) {
  if (!activeCaseId) return;
  const reason = prompt('Rejection reason (too_distant, inferior_data_quality, poor_condition_match, poor_market_area_match, atypical_sale, other):', 'other');
  if (!reason) return;
  const note = prompt('Note (optional):');
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence/candidates/${candidateId}/reject`, {
    method: 'POST', body: { reasonCode: reason, rejectedBy: 'appraiser', note: note || '' }
  }).catch(() => null);
  if (res && !res.error) { valLoadCandidates(); }
}

// ── Comp Grid ───────────────────────────────────────────────────────────────

async function valLoadGrid() {
  const el = $('valGridBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading grid...</div>';
  const res = await apiFetch(`/api/valuation/grid/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No grid data.</div>'; return; }

  const slots = res.slots || res.grid || [];
  if (!slots.length && !res.slot1) { el.innerHTML = '<div class="hint">No comps in grid. Accept candidates to populate.</div>'; return; }

  // Build grid as either array or keyed object
  const gridSlots = Array.isArray(slots) ? slots : [1,2,3,4,5,6].map(i => res[`slot${i}`] || res.slots?.[i-1]).filter(Boolean);
  if (!gridSlots.length) { el.innerHTML = '<div class="hint">No comps in grid yet.</div>'; return; }

  const features = ['Address', 'Sale Price', 'Sale Date', 'GLA', 'Bedrooms', 'Bathrooms', 'Year Built', 'Condition', 'Lot Size', 'Garage'];
  const featureKeys = ['address', 'salePrice', 'saleDate', 'gla', 'bedrooms', 'bathrooms', 'yearBuilt', 'condition', 'lotSize', 'garage'];

  let html = '<div style="overflow-x:auto;"><table class="val-grid-table"><thead><tr><th>Feature</th><th>Subject</th>';
  gridSlots.forEach((s, i) => { html += `<th>Comp ${s.grid_slot || s.gridSlot || i + 1}</th>`; });
  html += '</tr></thead><tbody>';

  features.forEach((feat, fi) => {
    const key = featureKeys[fi];
    html += `<tr><td class="val-grid-label">${esc(feat)}</td><td class="val-grid-value">—</td>`;
    gridSlots.forEach(s => {
      const data = s.candidateData || s.candidate_data || s.candidate || {};
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      let val = parsed[key] || parsed[key.replace(/([A-Z])/g, '_$1').toLowerCase()] || '—';
      if (key === 'salePrice' && val !== '—') val = '$' + Number(val).toLocaleString();
      html += `<td class="val-grid-value">${esc(String(val))}</td>`;
    });
    html += '</tr>';
  });

  // Indicated values row
  html += '<tr style="border-top:2px solid var(--gold);"><td class="val-grid-label" style="color:var(--gold);font-weight:900;">Indicated Value</td><td>—</td>';
  gridSlots.forEach(s => {
    const iv = s.indicated_value || s.indicatedValue || '—';
    html += `<td class="val-grid-value" style="color:var(--gold);">${iv !== '—' ? '$' + Number(iv).toLocaleString() : '—'}</td>`;
  });
  html += '</tr></tbody></table></div>';

  el.innerHTML = html;
}

async function valLoadGridSummary() {
  const el = $('valGridSummary');
  if (!el || !activeCaseId) return;
  const res = await apiFetch(`/api/valuation/grid/${activeCaseId}/summary`).catch(() => null);
  if (!res || res.error) { el.innerHTML = ''; return; }
  const range = res.range || {};
  el.innerHTML = `<div style="font-size:11px;">` +
    `<div>Range: <strong>$${Number(range.low || 0).toLocaleString()}</strong> – <strong>$${Number(range.high || 0).toLocaleString()}</strong></div>` +
    `<div>Average: <strong>$${Number(res.average || 0).toLocaleString()}</strong></div>` +
    `<div>Slots filled: <strong>${res.filledSlots || 0}/6</strong></div>` +
  `</div>`;
}

// ── Adjustment Support Notebook ─────────────────────────────────────────────

const ADJ_CATEGORIES = [
  'sale_financing_concessions', 'market_conditions_time', 'location', 'site_size',
  'view', 'design_style', 'quality', 'age', 'condition', 'bedrooms_bathrooms',
  'room_count', 'gla', 'basement_finished_below_grade', 'functional_utility',
  'hvac', 'energy_efficient_items', 'garage_carport', 'porch_patio_deck'
];

async function valLoadAdjustments() {
  const el = $('valAdjBody');
  if (!el || !activeCaseId) return;
  const slot = $('valAdjSlot')?.value || '1';
  el.innerHTML = '<div class="hint">Loading adjustments...</div>';

  const res = await apiFetch(`/api/valuation/grid/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No grid data.</div>'; return; }

  // Find slot adjustments
  const slots = res.slots || [];
  const slotData = Array.isArray(slots) ? slots.find(s => String(s.grid_slot || s.gridSlot) === slot) : null;
  const adjustments = slotData?.adjustments || [];

  // Build from categories, filling in existing data
  const adjMap = {};
  adjustments.forEach(a => { adjMap[a.adjustment_category || a.adjustmentCategory] = a; });

  el.innerHTML = ADJ_CATEGORIES.map(cat => {
    const adj = adjMap[cat] || {};
    const status = adj.decision_status || adj.decisionStatus || 'pending';
    const statusCls = status === 'approved' ? 'approved' : status === 'deferred' ? 'deferred' : 'pending';
    const subj = adj.subject_value ?? adj.subjectValue ?? '—';
    const comp = adj.comp_value ?? adj.compValue ?? '—';
    const suggested = adj.suggested_amount ?? adj.suggestedAmount ?? '—';
    const final = adj.final_amount ?? adj.finalAmount ?? '—';
    const label = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="val-adj-row">` +
      `<span class="val-adj-cat">${esc(label)}</span>` +
      `<div class="val-adj-vals">` +
        `<span title="Subject">${esc(String(subj))}</span>` +
        `<span title="Comp">${esc(String(comp))}</span>` +
        `<span title="Suggested" style="color:var(--muted);">${esc(String(suggested))}</span>` +
        `<span title="Final" style="color:var(--gold);">${esc(String(final))}</span>` +
      `</div>` +
      `<span class="val-adj-status ${statusCls}">${esc(status)}</span>` +
      `<button class="ghost sm" onclick="valEditAdj('${slot}','${cat}')" title="Edit adjustment">Edit</button>` +
    `</div>`;
  }).join('');
}

async function valEditAdj(slot, category) {
  if (!activeCaseId) return;
  const finalAmount = prompt(`Final adjustment amount for ${category.replace(/_/g, ' ')} (positive = comp inferior, negative = comp superior):`);
  if (finalAmount === null) return;
  const rationale = prompt('Rationale note:');
  const res = await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence/adjustment-support/${slot}/${category}`, {
    method: 'POST',
    body: { decisionStatus: 'approved', finalAmount: parseFloat(finalAmount) || 0, rationaleNote: rationale || '', supportType: 'appraiser_judgment' }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('valAdjStatus', 'Adjustment saved.', 'ok');
    valLoadAdjustments();
  } else {
    setStatus('valAdjStatus', res?.error || 'Failed.', 'err');
  }
}

// ── Burden & Contradiction Visibility ───────────────────────────────────────

async function valLoadBurden() {
  const el = $('valBurdenBody');
  const el2 = $('valBurdenBody2');
  const cEl = $('valContradictions');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const intel = _valIntel || await apiFetch(`/api/cases/${activeCaseId}/comparable-intelligence`).catch(() => null);
  if (!intel || intel.error) { el.innerHTML = '<div class="hint">Build intelligence first.</div>'; return; }

  // Burden from grid
  const gridRes = await apiFetch(`/api/valuation/grid/${activeCaseId}`).catch(() => null);
  const slots = gridRes?.slots || [];

  if (!slots.length) { el.innerHTML = '<div class="hint">No comps in grid.</div>'; return; }

  el.innerHTML = slots.map(s => {
    const slotNum = s.grid_slot || s.gridSlot || '?';
    const burden = s.burden || {};
    const net = burden.net_adjustment_percent || burden.netAdjustmentPercent || 0;
    const gross = burden.gross_adjustment_percent || burden.grossAdjustmentPercent || 0;
    const netCls = Math.abs(net) > 15 ? 'danger' : Math.abs(net) > 10 ? 'warn' : 'ok';
    const grossCls = gross > 25 ? 'danger' : gross > 20 ? 'warn' : 'ok';
    const conf = burden.data_confidence_score || burden.dataConfidenceScore || 0;
    const addr = s.candidateData?.address || s.candidate_data?.address || '—';
    return `<div style="margin-bottom:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:11px;">` +
      `<div style="font-weight:700;">Slot ${slotNum}: ${esc(typeof addr === 'string' ? addr : '—')}</div>` +
      `<div style="display:flex;gap:16px;margin-top:4px;">` +
        `<div style="flex:1;">Net: <strong>${net.toFixed(1)}%</strong><div class="val-burden-bar"><div class="val-burden-fill ${netCls}" style="width:${Math.min(Math.abs(net) * 3, 100)}%;"></div></div></div>` +
        `<div style="flex:1;">Gross: <strong>${gross.toFixed(1)}%</strong><div class="val-burden-bar"><div class="val-burden-fill ${grossCls}" style="width:${Math.min(gross * 2, 100)}%;"></div></div></div>` +
        `<div>Confidence: <strong>${(conf * 100).toFixed(0)}%</strong></div>` +
      `</div>` +
    `</div>`;
  }).join('');

  // Contradictions
  if (cEl) {
    const contradictions = intel.contradictions || [];
    if (!contradictions.length) {
      cEl.innerHTML = '<div style="font-size:11px;color:var(--ok);font-weight:700;">No contradictions detected.</div>';
    } else {
      cEl.innerHTML = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--danger);margin-bottom:4px;">Contradictions</div>' +
        contradictions.map(c =>
          `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03);">` +
            `<strong>${esc(c.field || c.category || '—')}</strong>: ${esc(c.message || c.description || '')}` +
          `</div>`
        ).join('');
    }
  }
  if (el2) el2.innerHTML = el.innerHTML;
}

// ── Income Approach ─────────────────────────────────────────────────────────

async function valLoadIncome() {
  const el = $('valIncomeBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/valuation/income/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No income data yet.</div>'; return; }

  const d = res.data || res;
  let html = '<div>';
  const rows = [
    ['Monthly Market Rent', d.monthly_market_rent || d.monthlyMarketRent],
    ['GRM', d.grm],
    ['Gross Income', d.gross_income || d.grossIncome],
    ['Operating Expenses', d.expenses_json ? (typeof d.expenses_json === 'string' ? '(see detail)' : Object.values(d.expenses_json).reduce((a, b) => a + (Number(b) || 0), 0)) : '—'],
    ['Net Income', d.net_income || d.netIncome],
    ['Indicated Value', d.indicated_value || d.indicatedValue],
  ];
  rows.forEach(([label, val]) => {
    const v = val != null && val !== '—' ? (typeof val === 'number' && val > 100 ? '$' + Number(val).toLocaleString() : val) : '—';
    html += `<div class="val-income-row"><span>${esc(label)}</span><span>${esc(String(v))}</span></div>`;
  });
  html += '</div>';

  // Rent comps
  const rentComps = d.rent_comps_json ? (typeof d.rent_comps_json === 'string' ? JSON.parse(d.rent_comps_json) : d.rent_comps_json) : [];
  if (rentComps.length) {
    html += '<div style="margin-top:6px;font-size:10px;font-weight:700;color:var(--muted);">RENT COMPS</div>';
    rentComps.forEach(rc => {
      html += `<div style="font-size:10px;padding:2px 0;">${esc(rc.address || '—')} — $${Number(rc.monthlyRent || rc.monthly_rent || 0).toLocaleString()}/mo</div>`;
    });
  }
  el.innerHTML = html;
  const el2 = $('valIncomeBody2');
  if (el2) el2.innerHTML = html;
}

async function valCalcIncome() {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/valuation/income/${activeCaseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    setStatus('valIncomeStatus', 'Income approach calculated.', 'ok');
    valLoadIncome();
    valLoadReconciliation();
  } else {
    setStatus('valIncomeStatus', res?.error || 'Failed.', 'err');
  }
}

// ── Cost Approach ───────────────────────────────────────────────────────────

async function valLoadCost() {
  const el = $('valCostBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';
  const res = await apiFetch(`/api/valuation/cost/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No cost data yet.</div>'; return; }

  const d = res.data || res;
  const rows = [
    ['Land Value', d.land_value || d.landValue],
    ['RCN (Replacement Cost New)', d.replacement_cost_new || d.replacementCostNew],
    ['Physical Depreciation', d.physical_depreciation || d.physicalDepreciation],
    ['Functional Depreciation', d.functional_depreciation || d.functionalDepreciation],
    ['External Depreciation', d.external_depreciation || d.externalDepreciation],
    ['Total Depreciation', d.total_depreciation || d.totalDepreciation],
    ['Depreciated Value', d.depreciated_value || d.depreciatedValue],
    ['Site Improvements', d.site_improvements || d.siteImprovements],
    ['Indicated Value', d.indicated_value || d.indicatedValue],
  ];

  let html = '<div>';
  rows.forEach(([label, val]) => {
    const v = val != null ? '$' + Number(val).toLocaleString() : '—';
    html += `<div class="val-cost-row"><span>${esc(label)}</span><span>${esc(v)}</span></div>`;
  });
  html += '</div>';
  el.innerHTML = html;
  const el2 = $('valCostBody2');
  if (el2) el2.innerHTML = html;
}

async function valCalcCost() {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/valuation/cost/${activeCaseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    setStatus('valCostStatus', 'Cost approach calculated.', 'ok');
    valLoadCost();
    valLoadReconciliation();
  } else {
    setStatus('valCostStatus', res?.error || 'Failed.', 'err');
  }
}

// ── Reconciliation ──────────────────────────────────────────────────────────

async function valLoadReconciliation() {
  const summaryEl = $('valApproachSummary');
  const reconEl = $('valReconBody');
  if (!activeCaseId) return;

  const res = await apiFetch(`/api/valuation/reconciliation/${activeCaseId}`).catch(() => null);
  if (!res || res.error) {
    if (summaryEl) summaryEl.innerHTML = '<div class="hint">No reconciliation data.</div>';
    if (reconEl) reconEl.innerHTML = '';
    return;
  }

  const d = res.data || res;

  // Approach summary cards
  if (summaryEl) {
    const approaches = [
      { label: 'Sales Comparison', value: d.sales_comparison_value || d.salesComparisonValue, weight: d.sales_comparison_weight || d.salesComparisonWeight },
      { label: 'Income', value: d.income_value || d.incomeValue, weight: d.income_weight || d.incomeWeight },
      { label: 'Cost', value: d.cost_value || d.costValue, weight: d.cost_weight || d.costWeight },
    ];
    summaryEl.innerHTML = approaches.map(a => {
      const v = a.value ? '$' + Number(a.value).toLocaleString() : '—';
      const w = a.weight != null ? (a.weight * 100).toFixed(0) + '%' : '—';
      return `<div class="val-approach-card">` +
        `<div class="val-approach-label">${esc(a.label)} (${w})</div>` +
        `<div class="val-approach-value">${esc(v)}</div>` +
      `</div>`;
    }).join('');
  }

  // Populate weight inputs
  if (d.sales_comparison_weight != null) { const e = $('valWtSales'); if (e) e.value = d.sales_comparison_weight; }
  if (d.income_weight != null) { const e = $('valWtIncome'); if (e) e.value = d.income_weight; }
  if (d.cost_weight != null) { const e = $('valWtCost'); if (e) e.value = d.cost_weight; }

  // Narrative — sync both reconciliation textareas
  const narrative = d.reconciliation_narrative || d.reconciliationNarrative || '';
  const nEl = $('valReconNarrative');
  const nEl2 = $('valReconNarrative2');
  if (nEl && narrative) nEl.value = narrative;
  if (nEl2 && narrative) nEl2.value = narrative;

  // Final value
  const finalEl = $('valFinalValue');
  const finalVal = d.final_opinion_value || d.finalOpinionValue;
  if (finalEl && finalVal) {
    finalEl.innerHTML = `<div class="val-final-box">` +
      `<div class="val-final-label">Final Opinion of Value</div>` +
      `<div class="val-final-value">$${Number(finalVal).toLocaleString()}</div>` +
    `</div>`;
  }
}

async function valSaveWeights() {
  if (!activeCaseId) return;
  const salesWeight = parseFloat($('valWtSales')?.value) || 0;
  const incomeWeight = parseFloat($('valWtIncome')?.value) || 0;
  const costWeight = parseFloat($('valWtCost')?.value) || 0;
  const res = await apiFetch(`/api/valuation/reconciliation/${activeCaseId}/weights`, {
    method: 'PUT', body: { salesWeight, incomeWeight, costWeight }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('valReconStatus', 'Weights saved.', 'ok');
    valLoadReconciliation();
  } else {
    setStatus('valReconStatus', res?.error || 'Failed.', 'err');
  }
}

async function valCalculateFinal() {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/valuation/reconciliation/${activeCaseId}/calculate`).catch(() => null);
  if (res && !res.error) {
    setStatus('valReconStatus', 'Final value calculated.', 'ok');
    valLoadReconciliation();
  } else {
    setStatus('valReconStatus', res?.error || 'Failed to calculate.', 'err');
  }
}

async function valSaveNarrative() {
  if (!activeCaseId) return;
  const narrative = $('valReconNarrative2')?.value || $('valReconNarrative')?.value || '';
  if (!narrative.trim()) { setStatus('valReconStatus', 'Enter a narrative first.', 'err'); return; }
  const res = await apiFetch(`/api/valuation/reconciliation/${activeCaseId}/narrative`, {
    method: 'PUT', body: { narrative }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('valReconStatus', 'Reconciliation memo saved.', 'ok');
  } else {
    setStatus('valReconStatus', res?.error || 'Failed.', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 10: Governance Dashboard — Section Freshness, Missing Facts,
//           Case Status & Pipeline, Dependency Graph
// ═══════════════════════════════════════════════════════════════════════════════

const PIPELINE_STAGES_ORDER = ['intake', 'extracting', 'generating', 'review', 'approved', 'inserting', 'complete'];
let _govSections = [];
let _govDependencyGraph = null;

function govOnTabOpen() {
  govLoadCaseStatus();
  govLoadSections();
  govLoadFreshness();
  govLoadRuns();
}

// ── Case Status & Pipeline ──────────────────────────────────────────────────

async function govLoadCaseStatus() {
  const el = $('govCaseStatusBody');
  const pEl = $('govPipelineBody');
  if (!el || !activeCaseId) { if (el) el.innerHTML = '<div class="hint">Select a case.</div>'; return; }

  const res = await apiFetch(`/api/cases/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">Failed to load case.</div>'; return; }

  const meta = res.meta || res;
  const status = meta.status || 'active';
  const pipeline = meta.pipeline_stage || meta.pipelineStage || 'intake';
  const workflow = meta.workflow_status || meta.workflowStatus || '—';

  el.innerHTML = `<div style="font-size:12px;">` +
    `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:var(--muted);">Status</span><strong>${esc(status)}</strong></div>` +
    `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:var(--muted);">Workflow</span><strong>${esc(workflow)}</strong></div>` +
    `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Address</span><strong>${esc(meta.address || '—')}</strong></div>` +
  `</div>`;

  // Pipeline strip
  if (pEl) {
    const idx = PIPELINE_STAGES_ORDER.indexOf(pipeline);
    pEl.innerHTML = '<div class="gov-pipeline-strip">' +
      PIPELINE_STAGES_ORDER.map((stage, i) => {
        const cls = i < idx ? 'done' : i === idx ? 'active' : 'pending';
        return `<span class="gov-pipeline-stage ${cls}">${esc(stage)}</span>`;
      }).join('<span style="color:var(--muted);font-size:10px;">›</span>') +
    '</div>';
  }
}

async function govAdvancePipeline(nextStage) {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/cases/${activeCaseId}/pipeline`, {
    method: 'PATCH', body: { pipeline_stage: nextStage }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('govPipelineStatus', `Pipeline → ${nextStage}`, 'ok');
    govLoadCaseStatus();
  } else {
    setStatus('govPipelineStatus', res?.error || 'Transition failed.', 'err');
  }
}

// ── Section Governance ──────────────────────────────────────────────────────

async function govLoadSections() {
  const el = $('govSectionsBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/governance/sections/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No governance data. Generate sections first.</div>'; return; }

  _govSections = res.sections || res || [];
  _govDependencyGraph = res.dependencyGraph || res.dependency_graph || null;
  govRenderSections();
}

function govRenderSections() {
  const el = $('govSectionsBody');
  if (!el) return;
  const filter = $('govFilterFreshness')?.value || 'all';
  let sections = Array.isArray(_govSections) ? _govSections : [];

  if (filter !== 'all') {
    sections = sections.filter(s => {
      const f = s.freshness_status || s.freshnessStatus || 'not_generated';
      return f === filter || (filter === 'not_generated' && !s.freshness_status && !s.freshnessStatus);
    });
  }

  if (!sections.length) { el.innerHTML = `<div class="hint">No sections match filter "${filter}".</div>`; return; }

  el.innerHTML = sections.map(s => {
    const id = s.section_id || s.sectionId || s.id || '—';
    const label = s.label || id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const freshness = s.freshness_status || s.freshnessStatus || 'not_generated';
    const quality = s.quality_score || s.qualityScore;
    const qualStr = quality != null ? (quality * 100).toFixed(0) + '%' : '—';
    const regenCount = s.regeneration_count || s.regenerationCount || 0;
    const staleReason = s.stale_reason || s.staleReason || '';
    const profile = s.generator_profile || s.generatorProfile || '';
    return `<div class="gov-section ${esc(freshness)}" onclick="govShowSectionDetail('${esc(id)}')">` +
      `<div style="flex:1;">` +
        `<div style="font-weight:700;">${esc(label)}</div>` +
        `<div style="font-size:10px;color:var(--muted);">${esc(profile)}${regenCount ? ' · regen ×' + regenCount : ''}${staleReason ? ' · ' + esc(staleReason) : ''}</div>` +
      `</div>` +
      `<div style="font-family:var(--mono);font-size:11px;min-width:32px;text-align:right;">${qualStr}</div>` +
      `<span class="gov-fresh-badge ${esc(freshness)}">${esc(freshness.replace(/_/g, ' '))}</span>` +
    `</div>`;
  }).join('');
}

async function govShowSectionDetail(sectionId) {
  const card = $('govSectionDetailCard');
  const titleEl = $('govSectionDetailTitle');
  const bodyEl = $('govSectionDetailBody');
  if (!card || !bodyEl || !activeCaseId) return;

  card.style.display = '';
  titleEl.textContent = sectionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  bodyEl.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/governance/sections/${activeCaseId}/${sectionId}`).catch(() => null);
  if (!res || res.error) { bodyEl.innerHTML = '<div class="hint">No detail available.</div>'; return; }

  const s = res.section || res;
  const freshness = s.freshness_status || s.freshnessStatus || 'not_generated';
  const quality = s.quality_score || s.qualityScore;
  const promptVer = s.prompt_version || s.promptVersion || '—';
  const staleReason = s.stale_reason || s.staleReason || '—';
  const staleSince = s.stale_since || s.staleSince || '—';
  const regenCount = s.regeneration_count || s.regenerationCount || 0;
  const generatedAt = s.generated_at || s.generatedAt || '—';

  // Parse dependency snapshot
  let depSnapshot = s.dependency_snapshot_json || s.dependencySnapshotJson;
  if (typeof depSnapshot === 'string') try { depSnapshot = JSON.parse(depSnapshot); } catch(e) { depSnapshot = null; }

  // Parse policy
  let policy = s.section_policy_json || s.sectionPolicyJson;
  if (typeof policy === 'string') try { policy = JSON.parse(policy); } catch(e) { policy = null; }

  let html = '<div style="font-size:11px;">';
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Freshness</span><span class="gov-fresh-badge ${esc(freshness)}">${esc(freshness)}</span></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Quality Score</span><strong>${quality != null ? (quality * 100).toFixed(0) + '%' : '—'}</strong></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Prompt Version</span><span style="font-family:var(--mono);">${esc(promptVer)}</span></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Generated At</span><span>${esc(String(generatedAt))}</span></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Regenerations</span><strong>${regenCount}</strong></div>`;
  if (freshness === 'stale') {
    html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--danger);">Stale Reason</span><span>${esc(staleReason)}</span></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--danger);">Stale Since</span><span>${esc(String(staleSince))}</span></div>`;
  }

  // Dependency snapshot
  if (depSnapshot && typeof depSnapshot === 'object') {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Dependency Snapshot</div>';
    const paths = Object.keys(depSnapshot);
    paths.slice(0, 12).forEach(p => {
      const val = depSnapshot[p];
      html += `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;"><span class="gov-fact-path">${esc(p)}</span><span style="font-weight:600;">${esc(String(val != null ? val : '—')).slice(0, 40)}</span></div>`;
    });
    if (paths.length > 12) html += `<div style="font-size:10px;color:var(--muted);">…and ${paths.length - 12} more</div>`;
  }

  html += '</div>';
  html += '<div class="sep" style="margin:8px 0;"></div>';
  html += '<div class="btnrow">';
  html += `<button class="sm" onclick="govInvalidateSection('${esc(sectionId)}')">Mark Stale</button>`;
  html += `<button class="sm sec" onclick="govInvalidateDownstream('${esc(sectionId)}')">Invalidate Downstream</button>`;
  html += '</div>';

  bodyEl.innerHTML = html;
}

async function govInvalidateSection(sectionId) {
  if (!activeCaseId) return;
  const reason = prompt('Invalidation reason:', 'manual_review');
  if (!reason) return;
  const res = await apiFetch(`/api/governance/sections/${activeCaseId}/${sectionId}/invalidate`, {
    method: 'POST', body: { reason }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('govActionStatus', `${sectionId} marked stale.`, 'ok');
    govLoadSections();
    govLoadFreshness();
  } else {
    setStatus('govActionStatus', res?.error || 'Failed.', 'err');
  }
}

async function govInvalidateDownstream(sectionId) {
  if (!activeCaseId) return;
  const res = await apiFetch(`/api/governance/sections/${activeCaseId}/invalidate-downstream`, {
    method: 'POST', body: { sectionId }
  }).catch(() => null);
  if (res && !res.error) {
    setStatus('govActionStatus', `Downstream of ${sectionId} invalidated.`, 'ok');
    govLoadSections();
    govLoadFreshness();
  } else {
    setStatus('govActionStatus', res?.error || 'Failed.', 'err');
  }
}

async function govInvalidateAll() {
  if (!activeCaseId) return;
  const stale = (_govSections || []).filter(s => {
    const f = s.freshness_status || s.freshnessStatus;
    return f === 'stale';
  });
  if (!stale.length) { setStatus('govActionStatus', 'No stale sections.', ''); return; }
  for (const s of stale) {
    const id = s.section_id || s.sectionId || s.id;
    await apiFetch(`/api/governance/sections/${activeCaseId}/${id}/invalidate`, {
      method: 'POST', body: { reason: 'bulk_invalidation' }
    }).catch(() => null);
  }
  setStatus('govActionStatus', `${stale.length} sections invalidated.`, 'ok');
  govLoadSections();
  govLoadFreshness();
}

async function govCheckFreshness() {
  if (!activeCaseId) return;
  setStatus('govActionStatus', 'Re-evaluating freshness...', '');
  const res = await apiFetch(`/api/governance/freshness/${activeCaseId}`).catch(() => null);
  if (res && !res.error) {
    setStatus('govActionStatus', 'Freshness re-evaluated.', 'ok');
    govLoadSections();
    govLoadFreshness();
  } else {
    setStatus('govActionStatus', res?.error || 'Failed.', 'err');
  }
}

// ── Freshness Summary ───────────────────────────────────────────────────────

async function govLoadFreshness() {
  const el = $('govFreshnessSummary');
  if (!el || !activeCaseId) return;

  const res = await apiFetch(`/api/governance/freshness/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No freshness data.</div>'; return; }

  const summary = res.summary || res;
  const total = summary.total || 0;
  const current = summary.current || 0;
  const stale = summary.stale || 0;
  const regenerating = summary.regenerating || 0;
  const notGenerated = summary.not_generated || summary.notGenerated || (total - current - stale - regenerating);
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  // Donut-style summary
  const ringBg = `conic-gradient(var(--ok) 0% ${pct}%, var(--danger) ${pct}% ${pct + (total > 0 ? Math.round((stale / total) * 100) : 0)}%, var(--gold) ${pct + (total > 0 ? Math.round((stale / total) * 100) : 0)}% ${pct + (total > 0 ? Math.round(((stale + regenerating) / total) * 100) : 0)}%, var(--surface) ${pct + (total > 0 ? Math.round(((stale + regenerating) / total) * 100) : 0)}% 100%)`;

  el.innerHTML = `<div class="gov-donut">` +
    `<div class="gov-donut-ring" style="background:${ringBg};">${pct}%</div>` +
    `<div class="gov-donut-labels">` +
      `<div><span style="color:var(--ok);">●</span> Current: <strong>${current}</strong></div>` +
      `<div><span style="color:var(--danger);">●</span> Stale: <strong>${stale}</strong></div>` +
      `<div><span style="color:var(--gold);">●</span> Regenerating: <strong>${regenerating}</strong></div>` +
      `<div><span style="color:var(--muted);">●</span> Not Generated: <strong>${notGenerated}</strong></div>` +
      `<div style="margin-top:3px;font-weight:700;">Total: ${total}</div>` +
    `</div>` +
  `</div>`;
}

// ── Missing Facts Dashboard ─────────────────────────────────────────────────

const GOV_SECTION_IDS = [
  'offering_history', 'contract', 'neighborhood_description', 'market_conditions',
  'site_description', 'improvements_description', 'highest_best_use',
  'sales_comparison_summary', 'reconciliation', 'additional_comments'
];

async function govLoadMissingFacts() {
  const el = $('govMissingFactsBody');
  const sumEl = $('govMissingFactsSummary');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Checking all sections...</div>';

  const res = await apiFetch(`/api/cases/${activeCaseId}/missing-facts`, {
    method: 'POST', body: { fieldIds: GOV_SECTION_IDS }
  }).catch(() => null);

  if (!res || res.error) { el.innerHTML = '<div class="hint">Failed to check missing facts.</div>'; return; }

  const results = res.results || res;
  let totalReq = 0, totalRec = 0, blockedSections = 0;

  let html = '';
  const entries = Array.isArray(results) ? results : Object.entries(results).map(([k, v]) => ({ fieldId: k, ...v }));

  entries.forEach(entry => {
    const fieldId = entry.fieldId || entry.field_id || entry.sectionId || '—';
    const required = entry.required || [];
    const recommended = entry.recommended || [];
    const hasBlockers = entry.hasBlockers || required.length > 0;
    const label = fieldId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    totalReq += required.length;
    totalRec += recommended.length;
    if (hasBlockers) blockedSections++;

    if (!required.length && !recommended.length) {
      html += `<div class="gov-fact-section"><span>${esc(label)}</span><span style="color:var(--ok);font-size:10px;">Complete</span></div>`;
      return;
    }

    html += `<div class="gov-fact-section ${hasBlockers ? 'has-blockers' : ''}">` +
      `<span>${esc(label)}</span>` +
      `<span style="font-size:10px;">${required.length ? `<span class="gov-fact-req">${required.length} required</span>` : ''}${recommended.length ? ` <span class="gov-fact-rec">${recommended.length} recommended</span>` : ''}</span>` +
    `</div>`;

    required.forEach(path => {
      html += `<div class="gov-fact-row"><span class="gov-fact-req">REQUIRED</span> <span class="gov-fact-path">${esc(path)}</span></div>`;
    });
    recommended.forEach(path => {
      html += `<div class="gov-fact-row"><span class="gov-fact-rec">RECOMMENDED</span> <span class="gov-fact-path">${esc(path)}</span></div>`;
    });
  });

  el.innerHTML = html || '<div class="hint">No sections to check.</div>';

  if (sumEl) {
    sumEl.innerHTML = `<div style="font-size:11px;display:flex;gap:16px;">` +
      `<div><span style="color:var(--danger);font-weight:700;">${totalReq}</span> required gaps</div>` +
      `<div><span style="color:var(--gold);font-weight:700;">${totalRec}</span> recommended gaps</div>` +
      `<div><span style="font-weight:700;">${blockedSections}</span> blocked sections</div>` +
    `</div>`;
  }
}

// ── Dependency Graph ────────────────────────────────────────────────────────

async function govLoadDependencyGraph() {
  const el = $('govDepGraphBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  // Use cached graph from section load, or fetch fresh
  if (!_govDependencyGraph) {
    const res = await apiFetch(`/api/governance/sections/${activeCaseId}`).catch(() => null);
    if (res) _govDependencyGraph = res.dependencyGraph || res.dependency_graph;
  }

  if (!_govDependencyGraph) { el.innerHTML = '<div class="hint">No dependency data available.</div>'; return; }

  const graph = _govDependencyGraph;
  const nodes = graph.nodes || Object.keys(graph);

  if (Array.isArray(graph) || typeof graph !== 'object') {
    el.innerHTML = '<div class="hint">Dependency graph format not recognized.</div>';
    return;
  }

  let html = '<div style="font-size:11px;">';
  const entries = graph.nodes ? graph.nodes : Object.entries(graph);

  if (Array.isArray(entries)) {
    entries.forEach(entry => {
      const [nodeId, nodeData] = Array.isArray(entry) ? entry : [entry.id || entry.sectionId, entry];
      if (!nodeId) return;
      const upstream = nodeData?.upstream || nodeData?.dependsOn || [];
      const downstream = nodeData?.downstream || nodeData?.dependents || [];
      const label = String(nodeId).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      html += `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.03);">`;
      html += `<div style="font-weight:700;margin-bottom:3px;">${esc(label)}</div>`;

      if (upstream.length) {
        html += `<div style="font-size:10px;color:var(--muted);margin-bottom:2px;">Depends on:</div>`;
        html += upstream.map(u => `<span class="gov-dep-node">${esc(String(u).replace(/_/g, ' '))}</span>`).join('<span class="gov-dep-arrow">→</span>');
        html += ` <span class="gov-dep-arrow">→</span> <span class="gov-dep-node" style="border-color:var(--gold);">${esc(label)}</span>`;
      }

      if (downstream.length) {
        html += `<div style="font-size:10px;color:var(--muted);margin-top:3px;margin-bottom:2px;">Feeds into:</div>`;
        html += `<span class="gov-dep-node" style="border-color:var(--gold);">${esc(label)}</span> <span class="gov-dep-arrow">→</span> `;
        html += downstream.map(d => `<span class="gov-dep-node">${esc(String(d).replace(/_/g, ' '))}</span>`).join('<span class="gov-dep-arrow">,</span> ');
      }

      if (!upstream.length && !downstream.length) {
        html += `<div style="font-size:10px;color:var(--muted);">No dependencies</div>`;
      }

      html += `</div>`;
    });
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Generation Runs ─────────────────────────────────────────────────────────

async function govLoadRuns() {
  const el = $('govRunsBody');
  if (!el || !activeCaseId) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/cases/${activeCaseId}/generation-runs`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No generation runs.</div>'; return; }

  const runs = res.runs || res || [];
  if (!runs.length) { el.innerHTML = '<div class="hint">No generation runs recorded.</div>'; return; }

  el.innerHTML = runs.slice(0, 10).map(r => {
    const status = r.status || '—';
    const statusColor = status === 'COMPLETE' ? 'var(--ok)' : status === 'FAILED' ? 'var(--danger)' : 'var(--gold)';
    const total = r.section_count || r.sectionCount || 0;
    const success = r.success_count || r.successCount || 0;
    const errors = r.error_count || r.errorCount || 0;
    const started = r.started_at || r.startedAt || r.created_at || '';
    const elapsed = r.elapsed_ms || r.elapsedMs;
    return `<div class="gov-run-item">` +
      `<div style="display:flex;justify-content:space-between;align-items:center;">` +
        `<span class="gov-run-status" style="color:${statusColor};border-color:${statusColor};">${esc(status)}</span>` +
        `<span style="font-size:10px;color:var(--muted);">${esc(String(started).slice(0, 19))}</span>` +
      `</div>` +
      `<div style="font-size:10px;margin-top:3px;">` +
        `${success}/${total} sections${errors ? ` · <span style="color:var(--danger);">${errors} errors</span>` : ''}` +
        `${elapsed ? ` · ${(elapsed / 1000).toFixed(1)}s` : ''}` +
      `</div>` +
    `</div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 11: Learning Dashboard — Patterns, Suggestions, Explainability,
//           Revision Diffs, Ranked Suggestions, Case Learning Reports
// ═══════════════════════════════════════════════════════════════════════════════

let _lrnPatterns = [];

function lrnOnTabOpen() {
  lrnLoadAcceptanceRate();
  lrnLoadPatterns();
  lrnLoadSuggestionHistory();
  lrnLoadDiffStats();
  lrnLoadCaseReport();
}

// ── Suggestion Acceptance Metrics ───────────────────────────────────────────

async function lrnLoadAcceptanceRate() {
  const el = $('lrnAcceptanceBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch('/api/learning/acceptance-rate').catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No acceptance data yet.</div>'; return; }

  const d = res;
  const total = d.total || 0;
  const accepted = d.accepted || 0;
  const modified = d.modified || 0;
  const rejected = d.rejected || 0;
  const accRate = d.acceptanceRate != null ? (d.acceptanceRate * 100).toFixed(0) : '—';
  const modRate = d.modificationRate != null ? (d.modificationRate * 100).toFixed(0) : '—';

  el.innerHTML = `<div class="lrn-stat-grid">` +
    `<div class="lrn-stat"><div class="lrn-stat-val">${total}</div><div class="lrn-stat-label">Total</div></div>` +
    `<div class="lrn-stat"><div class="lrn-stat-val" style="color:var(--ok);">${accepted}</div><div class="lrn-stat-label">Accepted</div></div>` +
    `<div class="lrn-stat"><div class="lrn-stat-val" style="color:var(--gold);">${modified}</div><div class="lrn-stat-label">Modified</div></div>` +
    `<div class="lrn-stat"><div class="lrn-stat-val" style="color:var(--danger);">${rejected}</div><div class="lrn-stat-label">Rejected</div></div>` +
  `</div>` +
  `<div style="font-size:11px;display:flex;gap:16px;">` +
    `<div>Acceptance: <strong style="color:var(--ok);">${accRate}%</strong></div>` +
    `<div>Modification: <strong style="color:var(--gold);">${modRate}%</strong></div>` +
  `</div>`;
}

// ── Case Learning Report ────────────────────────────────────────────────────

async function lrnLoadCaseReport() {
  const el = $('lrnCaseReportBody');
  if (!el || !activeCaseId) { if (el) el.innerHTML = '<div class="hint">Select a case.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/learning/case-report/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No learning report for this case.</div>'; return; }

  let html = '<div style="font-size:11px;">';

  const archive = res.archive;
  if (archive) {
    html += `<div style="margin-bottom:6px;">` +
      `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Form</span><strong>${esc(archive.formType || '—')}</strong></div>` +
      `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Property</span><strong>${esc(archive.propertyType || '—')}</strong></div>` +
      `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Archived</span><strong>${esc(String(archive.archivedAt || '—').slice(0, 10))}</strong></div>` +
    `</div>`;
  }

  const patterns = res.patternsApplied || [];
  if (patterns.length) {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += `<div style="font-weight:700;">Patterns Applied: ${patterns.length}</div>`;
    const byType = {};
    patterns.forEach(p => { byType[p.patternType || 'unknown'] = (byType[p.patternType || 'unknown'] || 0) + 1; });
    Object.entries(byType).forEach(([type, count]) => {
      html += `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${esc(type.replace(/_/g, ' '))}</span><strong>${count}</strong></div>`;
    });
  }

  const sugg = res.suggestions;
  if (sugg) {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += `<div style="font-weight:700;">Suggestions</div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Accepted</span><strong style="color:var(--ok);">${sugg.accepted || 0}</strong></div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Modified</span><strong style="color:var(--gold);">${sugg.modified || 0}</strong></div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Rejected</span><strong style="color:var(--danger);">${sugg.rejected || 0}</strong></div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Rate</span><strong>${sugg.acceptanceRate != null ? (sugg.acceptanceRate * 100).toFixed(0) + '%' : '—'}</strong></div>`;
  }

  const rev = res.revisionStats;
  if (rev) {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += `<div style="font-weight:700;">Revisions</div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Sections Changed</span><strong>${rev.sectionsChanged || 0}/${rev.totalSections || 0}</strong></div>`;
    html += `<div style="display:flex;justify-content:space-between;"><span>Avg Change</span><strong>${rev.averageChangeRatio != null ? (rev.averageChangeRatio * 100).toFixed(0) + '%' : '—'}</strong></div>`;
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Learned Patterns ────────────────────────────────────────────────────────

async function lrnLoadPatterns() {
  const el = $('lrnPatternsBody');
  if (!el) return;
  el.innerHTML = '<div class="hint">Loading...</div>';

  const filter = $('lrnPatternFilter')?.value || '';
  let url = '/api/learning/patterns';
  if (filter) url += `?patternType=${encodeURIComponent(filter)}`;

  const res = await apiFetch(url).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No patterns found.</div>'; return; }

  const patterns = Array.isArray(res) ? res : res.patterns || [];
  _lrnPatterns = patterns;

  if (!patterns.length) { el.innerHTML = '<div class="hint">No patterns match filter.</div>'; return; }

  el.innerHTML = patterns.slice(0, 50).map(p => {
    const conf = ((p.confidence || 0) * 100).toFixed(0);
    const confCls = p.confidence >= 0.7 ? 'high' : p.confidence >= 0.4 ? 'mid' : 'low';
    const type = p.pattern_type || p.patternType || '—';
    const key = p.pattern_key || p.patternKey || '';
    const usage = p.usage_count || p.usageCount || 0;
    const lastUsed = p.last_used_at || p.lastUsedAt || '';
    return `<div class="lrn-pattern" onclick="lrnShowPatternDetail('${esc(p.id)}')">` +
      `<div class="lrn-conf ${confCls}">${conf}</div>` +
      `<div style="flex:1;">` +
        `<div style="font-weight:700;">${esc(key || type.replace(/_/g, ' '))}</div>` +
        `<div style="font-size:10px;color:var(--muted);">Used ${usage}× ${lastUsed ? '· last ' + esc(String(lastUsed).slice(0, 10)) : ''}</div>` +
      `</div>` +
      `<span class="lrn-type-badge">${esc(type.replace(/_/g, ' '))}</span>` +
    `</div>`;
  }).join('');
}

async function lrnShowPatternDetail(patternId) {
  const card = $('lrnPatternDetailCard');
  const titleEl = $('lrnPatternDetailTitle');
  const bodyEl = $('lrnPatternDetailBody');
  if (!card || !bodyEl) return;

  card.style.display = '';
  bodyEl.innerHTML = '<div class="hint">Loading...</div>';

  const pattern = _lrnPatterns.find(p => p.id === patternId);
  if (!pattern) { bodyEl.innerHTML = '<div class="hint">Pattern not found.</div>'; return; }

  const conf = ((pattern.confidence || 0) * 100).toFixed(0);
  const type = pattern.pattern_type || pattern.patternType || '—';
  titleEl.textContent = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let data = pattern.pattern_data_json || pattern.patternDataJson || pattern.patternData;
  if (typeof data === 'string') try { data = JSON.parse(data); } catch(e) { data = {}; }
  if (!data) data = {};

  const srRes = await apiFetch(`/api/learning/patterns/${patternId}/success-rate`).catch(() => null);

  let html = '<div style="font-size:11px;">';
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Confidence</span><strong>${conf}%</strong></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Type</span><strong>${esc(type)}</strong></div>`;
  html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Usage Count</span><strong>${pattern.usage_count || pattern.usageCount || 0}</strong></div>`;

  if (srRes && !srRes.error) {
    html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Success Rate</span><strong>${srRes.successRate != null ? (srRes.successRate * 100).toFixed(0) + '%' : '—'}</strong></div>`;
    html += `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:var(--muted);">Applications</span><strong>${srRes.total || 0} (${srRes.accepted || 0} accepted, ${srRes.rejected || 0} rejected)</strong></div>`;
  }

  html += '<div class="sep" style="margin:6px 0;"></div>';
  html += '<div style="font-weight:700;margin-bottom:3px;">Pattern Data</div>';
  Object.entries(data).forEach(([key, val]) => {
    const display = typeof val === 'object' ? JSON.stringify(val).slice(0, 80) : String(val).slice(0, 80);
    html += `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;">` +
      `<span style="font-family:var(--mono);color:var(--muted);">${esc(key)}</span>` +
      `<span style="font-weight:600;">${esc(display)}</span>` +
    `</div>`;
  });

  html += '</div>';
  bodyEl.innerHTML = html;
}

// ── Suggestion History ──────────────────────────────────────────────────────

async function lrnLoadSuggestionHistory() {
  const el = $('lrnSuggestionBody');
  if (!el || !activeCaseId) { if (el) el.innerHTML = '<div class="hint">Select a case.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/learning/suggestion-history/${activeCaseId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No suggestion outcomes for this case.</div>'; return; }

  const outcomes = Array.isArray(res) ? res : res.outcomes || [];
  if (!outcomes.length) { el.innerHTML = '<div class="hint">No suggestion outcomes recorded.</div>'; return; }

  el.innerHTML = outcomes.slice(0, 30).map(o => {
    const accepted = o.accepted;
    const modified = o.modified;
    const outcomeCls = accepted ? 'accepted' : modified ? 'modified' : 'rejected';
    const outcomeLabel = accepted ? 'Accepted' : modified ? 'Modified' : 'Rejected';
    const section = o.section_id || o.sectionId || '—';
    const type = o.suggestion_type || o.suggestionType || '—';
    const reason = o.rejection_reason || o.rejectionReason || '';
    const label = section.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="lrn-sugg-row">` +
      `<span class="lrn-outcome ${outcomeCls}">${outcomeLabel}</span>` +
      `<div style="flex:1;">` +
        `<div style="font-weight:700;">${esc(label)}</div>` +
        `<div style="font-size:10px;color:var(--muted);">${esc(type.replace(/_/g, ' '))}${reason ? ' · ' + esc(reason) : ''}</div>` +
      `</div>` +
    `</div>`;
  }).join('');
}

// ── Revision Diff Stats ─────────────────────────────────────────────────────

async function lrnLoadDiffStats() {
  const el = $('lrnDiffBody');
  if (!el || !activeCaseId) { if (el) el.innerHTML = '<div class="hint">Select a case.</div>'; return; }
  el.innerHTML = '<div class="hint">Loading...</div>';

  const res = await apiFetch(`/api/learning/revision-diffs/${activeCaseId}/stats`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No revision data.</div>'; return; }

  const changed = res.sectionsChanged || 0;
  const total = res.totalSections || 0;
  const avg = res.averageChangeRatio != null ? (res.averageChangeRatio * 100).toFixed(0) : '—';
  const most = res.mostChangedSections || [];

  let html = `<div style="font-size:11px;margin-bottom:6px;">` +
    `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Sections Edited</span><strong>${changed}/${total}</strong></div>` +
    `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Avg Change</span><strong>${avg}%</strong></div>` +
  `</div>`;

  if (most.length) {
    html += '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px;">MOST EDITED SECTIONS</div>';
    most.forEach(m => {
      const ratio = m.changeRatio || m.change_ratio || 0;
      const ratioStr = (ratio * 100).toFixed(0);
      const cls = ratio > 0.5 ? 'danger' : ratio > 0.25 ? 'warn' : 'ok';
      const label = (m.sectionId || m.section_id || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      html += `<div class="lrn-diff-section">` +
        `<div class="lrn-diff-ratio" style="color:var(--${cls === 'ok' ? 'ok' : cls === 'warn' ? 'gold' : 'danger'});">${ratioStr}%</div>` +
        `<div style="flex:1;"><div style="font-weight:700;">${esc(label)}</div>` +
        `<div class="lrn-bar" style="width:100%;"><div class="lrn-bar-fill ${cls}" style="width:${Math.min(ratio * 100, 100)}%;"></div></div></div>` +
      `</div>`;
    });
  }

  el.innerHTML = html;
}

// ── Influence Explainability ────────────────────────────────────────────────

async function lrnLoadInfluence() {
  const el = $('lrnInfluenceBody');
  if (!el) return;
  const sectionId = $('lrnInfluenceSection')?.value;
  if (!sectionId) return;
  el.innerHTML = '<div class="hint">Loading influence explanation...</div>';

  const res = await apiFetch(`/api/learning/influence/${sectionId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No influence data for this section.</div>'; return; }

  let html = '<div class="lrn-influence">';

  if (res.explanation) {
    html += `<div style="font-size:12px;line-height:1.5;margin-bottom:8px;padding:8px;background:rgba(215,179,90,.04);border-radius:8px;border:1px solid rgba(215,179,90,.15);">${esc(res.explanation)}</div>`;
  }

  if (res.acceptanceRate != null) {
    const rate = (res.acceptanceRate * 100).toFixed(0);
    const cls = res.acceptanceRate >= 0.8 ? 'ok' : res.acceptanceRate >= 0.5 ? 'gold' : 'danger';
    html += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;">` +
      `<span style="font-weight:700;">Historical Acceptance Rate</span>` +
      `<strong style="color:var(--${cls});">${rate}%</strong>` +
    `</div>`;
    html += `<div style="font-size:10px;color:var(--muted);">Sample size: ${res.sampleSize || 0}</div>`;
  }

  const factors = res.influenceFactors || [];
  if (factors.length) {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Influence Factors</div>';
    factors.forEach(f => {
      html += `<div class="lrn-influence-factor">` +
        `<span style="font-weight:700;">${esc(f.factor || f.name || '—')}</span>` +
        `<span style="color:var(--muted);">${esc(f.description || '')}</span>` +
        `<span style="font-family:var(--mono);font-weight:700;">${f.weight != null ? (f.weight * 100).toFixed(0) + '%' : '—'}</span>` +
      `</div>`;
    });
  }

  const topPatterns = res.topPatterns || [];
  if (topPatterns.length) {
    html += '<div class="sep" style="margin:6px 0;"></div>';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Top Patterns</div>';
    topPatterns.forEach(tp => {
      const rate = tp.acceptanceRate != null ? (tp.acceptanceRate * 100).toFixed(0) + '%' : '—';
      html += `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;">` +
        `<span>${esc((tp.suggestionType || tp.type || '—').replace(/_/g, ' '))}</span>` +
        `<span>acceptance: <strong>${rate}</strong> (n=${tp.sampleSize || 0})</span>` +
      `</div>`;
    });
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Ranked Suggestions ──────────────────────────────────────────────────────

async function lrnLoadRanked() {
  const el = $('lrnRankedBody');
  if (!el) return;
  const sectionId = $('lrnRankedSection')?.value;
  if (!sectionId) return;
  el.innerHTML = '<div class="hint">Loading ranked suggestions...</div>';

  const res = await apiFetch(`/api/learning/ranked-suggestions/${sectionId}`).catch(() => null);
  if (!res || res.error) { el.innerHTML = '<div class="hint">No ranked suggestions for this section.</div>'; return; }

  const ranked = Array.isArray(res) ? res : res.ranked || res.suggestions || [];
  if (!ranked.length) { el.innerHTML = '<div class="hint">No suggestion history to rank.</div>'; return; }

  el.innerHTML = ranked.map((r, i) => {
    const rate = r.acceptanceRate != null ? (r.acceptanceRate * 100).toFixed(0) : '—';
    const rateCls = r.acceptanceRate >= 0.7 ? 'ok' : r.acceptanceRate >= 0.4 ? 'warn' : 'danger';
    const type = r.suggestionType || r.suggestion_type || r.type || '—';
    const total = r.total || r.sampleSize || 0;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:3px;font-size:11px;">` +
      `<div style="font-size:14px;font-weight:900;font-family:var(--mono);color:var(--muted);min-width:20px;">#${i + 1}</div>` +
      `<div style="flex:1;">` +
        `<div style="font-weight:700;">${esc(type.replace(/_/g, ' '))}</div>` +
        `<div style="font-size:10px;color:var(--muted);">${total} outcomes</div>` +
      `</div>` +
      `<div style="text-align:right;">` +
        `<div style="font-family:var(--mono);font-weight:900;color:var(--${rateCls});">${rate}%</div>` +
        `<div class="lrn-bar" style="width:60px;"><div class="lrn-bar-fill ${rateCls}" style="width:${rate}%;"></div></div>` +
      `</div>` +
    `</div>`;
  }).join('');
}

// ── Archive & Feedback Loop ─────────────────────────────────────────────────

async function lrnArchiveCase() {
  if (!activeCaseId) { setStatus('lrnArchiveStatus', 'Select a case first.', 'err'); return; }
  setStatus('lrnArchiveStatus', 'Archiving...', '');
  const res = await apiFetch(`/api/cases/${activeCaseId}/archive`, { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    setStatus('lrnArchiveStatus', 'Case archived. Patterns extracted.', 'ok');
    lrnLoadPatterns();
    lrnLoadCaseReport();
  } else {
    setStatus('lrnArchiveStatus', res?.error || 'Archive failed.', 'err');
  }
}

async function lrnCloseFeedbackLoop() {
  if (!activeCaseId) { setStatus('lrnArchiveStatus', 'Select a case first.', 'err'); return; }
  setStatus('lrnArchiveStatus', 'Closing feedback loop...', '');
  const res = await apiFetch(`/api/cases/${activeCaseId}/feedback-loop/close`, { method: 'POST', body: {} }).catch(() => null);
  if (res && !res.error) {
    const processed = res.sectionsProcessed || 0;
    const updated = res.applicationsUpdated || 0;
    setStatus('lrnArchiveStatus', `Loop closed: ${processed} sections, ${updated} applications updated.`, 'ok');
    lrnLoadAcceptanceRate();
    lrnLoadPatterns();
  } else {
    setStatus('lrnArchiveStatus', res?.error || 'Failed to close loop.', 'err');
  }
}


// ── INTAKE TAB ─────────────────────────────────────────────────────────────

let intakeCaseId = null;
let intakeExtracted = null;

function handleIntakeDrop(e) {
  e.preventDefault();
  document.getElementById('intake-drop-zone').style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith('.pdf')) {
    handleIntakeFile(file);
  } else {
    showIntakeStatus('Please drop a PDF file.', 'err');
  }
}

// ── ACI XML Intake ────────────────────────────────────────────────────────────

function handleIntakeXmlDrop(e) {
  e.preventDefault();
  document.getElementById('intake-xml-drop-zone').style.borderColor = 'rgba(85,209,143,.25)';
  const file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith('.xml')) {
    handleIntakeXmlFile(file);
  } else {
    showIntakeXmlStatus('Please drop an .xml file.', 'err');
  }
}

function showIntakeXmlStatus(msg, type) {
  const el = $('intake-xml-status');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.className = 'status' + (type ? ' ' + type : '');
  el.textContent = msg;
}

async function handleIntakeXmlFile(file) {
  if (!file) return;
  showIntakeXmlStatus(`Parsing ${file.name}… this may take a moment.`, 'warn');
  document.getElementById('intake-result').style.display = 'none';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 300000);
    const r = await fetch(server() + '/api/intake/xml', {
      method: 'POST',
      headers: { 'X-API-Key': CACC_API_KEY },
      body: formData,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await r.json();

    if (data.ok && data.caseId) {
      intakeCaseId = data.caseId;
      intakeExtracted = data.extracted;

      const parts = [];
      if (data.comps && data.comps.length) parts.push(`${data.comps.length} comps extracted`);
      if (data.narrativeKeys && data.narrativeKeys.length) parts.push(`${data.narrativeKeys.length} narrative sections`);
      if (data.hasPdf) parts.push('PDF saved for voice training');

      showIntakeXmlStatus(
        `✓ Case ${data.caseId} created from XML${parts.length ? ' · ' + parts.join(', ') : ''}`,
        'ok'
      );

      // Load the case and show result card using same mechanism as PDF intake
      activeCaseId = data.caseId;
      await loadCase(data.caseId);

      // Show result using existing intake result card
      showIntakeResult({
        ...data,
        extracted: {
          ...data.extracted,
          address: data.extracted.address || data.extracted.streetAddress || '',
          borrowerName: data.extracted.borrowerName || '',
          lenderName: data.extracted.lenderName || '',
          formTypeCode: data.extracted.formTypeCode || '',
          _xmlInfo: parts.join(' | '),
        },
        missingFields: [],
      });
      showIntakeStatus(`✓ XML imported: ${file.name}`, 'ok');
    } else {
      showIntakeXmlStatus(data.error || 'Failed to parse XML.', 'err');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      showIntakeXmlStatus('Timed out. Large XML files (with embedded PDF) can take a while — try again.', 'err');
    } else {
      showIntakeXmlStatus(`Error: ${err.message}`, 'err');
    }
  }
}

async function handleIntakeFile(file) {
  if (!file) return;
  showIntakeStatus(`Processing ${file.name}...`, '');
  document.getElementById('intake-result').style.display = 'none';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API}/intake/order`, {
      method: 'POST',
      body: formData,
      headers: { 'X-API-Key': CACC_API_KEY },
    });
    const data = await res.json();

    if (data.ok && data.caseId) {
      intakeCaseId = data.caseId;
      intakeExtracted = data.extracted;
      showIntakeResult(data);
      showIntakeStatus(`✓ Case created: ${data.caseId}`, 'ok');
      // Load case in background so active case bar updates; stay on intake for review
      activeCaseId = data.caseId;
      await loadCase(data.caseId);
      // Don't auto-navigate — let Charles click the CTA button
    } else {
      // Show specific, actionable error messages based on the error code
      let friendlyMsg = data.error || 'Failed to parse order sheet.';
      const code = data.code || '';
      if (code === 'PDF_EXTRACTION_FAILED' || (data.extractionMethod === 'failed')) {
        // Check if it looks like encryption vs OCR failure
        const errLower = (data.error || '').toLowerCase();
        if (errLower.includes('encrypt') || errLower.includes('password') || errLower.includes('decrypt')) {
          friendlyMsg = 'This PDF appears to be encrypted or password-protected. Please unlock it before uploading.';
        } else if (errLower.includes('ocr') || errLower.includes('scanned') || errLower.includes('image') || data.extractionMethod === 'ocr-vision') {
          friendlyMsg = 'Could not extract text from this PDF — it may be a scanned image only. Try a digitally-created PDF or contact the lender for a text-based version.';
        } else {
          friendlyMsg = 'Could not extract text from this PDF — it may be scanned, image-only, or encrypted. Try a different file.';
        }
      } else if (code === 'MISSING_REQUIRED_FIELDS' || (data.missingFields && data.missingFields.length > 3)) {
        const missing = data.missingFields ? data.missingFields.slice(0, 3).join(', ') : '';
        friendlyMsg = `Unrecognized order format — missing required fields${missing ? ': ' + missing : ''}. Is this a standard appraisal assignment sheet?`;
      } else if (code === 'MISSING_FILE') {
        friendlyMsg = 'No PDF file received. Please drop a valid PDF assignment sheet.';
      } else if (code === 'UNSUPPORTED_FILE_TYPE') {
        friendlyMsg = 'Only PDF files are accepted. Please upload a PDF assignment sheet.';
      }
      showIntakeStatus(friendlyMsg, 'err');
    }
  } catch (e) {
    showIntakeStatus('Server error: ' + e.message, 'err');
  }
}

function showIntakeStatus(msg, type) {
  const el = document.getElementById('intake-status');
  el.style.display = 'block';
  el.style.color = type === 'ok' ? 'var(--ok)' : type === 'err' ? 'var(--danger)' : 'var(--muted)';
  el.style.fontSize = '13px';
  el.style.padding = '8px 0';
  el.textContent = msg;
}

function showIntakeResult(data) {
  const el = document.getElementById('intake-extracted');
  const extracted = data.extracted || {};
  const missing = data.missingFields || [];

  const fields = [
    ['Order ID', extracted.orderID],
    ['Address', extracted.address],
    ['Borrower(s)', extracted.borrowerName],
    ['Lender', extracted.lenderName],
    ['Form Type', extracted.formType],
    ['Loan Type', extracted.loanType],
    ['Transaction', extracted.transactionType],
    ['Fee', extracted.fee ? `$${extracted.fee}` : null],
    ['Delivery Date', extracted.deliveryDate],
    ['Contact', extracted.contactName ? `${extracted.contactName} ${extracted.contactPhone || ''}` : null],
  ];

  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">';
  for (const [label, value] of fields) {
    const style = value ? 'color:var(--text)' : 'color:var(--muted);font-style:italic';
    html += `<div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:12px;${style};margin-top:1px">${value || 'not found'}</div>
    </div>`;
  }
  html += '</div>';

  if (missing.length > 0) {
    html += `<div style="margin-top:10px;font-size:11px;color:var(--warn)">⚠ Missing: ${missing.join(', ')}</div>`;
  }

  // Show pre-filled vs missing summary
  const prefilled = fields.filter(([, v]) => v).length;
  const total = fields.length;
  html += `<div style="margin-top:10px;padding:8px;background:rgba(215,179,90,.08);border:1px solid rgba(215,179,90,.25);border-radius:6px;font-size:11px;">
    <strong style="color:var(--gold)">✓ ${prefilled}/${total} fields pre-filled</strong>
    ${prefilled >= total - 2 ? ' &mdash; <span style="color:var(--ok)">Ready to generate!</span>' : ' &mdash; <span style="color:var(--warn)">Review facts before generating</span>'}
  </div>`;

  el.innerHTML = html;
  document.getElementById('intake-result').style.display = 'block';
  // Show new CTA buttons
  const wsbtn = document.getElementById('intake-goto-workspace-btn');
  if(wsbtn) wsbtn.style.display = 'inline-flex';
  const cbtn = document.getElementById('intake-goto-case-btn');
  if(cbtn) cbtn.style.display = 'inline-flex';
  // Hide the manual folder button — folder creation is now automatic
  const fbtn = document.getElementById('intake-create-folder-btn');
  if(fbtn) fbtn.style.display = 'none';
  // Auto-create the job folder immediately after intake
  setTimeout(() => createIntakeFolder(), 200);
  // Legacy compat
  const rb = document.getElementById('intake-ready-generate-btn');
  if(rb) rb.style.display = 'none';
  // Update wizard steps
  const iw2 = document.getElementById('iwStep1');
  if(iw2) { iw2.classList.remove('active-step'); iw2.classList.add('done-step'); }
  const iw3 = document.getElementById('iwStep2');
  if(iw3) iw3.classList.add('active-step');
  // Update sub text
  const sub = document.getElementById('intakeSuccessSub');
  if(sub) sub.textContent = (extracted.address||'') + (extracted.borrowerName ? ' · ' + extracted.borrowerName : '');

  // Add to recent list
  const recentEl = document.getElementById('intake-recent-list');
  const entry = document.createElement('div');
  entry.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer';
  entry.innerHTML = `<div style="color:var(--gold);font-weight:700">${extracted.address || 'Unknown address'}</div>
    <div style="color:var(--muted)">${extracted.borrowerName || ''} · ${extracted.formType || ''}</div>`;
  entry.onclick = () => intakeGotoWorkspace();
  if (recentEl.textContent === 'No recent intakes.') recentEl.textContent = '';
  recentEl.prepend(entry);
}

function intakeGotoWorkspace() {
  if (!intakeCaseId) return;
  activeCaseId = intakeCaseId;
  loadCase(intakeCaseId).then(() => showTab('workspace'));
  // Update wizard step 3
  const iw3 = document.getElementById('iwStep2');
  if(iw3) { iw3.classList.remove('active-step'); iw3.classList.add('done-step'); }
  const iw4 = document.getElementById('iwStep3');
  if(iw4) iw4.classList.add('active-step');
}

function gotoIntakeCase() {
  if (!intakeCaseId) return;
  activeCaseId = intakeCaseId;
  showTab('case');
  loadCaseList && loadCaseList();
  loadCase(intakeCaseId);
}

async function intakeReadyToGenerate() {
  if (!intakeCaseId) return;
  activeCaseId = intakeCaseId;
  await loadCase(intakeCaseId);
  showTab('generate');
}

async function createIntakeFolder() {
  if (!intakeCaseId || !intakeExtracted) return;
  const statusEl = document.getElementById('intake-folder-status');
  statusEl.textContent = 'Creating folder...';

  const body = {
    caseId: intakeCaseId,
    orderDate: new Date().toISOString().slice(0, 10),
    borrowerName: intakeExtracted.borrowerName || intakeExtracted.borrower1 || 'Unknown',
    address: intakeExtracted.address || '',
  };

  const res = await apiFetch('/intake/create-folder', { method: 'POST', body }).catch(() => null);
  if (res && res.ok) {
    statusEl.style.color = 'var(--ok)';
    statusEl.textContent = '✓ Folder created: ' + (res.folderPath || '');
  } else {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = (res && res.error) || 'Folder creation failed.';
  }
}
