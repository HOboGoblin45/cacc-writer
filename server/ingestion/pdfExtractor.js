/**
 * server/ingestion/pdfExtractor.js
 * ----------------------------------
 * 3-stage PDF text extraction pipeline.
 *
 * Stage 1: pdf-parse        — fast, works for digitally-created PDFs
 * Stage 2: pdfjs-dist       — handles more PDF variants (forms, tagged PDFs)
 * Stage 3: OCR via Vision   — renders pages with pdfjs-dist + @napi-rs/canvas,
 *                             then sends images to OpenAI Vision for text extraction
 *
 * Usage:
 *   import { extractPdfText } from '../ingestion/pdfExtractor.js';
 *   const { text, method } = await extractPdfText(buffer, client, model);
 *
 * Returns:
 *   { text: string, method: 'pdf-parse'|'pdfjs-text'|'ocr-vision'|'failed', error?: string }
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const require    = createRequire(import.meta.url);

// ── pdf-parse (CommonJS) ──────────────────────────────────────────────────────
const pdfParse = require('pdf-parse');

// ── @napi-rs/canvas (optional — OCR stage 3 only) ────────────────────────────
let napiCreateCanvas = null;
try {
  ({ createCanvas: napiCreateCanvas } = require('@napi-rs/canvas'));
} catch (e) {
  log.warn('pdfExtractor:canvas', { error: e.message, detail: 'OCR stage 3 unavailable (@napi-rs/canvas not loaded)' });
}

// ── pdfjs-dist worker path ────────────────────────────────────────────────────
const PDFJS_WORKER_SRC =
  'file:///' +
  path.join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
    .replace(/\\/g, '/');

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * extractPdfText(buffer, aiClient, model)
 *
 * Attempts to extract text from a PDF buffer using three progressive stages.
 * Returns as soon as a stage produces ≥ 200 characters of text.
 *
 * @param {Buffer}      buffer   — raw PDF file buffer
 * @param {object|null} aiClient — OpenAI client instance (required for stage 3 OCR)
 * @param {string}      model    — OpenAI model name (e.g. 'gpt-4.1')
 *
 * @returns {Promise<{ text: string, method: string, error?: string }>}
 */
export async function extractPdfText(buffer, aiClient, model) {
  // ── Stage 1: pdf-parse ────────────────────────────────────────────────────
  try {
    const p    = await pdfParse(buffer);
    const text = (p.text || '')
      .replace(/\n{4,}/g, '\n\n')
      .replace(/[ \t]{3,}/g, '  ')
      .trim();
    if (text.length >= 200) return { text, method: 'pdf-parse' };
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('encrypt') || msg.includes('password')) {
      return {
        text:   '',
        method: 'failed',
        error:  'PDF is password-protected. Remove the password and try again.',
      };
    }
  }

  // ── Stage 2: pdfjs-dist text extraction ──────────────────────────────────
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    const pdf = await pdfjsLib.getDocument({
      data:             new Uint8Array(buffer),
      useWorkerFetch:   false,
      isEvalSupported:  false,
      useSystemFonts:   true,
    }).promise;

    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str || '').join(' ') + '\n';
    }
    const text = fullText
      .replace(/\n{4,}/g, '\n\n')
      .replace(/[ \t]{3,}/g, '  ')
      .trim();
    if (text.length >= 200) return { text, method: 'pdfjs-text' };
  } catch { /* fall through to stage 3 */ }

  // ── Stage 3: OCR via OpenAI Vision ───────────────────────────────────────
  if (!aiClient) {
    return {
      text:   '',
      method: 'failed',
      error:  'PDF appears image-based and no AI client is available for OCR.',
    };
  }
  if (!napiCreateCanvas) {
    return {
      text:   '',
      method: 'failed',
      error:  'PDF appears image-based but OCR canvas is unavailable (@napi-rs/canvas failed to load).',
    };
  }

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

    class NodeCanvasFactory {
      create(w, h) {
        const canvas = napiCreateCanvas(w, h);
        return { canvas, context: canvas.getContext('2d') };
      }
      reset(cc, w, h) {
        cc.canvas.width  = w;
        cc.canvas.height = h;
      }
      destroy(cc) {
        cc.canvas.width  = 0;
        cc.canvas.height = 0;
        cc.canvas        = null;
        cc.context       = null;
      }
    }

    const pdf       = await pdfjsLib.getDocument({
      data:            new Uint8Array(buffer),
      useWorkerFetch:  false,
      isEvalSupported: false,
      useSystemFonts:  true,
    }).promise;
    const pageCount = Math.min(pdf.numPages, 15);
    let ocrText     = '';

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page     = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const factory  = new NodeCanvasFactory();
        const cc       = factory.create(
          Math.round(viewport.width),
          Math.round(viewport.height),
        );

        await page.render({
          canvasContext: cc.context,
          viewport,
          canvasFactory: factory,
        }).promise;

        const base64 = cc.canvas.toBuffer('image/png').toString('base64');
        factory.destroy(cc);

        const r = await aiClient.responses.create(
          {
            model,
            input: [{
              role:    'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Extract all text from this appraisal report page. Return raw text only, preserving paragraph structure. No commentary.',
                },
                {
                  type:      'input_image',
                  image_url: 'data:image/png;base64,' + base64,
                  detail:    'high',
                },
              ],
            }],
          },
          { signal: AbortSignal.timeout(30_000) },
        );

        ocrText += (r.output_text || '') + '\n\n';
      } catch (pageErr) {
        log.warn('pdfExtractor:ocr', { page: i, error: pageErr.message });
      }
    }

    const text = ocrText.replace(/\n{4,}/g, '\n\n').trim();
    if (text.length >= 200) return { text, method: 'ocr-vision' };
    return { text: '', method: 'failed', error: 'OCR extracted insufficient text from this PDF.' };
  } catch (err) {
    return { text: '', method: 'failed', error: 'OCR failed: ' + err.message };
  }
}
