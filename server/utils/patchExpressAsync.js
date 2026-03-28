import express from 'express';

const ROUTER_METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete'];
const WRAPPED = Symbol.for('cacc-writer.expressAsyncWrapped');

function isPromiseLike(value) {
  return Boolean(value) && typeof value.then === 'function';
}

function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler.length === 4) return handler;
  if (handler[WRAPPED]) return handler;

  const wrapped = function wrappedAsyncHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (isPromiseLike(result)) {
        result.catch(next);
      }
      return result;
    } catch (err) {
      return next(err);
    }
  };

  Object.defineProperty(wrapped, WRAPPED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return wrapped;
}

const routerPrototype = Object.getPrototypeOf(express.Router());

for (const method of ROUTER_METHODS) {
  const original = routerPrototype[method];
  if (typeof original !== 'function' || original[WRAPPED]) continue;

  const patched = function patchedRouterMethod(...args) {
    return original.call(this, ...args.map(wrapHandler));
  };

  Object.defineProperty(patched, WRAPPED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  routerPrototype[method] = patched;
}
