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
  dragComparableCandidateId: null,
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
    el.style.borderColor = 'rgba(220,38,38,.35)';
    el.style.background = 'rgba(220,38,38,.08)';
    el.style.color = '#ffd3d3';
  } else if (tone === 'warn') {
    el.style.borderColor = 'rgba(217,119,6,.35)';
    el.style.background = 'rgba(217,119,6,.08)';
    el.style.color = 'var(--warn)';
  } else {
    el.style.borderColor = 'var(--border)';
    el.style.background = 'var(--bg-secondary)';
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

function workspaceContradictionGraph() {
  return WORKSPACE_STATE.payload?.contradictionGraph || null;
}

function workspaceInsertionReliability() {
  return WORKSPACE_STATE.payload?.insertionReliability || null;
}

function workspaceSectionPolicySummary() {
  return WORKSPACE_STATE.payload?.sectionPolicySummary || {};
}

function workspaceSectionFreshnessSummary() {
  return WORKSPACE_STATE.payload?.sectionFreshnessSummary || { total: 0, current: 0, stale: 0, notGenerated: 0 };
}

function workspaceSectionContradictions(sectionId) {
  const items = Array.isArray(workspaceContradictionGraph()?.items)
    ? workspaceContradictionGraph().items
    : [];
  if (!sectionId) return items;
  return items.filter((item) => Array.isArray(item.sectionIds) && item.sectionIds.includes(sectionId));
}

function workspaceFreshnessBadge(status) {
  const labels = {
    current: ['Current', 'ok'],
    stale_due_to_fact_change: ['Stale: Facts Changed', 'warn'],
    stale_due_to_dependency_change: ['Stale: Dependency Changed', 'warn'],
    stale_due_to_prompt_change: ['Stale: Prompt Updated', 'warn'],
    not_generated: ['Not Generated', ''],
  };
  const [label, cls] = labels[status] || [status || 'Unknown', ''];
  return `<span class="chip ${cls}" style="font-size:0.75em;padding:2px 6px;">${esc(label)}</span>`;
}

function workspaceQualityBar(score) {
  if (score === null || score === undefined) return '';
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'var(--ok)' : pct >= 40 ? 'var(--warn)' : 'var(--err,#e74c3c)';
  return (
    `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">` +
      `<div style="flex:1;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">` +
        `<div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>` +
      `</div>` +
      `<span style="font-size:0.8em;font-weight:bold;color:${color};">${pct}/100</span>` +
    `</div>`
  );
}

function workspaceApprovalGateChip(gate) {
  if (!gate) return '<span class="chip" style="font-size:0.75em;padding:2px 6px;">Pending</span>';
  if (gate.ok) return '<span class="chip ok" style="font-size:0.75em;padding:2px 6px;">Pass</span>';
  const codeLabels = {
    CASE_ID_REQUIRED: 'No Case',
    QC_REQUIRED_BEFORE_APPROVAL: 'QC Required',
    QC_IN_PROGRESS: 'QC Running',
    QC_LAST_RUN_NOT_COMPLETE: 'QC Incomplete',
    QC_STALE_FOR_CURRENT_DRAFT: 'QC Stale',
    QC_BLOCKERS_OPEN: 'QC Blockers',
    QC_NOT_READY: 'Not Ready',
    SECTIONS_STALE: 'Stale Sections',
    SECTIONS_LOW_QUALITY: 'Low Quality',
    CONTRADICTIONS_UNRESOLVED: 'Contradictions',
  };
  const label = codeLabels[gate.code] || gate.code || 'Blocked';
  return `<span class="chip warn" style="font-size:0.75em;padding:2px 6px;">${esc(label)}</span>`;
}

function workspaceRenderFreshnessSummaryPanel() {
  const fs = workspaceSectionFreshnessSummary();
  if (!fs.total && !fs.stale) return '';
  const staleColor = fs.stale > 0 ? 'var(--warn)' : 'var(--ok)';
  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Section Freshness</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Generated Sections:</strong> ${esc(String(fs.total || 0))}</div>` +
        `<div><strong>Current:</strong> <span style="color:var(--ok)">${esc(String(fs.current || 0))}</span></div>` +
        `<div><strong>Stale:</strong> <span style="color:${staleColor}">${esc(String(fs.stale || 0))}</span></div>` +
        `<div><strong>Not Generated:</strong> ${esc(String(fs.notGenerated || 0))}</div>` +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderSectionAuditPanel(sectionId) {
  const summary = workspaceSectionPolicySummary();
  const audit = summary[sectionId];
  if (!audit) return '';

  const blockerChip = audit.hasBlockers
    ? '<span class="chip warn">Blockers</span>'
    : '<span class="chip ok">Ready</span>';
  const missingRequired = audit.missingRequiredCount || 0;
  const missingRecommended = audit.missingRecommendedCount || 0;

  let factStatus = '';
  if (missingRequired > 0) {
    factStatus += `<div><strong>Missing Required:</strong> <span style="color:var(--warn)">${esc(String(missingRequired))} fact${missingRequired === 1 ? '' : 's'}</span></div>`;
  }
  if (missingRecommended > 0) {
    factStatus += `<div><strong>Missing Recommended:</strong> ${esc(String(missingRecommended))} fact${missingRecommended === 1 ? '' : 's'}</div>`;
  }
  if (missingRequired === 0 && missingRecommended === 0) {
    factStatus = '<div style="color:var(--ok)">All required and recommended facts available</div>';
  }

  // Freshness + quality section
  let freshnessBlock = '';
  const fs = audit.freshnessStatus;
  if (fs) {
    freshnessBlock += `<div style="margin-top:8px;"><strong>Freshness:</strong> ${workspaceFreshnessBadge(fs)}</div>`;
    if (audit.staleReasons && audit.staleReasons.length > 0) {
      freshnessBlock += `<div style="font-size:0.8em;opacity:0.8;margin-top:2px;">${esc(audit.staleReasons.join('; '))}</div>`;
    }
    if (audit.changedPaths && audit.changedPaths.length > 0) {
      freshnessBlock += `<div style="font-size:0.75em;opacity:0.6;margin-top:2px;">Changed: ${esc(audit.changedPaths.slice(0, 5).join(', '))}${audit.changedPaths.length > 5 ? ` +${audit.changedPaths.length - 5} more` : ''}</div>`;
    }
  }

  let qualityBlock = '';
  if (audit.qualityScore !== null && audit.qualityScore !== undefined) {
    qualityBlock = `<div style="margin-top:8px;"><strong>Quality Score:</strong>${workspaceQualityBar(audit.qualityScore)}</div>`;
  }

  let generationBlock = '';
  if (audit.generatedAt) {
    generationBlock += `<div><strong>Generated:</strong> ${esc(new Date(audit.generatedAt).toLocaleString())}</div>`;
  }
  if (audit.regenerationCount > 0) {
    generationBlock += `<div><strong>Regenerations:</strong> ${esc(String(audit.regenerationCount))}</div>`;
  }

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Section Governance</h4>` +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">` +
        `<span style="font-size:0.85em;opacity:0.7">${esc(audit.profileId || 'default')}</span>` +
        `${blockerChip}` +
      `</div>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Prompt Version:</strong> ${esc(audit.promptVersion || '-')}</div>` +
        factStatus +
        freshnessBlock +
        qualityBlock +
        generationBlock +
      `</div>` +
      `<div style="margin-top:8px;">` +
        `<button class="sec sm" onclick="workspaceLoadSectionAudit('${esc(sectionId)}')">View Full Audit</button>` +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderContradictionGraphPanel(sectionId, limit = 5) {
  const graph = workspaceContradictionGraph();
  if (!graph?.summary?.totalContradictions) {
    return (
      `<div class="workspace-assistant-section">` +
        `<h4>Contradiction Graph</h4>` +
        `<div class="hint">No case-level contradictions are currently flagged.</div>` +
      `</div>`
    );
  }

  const items = workspaceSectionContradictions(sectionId);
  const visibleItems = (items.length ? items : (graph.items || [])).slice(0, limit);
  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Contradiction Graph</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Total:</strong> ${esc(String(graph.summary.totalContradictions || 0))}</div>` +
        `<div><strong>High/Blocker:</strong> ${esc(String((graph.summary.highCount || 0) + (graph.summary.blockerCount || 0)))}</div>` +
        `<div><strong>Comparable:</strong> ${esc(String(graph.summary.sourceCounts?.comparable_intelligence || 0))}</div>` +
      `</div>` +
      (graph.resolutionSummary
        ? `<div class="workspace-meta-list" style="margin-top:6px;">` +
            `<div><strong>Resolved:</strong> ${esc(String(graph.resolutionSummary.resolved || 0))}</div>` +
            `<div><strong>Dismissed:</strong> ${esc(String(graph.resolutionSummary.dismissed || 0))}</div>` +
            `<div><strong>Open:</strong> ${esc(String(graph.resolutionSummary.open || 0))}</div>` +
            `<div><strong>Completion:</strong> ${esc(String(graph.resolutionSummary.completionPercent || 0))}%</div>` +
          `</div>`
        : '') +
      (visibleItems.length
        ? visibleItems.map((item) => {
          const resolution = item.resolution || {};
          const resStatus = resolution.status || 'open';
          const isOpen = resStatus === 'open';
          const resChipTone = resStatus === 'resolved' ? 'ok' : resStatus === 'dismissed' ? '' : resStatus === 'acknowledged' ? 'warn' : '';
          const resLabel = resStatus.charAt(0).toUpperCase() + resStatus.slice(1);
          const itemId = item.id || '';
          const actionButtons = isOpen
            ? `<div class="btnrow" style="margin-top:6px;">` +
                `<button class="sm" onclick="workspaceResolveContradiction('${esc(itemId)}')">Resolve</button>` +
                `<button class="sec sm" onclick="workspaceDismissContradiction('${esc(itemId)}')">Dismiss</button>` +
                `<button class="ghost sm" onclick="workspaceAcknowledgeContradiction('${esc(itemId)}')">Acknowledge</button>` +
              `</div>`
            : `<div class="btnrow" style="margin-top:6px;">` +
                `<button class="ghost sm" onclick="workspaceReopenContradiction('${esc(itemId)}')">Reopen</button>` +
              `</div>`;

          return (
            `<div class="workspace-history-item">` +
              `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
                `<div class="workspace-qc-item"><strong>${esc(item.categoryLabel || item.category || 'Conflict')}</strong></div>` +
                `<div style="display:flex;gap:4px;">` +
                  `<span class="chip ${resChipTone}" style="font-size:0.7em;">${esc(resLabel)}</span>` +
                  `<span class="chip ${item.severity === 'blocker' || item.severity === 'high' ? 'warn' : ''}">${esc(item.severity || 'medium')}</span>` +
                `</div>` +
              `</div>` +
              `<div class="workspace-history-value">${esc(item.message || '')}</div>` +
              `${item.factPaths?.length ? `<div class="workspace-meta-list"><div><strong>Paths:</strong> ${esc(item.factPaths.join(', '))}</div></div>` : ''}` +
              `${resolution.actor ? `<div class="workspace-meta-list"><div><strong>By:</strong> ${esc(resolution.actor)}${resolution.resolvedAt || resolution.dismissedAt || resolution.acknowledgedAt ? ` at ${esc(new Date(resolution.resolvedAt || resolution.dismissedAt || resolution.acknowledgedAt).toLocaleString())}` : ''}</div></div>` : ''}` +
              actionButtons +
            `</div>`
          );
        }).join('')
        : '<div class="hint">No contradictions are scoped to this section.</div>') +
    `</div>`
  );
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

function workspaceRenderComparableScoreBreakdown(candidate) {
  const breakdown = candidate.weightedBreakdown || {};
  const entries = Object.entries(breakdown);
  if (!entries.length) return '';
  const labelMap = workspaceComparableLabelMap();
  const rows = entries
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 8)
    .map(([factor, score]) => {
      const pct = Math.round((score || 0) * 100);
      const barWidth = Math.min(pct, 100);
      const tone = pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'rgba(220,38,38,.6)';
      return (
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">` +
          `<span style="width:100px;font-size:0.75em;opacity:0.8;flex-shrink:0;">${esc(labelMap[factor] || factor)}</span>` +
          `<div style="flex:1;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">` +
            `<div style="width:${barWidth}%;height:100%;background:${tone};border-radius:3px;"></div>` +
          `</div>` +
          `<span style="width:32px;font-size:0.7em;opacity:0.6;text-align:right;">${pct}%</span>` +
        `</div>`
      );
    }).join('');
  return (
    `<details style="margin-top:8px;">` +
      `<summary style="cursor:pointer;font-size:0.8em;opacity:0.7;">Score Breakdown</summary>` +
      `<div style="margin-top:6px;">${rows}</div>` +
    `</details>`
  );
}

function workspaceRenderComparableGridPreview(preview) {
  const entries = Object.entries(preview || {});
  if (!entries.length) return '';
  const rows = entries.map(([label, value]) => (
    `<div style="display:flex;justify-content:space-between;gap:8px;font-size:0.75em;">` +
      `<span style="opacity:0.7;">${esc(label)}</span>` +
      `<span>${esc(String(value || '-'))}</span>` +
    `</div>`
  )).join('');
  return (
    `<details style="margin-top:6px;">` +
      `<summary style="cursor:pointer;font-size:0.8em;opacity:0.7;">Grid Preview</summary>` +
      `<div style="margin-top:4px;">${rows}</div>` +
    `</details>`
  );
}

function workspaceComparableTierTone(tier) {
  if (tier === 'tier_1') return 'ok';
  if (tier === 'tier_2') return '';
  if (tier === 'tier_3') return 'warn';
  if (tier === 'tier_4') return 'err';
  return '';
}

function workspaceInsertionStatusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'verified') return 'ok';
  if (normalized === 'partial' || normalized === 'queued' || normalized === 'running') return 'warn';
  if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'mismatch') return 'err';
  return '';
}

function workspaceRetryClassLabel(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

function workspaceRenderInsertionReliabilityPanel(sectionId, options = {}) {
  const reliability = workspaceInsertionReliability();
  const latestRun = reliability?.latestRun || null;
  const recentRuns = Array.isArray(reliability?.recentRuns) ? reliability.recentRuns : [];
  const detailed = Boolean(options.detailed);
  const previewLimit = Number.isInteger(options.previewLimit) ? options.previewLimit : 3;

  if (!latestRun) {
    return (
      `<div class="workspace-assistant-section">` +
        `<h4>Insertion Reliability</h4>` +
        `<div class="hint">No insertion runs are recorded for this case yet.</div>` +
      `</div>`
    );
  }

  const previewItems = Array.isArray(latestRun.replayPreview)
    ? latestRun.replayPreview.slice(0, previewLimit)
    : [];
  const actionable = latestRun.failedFields > 0 || latestRun.issueFieldCount > 0 || latestRun.rollbackFields > 0;
  const showRecentRuns = detailed || sectionId === 'qc_review';

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Insertion Reliability</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Latest Run:</strong> ${esc(latestRun.id)}</div>` +
        `<div><strong>Target:</strong> ${esc(latestRun.targetSoftware || latestRun.formType || 'Unknown')}</div>` +
        `<div><strong>Status:</strong> <span class="chip ${workspaceInsertionStatusTone(latestRun.status)}">${esc(workspaceReviewLabel(latestRun.status))}</span></div>` +
        `<div><strong>Readiness:</strong> ${esc(latestRun.readinessSignal || 'n/a')}</div>` +
        `<div><strong>QC Gate:</strong> ${esc(latestRun.qcGatePassed ? 'Pass' : `Blocked (${latestRun.qcBlockerCount || 0})`)}</div>` +
        `<div><strong>Fields:</strong> ${esc(`${latestRun.completedFields || 0}/${latestRun.totalFields || 0} inserted`)}</div>` +
        `<div><strong>Verified:</strong> ${esc(String(latestRun.verifiedFields || 0))}</div>` +
        `<div><strong>Failed:</strong> ${esc(String(latestRun.failedFields || 0))}</div>` +
        `<div><strong>Rollbacks:</strong> ${esc(String(latestRun.rollbackFields || 0))}</div>` +
        `<div><strong>Replay Items:</strong> ${esc(String(latestRun.issueFieldCount || 0))}</div>` +
        `<div><strong>Started:</strong> ${esc(latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : (latestRun.createdAt ? new Date(latestRun.createdAt).toLocaleString() : '-'))}</div>` +
      `</div>` +
      (actionable
        ? (
          previewItems.length
            ? previewItems.map((item) => (
              `<div class="workspace-history-item">` +
                `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
                  `<div class="workspace-qc-item"><strong>${esc(item.fieldId || item.destinationKey || 'Field')}</strong></div>` +
                  `<span class="chip ${workspaceInsertionStatusTone(item.status || item.verificationStatus)}">${esc(workspaceReviewLabel(item.status || item.verificationStatus || 'issue'))}</span>` +
                `</div>` +
                `<div class="workspace-meta-list">` +
                  `${item.destinationKey ? `<div><strong>Destination:</strong> ${esc(item.destinationKey)}</div>` : ''}` +
                  `${item.retryClass ? `<div><strong>Retry Class:</strong> ${esc(workspaceRetryClassLabel(item.retryClass))}</div>` : ''}` +
                  `${item.rollbackStatus ? `<div><strong>Rollback:</strong> ${esc(workspaceReviewLabel(item.rollbackStatus))}</div>` : ''}` +
                  `${item.errorCode ? `<div><strong>Error:</strong> ${esc(item.errorCode)}</div>` : ''}` +
                  `${item.errorText ? `<div><strong>Detail:</strong> ${esc(item.errorText)}</div>` : ''}` +
                `</div>` +
              `</div>`
            )).join('')
            : '<div class="hint">Replay package is recorded for this run, but no preview items were included in the workspace payload.</div>'
        )
        : '<div class="hint">Latest insertion run completed without replayable issues.</div>') +
      (showRecentRuns && recentRuns.length > 1
        ? (
          `<div class="workspace-history-item">` +
            `<div class="workspace-field-hint">Recent runs</div>` +
            recentRuns.slice(1, 5).map((run) => (
              `<div class="workspace-meta-list" style="padding:6px 0;border-top:1px solid var(--border);">` +
                `<div><strong>${esc(run.id)}</strong></div>` +
                `<div>${esc(run.targetSoftware || run.formType || 'Unknown')}</div>` +
                `<div><span class="chip ${workspaceInsertionStatusTone(run.status)}">${esc(workspaceReviewLabel(run.status))}</span></div>` +
                `<div>${esc(`${run.failedFields || 0} failed / ${run.rollbackFields || 0} rollback`)}</div>` +
              `</div>`
            )).join('') +
          `</div>`
        )
        : '') +
    `</div>`
  );
}

function workspaceComparableRejectSelectId(candidateId) {
  return `workspaceCompRejectReason-${candidateId}`;
}

function workspaceGridSlotLabel(gridSlot) {
  const match = String(gridSlot || '').match(/^comp(\d)$/i);
  return match ? `Comp ${match[1]}` : String(gridSlot || 'Comp');
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

function workspaceWeightTone(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized === 'primary') return 'ok';
  if (normalized === 'secondary') return 'warn';
  if (normalized === 'context') return 'err';
  return '';
}

function workspaceCurrency(value) {
  if (value == null || value === '') return 'n/a';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'n/a';
  const rounded = Math.round(amount);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString()}`;
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
              `<span class="chip ${workspaceWeightTone(slot.valuationMetrics?.suggestedWeightLabel)}">${esc(slot.valuationMetrics?.suggestedWeightLabel || 'Context')}</span>` +
            `</div>` +
          `</div>` +
          `<div class="workspace-meta-list">` +
            `<div><strong>Adjusted sale price:</strong> ${esc(workspaceCurrency(slot.valuationMetrics?.adjustedSalePrice))}</div>` +
            `<div><strong>Net adjustment:</strong> ${esc(workspaceCurrency(slot.valuationMetrics?.netAdjustmentAmount))}</div>` +
            `<div><strong>Major mismatches:</strong> ${esc(String(slot.burdenMetrics?.majorMismatchCount || 0))}</div>` +
            `<div><strong>Data confidence:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.dataConfidenceScore || 0))}</div>` +
            `<div><strong>Date relevance:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.dateRelevanceScore || 0))}</div>` +
            `<div><strong>Location confidence:</strong> ${esc(workspaceComparableScore(slot.burdenMetrics?.locationConfidenceScore || 0))}</div>` +
            `<div><strong>Weight score:</strong> ${esc(workspaceComparableScore(slot.valuationMetrics?.suggestedWeightScore || 0))}</div>` +
          `</div>` +
          ((slot.valuationMetrics?.weightReasoning || []).length
            ? `<div class="workspace-meta-list">` +
                (slot.valuationMetrics.weightReasoning || []).map((reason) =>
                  `<div class="workspace-qc-item">${esc(reason)}</div>`
                ).join('') +
              `</div>`
            : '') +
          ((slot.contradictions || []).length
            ? `<div class="workspace-meta-list">` +
                (slot.contradictions || []).map((flag) =>
                  `<div class="workspace-qc-item"><strong>${esc(flag.code)}</strong>: ${esc(flag.message)}</div>`
                ).join('') +
              `</div>`
            : '') +
          (slot.adjustmentSupport || []).map((record) => (
            `<div class="workspace-qc-item" style="border:1px solid var(--bg-tertiary);border-radius:8px;padding:8px 10px;background:var(--bg-secondary);">` +
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

// ── Valuation Calculator Panel ────────────────────────────────────────────────

const VALUATION_STATE = {
  lastResult: null,
  incomeResult: null,
  costResult: null,
  reconciliationResult: null,
};

function workspaceRenderValuationCalculatorPanel() {
  const intelligence = workspaceComparableIntelligence();
  const acceptedSlots = Array.isArray(intelligence?.acceptedSlots) ? intelligence.acceptedSlots : [];

  // Build comp summary from accepted slots
  const compRows = acceptedSlots.map((slot, i) => {
    const adjPrice = slot.valuationMetrics?.adjustedSalePrice;
    const netAdj = slot.valuationMetrics?.netAdjustmentAmount;
    const grossPct = slot.burdenMetrics?.grossAdjustmentPercent || 0;
    const netPct = slot.burdenMetrics?.netAdjustmentPercent || 0;
    const weightLabel = slot.valuationMetrics?.suggestedWeightLabel || 'Context';
    return (
      `<div class="workspace-history-item" style="padding:6px 8px;">` +
        `<div style="display:flex;justify-content:space-between;gap:8px;">` +
          `<div>` +
            `<strong>${esc(slot.gridSlotLabel || `Comp ${i + 1}`)}</strong>` +
            `<div class="workspace-field-hint">${esc(slot.address || 'Loaded comparable')}</div>` +
          `</div>` +
          `<div style="text-align:right;">` +
            `<div>${adjPrice != null ? esc(workspaceCurrency(adjPrice)) : 'n/a'}</div>` +
            `<div class="workspace-field-hint">Net ${esc(String(netPct))}% | Gross ${esc(String(grossPct))}%</div>` +
          `</div>` +
        `</div>` +
      `</div>`
    );
  }).join('');

  // Show last calculation result if available
  let resultHtml = '';
  if (VALUATION_STATE.lastResult) {
    const r = VALUATION_STATE.lastResult;
    resultHtml = (
      `<div style="margin-top:10px;padding:8px;border:1px solid var(--ok);border-radius:8px;background:rgba(0,200,100,.05);">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<strong>Sales Comparison Indication</strong>` +
          `<span style="font-size:1.1em;color:var(--ok)">${esc(workspaceCurrency(r.indication?.indicatedValue))}</span>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:6px;">` +
          `<div><strong>Method:</strong> ${esc(r.indication?.method || '-')}</div>` +
          `<div><strong>Comp Count:</strong> ${esc(String(r.burden?.compCount || 0))}</div>` +
          `<div><strong>Adjusted Range:</strong> ${esc(workspaceCurrency(r.burden?.adjustedPriceRange?.low))} - ${esc(workspaceCurrency(r.burden?.adjustedPriceRange?.high))}</div>` +
          `<div><strong>Avg Net %:</strong> ${esc(String(r.burden?.averageNetPercent || 0))}%</div>` +
          `<div><strong>Avg Gross %:</strong> ${esc(String(r.burden?.averageGrossPercent || 0))}%</div>` +
        `</div>` +
        (r.burden?.warnings?.length
          ? `<div style="margin-top:6px;">${r.burden.warnings.map((w) => `<div class="workspace-qc-item" style="color:var(--warn)">${esc(w.comp)}: ${esc(w.type)} (${esc(String(w.value))}%)</div>`).join('')}</div>`
          : '') +
      `</div>`
    );
  }

  // Income approach result
  let incomeHtml = '';
  if (VALUATION_STATE.incomeResult) {
    const ir = VALUATION_STATE.incomeResult;
    incomeHtml = (
      `<div style="margin-top:10px;padding:8px;border:1px solid rgba(100,180,255,.3);border-radius:8px;background:rgba(100,180,255,.05);">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<strong>Income Approach</strong>` +
          `<span style="font-size:1.1em;">${esc(workspaceCurrency(ir.indicatedValue))}</span>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:6px;">` +
          `<div><strong>Monthly Rent:</strong> ${esc(workspaceCurrency(ir.monthlyRent))}</div>` +
          `<div><strong>GRM:</strong> ${esc(String(ir.grm || '-'))}</div>` +
          `<div><strong>Annual Rent:</strong> ${esc(workspaceCurrency(ir.annualRent))}</div>` +
        `</div>` +
      `</div>`
    );
  }

  // Cost approach result
  let costHtml = '';
  if (VALUATION_STATE.costResult) {
    const cr = VALUATION_STATE.costResult;
    costHtml = (
      `<div style="margin-top:10px;padding:8px;border:1px solid rgba(200,180,100,.3);border-radius:8px;background:rgba(200,180,100,.05);">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<strong>Cost Approach</strong>` +
          `<span style="font-size:1.1em;">${esc(workspaceCurrency(cr.indicatedValue))}</span>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:6px;">` +
          `<div><strong>Site Value:</strong> ${esc(workspaceCurrency(cr.siteValue))}</div>` +
          `<div><strong>Total Cost New:</strong> ${esc(workspaceCurrency(cr.totalCostNew))}</div>` +
          `<div><strong>Depreciation:</strong> ${esc(workspaceCurrency(cr.totalDepreciation))}</div>` +
          `<div><strong>Site Improvements:</strong> ${esc(workspaceCurrency(cr.siteImprovementsValue))}</div>` +
        `</div>` +
      `</div>`
    );
  }

  // Reconciliation result
  let reconHtml = '';
  if (VALUATION_STATE.reconciliationResult) {
    const rr = VALUATION_STATE.reconciliationResult;
    reconHtml = (
      `<div style="margin-top:10px;padding:8px;border:1px solid rgba(180,100,255,.3);border-radius:8px;background:rgba(180,100,255,.05);">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<strong>Reconciliation</strong>` +
          `<span style="font-size:1.1em;">${rr.weightedValue ? esc(workspaceCurrency(rr.weightedValue)) : 'Pending weights'}</span>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:6px;">` +
          `<div><strong>Approaches:</strong> ${esc(String(rr.approachCount || 0))}</div>` +
          `<div><strong>Range:</strong> ${rr.range ? `${esc(workspaceCurrency(rr.range.low))} - ${esc(workspaceCurrency(rr.range.high))}` : 'n/a'}</div>` +
          `<div><strong>Spread:</strong> ${rr.range ? esc(workspaceCurrency(rr.range.spread)) : 'n/a'}</div>` +
        `</div>` +
      `</div>`
    );
  }

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Valuation Calculator</h4>` +
      (acceptedSlots.length
        ? `<div>${compRows}</div>` +
          `<div class="btnrow" style="margin-top:8px;">` +
            `<button class="sm" onclick="workspaceComputeSalesComparison()">Compute Sales Comparison</button>` +
          `</div>`
        : `<div class="hint">Load comparable candidates into comp slots to compute valuation metrics.</div>`) +
      resultHtml +
      `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">` +
        `<div style="display:flex;gap:6px;flex-wrap:wrap;">` +
          `<button class="sec sm" onclick="workspaceComputeIncomeApproach()">Income Approach</button>` +
          `<button class="sec sm" onclick="workspaceComputeCostApproach()">Cost Approach</button>` +
          `<button class="sec sm" onclick="workspaceComputeReconciliation()">Reconcile</button>` +
        `</div>` +
      `</div>` +
      incomeHtml +
      costHtml +
      reconHtml +
    `</div>`
  );
}

async function workspaceComputeSalesComparison() {
  if (!STATE.caseId) return;
  const intelligence = workspaceComparableIntelligence();
  const slots = Array.isArray(intelligence?.acceptedSlots) ? intelligence.acceptedSlots : [];
  if (!slots.length) return;

  const comps = slots.map((slot) => {
    const salePrice = slot.valuationMetrics?.salePrice || slot.candidate?.salePrice || 0;
    const adjustments = {};
    for (const record of (slot.adjustmentSupport || [])) {
      const amount = record.finalAmount ?? record.suggestedAmount;
      if (amount != null) adjustments[record.adjustmentCategory] = amount;
    }
    return { salePrice, adjustments };
  }).filter((c) => c.salePrice);

  if (!comps.length) {
    workspaceSetBanner('No valid comp sale prices found.', 'warn');
    return;
  }

  workspaceSetBanner('Computing sales comparison...', 'info');
  const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/sales-comparison`, {
    method: 'POST',
    body: { comps },
  });

  if (!result.ok) {
    workspaceSetBanner(result.error || 'Sales comparison computation failed.', 'error');
    return;
  }

  VALUATION_STATE.lastResult = result;
  workspaceSetBanner('');
  workspaceRenderAssistant();
}

async function workspaceComputeIncomeApproach() {
  if (!STATE.caseId) return;
  const entries = workspaceEntries();

  // Try to read from workspace fields
  const monthlyRent = entries['income_monthly_rent']?.value
    || entries['income_indicated_monthly_rent']?.value;
  const grm = entries['income_grm']?.value;

  if (!monthlyRent || !grm) {
    const rentInput = window.prompt('Monthly rent ($):', monthlyRent || '');
    if (rentInput == null) return;
    const grmInput = window.prompt('Gross Rent Multiplier (GRM):', grm || '');
    if (grmInput == null) return;

    const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/income`, {
      method: 'POST',
      body: { monthlyRent: rentInput, grm: grmInput },
    });

    if (!result.ok) {
      workspaceSetBanner(result.error || 'Income approach computation failed.', 'error');
      return;
    }
    VALUATION_STATE.incomeResult = result;
  } else {
    const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/income`, {
      method: 'POST',
      body: { monthlyRent, grm },
    });

    if (!result.ok) {
      workspaceSetBanner(result.error || 'Income approach computation failed.', 'error');
      return;
    }
    VALUATION_STATE.incomeResult = result;
  }

  workspaceSetBanner('');
  workspaceRenderAssistant();
}

async function workspaceComputeCostApproach() {
  if (!STATE.caseId) return;
  const entries = workspaceEntries();

  const siteValue = entries['cost_estimated_site_value']?.value;
  const dwellingCostNew = entries['cost_dwelling_cost_new']?.value;
  const totalDepreciation = entries['cost_total_depreciation']?.value;
  const garageCarportCost = entries['cost_garage_carport']?.value || 0;
  const otherCosts = entries['cost_porches_patios']?.value || 0;
  const siteImprovementsValue = entries['cost_site_improvements_value']?.value || 0;

  if (!siteValue || !dwellingCostNew) {
    const siteInput = window.prompt('Estimated site value ($):', siteValue || '');
    if (siteInput == null) return;
    const dwellingInput = window.prompt('Dwelling cost new ($):', dwellingCostNew || '');
    if (dwellingInput == null) return;
    const depInput = window.prompt('Total depreciation ($):', totalDepreciation || '');
    if (depInput == null) return;

    const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/cost`, {
      method: 'POST',
      body: {
        siteValue: siteInput,
        dwellingCostNew: dwellingInput,
        totalDepreciation: depInput,
        garageCarportCost,
        otherCosts,
        siteImprovementsValue,
      },
    });

    if (!result.ok) {
      workspaceSetBanner(result.error || 'Cost approach computation failed.', 'error');
      return;
    }
    VALUATION_STATE.costResult = result;
  } else {
    const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/cost`, {
      method: 'POST',
      body: {
        siteValue,
        dwellingCostNew,
        totalDepreciation: totalDepreciation || 0,
        garageCarportCost,
        otherCosts,
        siteImprovementsValue,
      },
    });

    if (!result.ok) {
      workspaceSetBanner(result.error || 'Cost approach computation failed.', 'error');
      return;
    }
    VALUATION_STATE.costResult = result;
  }

  workspaceSetBanner('');
  workspaceRenderAssistant();
}

async function workspaceComputeReconciliation() {
  if (!STATE.caseId) return;

  const salesVal = VALUATION_STATE.lastResult?.indication?.indicatedValue || null;
  const incomeVal = VALUATION_STATE.incomeResult?.indicatedValue || null;
  const costVal = VALUATION_STATE.costResult?.indicatedValue || null;

  if (!salesVal && !incomeVal && !costVal) {
    workspaceSetBanner('Compute at least one approach value before reconciliation.', 'warn');
    return;
  }

  // Default weights — sales comparison primary
  const weights = {
    salesComparison: salesVal ? 60 : 0,
    costApproach: costVal ? 20 : 0,
    incomeApproach: incomeVal ? 20 : 0,
  };

  const result = await apiFetch(`/api/cases/${STATE.caseId}/valuation/reconciliation`, {
    method: 'POST',
    body: {
      salesComparisonValue: salesVal,
      costApproachValue: costVal,
      incomeApproachValue: incomeVal,
      weights,
    },
  });

  if (!result.ok) {
    workspaceSetBanner(result.error || 'Reconciliation computation failed.', 'error');
    return;
  }

  VALUATION_STATE.reconciliationResult = result;
  workspaceSetBanner('');
  workspaceRenderAssistant();
}

function workspaceRenderReconciliationSupportPanel() {
  const support = workspaceComparableIntelligence()?.reconciliationSupport || null;
  if (!support || !support.summary?.consideredCompCount) {
    return (
      `<div class="workspace-assistant-section">` +
        `<h4>Reconciliation Support</h4>` +
        `<div class="hint">Load and evaluate accepted comp slots to generate reconciliation support.</div>` +
      `</div>`
    );
  }

  const weightingCards = (support.weighting || []).map((slot) => (
    `<div class="workspace-history-item">` +
      `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">` +
        `<div>` +
          `<div class="workspace-history-value">${esc(slot.gridSlotLabel)}: ${esc(slot.address || 'Comparable')}</div>` +
          `<div class="workspace-field-hint">${esc(workspaceCurrency(slot.adjustedSalePrice))} adjusted | ${esc(slot.contributionPercent)}% contribution</div>` +
        `</div>` +
        `<span class="chip ${workspaceWeightTone(slot.suggestedWeightLabel)}">${esc(slot.suggestedWeightLabel)}</span>` +
      `</div>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Weight score:</strong> ${esc(workspaceComparableScore(slot.suggestedWeightScore || 0))}</div>` +
        `<div><strong>Gross adjustment:</strong> ${esc(`${slot.grossAdjustmentPercent || 0}%`)}</div>` +
        `<div><strong>Net adjustment:</strong> ${esc(`${slot.netAdjustmentPercent || 0}%`)}</div>` +
        `<div><strong>Flags:</strong> ${esc(String(slot.contradictionCount || 0))}</div>` +
      `</div>` +
      ((slot.reasons || []).length
        ? `<div class="workspace-meta-list">` +
            slot.reasons.map((reason) => `<div class="workspace-qc-item">${esc(reason)}</div>`).join('') +
          `</div>`
        : '') +
    `</div>`
  )).join('');

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Reconciliation Support</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Adjusted range:</strong> ${esc(workspaceCurrency(support.summary.indicatedRangeLow))} to ${esc(workspaceCurrency(support.summary.indicatedRangeHigh))}</div>` +
        `<div><strong>Weighted indication:</strong> ${esc(workspaceCurrency(support.summary.weightedIndication))}</div>` +
        `<div><strong>Accepted comps:</strong> ${esc(String(support.summary.consideredCompCount || 0))}</div>` +
        `<div><strong>Most reliable:</strong> ${esc((support.mostReliable || []).map((slot) => slot.gridSlotLabel).join(', ') || 'n/a')}</div>` +
      `</div>` +
      `<div class="btnrow">` +
        `<button class="sec sm" onclick="workspaceApplyReconciliationNarrative()">Write Narrative Draft</button>` +
        `<button class="sm" onclick="workspaceApplyWeightedIndicationToOpinion()">Use Weighted Indication as Opinion Draft</button>` +
      `</div>` +
      `${weightingCards}` +
      `<div class="workspace-history-item">` +
        `<div class="workspace-field-hint">Draft reconciliation language</div>` +
        `<div class="workspace-history-value">${esc(support.draftNarrative || 'No reconciliation narrative available.')}</div>` +
      `</div>` +
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
      `<div class="workspace-history-item workspace-comp-candidate-card" draggable="true" data-comparable-candidate-id="${esc(candidate.id)}">` +
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
          `<div><strong>Relevance:</strong> ${esc(workspaceComparableScore(candidate.relevanceScore))}</div>` +
          `<div><strong>Key matches:</strong> ${esc(keyMatches.length ? keyMatches.join(', ') : 'Limited')}</div>` +
          `<div><strong>Key mismatches:</strong> ${esc(mismatchList)}</div>` +
          `${(candidate.missingFactors || []).length ? `<div><strong>Missing factors:</strong> <span style="color:var(--warn)">${esc(workspaceComparableFactorLabels(candidate.missingFactors).join(', '))}</span></div>` : ''}` +
          `<div><strong>Prior usage:</strong> ${esc(`${candidate.priorUsage?.acceptedCount || 0} accepted / ${candidate.priorUsage?.rejectedCount || 0} rejected`)}</div>` +
        `</div>` +
        `<div style="margin-top:8px;">${warningList}</div>` +
        workspaceRenderComparableScoreBreakdown(candidate) +
        workspaceRenderComparableGridPreview(preview) +
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
  WORKSPACE_STATE.dragComparableCandidateId = null;
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
  const policySummary = workspaceSectionPolicySummary();
  if (nav) {
    nav.innerHTML = payload.definition.sections.map((section) => {
      const active = section.id === WORKSPACE_STATE.sectionId ? ' active' : '';
      const audit = policySummary[section.id];
      let badge = '';
      if (audit) {
        if (audit.hasBlockers) {
          badge = ' <span class="chip warn" style="font-size:0.65em;padding:1px 5px;">Missing Facts</span>';
        } else if (audit.freshnessStatus && audit.freshnessStatus !== 'current' && audit.freshnessStatus !== 'not_generated') {
          badge = ' <span class="chip warn" style="font-size:0.65em;padding:1px 5px;">Stale</span>';
        } else if (audit.missingRecommendedCount > 0) {
          badge = ' <span class="chip" style="font-size:0.65em;padding:1px 5px;opacity:0.7">Gaps</span>';
        }
        if (audit.qualityScore !== null && audit.qualityScore !== undefined) {
          const qColor = audit.qualityScore >= 70 ? 'var(--ok)' : audit.qualityScore >= 40 ? 'var(--warn)' : 'var(--err,#e74c3c)';
          badge += ` <span style="font-size:0.6em;color:${qColor};font-weight:bold;" title="Quality: ${audit.qualityScore}/100">${audit.qualityScore}</span>`;
        }
      }
      return (
        `<button class="workspace-nav-item${active}" onclick="workspaceSelectSection('${section.id}')">` +
          `<div class="workspace-nav-item-title">${esc(section.label)}${badge}</div>` +
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

  // Render overview panels (readiness, missing facts, insertion reliability)
  const overviewEl = ws$('workspaceOverviewPanels');
  if (overviewEl) {
    const overviewParts = [
      workspaceRenderReadinessChecklist(),
      workspaceRenderMissingFactsDashboard(),
      workspaceRenderInsertionSummaryCard(),
    ].filter(Boolean);
    if (overviewParts.length) {
      overviewEl.innerHTML = overviewParts.join('');
      overviewEl.style.display = '';
    } else {
      overviewEl.style.display = 'none';
    }
  }
}

function workspaceRenderGovernanceCard(sectionId) {
  const audit = workspaceSectionPolicySummary()[sectionId];
  if (!audit) return '';

  // Freshness
  const freshBadge = workspaceFreshnessBadge(audit.freshnessStatus || 'not_generated');
  const isStale = audit.freshnessStatus && audit.freshnessStatus !== 'current' && audit.freshnessStatus !== 'not_generated';
  const staleDetail = isStale && audit.staleReasons?.length
    ? `<div class="workspace-gov-detail">${esc(audit.staleReasons.join('; '))}</div>` : '';

  // Quality
  const qualityBar = audit.qualityScore !== null && audit.qualityScore !== undefined
    ? workspaceQualityBar(audit.qualityScore) : '<span class="hint">Not yet scored</span>';

  // Missing facts
  const missingReq = audit.missingRequiredCount || 0;
  const missingRec = audit.missingRecommendedCount || 0;
  let factChip = '';
  if (missingReq > 0) {
    factChip = `<span class="chip warn">${missingReq} required missing</span>`;
  } else if (missingRec > 0) {
    factChip = `<span class="chip">${missingRec} recommended missing</span>`;
  } else {
    factChip = '<span class="chip ok">Facts complete</span>';
  }

  // Blocker badge
  const blockerBadge = audit.hasBlockers
    ? '<span class="chip warn">Blocked</span>'
    : '<span class="chip ok">Ready</span>';

  // Generation info
  const genAt = audit.generatedAt
    ? `<span style="font-size:0.8em;opacity:0.7;">${esc(new Date(audit.generatedAt).toLocaleString())}</span>` : '<span class="hint">Never</span>';
  const regenCount = audit.regenerationCount > 0
    ? ` <span class="chip" style="font-size:0.7em;">${audit.regenerationCount} regen</span>` : '';

  return (
    `<div class="workspace-section-card workspace-gov-card">` +
      `<div class="workspace-card-head">` +
        `<h3>Section Governance</h3>` +
        `<div style="display:flex;gap:4px;align-items:center;">${blockerBadge} ${freshBadge}</div>` +
      `</div>` +
      `<div class="workspace-card-body">` +
        `<div class="workspace-gov-grid">` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Prompt</div>` +
            `<div class="workspace-gov-value">${esc(audit.promptVersion || 'default')}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Facts</div>` +
            `<div class="workspace-gov-value">${factChip}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Generated</div>` +
            `<div class="workspace-gov-value">${genAt}${regenCount}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Quality</div>` +
            `<div class="workspace-gov-value">${qualityBar}</div>` +
          `</div>` +
        `</div>` +
        staleDetail +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderReadinessChecklist() {
  const payload = WORKSPACE_STATE.payload;
  if (!payload) return '';

  const policySummary = workspaceSectionPolicySummary();
  const freshness = workspaceSectionFreshnessSummary();
  const qc = payload.qc || {};
  const gate = qc.approvalGate;
  const insertionRel = workspaceInsertionReliability();

  // Ready to generate: all required facts are present for all narrative sections
  const sectionIds = Object.keys(policySummary);
  const totalSections = sectionIds.length;
  const readyToGenerate = sectionIds.filter(sid => !policySummary[sid].hasBlockers).length;
  const allReadyToGenerate = readyToGenerate === totalSections && totalSections > 0;

  // Ready to review: all sections are generated and current
  const generatedCount = freshness.total || 0;
  const staleCount = freshness.stale || 0;
  const currentCount = freshness.current || 0;
  const allGenerated = generatedCount > 0 && staleCount === 0;

  // Ready to finalize: QC gate passes, no contradictions, insertion clean
  const qcPasses = gate?.ok === true;
  const contradictions = qc.contradictionGraphCount || 0;
  const insertionClean = insertionRel?.latestRun
    ? (insertionRel.latestRun.failedFields === 0 && insertionRel.latestRun.rollbackFields === 0)
    : false;

  function checkRow(label, passed, detail) {
    const icon = passed ? '<span style="color:var(--ok);font-weight:bold;">&#x2713;</span>' : '<span style="color:var(--warn);font-weight:bold;">&#x2717;</span>';
    return (
      `<div class="workspace-readiness-row">` +
        `${icon} <span class="workspace-readiness-label">${esc(label)}</span>` +
        `<span class="workspace-readiness-detail">${esc(detail)}</span>` +
      `</div>`
    );
  }

  return (
    `<div class="workspace-section-card">` +
      `<div class="workspace-card-head">` +
        `<h3>1004 Readiness</h3>` +
        `<div style="display:flex;gap:4px;align-items:center;">` +
          (allReadyToGenerate && allGenerated && qcPasses
            ? '<span class="chip ok">Ready to finalize</span>'
            : allReadyToGenerate && allGenerated
              ? '<span class="chip warn">Ready for review</span>'
              : allReadyToGenerate
                ? '<span class="chip">Ready to generate</span>'
                : '<span class="chip warn">Not ready</span>') +
        `</div>` +
      `</div>` +
      `<div class="workspace-card-body">` +
        `<div class="workspace-readiness-group">` +
          `<div class="workspace-readiness-heading">Ready to Generate</div>` +
          checkRow('Required facts present', allReadyToGenerate, `${readyToGenerate}/${totalSections} sections have required facts`) +
          checkRow('Pre-draft gate', !qc.factReviewQueueSummary?.preDraftBlocked, qc.factReviewQueueSummary?.preDraftBlocked ? 'Fact review pending' : 'Clear') +
        `</div>` +
        `<div class="workspace-readiness-group">` +
          `<div class="workspace-readiness-heading">Ready for Review</div>` +
          checkRow('Sections generated', generatedCount > 0, `${generatedCount} generated`) +
          checkRow('No stale sections', staleCount === 0, staleCount > 0 ? `${staleCount} stale` : 'All current') +
          checkRow('Quality thresholds', currentCount > 0, currentCount > 0 ? `${currentCount} current` : 'None scored') +
        `</div>` +
        `<div class="workspace-readiness-group">` +
          `<div class="workspace-readiness-heading">Ready to Finalize</div>` +
          checkRow('QC gate passes', qcPasses, gate?.ok ? 'Pass' : (gate?.message || gate?.code || 'Not run')) +
          checkRow('Contradictions resolved', contradictions === 0, contradictions > 0 ? `${contradictions} unresolved` : 'Clear') +
          checkRow('Insertion clean', insertionClean, insertionRel?.latestRun ? `${insertionRel.latestRun.failedFields || 0} failed, ${insertionRel.latestRun.rollbackFields || 0} rollback` : 'Not run') +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderMissingFactsDashboard() {
  const policySummary = workspaceSectionPolicySummary();
  const sectionIds = Object.keys(policySummary);
  if (!sectionIds.length) return '';

  const rows = sectionIds
    .map(sid => {
      const audit = policySummary[sid];
      const reqCount = audit.missingRequiredCount || 0;
      const recCount = audit.missingRecommendedCount || 0;
      if (reqCount === 0 && recCount === 0) return null;
      return { sectionId: sid, required: reqCount, recommended: recCount, hasBlockers: audit.hasBlockers };
    })
    .filter(Boolean)
    .sort((a, b) => b.required - a.required || b.recommended - a.recommended);

  if (!rows.length) {
    return (
      `<div class="workspace-section-card">` +
        `<div class="workspace-card-head"><h3>Missing Facts</h3><span class="chip ok">Complete</span></div>` +
        `<div class="workspace-card-body"><div class="hint" style="color:var(--ok)">All narrative sections have their required and recommended facts.</div></div>` +
      `</div>`
    );
  }

  const totalBlockers = rows.filter(r => r.hasBlockers).length;
  const totalGaps = rows.length;

  return (
    `<div class="workspace-section-card">` +
      `<div class="workspace-card-head">` +
        `<h3>Missing Facts Dashboard</h3>` +
        `<div style="display:flex;gap:4px;">` +
          (totalBlockers > 0 ? `<span class="chip warn">${totalBlockers} blocked</span>` : '') +
          `<span class="chip">${totalGaps} sections with gaps</span>` +
        `</div>` +
      `</div>` +
      `<div class="workspace-card-body">` +
        rows.map(row => {
          const sev = row.hasBlockers ? 'blocker' : row.required > 0 ? 'high' : 'low';
          const sevColor = sev === 'blocker' ? 'var(--danger, #dc2626)' : sev === 'high' ? 'var(--warn)' : 'var(--muted)';
          return (
            `<div class="workspace-missing-row" style="border-left:3px solid ${sevColor};">` +
              `<div class="workspace-missing-section">${esc(row.sectionId)}</div>` +
              `<div class="workspace-missing-counts">` +
                (row.required > 0 ? `<span class="chip warn">${row.required} required</span>` : '') +
                (row.recommended > 0 ? `<span class="chip">${row.recommended} recommended</span>` : '') +
              `</div>` +
            `</div>`
          );
        }).join('') +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderInsertionSummaryCard() {
  const reliability = workspaceInsertionReliability();
  const latestRun = reliability?.latestRun || null;

  if (!latestRun) {
    return (
      `<div class="workspace-section-card">` +
        `<div class="workspace-card-head"><h3>Insertion Reliability</h3></div>` +
        `<div class="workspace-card-body"><div class="hint">No insertion runs recorded. Run insertion from the Workspace to see reliability data.</div></div>` +
      `</div>`
    );
  }

  const total = latestRun.totalFields || 0;
  const completed = latestRun.completedFields || 0;
  const verified = latestRun.verifiedFields || 0;
  const failed = latestRun.failedFields || 0;
  const rollback = latestRun.rollbackFields || 0;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
  const pctColor = pct >= 95 ? 'var(--ok)' : pct >= 80 ? 'var(--warn)' : 'var(--danger, #dc2626)';
  const statusTone = workspaceInsertionStatusTone(latestRun.status);

  return (
    `<div class="workspace-section-card">` +
      `<div class="workspace-card-head">` +
        `<h3>ACI Insertion Reliability</h3>` +
        `<div style="display:flex;gap:4px;align-items:center;">` +
          `<span class="chip ${statusTone}">${esc(workspaceReviewLabel(latestRun.status))}</span>` +
          `<span style="font-size:1.1em;font-weight:900;color:${pctColor};">${pct}%</span>` +
        `</div>` +
      `</div>` +
      `<div class="workspace-card-body">` +
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">` +
          `<div style="flex:1;height:8px;background:var(--bg-tertiary);border-radius:4px;overflow:hidden;">` +
            `<div style="width:${pct}%;height:100%;background:${pctColor};border-radius:4px;"></div>` +
          `</div>` +
          `<span style="font-size:0.8em;color:${pctColor};font-weight:bold;">${verified}/${total} verified</span>` +
        `</div>` +
        `<div class="workspace-gov-grid">` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Target</div>` +
            `<div class="workspace-gov-value">${esc(latestRun.targetSoftware || latestRun.formType || 'ACI')}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Inserted</div>` +
            `<div class="workspace-gov-value">${completed}/${total}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Failed</div>` +
            `<div class="workspace-gov-value" style="${failed > 0 ? 'color:var(--danger, #dc2626)' : ''}">${failed}</div>` +
          `</div>` +
          `<div class="workspace-gov-cell">` +
            `<div class="workspace-gov-label">Rollbacks</div>` +
            `<div class="workspace-gov-value" style="${rollback > 0 ? 'color:var(--warn)' : ''}">${rollback}</div>` +
          `</div>` +
        `</div>` +
        `<div class="workspace-meta-list" style="margin-top:8px;">` +
          `<div><strong>Run ID:</strong> ${esc(latestRun.id)}</div>` +
          `<div><strong>QC Gate:</strong> ${esc(latestRun.qcGatePassed ? 'Pass' : 'Blocked')}</div>` +
          `<div><strong>Replay Items:</strong> ${esc(String(latestRun.issueFieldCount || 0))}</div>` +
          `<div><strong>Started:</strong> ${esc(latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : '-')}</div>` +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderVersionCompare(fieldId) {
  const entry = workspaceEntry(fieldId);
  if (!entry) return '';
  const versions = Array.isArray(entry.history) ? entry.history : [];
  if (versions.length < 1) return '';

  const currentValue = entry.value != null ? String(entry.value) : '';
  const previousValue = versions[0]?.value != null ? String(versions[0].value) : '';

  if (currentValue === previousValue) return '';

  // Simple line-level diff display
  const currentLines = currentValue.split('\n');
  const previousLines = previousValue.split('\n');
  const maxLines = Math.max(currentLines.length, previousLines.length);
  let diffRows = '';
  for (let i = 0; i < maxLines; i++) {
    const prev = previousLines[i] ?? '';
    const curr = currentLines[i] ?? '';
    if (prev === curr) {
      diffRows += `<div class="workspace-diff-line workspace-diff-same">${esc(curr || ' ')}</div>`;
    } else {
      if (prev) diffRows += `<div class="workspace-diff-line workspace-diff-removed">- ${esc(prev)}</div>`;
      if (curr) diffRows += `<div class="workspace-diff-line workspace-diff-added">+ ${esc(curr)}</div>`;
    }
  }

  return (
    `<div class="workspace-assistant-section">` +
      `<h4>Version Compare</h4>` +
      `<div class="workspace-diff-head">` +
        `<span class="chip">Current</span> vs <span class="chip">${esc(versions[0].savedAt ? new Date(versions[0].savedAt).toLocaleString() : 'Previous')}</span>` +
      `</div>` +
      `<div class="workspace-diff-container">${diffRows}</div>` +
      `<div class="btnrow" style="margin-top:6px;">` +
        `<button class="sec sm" onclick="workspaceRestoreVersion('${esc(fieldId)}', 0)">Restore Previous</button>` +
      `</div>` +
    `</div>`
  );
}

function workspaceRenderSection(section) {
  const wrap = ws$('workspaceSectionContent');
  if (!wrap) return;

  const parts = [];

  // Governance card for this section
  parts.push(workspaceRenderGovernanceCard(section.id));

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
  const isComparableGrid = field.fieldId === 'sales_comp_grid';
  return (
    `<div class="workspace-grid-wrap">` +
      `<table class="workspace-grid">` +
        `<thead><tr>${(field.columns || []).map((column) => {
          if (isComparableGrid && ['comp1', 'comp2', 'comp3'].includes(column.key)) {
            return (
              `<th class="workspace-grid-slot-target" data-grid-slot-drop="${column.key}">` +
                `<div>${esc(column.label)}</div>` +
                `<div class="workspace-grid-slot-hint">Drop candidate here</div>` +
              `</th>`
            );
          }
          return `<th>${esc(column.label)}</th>`;
        }).join('')}</tr></thead>` +
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
  const comparableWorkspacePanel = ['sales_comparison', 'reconciliation'].includes(currentSection?.id)
    ? `${workspaceRenderComparablePanel()}${workspaceRenderAcceptedComparableSlots(workspaceComparableIntelligence())}${workspaceRenderValuationCalculatorPanel()}${workspaceRenderReconciliationSupportPanel()}`
    : '';
  const insertionReliability = workspaceInsertionReliability();
  const insertionPanel = workspaceRenderInsertionReliabilityPanel(currentSection?.id, {
    detailed: currentSection?.id === 'qc_review' || !field,
    previewLimit: currentSection?.id === 'qc_review' ? 5 : 3,
  });
  const showInsertionPanel = !field
    || currentSection?.id === 'qc_review'
    || Boolean(insertionReliability?.latestRun && (
      insertionReliability.latestRun.failedFields > 0
      || insertionReliability.latestRun.issueFieldCount > 0
      || insertionReliability.latestRun.rollbackFields > 0
    ));
  if (!assistantTitle || !body) return;

  if (!definition) {
    assistantTitle.textContent = 'No field selected';
    body.innerHTML = '<div class="hint">Focus a field to review evidence support, apply suggestions, and restore versions.</div>';
    return;
  }

  const qc = WORKSPACE_STATE.payload?.qc || {};
  if (!field) {
    assistantTitle.textContent = 'Section Summary';
    const govCard = typeof workspaceRenderGovernanceCard === 'function'
      ? workspaceRenderGovernanceCard(currentSection?.id)
      : '';
    body.innerHTML =
      comparableWorkspacePanel +
      (govCard || workspaceRenderSectionAuditPanel(currentSection?.id)) +
      workspaceRenderContradictionGraphPanel(currentSection?.id, 6) +
      insertionPanel +
      workspaceRenderFreshnessSummaryPanel() +
      `<div class="workspace-assistant-section">` +
        `<h4>Quality Control</h4>` +
        `<div class="workspace-meta-list">` +
          `<div><strong>Conflicts:</strong> ${esc(String(qc.conflictCount || 0))}</div>` +
          `<div><strong>Contradictions:</strong> ${esc(String(qc.contradictionGraphCount || 0))}</div>` +
          `<div><strong>Approval Gate:</strong> ${workspaceApprovalGateChip(qc.approvalGate)}</div>` +
          (qc.approvalGate && !qc.approvalGate.ok ? `<div style="font-size:0.8em;color:var(--warn);margin-top:2px;">${esc(qc.approvalGate.message || '')}</div>` : '') +
          `<div><strong>Insertion:</strong> ${esc(qc.latestInsertionStatus || 'Not run')}</div>` +
          `<div><strong>Insertion Issues:</strong> ${esc(String(qc.latestInsertionIssueCount || 0))}</div>` +
          `<div><strong>Insertion Rollbacks:</strong> ${esc(String(qc.latestInsertionRollbackCount || 0))}</div>` +
          `<div><strong>Workflow Status:</strong> ${esc(WORKSPACE_STATE.payload.meta?.workflowStatus || '-')}</div>` +
        `</div>` +
      `</div>`;
    return;
  }

  // Version compare for the focused field (shown before other assistant content)
  const versionComparePanel = workspaceRenderVersionCompare(field.fieldId);

  const entry = workspaceEntry(field.fieldId) || { value: null, history: [], suggestion: null };
  assistantTitle.textContent = field.label;

  const sections = [];
  if (comparableWorkspacePanel) sections.push(comparableWorkspacePanel);
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
            `<button class="ghost sm" onclick="workspaceLoadWhySuggestion('${field.fieldId}')" title="Why this suggestion?">Why?</button>` +
          `</div>` +
          `<div id="whySuggestionDrawer_${field.fieldId}" style="display:none;"></div>` +
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

  sections.push(workspaceRenderContradictionGraphPanel(field.sectionId, 4));
  if (showInsertionPanel) sections.push(insertionPanel);

  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>QC Snapshot</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Conflict Count:</strong> ${esc(String(qc.conflictCount || 0))}</div>` +
        `<div><strong>Contradictions:</strong> ${esc(String(qc.contradictionGraphCount || 0))}</div>` +
        `<div><strong>Approval Gate:</strong> ${workspaceApprovalGateChip(qc.approvalGate)}</div>` +
        `<div><strong>Insertion:</strong> ${esc(qc.latestInsertionStatus || 'Not run')}</div>` +
        `<div><strong>Insertion Issues:</strong> ${esc(String(qc.latestInsertionIssueCount || 0))}</div>` +
        `<div><strong>Insertion Rollbacks:</strong> ${esc(String(qc.latestInsertionRollbackCount || 0))}</div>` +
        `<div><strong>Field Conflicts:</strong> ${esc(String(conflicts.length || 0))}</div>` +
        `<div><strong>Pending Candidates:</strong> ${esc(String(entry.pendingReviewCount || 0))}</div>` +
        `<div><strong>Fact Review Queue:</strong> ${esc(qc.factReviewQueueSummary?.preDraftBlocked ? 'Blocked' : 'Clear')}</div>` +
        `<div><strong>Unresolved Issues:</strong> ${esc(String((WORKSPACE_STATE.payload.meta?.unresolvedIssues || []).length))}</div>` +
      `</div>` +
    `</div>`
  );

  // Insert version compare after Current Value section (index 1 after comparable panel)
  if (versionComparePanel) {
    const insertIdx = comparableWorkspacePanel ? 2 : 1;
    sections.splice(insertIdx, 0, versionComparePanel);
  }

  body.innerHTML = sections.join('');
}

function workspaceSelectSection(sectionId) {
  WORKSPACE_STATE.sectionId = sectionId;
  WORKSPACE_STATE.fieldId = null;
  workspaceRender();
}

function workspaceFlashStaleSections(sectionIds) {
  // Re-render nav to pick up updated freshness badges
  workspaceRender();
  // Briefly highlight the nav items for newly-stale sections
  requestAnimationFrame(() => {
    const navItems = document.querySelectorAll('.workspace-nav-item');
    for (const item of navItems) {
      const onclick = item.getAttribute('onclick') || '';
      const match = onclick.match(/workspaceSelectSection\('([^']+)'\)/);
      if (match && sectionIds.includes(match[1])) {
        item.style.transition = 'background 0.3s';
        item.style.background = 'rgba(231,76,60,0.25)';
        setTimeout(() => { item.style.background = ''; }, 2500);
      }
    }
  });
}

async function workspaceLoadSectionAudit(sectionId) {
  if (!STATE.caseId || !sectionId) return;
  const body = ws$('workspaceAssistantBody');
  if (!body) return;

  body.innerHTML = '<div class="hint">Loading section audit...</div>';
  const result = await apiFetch(`/api/cases/${STATE.caseId}/section-audit/${sectionId}`);
  if (!result.ok) {
    body.innerHTML = `<div class="hint" style="color:var(--warn)">Failed to load audit: ${esc(result.error || 'Unknown error')}</div>`;
    return;
  }

  const policy = result.policy || {};
  const snapshot = result.dependencySnapshot || {};
  const regen = result.regeneratePolicy || {};
  const staleDeps = result.staleDependentSections || [];

  const requiredFacts = snapshot.requiredFacts || {};
  const factRows = Object.entries(requiredFacts).map(([path, val]) => {
    const present = val != null;
    return (
      `<div style="display:flex;justify-content:space-between;gap:6px;">` +
        `<span>${esc(path)}</span>` +
        `<span class="chip ${present ? 'ok' : 'warn'}" style="font-size:0.7em;padding:1px 5px;">${present ? esc(String(val)) : 'Missing'}</span>` +
      `</div>`
    );
  }).join('');

  const blockerList = (regen.blockers || []).map(
    (b) => `<div style="color:var(--warn)">- ${esc(b)}</div>`
  ).join('');
  const warningList = (regen.warnings || []).map(
    (w) => `<div style="opacity:0.8">- ${esc(w)}</div>`
  ).join('');

  const staleDepsHtml = staleDeps.length
    ? staleDeps.map((s) => `<span class="chip" style="font-size:0.7em;margin:2px;">${esc(s)}</span>`).join(' ')
    : '<span style="opacity:0.6">None</span>';

  const sections = [];

  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>Section Policy</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Section:</strong> ${esc(policy.sectionId || sectionId)}</div>` +
        `<div><strong>Profile:</strong> ${esc(policy.profileId || '-')}</div>` +
        `<div><strong>Prompt Version:</strong> ${esc(result.promptVersion || policy.promptVersion || '-')}</div>` +
        `<div><strong>Temperature:</strong> ${esc(String(policy.temperature ?? '-'))}</div>` +
      `</div>` +
    `</div>`
  );

  // Freshness & quality from the enriched audit endpoint
  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>Freshness & Quality</h4>` +
      `<div class="workspace-meta-list">` +
        `<div><strong>Freshness:</strong> ${workspaceFreshnessBadge(result.freshnessStatus || 'not_generated')}</div>` +
        (result.qualityScore !== null && result.qualityScore !== undefined
          ? `<div><strong>Quality:</strong>${workspaceQualityBar(result.qualityScore)}</div>`
          : `<div><strong>Quality:</strong> <span style="opacity:0.6">Not scored</span></div>`) +
        (result.generatedAt
          ? `<div><strong>Generated:</strong> ${esc(new Date(result.generatedAt).toLocaleString())}</div>`
          : '') +
        (result.regenerationCount > 0
          ? `<div><strong>Regeneration Count:</strong> ${esc(String(result.regenerationCount))}</div>`
          : '') +
      `</div>` +
      ((result.staleReasons || []).length
        ? `<div style="margin-top:6px;font-size:0.8em;"><strong>Stale Reasons:</strong><ul style="margin:4px 0 0 16px;padding:0;">${result.staleReasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`
        : '') +
      ((result.changedPaths || []).length
        ? `<div style="margin-top:4px;font-size:0.75em;opacity:0.7;">Changed paths: ${esc(result.changedPaths.join(', '))}</div>`
        : '') +
    `</div>`
  );

  if (Object.keys(requiredFacts).length) {
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Dependency Snapshot</h4>` +
        `<div class="workspace-meta-list">${factRows}</div>` +
        (snapshot.capturedAt ? `<div style="margin-top:6px;font-size:0.75em;opacity:0.6">Captured: ${esc(new Date(snapshot.capturedAt).toLocaleString())}</div>` : '') +
      `</div>`
    );
  }

  sections.push(
    `<div class="workspace-assistant-section">` +
      `<h4>Regenerate Policy</h4>` +
      `<div style="margin-bottom:6px;">` +
        `<span class="chip ${regen.allowed ? 'ok' : 'warn'}">${regen.allowed ? 'Allowed' : 'Blocked'}</span>` +
      `</div>` +
      (blockerList ? `<div style="margin-bottom:4px;"><strong>Blockers:</strong>${blockerList}</div>` : '') +
      (warningList ? `<div><strong>Warnings:</strong>${warningList}</div>` : '') +
    `</div>`
  );

  if (staleDeps.length || true) {
    sections.push(
      `<div class="workspace-assistant-section">` +
        `<h4>Stale Dependent Sections</h4>` +
        `<div>${staleDepsHtml}</div>` +
        `<div style="margin-top:6px;font-size:0.75em;opacity:0.6">Sections that share fact dependencies and may need regeneration</div>` +
      `</div>`
    );
  }

  sections.push(
    `<div style="margin-top:12px;">` +
      `<button class="sec sm" onclick="workspaceRenderAssistant()">Back to Summary</button>` +
    `</div>`
  );

  body.innerHTML = sections.join('');
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

function workspaceHandleDragStart(event) {
  const card = event.target?.closest?.('[data-comparable-candidate-id]');
  if (!card) return;
  const candidateId = card.getAttribute('data-comparable-candidate-id');
  if (!candidateId) return;
  workspaceStartComparableDrag(candidateId);
  card.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', candidateId);
  }
  document.querySelectorAll('[data-grid-slot-drop]').forEach((el) => {
    el.classList.add('is-drop-active');
  });
}

function workspaceHandleDragEnd(event) {
  const card = event.target?.closest?.('[data-comparable-candidate-id]');
  if (card) card.classList.remove('is-dragging');
  workspaceEndComparableDrag();
}

function workspaceHandleDragOver(event) {
  const target = event.target?.closest?.('[data-grid-slot-drop]');
  if (!target || !WORKSPACE_STATE.dragComparableCandidateId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  target.classList.add('is-drop-hover');
}

function workspaceHandleDragLeave(event) {
  const target = event.target?.closest?.('[data-grid-slot-drop]');
  if (!target) return;
  target.classList.remove('is-drop-hover');
}

async function workspaceHandleDrop(event) {
  const target = event.target?.closest?.('[data-grid-slot-drop]');
  if (!target) return;
  const gridSlot = target.getAttribute('data-grid-slot-drop');
  const candidateId = event.dataTransfer?.getData('text/plain') || WORKSPACE_STATE.dragComparableCandidateId;
  target.classList.remove('is-drop-hover');
  if (!gridSlot || !candidateId) return;
  event.preventDefault();
  await workspaceDropComparableCandidate(gridSlot, candidateId);
}

function workspaceUpdateEntryValue(fieldId, nextValue) {
  const entry = workspaceEntry(fieldId);
  if (!entry) return;
  entry.value = nextValue;
}

function workspaceSetFieldValue(fieldId, nextValue, { provenance = null, focus = true, immediate = true } = {}) {
  const entry = workspaceEntry(fieldId);
  if (!entry) return false;
  entry.value = JSON.parse(JSON.stringify(nextValue));
  if (provenance) entry._pendingProvenance = provenance;
  else delete entry._pendingProvenance;
  if (focus) WORKSPACE_STATE.fieldId = fieldId;
  WORKSPACE_STATE.dirtyFieldIds.add(fieldId);
  workspaceSetSaveState('Unsaved');
  workspaceRender();
  workspaceScheduleSave(immediate);
  return true;
}

function workspaceApplyReconciliationNarrative() {
  const support = workspaceComparableIntelligence()?.reconciliationSupport || null;
  if (!support?.draftNarrative) return;
  const applied = workspaceSetFieldValue('reconciliation_narrative', support.draftNarrative, {
    immediate: true,
  });
  if (!applied) return;
  workspaceSetBanner('Reconciliation draft written into the narrative field.', 'info');
}

function workspaceApplyWeightedIndicationToOpinion() {
  const support = workspaceComparableIntelligence()?.reconciliationSupport || null;
  const weightedIndication = support?.summary?.weightedIndication;
  if (weightedIndication == null) return;
  const draftValue = workspaceCurrency(weightedIndication);
  const confirmed = window.confirm(
    `Write ${draftValue} into Opinion of Market Value as an appraiser draft? This remains manually editable.`,
  );
  if (!confirmed) return;
  const applied = workspaceSetFieldValue('reconciliation_market_value', draftValue, {
    immediate: true,
  });
  if (!applied) return;
  workspaceSetBanner('Weighted indication copied into the market value opinion field as a draft.', 'info');
}

function workspaceStartComparableDrag(candidateId) {
  WORKSPACE_STATE.dragComparableCandidateId = candidateId || null;
}

function workspaceEndComparableDrag() {
  WORKSPACE_STATE.dragComparableCandidateId = null;
  document.querySelectorAll('[data-grid-slot-drop]').forEach((el) => {
    el.classList.remove('is-drop-active');
  });
}

function workspaceGridDropTarget(slot) {
  if (!slot) return null;
  return document.querySelector(`[data-grid-slot-drop="${slot}"]`);
}

async function workspaceDropComparableCandidate(gridSlot, candidateId = null) {
  const resolvedCandidateId = candidateId || WORKSPACE_STATE.dragComparableCandidateId;
  if (!gridSlot || !resolvedCandidateId) return;
  await workspaceAcceptComparableCandidate(resolvedCandidateId, gridSlot);
  workspaceEndComparableDrag();
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

  // Handle fact-change cascade: update local governance data and notify user
  if (response.factChangeInvalidation && response.factChangeInvalidation.invalidatedSections?.length > 0) {
    const inv = response.factChangeInvalidation;
    // Update local sectionPolicySummary to reflect newly-stale sections
    const policySummary = WORKSPACE_STATE.payload?.sectionPolicySummary || {};
    for (const sid of inv.invalidatedSections) {
      if (policySummary[sid]) {
        policySummary[sid].freshnessStatus = 'stale_due_to_fact_change';
        policySummary[sid].staleReasons = [`Fact change: ${inv.changedPaths.join(', ')}`];
        policySummary[sid].changedPaths = inv.changedPaths;
      }
    }
    // Update freshness summary counts
    if (WORKSPACE_STATE.payload?.sectionFreshnessSummary) {
      const fs = WORKSPACE_STATE.payload.sectionFreshnessSummary;
      fs.stale = (fs.stale || 0) + inv.invalidatedSections.length;
      fs.current = Math.max(0, (fs.current || 0) - inv.invalidatedSections.length);
    }
    // Flash stale nav items
    workspaceFlashStaleSections(inv.invalidatedSections);
  }

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

// ── Contradiction Resolution Actions ──────────────────────────────────────────

async function workspaceResolveContradiction(contradictionId) {
  if (!contradictionId || !STATE.caseId) return;
  const note = window.prompt('Resolution note (optional):') || '';
  workspaceSetBanner('Resolving contradiction...', 'info');
  const result = await apiFetch(`/api/cases/${STATE.caseId}/contradiction-graph/${contradictionId}/resolve`, {
    method: 'POST',
    body: { actor: 'appraiser', note },
  });
  if (!result.ok) {
    workspaceSetBanner(result.error || 'Failed to resolve contradiction.', 'error');
    return;
  }
  workspaceSetBanner('Contradiction resolved.', 'info');
  await workspaceLoad(true);
}

async function workspaceDismissContradiction(contradictionId) {
  if (!contradictionId || !STATE.caseId) return;
  const reason = window.prompt('Dismissal reason:');
  if (reason == null) return;
  workspaceSetBanner('Dismissing contradiction...', 'info');
  const result = await apiFetch(`/api/cases/${STATE.caseId}/contradiction-graph/${contradictionId}/dismiss`, {
    method: 'POST',
    body: { actor: 'appraiser', reason },
  });
  if (!result.ok) {
    workspaceSetBanner(result.error || 'Failed to dismiss contradiction.', 'error');
    return;
  }
  workspaceSetBanner('Contradiction dismissed.', 'info');
  await workspaceLoad(true);
}

async function workspaceAcknowledgeContradiction(contradictionId) {
  if (!contradictionId || !STATE.caseId) return;
  const note = window.prompt('Acknowledgement note (optional):') || '';
  workspaceSetBanner('Acknowledging contradiction...', 'info');
  const result = await apiFetch(`/api/cases/${STATE.caseId}/contradiction-graph/${contradictionId}/acknowledge`, {
    method: 'POST',
    body: { actor: 'appraiser', note },
  });
  if (!result.ok) {
    workspaceSetBanner(result.error || 'Failed to acknowledge contradiction.', 'error');
    return;
  }
  workspaceSetBanner('Contradiction acknowledged.', 'info');
  await workspaceLoad(true);
}

async function workspaceReopenContradiction(contradictionId) {
  if (!contradictionId || !STATE.caseId) return;
  const reason = window.prompt('Reopen reason (optional):') || '';
  workspaceSetBanner('Reopening contradiction...', 'info');
  const result = await apiFetch(`/api/cases/${STATE.caseId}/contradiction-graph/${contradictionId}/reopen`, {
    method: 'POST',
    body: { actor: 'appraiser', reason },
  });
  if (!result.ok) {
    workspaceSetBanner(result.error || 'Failed to reopen contradiction.', 'error');
    return;
  }
  workspaceSetBanner('Contradiction reopened.', 'info');
  await workspaceLoad(true);
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
  const assistantBody = ws$('workspaceAssistantBody');
  if (sectionContent) {
    sectionContent.addEventListener('input', workspaceHandleInput);
    sectionContent.addEventListener('change', workspaceHandleInput);
    sectionContent.addEventListener('focusin', (event) => workspaceHandleFocus(event.target));
    sectionContent.addEventListener('dragover', workspaceHandleDragOver);
    sectionContent.addEventListener('dragleave', workspaceHandleDragLeave);
    sectionContent.addEventListener('drop', (event) => {
      workspaceHandleDrop(event).catch((err) => {
        workspaceSetBanner(err.message || 'Failed to load comparable candidate.', 'error');
        workspaceSetSaveState('Error');
      });
    });
  }
  if (assistantBody) {
    assistantBody.addEventListener('dragstart', workspaceHandleDragStart);
    assistantBody.addEventListener('dragend', workspaceHandleDragEnd);
  }
}
