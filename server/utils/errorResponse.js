import { sendError } from './routeUtils.js';

export function sendErrorResponse(res, err, options = {}) {
  const defaultStatus = Number(options.defaultStatus) || 500;
  const status = Number(options.status || err?.status || err?.statusCode) || defaultStatus;
  const detail = String(err?.message || options.fallbackMessage || 'Request failed');
  const publicMessage = options.publicMessage || (status >= 500 ? 'Internal server error' : detail);
  const extra = { ...(options.extra || {}) };

  if (status >= 500 && process.env.NODE_ENV !== 'production' && !Object.prototype.hasOwnProperty.call(extra, 'detail')) {
    extra.detail = detail;
  }

  const code = options.code || err?.code;
  return sendError(res, status, publicMessage, code ? String(code) : undefined, extra);
}
