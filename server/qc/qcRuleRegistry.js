/**
 * server/qc/qcRuleRegistry.js
 * ------------------------------
 * Phase 7 — QC Rule Registry
 *
 * Central registry of all QC rules. Each rule is a structured, inspectable
 * definition with metadata and a check function.
 *
 * Rules are organized by category and can be filtered by:
 *   - report family
 *   - assignment flags
 *   - scope
 *   - active state
 *
 * The registry is the single source of truth for what QC checks exist.
 * Checker modules register their rules here at import time.
 *
 * Usage:
 *   import { getRegistry, getApplicableRules } from './qcRuleRegistry.js';
 */

import log from '../logger.js';

/** @type {Map<string, import('./types.js').QCRuleDefinition>} */
const registry = new Map();

/** Current rule set version — bump when rules change materially */
export const RULE_SET_VERSION = '7.1.0';

// ── Registry API ────────────────────────────────────────────────────────────

/**
 * Register a QC rule definition.
 * @param {import('./types.js').QCRuleDefinition} rule
 */
export function registerRule(rule) {
  if (!rule.ruleId) throw new Error('QC rule must have a ruleId');
  if (registry.has(rule.ruleId)) {
    log.warn('qc-registry:duplicate-rule', { ruleId: rule.ruleId });
  }
  registry.set(rule.ruleId, rule);
}

/**
 * Register multiple rules at once.
 * @param {import('./types.js').QCRuleDefinition[]} rules
 */
export function registerRules(rules) {
  for (const rule of rules) {
    registerRule(rule);
  }
}

/**
 * Get the full registry map.
 * @returns {Map<string, import('./types.js').QCRuleDefinition>}
 */
export function getRegistry() {
  return registry;
}

/**
 * Get a single rule by ID.
 * @param {string} ruleId
 * @returns {import('./types.js').QCRuleDefinition | undefined}
 */
export function getRule(ruleId) {
  return registry.get(ruleId);
}

/**
 * Get all active rules applicable to a given context.
 *
 * Filtering logic:
 *   1. Rule must be active
 *   2. If rule specifies applicableReportFamilies, the current report family must match
 *   3. If rule specifies applicableFlags, at least one flag must be true in the context
 *
 * @param {Object} opts
 * @param {string} opts.reportFamilyId
 * @param {Object} opts.flags — DerivedAssignmentFlags
 * @returns {import('./types.js').QCRuleDefinition[]}
 */
export function getApplicableRules({ reportFamilyId, flags }) {
  const applicable = [];

  for (const rule of registry.values()) {
    // Skip inactive rules
    if (!rule.active) continue;

    // Check report family applicability
    if (rule.applicableReportFamilies && rule.applicableReportFamilies.length > 0) {
      if (!rule.applicableReportFamilies.includes(reportFamilyId)) continue;
    }

    // Check flag applicability — at least one listed flag must be true
    if (rule.applicableFlags && rule.applicableFlags.length > 0) {
      const hasMatchingFlag = rule.applicableFlags.some(f => flags[f] === true);
      if (!hasMatchingFlag) continue;
    }

    applicable.push(rule);
  }

  return applicable;
}

/**
 * Get all rules grouped by category.
 * @returns {Object<string, import('./types.js').QCRuleDefinition[]>}
 */
export function getRulesByCategory() {
  const grouped = {};
  for (const rule of registry.values()) {
    const cat = rule.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(rule);
  }
  return grouped;
}

/**
 * Get registry stats for health/debug endpoints.
 * @returns {{ total: number, active: number, byCategory: Object<string, number>, byType: Object<string, number> }}
 */
export function getRegistryStats() {
  let active = 0;
  const byCategory = {};
  const byType = {};

  for (const rule of registry.values()) {
    if (rule.active) active++;
    byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    byType[rule.ruleType] = (byType[rule.ruleType] || 0) + 1;
  }

  return {
    total: registry.size,
    active,
    byCategory,
    byType,
    ruleSetVersion: RULE_SET_VERSION,
  };
}

/**
 * List all rule IDs (for debugging / admin).
 * @returns {string[]}
 */
export function listRuleIds() {
  return Array.from(registry.keys());
}
