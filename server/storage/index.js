/**
 * server/storage/index.js
 * ======================
 * Barrel export for storage module.
 *
 * @example
 * import { getStorageAdapter, createStorageAdapter } from '../storage/index.js';
 * import { StorageAdapter } from '../storage/index.js';
 * import { R2StorageAdapter, S3StorageAdapter, LocalStorageAdapter, DualWriteAdapter } from '../storage/index.js';
 */

export { StorageAdapter } from './StorageAdapter.js';
export { LocalStorageAdapter } from './LocalStorageAdapter.js';
export { R2StorageAdapter } from './R2StorageAdapter.js';
export { S3StorageAdapter } from './S3StorageAdapter.js';
export { DualWriteAdapter } from './DualWriteAdapter.js';
export { createStorageAdapter, getStorageAdapter, _resetStorageAdapter, _setStorageAdapter } from './StorageFactory.js';
