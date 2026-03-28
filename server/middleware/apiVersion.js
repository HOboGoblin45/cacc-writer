/**
 * server/middleware/apiVersion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * API versioning middleware.
 *
 * Adds version metadata to every API response:
 *   X-API-Version: 3.1.0
 *   X-Deprecation-Warning: (if applicable)
 *
 * Also reads an optional client version header to support backward compatibility.
 *
 * Usage in server:
 *   import { apiVersionMiddleware, API_VERSION } from './middleware/apiVersion.js';
 *   app.use('/api', apiVersionMiddleware());
 */

/**
 * Current API version string.
 * Follows SemVer: MAJOR.MINOR.PATCH
 *   - MAJOR: breaking changes
 *   - MINOR: new features (backward compatible)
 *   - PATCH: bug fixes
 */
export const API_VERSION = '3.1.0';

/**
 * Minimum client version that is still supported.
 * Clients below this version receive a deprecation warning.
 */
export const MIN_SUPPORTED_VERSION = '2.0.0';

/**
 * Parse a SemVer string into [major, minor, patch].
 * Returns null if the string is not valid SemVer.
 *
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
function parseSemVer(version) {
  if (!version || typeof version !== 'string') return null;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two SemVer tuples.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 *
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {-1 | 0 | 1}
 */
function compareSemVer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * API versioning middleware.
 *
 * Sets X-API-Version on every response.
 * Reads X-Client-Version from request to check compatibility.
 * Adds deprecation warning if client version is below minimum.
 *
 * @param {object} [options]
 * @param {string} [options.version] — override API version (for testing)
 * @param {string} [options.minVersion] — override minimum supported version
 * @returns {import('express').RequestHandler}
 */
export function apiVersionMiddleware(options = {}) {
  const version = options.version || API_VERSION;
  const minVersion = options.minVersion || MIN_SUPPORTED_VERSION;
  const minParsed = parseSemVer(minVersion);

  return (req, _res, next) => {
    _res.setHeader('X-API-Version', version);

    // Check client version if provided
    const clientVersion = req.headers['x-client-version'];
    if (clientVersion) {
      const clientParsed = parseSemVer(clientVersion);
      if (clientParsed && minParsed && compareSemVer(clientParsed, minParsed) < 0) {
        _res.setHeader(
          'X-Deprecation-Warning',
          `Client version ${clientVersion} is below minimum supported version ${minVersion}. Please upgrade.`
        );
      }
      // Expose client version on request for downstream use
      req.clientVersion = clientVersion;
    }

    next();
  };
}

export { parseSemVer, compareSemVer };
export default { apiVersionMiddleware, API_VERSION, MIN_SUPPORTED_VERSION, parseSemVer, compareSemVer };
