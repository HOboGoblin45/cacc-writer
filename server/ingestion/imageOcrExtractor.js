/**
 * server/ingestion/imageOcrExtractor.js
 * ---------------------------------------
 * OCR extractor for uploaded image documents (PNG/JPG/WEBP/TIFF).
 */

import log from '../logger.js';

const EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

function normalizeText(value) {
  return String(value || '')
    .replace(/\n{4,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}

function resolveMimeType(ext = '', mimeHint = '') {
  const normalizedHint = String(mimeHint || '').toLowerCase();
  if (normalizedHint.startsWith('image/')) return normalizedHint;
  return EXT_TO_MIME[String(ext || '').toLowerCase()] || 'image/png';
}

/**
 * Extract text from an image via OpenAI Vision.
 *
 * @param {Buffer} buffer
 * @param {object} options
 * @param {object|null} options.aiClient
 * @param {string} options.model
 * @param {string} [options.ext]
 * @param {string} [options.mimeType]
 * @returns {Promise<{ text: string, method: string, error?: string }>}
 */
export async function extractImageText(buffer, options = {}) {
  const aiClient = options.aiClient || null;
  const model = options.model;
  const mimeType = resolveMimeType(options.ext, options.mimeType);

  if (!buffer || !buffer.length) {
    return { text: '', method: 'failed', error: 'Image file was empty.' };
  }

  if (!aiClient) {
    return {
      text: '',
      method: 'image_no_ocr',
      error: 'Image OCR unavailable because OpenAI client is not configured.',
    };
  }

  try {
    const base64 = Buffer.from(buffer).toString('base64');
    const response = await aiClient.responses.create(
      {
        model,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Extract all readable text from this appraisal-related image. Return raw text only.',
            },
            {
              type: 'input_image',
              image_url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          ],
        }],
      },
      { signal: AbortSignal.timeout(30_000) },
    );

    const text = normalizeText(response?.output_text || '');
    if (text.length < 20) {
      return {
        text: '',
        method: 'failed',
        error: 'Image OCR returned insufficient text.',
      };
    }

    return { text, method: 'ocr-vision-image' };
  } catch (err) {
    log.warn('imageExtractor:ocr', { error: err.message });
    return {
      text: '',
      method: 'failed',
      error: `Image OCR failed: ${err.message}`,
    };
  }
}

