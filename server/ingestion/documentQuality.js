/**
 * server/ingestion/documentQuality.js
 * ------------------------------------
 * Deterministic document quality scoring for intake/extraction health.
 */

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function qualityBucket(score) {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'acceptable';
  if (score >= 50) return 'weak';
  return 'critical';
}

/**
 * Score a case document row and return flags for dashboard/QC surfacing.
 *
 * @param {object} doc
 * @returns {{ score: number, bucket: string, flags: string[] }}
 */
export function scoreDocumentQuality(doc = {}) {
  const flags = [];
  let score = 60;

  const status = String(doc.extraction_status || 'pending');
  const textLength = Number(doc.text_length || 0);
  const classConfidence = Number(doc.classification_confidence ?? 0.5);
  const hasWarning = String(doc.ingestion_warning || '').trim().length > 0;
  const isDuplicate = Boolean(doc.duplicate_of_document_id);
  const pageCount = Number(doc.page_count || 0);

  score += clamp(Math.round(classConfidence * 20), 0, 20);
  if (classConfidence < 0.6) flags.push('low_classification_confidence');

  if (status === 'extracted') score += 15;
  if (status === 'pending') score -= 8;
  if (status === 'failed') {
    score -= 35;
    flags.push('extraction_failed');
  }
  if (status === 'skipped') score -= 10;

  if (textLength === 0) {
    score -= 20;
    flags.push('no_extracted_text');
  } else if (textLength < 80) {
    score -= 15;
    flags.push('very_low_text');
  } else if (textLength < 250) {
    score -= 8;
    flags.push('low_text');
  } else if (textLength > 1200) {
    score += 4;
  }

  if (pageCount > 0 && textLength > 0) {
    const charsPerPage = textLength / pageCount;
    if (charsPerPage < 90) {
      score -= 8;
      flags.push('possible_ocr_gap');
    }
  }

  if (isDuplicate) {
    score -= 12;
    flags.push('duplicate_document');
  }

  if (hasWarning) {
    score -= 10;
    flags.push('ingestion_warning');
  }

  score = clamp(score, 0, 100);
  return {
    score,
    bucket: qualityBucket(score),
    flags,
  };
}

/**
 * Build aggregate metrics over many documents.
 *
 * @param {object[]} documents
 * @returns {{averageScore:number|null, buckets:object, warningCount:number, duplicateCount:number, lowQualityCount:number, flaggedDocuments:object[]}}
 */
export function summarizeDocumentQuality(documents = []) {
  const buckets = {
    strong: 0,
    acceptable: 0,
    weak: 0,
    critical: 0,
  };

  if (!Array.isArray(documents) || documents.length === 0) {
    return {
      averageScore: null,
      buckets,
      warningCount: 0,
      duplicateCount: 0,
      lowQualityCount: 0,
      flaggedDocuments: [],
    };
  }

  let totalScore = 0;
  let warningCount = 0;
  let duplicateCount = 0;
  let lowQualityCount = 0;
  const flagged = [];

  for (const doc of documents) {
    const quality = scoreDocumentQuality(doc);
    totalScore += quality.score;
    buckets[quality.bucket] += 1;

    if (doc?.ingestion_warning) warningCount += 1;
    if (doc?.duplicate_of_document_id) duplicateCount += 1;
    if (quality.score < 70) lowQualityCount += 1;

    if (quality.score < 70 || quality.flags.length > 0) {
      flagged.push({
        documentId: doc.id,
        originalFilename: doc.original_filename,
        docType: doc.doc_type,
        score: quality.score,
        bucket: quality.bucket,
        flags: quality.flags,
        warning: doc.ingestion_warning || null,
      });
    }
  }

  flagged.sort((a, b) => a.score - b.score);

  return {
    averageScore: Math.round(totalScore / documents.length),
    buckets,
    warningCount,
    duplicateCount,
    lowQualityCount,
    flaggedDocuments: flagged.slice(0, 10),
  };
}

