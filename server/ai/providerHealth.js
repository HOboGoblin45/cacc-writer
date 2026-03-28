/**
 * server/ai/providerHealth.js
 * ──────────────────────────────────────────────────────────────────────────
 * Provider Health Dashboard Data
 *
 * Exports provider health status and cost tracking information
 * for monitoring and admin dashboards.
 */

import log from '../logger.js';

// Global reference to the fallback chain (set by whoever initializes it)
let _globalChain = null;

/**
 * Set the global fallback chain instance.
 * Called by whoever initializes the chain (main server file).
 */
export function setGlobalChain(chain) {
  _globalChain = chain;
  log.info('provider-health:chain-registered');
}

/**
 * Get the global fallback chain.
 */
export function getGlobalChain() {
  return _globalChain;
}

/**
 * Get provider health report.
 * Returns status of all providers: name, healthy, lastCallMs, failCount, successCount, totalCost
 *
 * @returns {object} Health report
 */
export function getProviderHealthReport() {
  if (!_globalChain) {
    return {
      ok: false,
      error: 'Fallback chain not initialized',
      providers: [],
    };
  }

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    providers: _globalChain.getHealthReport(),
  };
}

/**
 * Get cost breakdown per provider.
 *
 * @returns {object} Cost summary
 */
export function getProviderCosts() {
  if (!_globalChain) {
    return {
      ok: false,
      error: 'Fallback chain not initialized',
    };
  }

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    summary: _globalChain.getCostSummary(),
  };
}

/**
 * Reset provider health (circuit breaker).
 *
 * @param {string} providerName - Name of provider to reset
 */
export function resetProviderHealth(providerName) {
  if (!_globalChain) {
    throw new Error('Fallback chain not initialized');
  }

  _globalChain.resetProvider(providerName);
  log.info('provider-health:reset', { provider: providerName });

  return {
    ok: true,
    provider: providerName,
    message: `Health reset for provider ${providerName}`,
  };
}

/**
 * Reset all provider health (circuit breakers).
 */
export function resetAllProviderHealth() {
  if (!_globalChain) {
    throw new Error('Fallback chain not initialized');
  }

  _globalChain.resetAll();
  log.info('provider-health:reset-all');

  return {
    ok: true,
    message: 'All provider health reset',
  };
}

/**
 * Check if providers are available.
 */
export function areProvidersAvailable() {
  if (!_globalChain) return false;
  return _globalChain.getEnabledProviders().length > 0;
}

/**
 * Get list of enabled providers.
 */
export function getEnabledProviders() {
  if (!_globalChain) return [];
  return _globalChain.getEnabledProviders().map(p => ({
    name: p.name,
    model: p.model,
    healthy: p.isHealthy(),
    priority: p.priority,
  }));
}

export default {
  setGlobalChain,
  getGlobalChain,
  getProviderHealthReport,
  getProviderCosts,
  resetProviderHealth,
  resetAllProviderHealth,
  areProvidersAvailable,
  getEnabledProviders,
};
