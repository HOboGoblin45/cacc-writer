const WORKSPACE_STATE = {
  payload: null,
  sectionId: 'assignment',
  fieldId: null,
  dirtyFieldIds: new Set(),
  saveTimer: null,
  saving: false,
  loading: false,
  caseId: null,
  lastSavedAt: null,
};

function ws$(id) {
  return document.getElementById(id);
}

function workspaceDefinition() {
  return WORKSPACE_STATE.payload?.definition || null;
}

function workspaceEntries() {
  return WORKSPACE_STATE.payload?.entries || {};
}

function workspaceEntry(fieldId) {
  return workspaceEntries()[fieldId] || null;
}

function workspaceSection(sectionId) {
  return workspaceDefinition()?.sections?.find((section) => section.id === sectionId) || null;
}

function workspaceCurrentSection() {
  return workspaceSection(WORKSPACE_STATE.sectionId);
}

function workspaceSetSaveState(label) {
  const el = ws$('workspaceSaveState');
  if (el) el.textContent = label;
}

function workspaceSetSavedAt(timestamp) {
  WORKSPACE_STATE.lastSavedAt = timestamp || null;
  const el = ws$('workspaceSavedAt');
  if (!el) return;
  el.textContent = timestamp ? new Date(timestamp).toLocaleString() : '-';
}

function workspaceSetBanner(message, tone = 'info') {
  const el = ws$('workspaceBanner');
  if (!el) return;
  if (!message) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = message;
  if (tone === 'error') {
    el.style.borderColor = 'rgba(255,92,92,.35)';
    el.style.background = 'rgba(255,92,92,.08)';
    el.style.color = '#ffd3d3';
  } else if (tone === 'warn') {
    el.style.borderColor = 'rgba(245,200,66,.35)';
    el.style.background = 'rgba(245,200,66,.08)';
    el.style.color = 'var(--warn)';
  } else {
    el.style.borderColor = 'var(--border)';
    el.style.background = 'rgba(255,255,255,.03)';
    el.style.color = 'var(--text)';
  }
}

function workspacePreviewValue(value) {
  if (value == null || value === '') return 'No value saved.';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    const compact = value
      .slice(0, 2)
      .map((row) => Object.values(row || {}).filter(Boolean).join(' | '))
      .filter(Boolean)
      .join('\n');
    return compact || `${value.length} rows`;
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function workspaceStatusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'merged' || normalized === 'accepted') return 'ok';
  if (normalized === 'pending') return 'warn';
  if (normalized === 'rejected') return 'err';
  return '';
}

function workspaceReviewLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function workspaceEvidenceSource(candidate) {
  if (!candidate) return 'Evidence';
  return candidate.filename || candidate.docType || candidate.documentId || candidate.factPath || 'Evidence';
}

function workspaceConflictSummary(entry) {
  const conflicts = Array.isArray(entry?.conflicts) ? entry.conflicts : [];
  if (!conflicts.length) return '';
  const blocker = conflicts.find((conflict) => conflict.severity === 'blocker');
  if (blocker) return `Conflict: ${blocker.factPath}`;
  return `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`;
}

function workspaceComparableIntelligence() {
  return WORKSPACE_STATE.payload?.comparableIntelligence || null;
}

function workspaceComparableScore(value) {
  const score = Number(value || 0);
  return `${Math.round(score * 100)}%`;
}

function workspaceComparableLabelMap() {
  return {
    geographicProximity: 'Location',
    marketAreaSimilarity: 'Market area',
    recencyOfSale: 'Recency',
    propertyTypeSimilarity: 'Property type',
    designStyleSimilarity: 'Design/style',
    qualitySimilarity: 'Quality',
    conditionSimilarity: 'Condition',
    ageSimilarity: 'Age',
    glaSimilarity: 'GLA',
    siteSizeSimilarity: 'Site size',
    roomCountSimilarity: 'Room count',
    bedroomBathSimilarity: 'Beds/baths',
    basementUtilitySimilarity: 'Basement utility',
    garageSimilarity: 'Garage',
    zoningUseSimilarity: 'Zoning/use',
    externalInfluenceSimilarity: 'External influences',
    dataConfidence: 'Data confidence',
  };
}

function workspaceComparableFactorLabels(factors = []) {
  const labelMap = workspaceComparableLabelMap();
  return factors.map((factor) => labelMap[factor] || factor);
}

function workspaceComparableTierTone(tier) {
  if (tier === 'tier_1') return 'ok';
  if (tier === 'tier_2') return '';
  if (tier === 'tier_3') return 'warn';
  if (tier === 'tier_4') return 'err';
  return '';
}

function workspaceComparableRejectSelectId(candidateId) {
  return `workspaceCompRejectReason-${candidateId}`;
}

function workspaceSupportTypeLabel(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Support';
}

function workspaceAdjustmentAmountLabel(record) {
  if (record.finalAmount != null && record.decisionStatus === 'modified') {
    return `Final ${record.finalAmount > 0 ? '+' : ''}$${Math.abs(record.finalAmount).toLocaleString()}`;
  }
  if (record.suggestedAmount != null) {
    return `Suggested ${record.suggestedAmount > 0 ? '+' : ''}$${Math.abs(record.suggestedAmount).toLocaleString()}`;
  }
  if (record.supportType === 'no_adjustment_warranted') return 'No adjustment warranted';
  return 'Qualitative review';
}

function workspaceDecisionTone(status) {
  if (status === 'accepted') return 'ok';
  if (status === 'modified') return 'warn';
  if (status === 'rejected') return 'err';
  return '';
}

function workspaceStrengthTone(status) {
  if (status === 'high') return 'ok';
  if (status === 'medium') return 'warn';
  if (status === 'low') return 'err';
  return '';
}

function workspaceRenderAcceptedComparableSlots(intelligence) {
  const acceptedSlots = Array.isArray(intelligence?.acceptedSlots) ? intelligence.acceptedSlots : [];
  if (!acceptedSlots.length) {
    return (
      `<div class="workspace-assistant-section">` +
        `<h4>Adjustment Support</h4>` +
        `<div class="hint">Load a candidate into Comp 1, Comp 2, or Comp 3 to build burden metrics and adjustment support.</div>` +
      `</div>`
    );
  }

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Adjustment Support</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Library Records:</strong> ${esc(String(intelligence?.librarySummary?.scopedRecordCount || 0))}</div>` +
        `<div><strong>Current Case Contributions:</strong> ${esc(String(intelligence?.librarySummary?.approvedRecordCount || 0))}</div>` +
        `<div><strong>Comparable Flags:</strong> ${esc(String((intelligence?.contradictions || []).length))}</div>` +
      `</div>` +
      acceptedSlots.map((slot) => (
        `<div class="workspace-history-item">` +
          `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
            `<div>` +
              `<div class="workspace-history-value">${esc(slot.gridSlotLabel)}: ${esc(slot.address || 'Loaded comparable')}</div>` +
              `<div class="workspace-field-hint">${esc(slot.tierLabel || 'Accepted comparable')} | Stability ${esc(workspaceComparableScore(slot.burdenMetrics?.overallStabilityScore || 0))}</div>` +
            `</div>` +
            `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">` +
              `<span class="chip ${workspaceDecisionTone(slot.burdenMetrics?.overallStabilityScore >= 0.75 ? 'accepted' : slot.burdenMetrics?.overallStabilityScore >= 0.55 ? 'modified' : 'rejected')}">Stability ${esc(workspaceComparableScore(slot.burdenMetrics?.overallStabilityScore || 0))}</span>` +
              `<span class="chip">Gross ${esc(`${slot.burdenMetrics?.grossAdjustmentPercent || 0}%`)}</span>` +
              `<span class="chip">Net ${esc(`${slot.burdenMetrics?.netAdjustmentPercent || 0}%`)}</span>` +
            `</div>` +
          `</div>` +
          `<div class="workspace-meta-list">` +
            `<div><strong>Major mismatches:</strong> ${esc(String(slot.burdenMetrics?.majorMismatchCount || 0))}</div>` +
            `<div><strong>Data confidence:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.dataConfidenceScore || 0))}</div>` +
            `<div><strong>Date relevance:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.dateRelevanceScore || 0))}</div>` +
            `<div><strong>Location confidence:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.locationConfidenceScore || 0))}</div>` +
          `</div>` +
          ((slot.contradictions || []).length
            ? `<div class="workspace-meta-list">` +
                (slot.contradictions || []).map((flag) =>
                  `<div class="workspace-qc-item"><strong>${esc(flag.code)}</strong>: ${esc(flag.message)}</div>`
                ).join('') +
              `</div>`
            : '') +
          (slot.adjustmentSupport || []).map((record) => (
            `<div class="workspace-qc-item" style="border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 10px;background:rgba(255,255,255,.02);">` +
              `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
                `<div>` +
                  `<strong>${esc(record.label || record.adjustmentCategory)}</strong>` +
                  `<div class="workspace-field-hint">${esc(record.subjectValue || 'n/a')} vs ${esc(record.compValue || 'n/a')}</div>` +
                `</div>` +
                `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">` +
                  `<span class="chip ${workspaceStrengthTone(record.supportStrength)}">${esc(workspaceReviewLabel(record.supportStrength))}</span>` +
                  `<span class="chip ${workspaceDecisionTone(record.decisionStatus)}">${esc(workspaceReviewLabel(record.decisionStatus))}</span>` +
                `</div>` +
              `</div>` +
              `<div class="workspace-meta-list" style="margin-top:6px;">` +
                `<div><strong>Support:</strong> ${esc(workspaceSupportTypeLabel(record.supportType))}</div>` +
                `<div><strong>Adjustment:</strong> ${esc(workspaceAdjustmentAmountLabel(record))}</div>` +
                `<div><strong>Rationale:</strong> ${esc(record.rationaleNote || 'No rationale saved.')}</div>` +
                `${(record.libraryMatches || []).length ? `<div><strong>Library:</strong> ${esc(record.libraryMatches.map((match) => `${match.supportMethod} (${match.confidence})`).join('; '))}</div>` : ''}` +
              `</div>` +
              `<div class="btnrow">` +
                `<button class="sec sm" onclick="workspaceSaveAdjustmentSupportDecision('${slot.gridSlot}', '${record.adjustmentCategory}', 'accepted')">Accept</button>` +
                `<button class="sm" onclick="workspaceModifyAdjustmentSupportDecision('${slot.gridSlot}', '${record.adjustmentCategory}')">Modify</button>` +
                `<button class="ghost sm" onclick="workspaceSaveAdjustmentSupportDecision('${slot.gridSlot}', '${record.adjustmentCategory}', 'rejected')">Reject</button>` +
              `</div>` +
            `</div>`
          )).join('') +
        `</div>`
      )).join('') +
    `</div>`
  );
}

function workspaceRenderComparablePanel() {
  const intelligence = workspaceComparableIntelligence();
  if (!intelligence) {
    return (
      `<div class="workspace-assistant-section">` +
        `<h4>Comparable Recommendations</h4>` +
        `<div class="hint">Comparable intelligence has not been generated for this case yet.</div>` +
      `</div>`
    );
  }

  const summary = intelligence.summary || {};
  const subject = intelligence.subject || {};
  const subjectSummary = [
    subject.address,
    [subject.city, subject.state].filter(Boolean).join(', '),
    subject.gla ? `${subject.gla} sf` : '',
    subject.condition,
  ].filter(Boolean).join(' | ');

  const candidateCards = (intelligence.candidates || []).map((candidate) => {
    const keyMatches = workspaceComparableFactorLabels(candidate.keyMatches || []);
    const keyMismatches = workspaceComparableFactorLabels(candidate.keyMismatches || []);
    const rejectSelectId = workspaceComparableRejectSelectId(candidate.id);
    const reviewTone = workspaceStatusTone(candidate.reviewStatus);
    const tierTone = workspaceComparableTierTone(candidate.tier);
    const preview = candidate.gridPreview || {};
    const mismatchList = keyMismatches.length
      ? keyMismatches.join(', ')
      : 'No major mismatches surfaced.';
    const warningList = (candidate.warnings || []).length
      ? candidate.warnings.map((warning) => `<div class="workspace-qc-item">${esc(warning)}</div>`).join('')
      : '<div class="hint">No current ranking warnings.</div>';

    return (
      `<div class="workspace-history-item">` +
        `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
          `<div>` +
            `<div class="workspace-history-value">${esc(candidate.candidate?.address || 'Unnamed candidate')}</div>` +
            `<div class="workspace-field-hint">${esc(preview['Sale Price'] || '')}${preview['Date of Sale / Time'] ? ` | ${esc(preview['Date of Sale / Time'])}` : ''}</div>` +
          `</div>` +
          `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">` +
            `<span class="chip ${tierTone}">${esc(candidate.tierLabel || 'Tier')}</span>` +
            `<span class="chip">${esc(workspaceComparableScore(candidate.relevanceScore))}</span>` +
            `<span class="chip ${reviewTone}">${esc(workspaceReviewLabel(candidate.reviewStatus))}</span>` +
          `</div>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:8px;">` +
          `<div><strong>Source strength:</strong> ${esc(candidate.sourceStrength || 'n/a')}</div>` +
          `<div><strong>Coverage:</strong> ${esc(workspaceComparableScore(candidate.coverageScore))}</div>` +
          `<div><strong>Key matches:</strong> ${esc(keyMatches.length ? keyMatches.join(', ') : 'Limited')}</div>` +
          `<div><strong>Key mismatches:</strong> ${esc(mismatchList)}</div>` +
          `<div><strong>Prior usage:</strong> ${esc(`${candidate.priorUsage?.acceptedCount || 0} accepted / ${candidate.priorUsage?.rejectedCount || 0} rejected`)}</div>` +
        `</div>` +
        `<div style="margin-top:8px;">${warningList}</div>` +
        `<div class="btnrow">` +
          `<button class="sec sm" onclick="workspaceAcceptComparableCandidate('${candidate.id}')">Accept</button>` +
          `<button class="ghost sm" onclick="workspaceHoldComparableCandidate('${candidate.id}')">Hold</button>` +
          `<button class="sm" onclick="workspaceAcceptComparableCandidate('${candidate.id}', 'comp1')">Load Comp 1</button>` +
          `<button class="sm" onclick="workspaceAcceptComparableCandidate('${candidate.id}', 'comp2')">Load Comp 2</button>` +
          `<button class="sm" onclick="workspaceAcceptComparableCandidate('${candidate.id}', 'comp3')">Load Comp 3</button>` +
        `</div>` +
        `<div class="btnrow" style="margin-top:8px;">` +
          `<select id="${esc(rejectSelectId)}" class="workspace-select-inline">` +
            `<option value="too_distant">Too distant</option>` +
            `<option value="inferior_data_quality">Inferior data quality</option>` +
            `<option value="poor_condition_match">Poor condition match</option>` +
            `<option value="poor_design_style_match">Poor design/style match</option>` +
            `<option value="poor_market_area_match">Poor market area match</option>` +
            `<option value="poor_date_relevance">Poor date relevance</option>` +
            `<option value="atypical_sale">Atypical sale</option>` +
            `<option value="unsupported_verification">Unsupported verification</option>` +
            `<option value="other">Other</option>` +
          `</select>` +
          `<button class="ghost sm" onclick="workspaceRejectComparableCandidate('${candidate.id}')">Reject</button>` +
        `</div>` +
      `</div>`
    );
  }).join('');

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Comparable Recommendations</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Subject:</strong> ${esc(subjectSummary || 'Subject summary unavailable')}</div>` +
        `<div><strong>Candidates:</strong> ${esc(String(summary.candidateCount || 0))}</div>` +
        `<div><strong>Accepted:</strong> ${esc(String(summary.acceptedCount || 0))}</div>` +
        `<div><strong>Held:</strong> ${esc(String(summary.heldCount || 0))}</div>` +
        `<div><strong>Rejected:</strong> ${esc(String(summary.rejectedCount || 0))}</div>` +
        `<div><strong>Loaded Slots:</strong> ${esc(String(summary.acceptedSlotCount || 0))}</div>` +
        `<div><strong>Comp Flags:</strong> ${esc(String(summary.contradictionCount || 0))}</div>` +
      `</div>` +
      `${candidateCards || '<div class="hint">No candidate comparables are available yet.</div>'}` +
    `</div>`
  );
}

function workspaceFocusFirstFieldForSection(section) {
  if (!section || !section.fields?.length) {
    WORKSPACE_STATE.fieldId = null;
    return;
  }
  if (WORKSPACE_STATE.fieldId && section.fields.some((field) => field.fieldId === WORKSPACE_STATE.fieldId)) {
    return;
  }
  WORKSPACE_STATE.fieldId = section.fields[0].fieldId;
}

function workspaceReset() {
  WORKSPACE_STATE.payload = null;
  WORKSPACE_STATE.sectionId = 'assignment';
  WORKSPACE_STATE.fieldId = null;
  WORKSPACE_STATE.dirtyFieldIds.clear();
  WORKSPACE_STATE.caseId = null;
  if (WORKSPACE_STATE.saveTimer) {
    clearTimeout(WORKSPACE_STATE.saveTimer);
    WORKSPACE_STATE.saveTimer = null;
  }
  workspaceSetSaveState('Idle');
  workspaceSetSavedAt(null);
  const caseLabel = ws$('workspaceCaseLabel');
  if (caseLabel) caseLabel.textContent = 'No case selected';
  const chip = ws$('workspaceFormTypeChip');
  if (chip) chip.textContent = '1004';
  const nav = ws$('workspaceNavList');
  if (nav) nav.innerHTML = '<div class="hint">Select a 1004 case to load the section map.</div>';
  const title = ws$('workspaceSectionTitle');
  if (title) title.textContent = 'No case selected';
  const pageHint = ws$('workspaceSectionPageHint');
  if (pageHint) pageHint.textContent = 'Section';
  const description = ws$('workspaceSectionDescription');
  if (description) description.textContent = 'The section-based workspace will appear here.';
  const body = ws$('workspaceSectionContent');
  if (body) {
    body.innerHTML = '<div class="card"><div class="card-body"><div class="hint">Select a case to enter the CACC 1004 workspace.</div></div></div>';
  }
  const assistant = ws$('workspaceAssistantBody');
  if (assistant) assistant.innerHTML = '<div class="hint">Focus a field to review evidence support, apply suggestions, and restore versions.</div>';
  const assistantTitle = ws$('workspaceAssistantTitle');
  if (assistantTitle) assistantTitle.textContent = 'No field selected';
  workspaceSetBanner('');
}

async function workspaceLoad(force = false) {
  if (!STATE.caseId) {
    workspaceReset();
    return;
  }
  if (!force && WORKSPACE_STATE.payload && WORKSPACE_STATE.caseId === STATE.caseId) {
    workspaceRender();
    return;
  }

  WORKSPACE_STATE.loading = true;
  workspaceSetSaveState('Loading...');
  workspaceSetBanner('');

  const response = await apiFetch(`/api/cases/${STATE.caseId}/workspace`, { timeout: 30000 });
  WORKSPACE_STATE.loading = false;

  if (!response.ok || !response.workspace) {
    workspaceReset();
    const message = response.error || 'Workspace failed to load.';
    workspaceSetBanner(message, 'error');
    workspaceSetSaveState('Unavailable');
    return;
  }

  WORKSPACE_STATE.payload = response.workspace;
  WORKSPACE_STATE.caseId = STATE.caseId;
  WORKSPACE_STATE.sectionId = WORKSPACE_STATE.payload.definition.sections[0]?.id || 'assignment';
  WORKSPACE_STATE.fieldId = null;
  WORKSPACE_STATE.dirtyFieldIds.clear();
  workspaceSetSavedAt(response.workspace.meta?.updatedAt || STATE.meta?.updatedAt || null);
  workspaceSetSaveState('Ready');
  workspaceRender();
}

function workspaceRender() {
  const payload = WORKSPACE_STATE.payload;
  if (!payload) {
    workspaceReset();
    return;
  }

  const caseLabel = ws$('workspaceCaseLabel');
  if (caseLabel) caseLabel.textContent = STATE.meta?.address || STATE.caseId || 'Active case';
  const chip = ws$('workspaceFormTypeChip');
  if (chip) chip.textContent = payload.definition.formType.toUpperCase();

  const currentSection = workspaceCurrentSection() || payload.definition.sections[0];
  if (!currentSection) return;
  WORKSPACE_STATE.sectionId = currentSection.id;
  workspaceFocusFirstFieldForSection(currentSection);

  const nav = ws$('workspaceNavList');
  if (nav) {
    nav.innerHTML = payload.definition.sections.map((section) => {
      const active = section.id === WORKSPACE_STATE.sectionId ? ' active' : '';
      return (
        `<button class="workspace-nav-item${active}" onclick="workspaceSelectSection('${section.id}')">` +
          `<div class="workspace-nav-item-title">${esc(section.label)}</div>` +
          `<div class="workspace-nav-item-meta">${esc(section.pageHint || 'Workspace section')}</div>` +
        `</button>`
      );
    }).join('');
  }

  const title = ws$('workspaceSectionTitle');
  if (title) title.textContent = currentSection.label;
  const pageHint = ws$('workspaceSectionPageHint');
  if (pageHint) pageHint.textContent = currentSection.pageHint || 'Workspace section';
  const description = ws$('workspaceSectionDescription');
  if (description) description.textContent = currentSection.description || '';

  workspaceRenderSection(currentSection);
  workspaceRenderAssistant();
}

function workspaceRenderSection(section) {
  const wrap = ws$('workspaceSectionContent');
  if (!wrap) return;

  const parts = [];

  if (Array.isArray(section.lockedTextBlocks) && section.lockedTextBlocks.length) {
    parts.push(
      `<div class="workspace-section-card">` +
        `<div class="workspace-card-head"><h3>Locked Standard Text</h3><span class="chip">Read only</span></div>` +
        `<div class="workspace-card-body">` +
          section.lockedTextBlocks.map((block) =>
            `<div class="workspace-locked">` +
              `<div class="workspace-locked-title">${esc(block.title)}</div>` +
              `<div class="workspace-qc-item">${esc(block.body)}</div>` +
            `</div>`
          ).join('') +
        `</div>` +
      `</div>`
    );
  }

  const groups = [];
  const groupMap = new Map();
  for (const field of section.fields || []) {
    if (!groupMap.has(field.group)) {
      groupMap.set(field.group, []);
      groups.push(field.group);
    }
    groupMap.get(field.group).push(field);
  }

  for (const group of groups) {
    const fields = groupMap.get(group) || [];
    const hasGrid = fields.some((field) => field.inputType === 'grid');
    const body = fields.map((field) => workspaceRenderField(field)).join('');
    parts.push(
      `<div class="workspace-section-card">` +
        `<div class="workspace-card-head"><h3>${esc(group)}</h3>${hasGrid ? '<span class="chip">Editable grid</span>' : ''}</div>` +
        `<div class="workspace-card-body">` +
          (hasGrid ? body : `<div class="workspace-field-grid">${body}</div>`) +
        `</div>` +
      `</div>`
    );
  }

  wrap.innerHTML = parts.join('') || '<div class="card"><div class="card-body"><div class="hint">No fields configured for this section.</div></div></div>';
}

function workspaceRenderField(field) {
  const entry = workspaceEntry(field.fieldId) || { value: field.defaultValue ?? null, suggestion: null };
  if (field.inputType === 'grid') {
    return workspaceRenderGridField(field, entry);
  }

  const widthClass = field.width || 'half';
  const focusedClass = WORKSPACE_STATE.fieldId === field.fieldId ? ' is-focused' : '';
  const chips = [];
  if (entry.suggestion) chips.push('<span class="chip ok">Suggested</span>');
  if (entry.pendingReviewCount) chips.push(`<span class="chip">${esc(String(entry.pendingReviewCount))} pending</span>`);
  if (entry.hasConflict) chips.push(`<span class="chip warn">${esc(workspaceConflictSummary(entry))}</span>`);
  const helper = field.helperText ? `<div class="workspace-field-hint">${esc(field.helperText)}</div>` : '';
  let control = '';

  if (field.inputType === 'textarea') {
    control = `<textarea rows="${field.rows || 4}" data-workspace-field-id="${field.fieldId}" placeholder="${esc(field.placeholder || '')}">${esc(entry.value == null ? '' : entry.value)}</textarea>`;
  } else if (field.inputType === 'select') {
    control = `<select data-workspace-field-id="${field.fieldId}">` +
      (field.options || []).map((option) => {
        const selected = String(entry.value ?? '') === String(option.value) ? ' selected' : '';
        return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
      }).join('') +
    `</select>`;
  } else {
    control = `<input type="text" data-workspace-field-id="${field.fieldId}" value="${esc(entry.value == null ? '' : entry.value)}" placeholder="${esc(field.placeholder || '')}"/>`;
  }

  return (
    `<div class="workspace-field ${widthClass}${focusedClass}" data-field-shell="${field.fieldId}">` +
      `<div class="workspace-field-meta">` +
        `<label for="">${esc(field.label)}</label>` +
        chips.join('') +
      `</div>` +
      control +
      helper +
    `</div>`
  );
}

function workspaceRenderGridField(field, entry) {
  const rows = Array.isArray(entry.value) && entry.value.length ? entry.value : (field.defaultValue || []);
  return (
    `<div class="workspace-grid-wrap">` +
      `<table class="workspace-grid">` +
        `<thead><tr>${(field.columns || []).map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead>` +
        `<tbody>` +
          rows.map((row, rowIndex) => {
            return '<tr>' + (field.columns || []).map((column, columnIndex) => {
              const value = row && row[column.key] != null ? row[column.key] : '';
              if (column.editable === false || columnIndex === 0) {
                return `<td>${esc(value)}</td>`;
              }
              return `<td><input type="text" value="${esc(value)}" data-workspace-field-id="${field.fieldId}" data-grid-row="${rowIndex}" data-grid-col="${column.key}"/></td>`;
            }).join('') + '</tr>';
          }).join('') +
        `</tbody>` +
      `</table>` +
      (field.helperText ? `<div class="workspace-field-hint" style="padding:10px 12px;">${esc(field.helperText)}</div>` : '') +
    `</div>`
  );
}

function workspaceRenderAssistant() {
  const assistantTitle = ws$('workspaceAssistantTitle');
  const body = ws$('workspaceAssistantBody');
  const definition = workspaceDefinition();
  const field = WORKSPACE_STATE.fieldId ? definition?.fieldIndex?.[WORKSPACE_STATE.fieldId] : null;
  const currentSection = workspaceCurrentSection();
  const salesComparisonPanel = currentSection?.id === 'sales_comparison'
    ? `${workspaceRenderComparablePanel()}${workspaceRenderAcceptedComparableSlots(workspaceComparableIntelligence())}`
    : '';
  if (!assistantTitle || !body) return;

  if (!definition) {
    assistantTitle.textContent = 'No field selected';
    body.innerHTML = '<div class="hint">Focus a field to review evidence support, apply suggestions, and restore versions.</div>';
    return;
  }

  const qc = WORKSPACE_STATE.payload?.qc || {};
  if (!field) {
    assistantTitle.textContent = 'Section Summary';
    body.innerHTML =
      salesComparisonPanel +
      `<div class="workspace-assistant-section">` +
        `<h4>Quality Control</h4>` +
        `<div class="workspace-meta-list">` +
          `<div><strong>Conflicts:</strong> ${esc(String(qc.conflictCount || 0))}</div>` +
          `<div><strong>Approval Gate:</strong> ${esc(qc.approvalGate?.ok ? 'Pass' : (qc.approvalGate?.code || 'Pending'))}</div>` +
          `<div><strong>Workflow Status:</strong> ${esc(WORKSPACE_STATE.payload.meta?.workflowStatus || '-')}</div>` +
        `</div>` +
      `</div>`;
    return;
  }

  const entry = workspaceEntry(field.fieldId) || { value: null, history: [], suggestion: null };
  assistantTitle.textContent = field.label;

  const sections = [];
  if (salesComparisonPanel) sections.push(salesComparisonPanel);
  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>Current Value</h4>` +
      `<div class="workspace-history-value">${esc(workspacePreviewValue(entry.value))}</div>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Section:</strong> ${esc(field.sectionLabel || '')}</div>` +
        `<div><strong>Updated:</strong> ${esc(entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Not yet saved')}</div>` +
      `</div>` +
    `</div>`
  );

  if (entry.suggestion) {
    const provenance = entry.suggestion.provenance || {};
    const suggestionStatus = provenance.reviewStatus ? `<span class="chip ${workspaceStatusTone(provenance.reviewStatus)}">${esc(workspaceReviewLabel(provenance.reviewStatus))}</span>` : '';
    const canAcceptSuggestion = Boolean(entry.suggestion.factId && entry.suggestion.factPath);
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Suggested Value</h4>` +
        `<div class="workspace-suggestion">` +
          `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
            `<div class="workspace-suggestion-value">${esc(workspacePreviewValue(entry.suggestion.value))}</div>` +
            `${suggestionStatus}` +
          `</div>` +
          `<div class="workspace-meta-list" style="margin-top:8px;">` +
            `<div><strong>Confidence:</strong> ${esc(entry.suggestion.confidence || 'n/a')}</div>` +
            `<div><strong>Source:</strong> ${esc(entry.suggestion.source || provenance.sourceId || provenance.docType || 'evidence')}</div>` +
            `${provenance.factPath ? `<div><strong>Fact Path:</strong> ${esc(provenance.factPath)}</div>` : ''}` +
            `${provenance.page ? `<div><strong>Page:</strong> ${esc(provenance.page)}</div>` : ''}` +
            `${provenance.quote ? `<div><strong>Evidence:</strong> ${esc(provenance.quote)}</div>` : ''}` +
          `</div>` +
          `<div class="btnrow">` +
            `<button class="sm" onclick="workspaceApplySuggestion('${field.fieldId}')">Use Suggestion</button>` +
            `${canAcceptSuggestion ? `<button class="sec sm" onclick="workspaceAcceptSuggestedEvidence('${field.fieldId}')">Accept Evidence</button>` : ''}` +
          `</div>` +
        `</div>` +
      `</div>`
    );
  }

  const conflicts = Array.isArray(entry.conflicts) ? entry.conflicts : [];
  if (conflicts.length) {
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Conflict Review</h4>` +
        conflicts.map((conflict) => (
          `<div class="workspace-history-item">` +
            `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
              `<div class="workspace-qc-item"><strong>${esc(conflict.factPath)}</strong></div>` +
              `<span class="chip ${conflict.severity === 'blocker' ? 'warn' : ''}">${esc(conflict.severity || 'conflict')}</span>` +
            `</div>` +
            `<div class="workspace-meta-list">` +
              `<div><strong>Distinct values:</strong> ${esc(String(conflict.valueCount || 0))}</div>` +
              `<div><strong>Pending review:</strong> ${esc(conflict.hasPendingReview ? 'Yes' : 'No')}</div>` +
            `</div>` +
            `${(conflict.values || []).map((valueBucket) => (
              `<div class="workspace-qc-item">` +
                `<strong>${esc(valueBucket.displayValue || '')}</strong> ` +
                `<span class="chip">${esc(valueBucket.maxConfidence || 'n/a')}</span> ` +
                `<span class="chip">${esc(String(valueBucket.sourceCount || 0))} source${valueBucket.sourceCount === 1 ? '' : 's'}</span>` +
              `</div>`
            )).join('')}` +
          `</div>`
        )).join('') +
      `</div>`
    );
  }

  const candidates = Array.isArray(entry.candidates) ? entry.candidates : [];
  if (candidates.length) {
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Evidence Candidates</h4>` +
        candidates.map((candidate, index) => {
          const tone = workspaceStatusTone(candidate.reviewStatus);
          const canReject = candidate.factId && candidate.reviewStatus !== 'rejected' && candidate.reviewStatus !== 'merged';
          const canAccept = candidate.factId && candidate.reviewStatus !== 'merged';
          return (
            `<div class="workspace-history-item">` +
              `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
                `<div class="workspace-history-value">${esc(workspacePreviewValue(candidate.value))}</div>` +
                `<span class="chip ${tone}">${esc(workspaceReviewLabel(candidate.reviewStatus))}</span>` +
              `</div>` +
              `<div class="workspace-meta-list">` +
                `<div><strong>Fact Path:</strong> ${esc(candidate.factPath || '-')}</div>` +
                `<div><strong>Confidence:</strong> ${esc(candidate.confidence || 'n/a')}</div>` +
                `<div><strong>Source:</strong> ${esc(workspaceEvidenceSource(candidate))}</div>` +
                `${candidate.sourceText ? `<div><strong>Evidence:</strong> ${esc(candidate.sourceText)}</div>` : ''}` +
              `</div>` +
              `<div class="btnrow">` +
                `<button class="sm" onclick="workspaceApplyCandidate('${field.fieldId}', ${index})">Use in Field</button>` +
                `${canAccept ? `<button class="sec sm" onclick="workspaceAcceptCandidate('${field.fieldId}', ${index})">Accept</button>` : ''}` +
                `${canReject ? `<button class="ghost sm" onclick="workspaceRejectCandidate('${field.fieldId}', ${index})">Reject</button>` : ''}` +
              `</div>` +
            `</div>`
          );
        }).join('') +
      `</div>`
    );
  } else if (!entry.suggestion) {
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Evidence Candidates</h4>` +
        `<div class="hint">No extracted evidence is currently mapped to this field.</div>` +
      `</div>`
    );
  }

  const versions = Array.isArray(entry.history) ? entry.history : [];
  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>Version History</h4>` +
      (versions.length
        ? versions.map((version, index) =>
          `<div class="workspace-history-item">` +
            `<div class="workspace-meta-list">` +
              `<div><strong>Saved:</strong> ${esc(version.savedAt ? new Date(version.savedAt).toLocaleString() : '-')}</div>` +
              `<div><strong>Source:</strong> ${esc(version.source || 'workspace')}</div>` +
            `</div>` +
            `<div class="workspace-history-value">${esc(workspacePreviewValue(version.value))}</div>` +
            `<div class="btnrow"><button class="sec sm" onclick="workspaceRestoreVersion('${field.fieldId}', ${index})">Restore</button></div>` +
          `</div>`
        ).join('')
        : '<div class="hint">No previous versions saved for this field.</div>') +
    `</div>`
  );

  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>QC Snapshot</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Conflict Count:</strong> ${esc(String(qc.conflictCount || 0))}</div>` +
        `<div><strong>Approval Gate:</strong> ${esc(qc.approvalGate?.ok ? 'Pass' : (qc.approvalGate?.code || 'Pending'))}</div>` +
        `<div><strong>Field Conflicts:</strong> ${esc(String(conflicts.length || 0))}</div>` +
        `<div><strong>Pending Candidates:</strong> ${esc(String(entry.pendingReviewCount || 0))}</div>` +
        `<div><strong>Fact Review Queue:</strong> ${esc(qc.factReviewQueueSummary?.preDraftBlocked ? 'Blocked' : 'Clear')}</div>` +
        `<div><strong>Unresolved Issues:</strong> ${esc(String((WORKSPACE_STATE.payload.meta?.unresolvedIssues || []).length))}</div>` +
      `</div>` +
    `</div>`
  );

  body.innerHTML = sections.join('');
}

function workspaceSelectSection(sectionId) {
  WORKSPACE_STATE.sectionId = sectionId;
  WORKSPACE_STATE.fieldId = null;
  workspaceRender();
}

function workspaceHandleFocus(target) {
  const fieldId = target?.dataset?.workspaceFieldId;
  if (!fieldId) return;
  WORKSPACE_STATE.fieldId = fieldId;
  document.querySelectorAll('[data-field-shell]').forEach((el) => {
    el.classList.toggle('is-focused', el.getAttribute('data-field-shell') === fieldId);
  });
  workspaceRenderAssistant();
}

function workspaceUpdateEntryValue(fieldId, nextValue) {
  const entry = workspaceEntry(fieldId);
  if (!entry) return;
  entry.value = nextValue;
}

function workspaceHandleInput(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const fieldId = target.dataset.workspaceFieldId;
  if (!fieldId) return;
  const field = workspaceDefinition()?.fieldIndex?.[fieldId];
  if (!field) return;

  let nextValue;
  if (field.inputType === 'grid') {
    const current = Array.isArray(workspaceEntry(fieldId)?.value)
      ? JSON.parse(JSON.stringify(workspaceEntry(fieldId).value))
      : JSON.parse(JSON.stringify(field.defaultValue || []));
    const rowIndex = Number.parseInt(target.dataset.gridRow, 10);
    const colKey = target.dataset.gridCol;
    if (!Number.isInteger(rowIndex) || !colKey || !current[rowIndex]) return;
    current[rowIndex][colKey] = target.value;
    nextValue = current;
  } else {
    nextValue = target.value;
  }

  workspaceUpdateEntryValue(fieldId, nextValue);
  WORKSPACE_STATE.fieldId = fieldId;
  WORKSPACE_STATE.dirtyFieldIds.add(fieldId);
  workspaceSetSaveState('Unsaved');
  workspaceRenderAssistant();
  workspaceScheduleSave();
}

function workspaceCollectChanges(fieldIds) {
  return fieldIds.map((fieldId) => {
    const entry = workspaceEntry(fieldId);
    const change = {
      fieldId,
      value: entry?.value ?? null,
    };
    if (entry?._pendingProvenance) {
      change.provenance = entry._pendingProvenance;
    }
    return change;
  });
}

function workspaceScheduleSave(immediate = false) {
  if (WORKSPACE_STATE.saveTimer) clearTimeout(WORKSPACE_STATE.saveTimer);
  WORKSPACE_STATE.saveTimer = setTimeout(() => {
    workspaceFlushSave().catch((err) => {
      workspaceSetBanner(err.message || 'Autosave failed.', 'error');
      workspaceSetSaveState('Error');
    });
  }, immediate ? 20 : 900);
}

async function workspaceFlushSave() {
  if (WORKSPACE_STATE.saving || !WORKSPACE_STATE.dirtyFieldIds.size || !STATE.caseId) return;
  const fieldIds = Array.from(WORKSPACE_STATE.dirtyFieldIds);
  WORKSPACE_STATE.saving = true;
  workspaceSetSaveState('Saving...');

  const response = await apiFetch(`/api/cases/${STATE.caseId}/workspace`, {
    method: 'PUT',
    timeout: 30000,
    body: {
      changes: workspaceCollectChanges(fieldIds),
      actor: 'appraiser',
    },
  });

  WORKSPACE_STATE.saving = false;
  if (!response.ok) {
    workspaceSetBanner(response.error || 'Autosave failed.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  for (const savedEntry of response.saved || []) {
    if (!savedEntry?.fieldId) continue;
    const local = workspaceEntry(savedEntry.fieldId);
    if (!local) continue;
    Object.assign(local, savedEntry);
    delete local._pendingProvenance;
    WORKSPACE_STATE.dirtyFieldIds.delete(savedEntry.fieldId);
  }

  workspaceSetSavedAt(response.savedAt || response.meta?.updatedAt || new Date().toISOString());
  workspaceSetSaveState(WORKSPACE_STATE.dirtyFieldIds.size ? 'Unsaved' : 'Saved');
  workspaceSetBanner('');
  workspaceRenderAssistant();
}

function workspaceApplySuggestion(fieldId) {
  const entry = workspaceEntry(fieldId);
  if (!entry?.suggestion) return;
  entry.value = JSON.parse(JSON.stringify(entry.suggestion.value));
  entry._pendingProvenance = entry.suggestion.provenance || null;
  WORKSPACE_STATE.fieldId = fieldId;
  WORKSPACE_STATE.dirtyFieldIds.add(fieldId);
  workspaceSetSaveState('Unsaved');
  workspaceRender();
  workspaceScheduleSave(true);
}

function workspaceApplyCandidate(fieldId, candidateIndex) {
  const entry = workspaceEntry(fieldId);
  const candidate = Array.isArray(entry?.candidates) ? entry.candidates[candidateIndex] : null;
  if (!candidate) return;
  entry.value = JSON.parse(JSON.stringify(candidate.value));
  entry._pendingProvenance = {
    sourceType: 'extracted',
    sourceId: candidate.documentId || candidate.factId || null,
    docType: candidate.docType || null,
    quote: candidate.sourceText || '',
    confidence: candidate.confidence || null,
    factId: candidate.factId || null,
    factPath: candidate.factPath || null,
    reviewStatus: candidate.reviewStatus || null,
  };
  WORKSPACE_STATE.fieldId = fieldId;
  WORKSPACE_STATE.dirtyFieldIds.add(fieldId);
  workspaceSetSaveState('Unsaved');
  workspaceRender();
  workspaceScheduleSave(true);
}

async function workspaceAcceptSuggestedEvidence(fieldId) {
  const entry = workspaceEntry(fieldId);
  if (!entry?.suggestion?.factId || !entry?.suggestion?.factPath) return;
  const candidateIndex = (entry.candidates || []).findIndex((candidate) => candidate.factId === entry.suggestion.factId);
  if (candidateIndex >= 0) {
    await workspaceAcceptCandidate(fieldId, candidateIndex);
    return;
  }
  workspaceApplySuggestion(fieldId);
}

async function workspaceAcceptCandidate(fieldId, candidateIndex) {
  const entry = workspaceEntry(fieldId);
  const candidate = Array.isArray(entry?.candidates) ? entry.candidates[candidateIndex] : null;
  if (!candidate?.factId || !candidate.factPath || !STATE.caseId) return;

  await workspaceFlushSave();
  workspaceSetSaveState('Applying evidence...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/fact-review-queue/resolve`, {
    method: 'POST',
    timeout: 30000,
    body: {
      factPath: candidate.factPath,
      selectedValue: candidate.value,
      sourceType: 'extracted',
      sourceId: candidate.documentId || null,
      selectedFactId: candidate.factId,
      rejectOtherPending: true,
      note: `Accepted from workspace field ${fieldId}`,
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to accept evidence candidate.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner('Evidence candidate accepted into the case record.', 'info');
  await workspaceLoad(true);
}

async function workspaceRejectCandidate(fieldId, candidateIndex) {
  const entry = workspaceEntry(fieldId);
  const candidate = Array.isArray(entry?.candidates) ? entry.candidates[candidateIndex] : null;
  if (!candidate?.factId || !STATE.caseId) return;

  await workspaceFlushSave();
  workspaceSetSaveState('Updating review...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/extracted-facts/review`, {
    method: 'POST',
    timeout: 30000,
    body: {
      factId: candidate.factId,
      action: 'rejected',
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to reject evidence candidate.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner('Evidence candidate rejected.', 'info');
  await workspaceLoad(true);
}

async function workspaceAcceptComparableCandidate(candidateId, gridSlot = null) {
  if (!candidateId || !STATE.caseId) return;

  await workspaceFlushSave();
  workspaceSetSaveState(gridSlot ? 'Loading comp...' : 'Updating comp...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence/candidates/${candidateId}/accept`, {
    method: 'POST',
    timeout: 30000,
    body: {
      acceptedBy: 'appraiser',
      gridSlot,
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to accept comparable candidate.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner(
    gridSlot
      ? `Comparable loaded into ${gridSlot.toUpperCase()}.`
      : 'Comparable candidate accepted.',
    'info',
  );
  await workspaceLoad(true);
}

async function workspaceHoldComparableCandidate(candidateId) {
  if (!candidateId || !STATE.caseId) return;

  await workspaceFlushSave();
  workspaceSetSaveState('Updating comp...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence/candidates/${candidateId}/hold`, {
    method: 'POST',
    timeout: 30000,
    body: {
      actor: 'appraiser',
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to hold comparable candidate.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner('Comparable candidate marked as held.', 'info');
  await workspaceLoad(true);
}

async function workspaceRejectComparableCandidate(candidateId) {
  if (!candidateId || !STATE.caseId) return;

  const select = document.getElementById(workspaceComparableRejectSelectId(candidateId));
  const reasonCode = select?.value || 'other';

  await workspaceFlushSave();
  workspaceSetSaveState('Updating comp...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence/candidates/${candidateId}/reject`, {
    method: 'POST',
    timeout: 30000,
    body: {
      rejectedBy: 'appraiser',
      reasonCode,
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to reject comparable candidate.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner('Comparable candidate rejected.', 'info');
  await workspaceLoad(true);
}

async function workspaceSaveAdjustmentSupportDecision(gridSlot, adjustmentCategory, decisionStatus, options = {}) {
  if (!gridSlot || !adjustmentCategory || !STATE.caseId) return;

  await workspaceFlushSave();
  workspaceSetSaveState('Saving support...');
  const response = await apiFetch(`/api/cases/${STATE.caseId}/comparable-intelligence/adjustment-support/${gridSlot}/${adjustmentCategory}`, {
    method: 'POST',
    timeout: 30000,
    body: {
      decisionStatus,
      rationaleNote: options.rationaleNote || '',
      finalAmount: options.finalAmount ?? null,
      finalRange: options.finalRange ?? undefined,
      supportType: options.supportType || undefined,
    },
  });

  if (!response.ok) {
    workspaceSetBanner(response.error || 'Failed to save adjustment support decision.', 'error');
    workspaceSetSaveState('Error');
    return;
  }

  workspaceSetBanner('Adjustment support decision saved.', 'info');
  await workspaceLoad(true);
}

async function workspaceModifyAdjustmentSupportDecision(gridSlot, adjustmentCategory) {
  const intelligence = workspaceComparableIntelligence();
  const slot = (intelligence?.acceptedSlots || []).find((entry) => entry.gridSlot === gridSlot);
  const record = (slot?.adjustmentSupport || []).find((entry) => entry.adjustmentCategory === adjustmentCategory);
  if (!record) return;

  const amountInput = window.prompt(
    `Final adjustment amount for ${record.label || adjustmentCategory} (${gridSlot.toUpperCase()}). Leave blank to keep qualitative support.`,
    record.finalAmount ?? record.suggestedAmount ?? '',
  );
  if (amountInput == null) return;

  const noteInput = window.prompt(
    `Rationale note for ${record.label || adjustmentCategory}:`,
    record.rationaleNote || '',
  );
  if (noteInput == null) return;

  const parsedAmount = String(amountInput).trim() === '' ? null : Number(String(amountInput).replace(/[^0-9.\-]/g, ''));
  await workspaceSaveAdjustmentSupportDecision(gridSlot, adjustmentCategory, 'modified', {
    finalAmount: Number.isFinite(parsedAmount) ? parsedAmount : null,
    rationaleNote: noteInput,
    supportType: 'appraiser_judgment_with_explanation',
  });
}

function workspaceRestoreVersion(fieldId, historyIndex) {
  const entry = workspaceEntry(fieldId);
  const version = Array.isArray(entry?.history) ? entry.history[historyIndex] : null;
  if (!version) return;
  entry.value = JSON.parse(JSON.stringify(version.value));
  delete entry._pendingProvenance;
  WORKSPACE_STATE.fieldId = fieldId;
  WORKSPACE_STATE.dirtyFieldIds.add(fieldId);
  workspaceSetSaveState('Unsaved');
  workspaceRender();
  workspaceScheduleSave(true);
}

function workspaceForceSave() {
  workspaceScheduleSave(true);
}

function workspaceReload() {
  workspaceLoad(true);
}

function workspaceOnCaseLoaded() {
  const tab = ws$('tab-workspace');
  const caseLabel = ws$('workspaceCaseLabel');
  if (caseLabel) caseLabel.textContent = STATE.meta?.address || STATE.caseId || 'Active case';
  if (!tab || !tab.classList.contains('active')) return;
  workspaceLoad(true);
}

function workspaceOnTabOpen() {
  if (!STATE.caseId) {
    workspaceReset();
    workspaceSetBanner('Select a case to enter the CACC 1004 workspace.', 'warn');
    return;
  }
  if (String(STATE.formType || '').toLowerCase() !== '1004') {
    workspaceReset();
    workspaceSetBanner(`Workspace UI is currently implemented for 1004 cases. Active form: ${STATE.formType || 'unknown'}.`, 'warn');
    return;
  }
  workspaceLoad();
}

const workspaceRoot = ws$('tab-workspace');
if (workspaceRoot) {
  const sectionContent = ws$('workspaceSectionContent');
  if (sectionContent) {
    sectionContent.addEventListener('input', workspaceHandleInput);
    sectionContent.addEventListener('change', workspaceHandleInput);
    sectionContent.addEventListener('focusin', (event) => workspaceHandleFocus(event.target));
  }
}
