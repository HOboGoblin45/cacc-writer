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
async function apiFetch(path, opts={}) {
  const timeout=opts.timeout??120000, ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),timeout);
  try {
    const r=await fetch(server()+path,{headers:{'Content-Type':'application/json'},...opts,signal:ctrl.signal,body:opts.body?(typeof opts.body==='string'?opts.body:JSON.stringify(opts.body)):undefined});
    const text=await r.text();
    try{return JSON.parse(text);}catch{return{ok:false,error:'Non-JSON: '+text.slice(0,300)};}
  } catch(e) {
    if(e.name==='AbortError')return{ok:false,error:'Request timed out after '+(timeout/1000)+'s'};
    throw e;
  } finally { clearTimeout(timer); }
}

// ====== TABS ======
function showTab(name) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>{if(t.getAttribute('onclick')&&t.getAttribute('onclick').includes("'"+name+"'"))t.classList.add('active');});
  if(name==='workspace' && typeof workspaceOnTabOpen==='function')workspaceOnTabOpen();
  if(name==='facts')loadNeighborhoodTemplates();
  if(name==='voice')loadVoiceExamples();
  if(name==='docs')loadDocsTab();
  if(name==='memory')memLoadAll();
  if(name==='qc')qcOnTabOpen();
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
  const filtered=_caseFilter==='all'?cases:cases.filter(cs=>(cs.status||'active')===_caseFilter);
  const list=$('caseList');
  if(!filtered.length){list.innerHTML='<div class="hint">No '+(_caseFilter==='all'?'':''+_caseFilter+' ')+'cases.</div>';return;}
  list.innerHTML=filtered.map(cs=>{
    const st=cs.status||'active', active=STATE.caseId===cs.caseId?' active':'';
    const cid=JSON.stringify(cs.caseId||''), sid=JSON.stringify(st);
    // Deferred form types get a distinct badge style
    const isDeferred = isDeferredFormId(cs.formType||'');
    const formLabel=cs.formType?` <span class="form-badge${isDeferred?' deferred':''}">${esc(cs.formType.toUpperCase())}${isDeferred?' ⚠':''}</span>`:'';
    // ── Assignment metadata chips in case list ────────────────────────────
    const purposeChip=cs.assignmentPurpose?`<span class="meta-chip purpose">${esc(cs.assignmentPurpose)}</span>`:'';
    const loanChip=cs.loanProgram?`<span class="meta-chip loan">${esc(cs.loanProgram)}</span>`:'';
    const condChip=cs.subjectCondition?`<span class="meta-chip cond-rating">${esc(cs.subjectCondition)}</span>`:'';
    const geoChip=(cs.city||cs.county)?`<span class="meta-chip geo">${esc([cs.city,cs.county].filter(Boolean).join(', '))}</span>`:'';
    const issuesChip=Array.isArray(cs.unresolvedIssues)&&cs.unresolvedIssues.length
      ?`<span class="meta-chip status">Issues: ${cs.unresolvedIssues.length}</span>`:'';
    const chips=[purposeChip,loanChip,condChip,geoChip,issuesChip].filter(Boolean).join('');
    return '<div class="case-item'+active+'" onclick="loadCase('+cid+')">'
      +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
      +'<span style="flex:1;font-size:12px;font-weight:600;">'+esc(cs.address||cs.caseId)+'</span>'
      +formLabel
      +'<span class="case-status cs-'+st+'" onclick="event.stopPropagation();cycleStatus('+cid+','+sid+',this)">'+st.charAt(0).toUpperCase()+st.slice(1)+'</span>'
      +'<button class="ghost sm" style="font-size:10px;padding:2px 6px;color:var(--danger);border-color:rgba(255,92,92,.2);" onclick="event.stopPropagation();deleteCase('+cid+',this)">&times;</button></div>'
    +(cs.borrower?'<div style="font-size:11px;color:var(--muted);">'+esc(cs.borrower)+'</div>':'')
    +(chips?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">'+chips+'</div>':'')
    +'<div style="font-size:10px;color:var(--muted);margin-top:3px;">'+cs.caseId+' &bull; '+new Date(cs.updatedAt).toLocaleDateString()+'</div>'
      +'</div>';
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
let _agentStatus = { aci: false, rq: false };

async function checkAgentStatus() {
  try {
    const d = await apiFetch('/api/agents/status', { timeout: 5000 });
    if (!d.ok) return;
    _agentStatus.aci = !!d.aci;
    _agentStatus.rq  = !!d.rq;
    updateAgentBadge('aci', _agentStatus.aci);
    updateAgentBadge('rq',  _agentStatus.rq);
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
