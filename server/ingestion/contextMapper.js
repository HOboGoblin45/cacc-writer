/**
 * server/ingestion/contextMapper.js
 * -----------------------------------
 * Phase 5 — Document-to-Context Mapping
 *
 * Maps extracted fact candidates to assignment context fields.
 * Produces merge candidates — does NOT automatically overwrite case facts.
 *
 * The mapper:
 *   1. Groups extracted facts by their context path
 *   2. Validates and normalizes values
 *   3. Checks for conflicts with existing facts
 *   4. Returns a merge plan the user can review
 *
 * Usage:
 *   import { buildMergePlan, applyMergePlan } from '../ingestion/contextMapper.js';
 *   const plan = buildMergePlan(extractedFacts, existingFacts);
 *   applyMergePlan(plan, existingFacts, acceptedPaths);
 */

import fs from 'fs';
import path from 'path';

// ── Fact path → facts.json mapping ───────────────────────────────────────────
// Maps our extracted fact paths to the actual facts.json structure paths.

const FACT_PATH_MAP = {
  // Subject
  'subject.address':       { section: 'subject', field: 'address' },
  'subject.city':          { section: 'subject', field: 'city' },
  'subject.county':        { section: 'subject', field: 'county' },
  'subject.state':         { section: 'subject', field: 'state' },
  'subject.zip':           { section: 'subject', field: 'zip' },
  'subject.yearBuilt':     { section: 'subject', field: 'yearBuilt' },
  'subject.gla':           { section: 'subject', field: 'gla' },
  'subject.lotSize':       { section: 'subject', field: 'lotSize' },
  'subject.bedrooms':      { section: 'subject', field: 'bedrooms' },
  'subject.bathrooms':     { section: 'subject', field: 'bathrooms' },
  'subject.design':        { section: 'subject', field: 'design' },
  'subject.condition':     { section: 'subject', field: 'condition' },
  'subject.parcelNumber':  { section: 'subject', field: 'parcelNumber' },
  'subject.assessedValue': { section: 'subject', field: 'assessedValue' },
  'subject.taxYear':       { section: 'subject', field: 'taxYear' },
  'subject.legalDescription': { section: 'subject', field: 'legalDescription' },

  // Contract
  'contract.salePrice':    { section: 'contract', field: 'salePrice' },
  'contract.contractDate': { section: 'contract', field: 'contractDate' },
  'contract.closingDate':  { section: 'contract', field: 'closingDate' },
  'contract.concessions':  { section: 'contract', field: 'concessions' },
  'contract.financing':    { section: 'contract', field: 'financing' },
  'contract.buyer':        { section: 'contract', field: 'buyer' },
  'contract.seller':       { section: 'contract', field: 'seller' },
  'contract.saleDate':     { section: 'contract', field: 'saleDate' },

  // Site
  'site.zoning':              { section: 'site', field: 'zoning' },
  'site.zoningConformity':    { section: 'site', field: 'zoningConformity' },
  'site.permittedUse':        { section: 'site', field: 'permittedUse' },
  'site.municipality':        { section: 'site', field: 'municipality' },
  'site.floodZone':           { section: 'site', field: 'floodZone' },
  'site.floodMapNumber':      { section: 'site', field: 'floodMapNumber' },
  'site.floodMapDate':        { section: 'site', field: 'floodMapDate' },
  'site.floodCommunityNumber': { section: 'site', field: 'floodCommunityNumber' },

  // Market
  'market.listPrice':  { section: 'market', field: 'listPrice' },
  'market.dom':        { section: 'market', field: 'dom' },

  // Assignment
  'assignment.borrower':      { section: 'assignment', field: 'borrower' },
  'assignment.lenderName':    { section: 'assignment', field: 'lenderName' },
  'assignment.amcName':       { section: 'assignment', field: 'amcName' },
  'assignment.clientName':    { section: 'assignment', field: 'clientName' },
  'assignment.productType':   { section: 'assignment', field: 'productType' },
  'assignment.loanProgram':   { section: 'assignment', field: 'loanProgram' },
  'assignment.dueDate':       { section: 'assignment', field: 'dueDate' },
  'assignment.occupancy':     { section: 'assignment', field: 'occupancy' },
  'assignment.intendedUse':   { section: 'assignment', field: 'intendedUse' },
  'assignment.intendedUser':  { section: 'assignment', field: 'intendedUser' },
  'assignment.effectiveDate': { section: 'assignment', field: 'effectiveDate' },
  'assignment.extraordinaryAssumptions': { section: 'assignment', field: 'extraordinaryAssumptions' },
  'assignment.hypotheticalConditions':   { section: 'assignment', field: 'hypotheticalConditions' },

  // Improvements
  'improvements.basement':  { section: 'improvements', field: 'basement' },
  'improvements.garage':    { section: 'improvements', field: 'garage' },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a merge plan from extracted facts and existing case facts.
 *
 * @param {ExtractedFact[]} extractedFacts — from document extractors
 * @param {object} existingFacts — current facts.json content
 * @returns {MergeCandidate[]}
 *
 * @typedef {object} MergeCandidate
 * @property {string} factPath        — dot-separated path
 * @property {string} section         — facts.json section
 * @property {string} field           — facts.json field name
 * @property {string} newValue        — extracted value
 * @property {string} confidence      — 'high' | 'medium' | 'low'
 * @property {string|null} existingValue — current value (null if empty)
 * @property {string} status          — 'new' | 'confirm' | 'conflict' | 'upgrade'
 * @property {string} sourceText      — source snippet
 * @property {string} documentId      — source document ID
 */
export function buildMergePlan(extractedFacts, existingFacts = {}) {
  const candidates = [];

  for (const ef of extractedFacts) {
    const mapping = FACT_PATH_MAP[ef.factPath];
    if (!mapping) continue; // unknown path — skip

    const existingSection = existingFacts[mapping.section] || {};
    const existingEntry = existingSection[mapping.field];

    // Get the existing value (handle both raw values and {value, confidence} objects)
    let existingValue = null;
    let existingConfidence = null;
    if (existingEntry && typeof existingEntry === 'object' && 'value' in existingEntry) {
      existingValue = existingEntry.value;
      existingConfidence = existingEntry.confidence;
    } else if (existingEntry != null) {
      existingValue = existingEntry;
    }

    // Determine status
    let status;
    if (existingValue == null || existingValue === '' || existingValue === 'null') {
      status = 'new'; // no existing value — safe to fill
    } else if (String(existingValue).trim() === String(ef.value).trim()) {
      status = 'confirm'; // same value — confirms existing
    } else if (existingConfidence === 'low' && (ef.confidence === 'high' || ef.confidence === 'medium')) {
      status = 'upgrade'; // upgrading a low-confidence value
    } else {
      status = 'conflict'; // different value — needs review
    }

    candidates.push({
      factPath:       ef.factPath,
      section:        mapping.section,
      field:          mapping.field,
      newValue:       ef.value,
      confidence:     ef.confidence,
      existingValue:  existingValue != null ? String(existingValue) : null,
      status,
      sourceText:     ef.sourceText || '',
      documentId:     ef.documentId || '',
    });
  }

  return candidates;
}

/**
 * Apply accepted merge candidates to facts.json.
 * Only merges candidates whose factPath is in acceptedPaths.
 *
 * @param {MergeCandidate[]} plan — from buildMergePlan()
 * @param {object} facts — mutable facts.json content
 * @param {Set<string>|string[]} acceptedPaths — paths the user accepted
 * @returns {{ merged: number, skipped: number }}
 */
export function applyMergePlan(plan, facts, acceptedPaths) {
  const accepted = acceptedPaths instanceof Set ? acceptedPaths : new Set(acceptedPaths);
  let merged = 0;
  let skipped = 0;

  for (const candidate of plan) {
    if (!accepted.has(candidate.factPath)) {
      skipped++;
      continue;
    }

    // Ensure section exists
    if (!facts[candidate.section]) {
      facts[candidate.section] = {};
    }

    // Write the value in the standard facts.json format
    facts[candidate.section][candidate.field] = {
      value:      candidate.newValue,
      confidence: candidate.confidence,
      source:     `document:${candidate.documentId}`,
    };

    merged++;
  }

  return { merged, skipped };
}

/**
 * Auto-accept non-conflicting candidates from a merge plan.
 * Returns the set of fact paths that are safe to auto-merge.
 *
 * @param {MergeCandidate[]} plan
 * @returns {Set<string>}
 */
export function getAutoAcceptPaths(plan) {
  const paths = new Set();
  for (const c of plan) {
    if (c.status === 'new' || c.status === 'confirm' || c.status === 'upgrade') {
      paths.add(c.factPath);
    }
  }
  return paths;
}
