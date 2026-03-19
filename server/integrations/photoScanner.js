/**
 * server/integrations/photoScanner.js
 * -------------------------------------
 * Scans Dropbox for property photos matching a borrower name or address.
 *
 * Phase A: discovery only — returns file list with suggested labels.
 * Phase C (TODO): ACI pywinauto insertion (requires window calibration).
 *
 * Env: DROPBOX_PATH (default: C:\Users\ccres\Dropbox)
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_DROPBOX = 'C:\\Users\\ccres\\Dropbox';

/**
 * Infer a human-readable ACI photo label from a filename.
 */
export function inferPhotoLabel(filename) {
  const base = filename.replace(/\.(jpg|jpeg|png|heic|heif)$/i, '').toLowerCase();
  if (/front|subject|main/.test(base)) return 'Front View of Subject';
  if (/rear|back/.test(base)) return 'Rear View of Subject';
  if (/street/.test(base)) return 'Street Scene';
  if (/kitchen/.test(base)) return 'Kitchen';
  if (/bath/.test(base)) return 'Bathroom';
  if (/bedroom|bed/.test(base)) return 'Bedroom';
  if (/living/.test(base)) return 'Living Room';
  if (/dining/.test(base)) return 'Dining Room';
  if (/garage/.test(base)) return 'Garage';
  if (/basement/.test(base)) return 'Basement';
  if (/exterior/.test(base)) return 'Exterior';
  if (/attic/.test(base)) return 'Attic';
  if (/deck|patio/.test(base)) return 'Deck/Patio';
  if (/laundry/.test(base)) return 'Laundry Room';
  if (/office|study/.test(base)) return 'Office/Study';
  return 'Subject Photo';
}

/**
 * Score how well a folder name matches a borrower or address.
 * Higher = better match.
 */
function matchScore(folderName, borrowerName, address) {
  const folder = folderName.toLowerCase();
  let score = 0;

  if (borrowerName) {
    const parts = borrowerName.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.length >= 3 && folder.includes(part)) score += 2;
    }
  }

  if (address) {
    // Match first word of street address (house number or street name)
    const addrParts = address.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    for (const part of addrParts.slice(0, 3)) {
      if (part.length >= 3 && folder.includes(part)) score += 1;
    }
  }

  return score;
}

/**
 * Scan the Dropbox folder for photos related to a borrower or address.
 *
 * @param {string} borrowerName - borrower name from case meta
 * @param {string} address      - subject property address
 * @param {string} [dropboxPath] - override Dropbox path (uses env var or default)
 * @returns {{ found: boolean, photos: Array, folderCount: number, searchedPath: string }}
 */
export function scanDropboxForPhotos(borrowerName = '', address = '', dropboxPath = null) {
  const rootPath = dropboxPath || process.env.DROPBOX_PATH || DEFAULT_DROPBOX;

  if (!fs.existsSync(rootPath)) {
    return { found: false, photos: [], folderCount: 0, searchedPath: rootPath, error: 'Dropbox path not found' };
  }

  let entries;
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (e) {
    return { found: false, photos: [], folderCount: 0, searchedPath: rootPath, error: e.message };
  }

  // Score and sort folders by match quality
  const scored = entries
    .filter(e => e.isDirectory())
    .map(e => ({ entry: e, score: matchScore(e.name, borrowerName, address) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const photos = [];
  let folderCount = 0;

  for (const { entry } of scored) {
    const folderPath = path.join(rootPath, entry.name);
    let files;
    try {
      files = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const photoFiles = files
      .filter(f => f.isFile() && /\.(jpg|jpeg|png|heic|heif)$/i.test(f.name))
      .map(f => ({
        filename: f.name,
        fullPath: path.join(folderPath, f.name),
        relativePath: path.join(entry.name, f.name),
        folder: entry.name,
        suggestedLabel: inferPhotoLabel(f.name),
        sizeBytes: (() => { try { return fs.statSync(path.join(folderPath, f.name)).size; } catch { return 0; } })(),
      }));

    if (photoFiles.length > 0) {
      photos.push(...photoFiles);
      folderCount++;
    }
  }

  return {
    found: photos.length > 0,
    photos,
    folderCount,
    searchedPath: rootPath,
  };
}
