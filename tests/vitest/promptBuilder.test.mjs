/**
 * tests/vitest/promptBuilder.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the prompt builder — message assembly, facts formatting,
 * assignment context, and review message generation.
 *
 * Mocks filesystem and knowledge base dependencies to isolate prompt logic.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';

// Mock fs so loadPromptFile doesn't need real files
vi.mock('fs', () => ({
  default: {
    readFileSync: (filePath) => {
      const name = path.basename(filePath);
      if (name === 'system_cacc_writer.txt') return 'You are CACC Appraiser, an AI narrative writer.';
      if (name === 'style_guide_cresci.txt') return 'Write in professional appraisal style.';
      if (name === 'review_pass.txt') return 'Review the following draft for quality.';
      return '';
    },
    existsSync: () => true,
  },
  readFileSync: (filePath) => {
    const name = path.basename(filePath);
    if (name === 'system_cacc_writer.txt') return 'You are CACC Appraiser, an AI narrative writer.';
    if (name === 'style_guide_cresci.txt') return 'Write in professional appraisal style.';
    if (name === 'review_pass.txt') return 'Review the following draft for quality.';
    return '';
  },
  existsSync: () => true,
}));

// Mock retrieval.js
vi.mock('../../server/retrieval.js', () => ({
  formatExamplesBlock: (examples) => examples?.length ? `[${examples.length} examples]` : '',
  formatVoiceExamplesBlock: (examples) => examples?.length ? `[${examples.length} voice examples]` : '',
}));

// Mock knowledgeBase.js
vi.mock('../../server/knowledgeBase.js', () => ({
  getPhrases: () => [],
  getNarrativeTemplate: () => null,
}));

// Mock forms/index.js
vi.mock('../../forms/index.js', () => ({
  getFormConfig: () => null,
}));

// Mock neighborhoodContext.js
vi.mock('../../server/neighborhoodContext.js', () => ({
  LOCATION_CONTEXT_FIELDS: new Set(['neighborhood_description', 'site_description']),
}));

// Mock fieldRegistry.js
vi.mock('../../server/fieldRegistry.js', () => ({
  getFieldLabel: (formType, fieldId) => fieldId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  getPhraseTags: () => ['general'],
}));

import { buildPromptMessages, buildReviewMessages, buildApproveEditPrompt } from '../../server/promptBuilder.js';

// ── buildPromptMessages ──────────────────────────────────────────────────────

describe('buildPromptMessages', () => {
  it('should return an array of messages with system and user roles', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
    });

    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // First should be system role
    expect(messages[0].role).toBe('system');

    // Last should be user role
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('should include system prompt content', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
    });

    const systemContent = messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
    expect(systemContent).toContain('CACC Appraiser');
  });

  it('should include facts in the prompt when provided', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'site_description',
      facts: {
        subject: {
          address: { value: '123 Main St', confidence: 'high' },
          city: { value: 'Springfield', confidence: 'high' },
        },
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('123 Main St');
    expect(allContent).toContain('Springfield');
  });

  it('should annotate medium confidence facts with hedging', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'site_description',
      facts: {
        subject: {
          lotSize: { value: '0.25 acres', confidence: 'medium' },
        },
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('medium');
    expect(allContent).toContain('hedged');
  });

  it('should replace low confidence facts with [INSERT]', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'site_description',
      facts: {
        subject: {
          zoningCode: { value: 'R-1', confidence: 'low' },
        },
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('[INSERT]');
  });

  it('should include voice examples when provided', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
      voiceExamples: [
        { text: 'The neighborhood is suburban in character...', source: 'approved' },
      ],
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('1 voice examples');
  });

  it('should include other examples when provided', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
      examples: [
        { text: 'Example text 1', source: 'curated' },
        { text: 'Example text 2', source: 'curated' },
      ],
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('2 examples');
  });

  it('should include assignment context when provided', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
      assignmentMeta: {
        assignmentPurpose: 'Purchase',
        loanProgram: 'FHA',
        propertyType: 'SFR',
        county: 'McLean',
        state: 'IL',
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('FHA');
    expect(allContent).toContain('McLean');
  });

  it('should include FHA-specific guidance for FHA loans', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'improvements_description',
      assignmentMeta: { loanProgram: 'FHA' },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('FHA');
    expect(allContent.toLowerCase()).toContain('minimum property standards');
  });

  it('should include location context when provided', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
      locationContext: 'The subject is located 2 miles from downtown. Nearby schools include Lincoln Elementary.',
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('Lincoln Elementary');
  });

  it('should include the field label in the user message', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'neighborhood_description',
    });

    const userMsg = messages[messages.length - 1];
    expect(userMsg.content.toLowerCase()).toContain('neighborhood');
  });

  it('should skip empty facts sections', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'site_description',
      facts: {
        subject: {},
        market: {},
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    // Should not have empty section headers
    expect(allContent).not.toContain('SUBJECT:\n\n');
  });

  it('should handle array facts (comps)', () => {
    const messages = buildPromptMessages({
      formType: '1004',
      fieldId: 'sales_comparison',
      facts: {
        comps: [
          { address: { value: '456 Oak Ave', confidence: 'high' }, salePrice: { value: '$250,000', confidence: 'high' } },
          { address: { value: '789 Elm St', confidence: 'high' }, salePrice: { value: '$265,000', confidence: 'medium' } },
        ],
      },
    });

    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('456 Oak Ave');
    expect(allContent).toContain('$250,000');
  });
});

// ── buildReviewMessages ──────────────────────────────────────────────────────

describe('buildReviewMessages', () => {
  it('should return messages array with system and user roles', () => {
    const messages = buildReviewMessages({
      draftText: 'The neighborhood is primarily residential in nature with single-family homes.',
      facts: { subject: { address: '123 Main St' } },
      fieldId: 'neighborhood_description',
      formType: '1004',
    });

    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe('system');
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('should include the draft text in the user message', () => {
    const draftText = 'The subject property is a well-maintained single-family residence.';
    const messages = buildReviewMessages({
      draftText,
      facts: {},
      fieldId: 'improvements_description',
      formType: '1004',
    });

    const userMsg = messages[messages.length - 1].content;
    expect(userMsg).toContain(draftText);
  });

  it('should include review instructions in system message', () => {
    const messages = buildReviewMessages({
      draftText: 'Some draft text here.',
      facts: {},
      fieldId: 'site_description',
      formType: '1004',
    });

    const systemContent = messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
    expect(systemContent).toContain('Review');
  });
});

// ── buildApproveEditPrompt ───────────────────────────────────────────────────

describe('buildApproveEditPrompt', () => {
  it('should return messages array with original and edited text', () => {
    const result = buildApproveEditPrompt(
      'The neighborhood is stable.',
      'The neighborhood is stable with increasing demand for housing.'
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');

    const userContent = result[1].content;
    expect(userContent).toContain('The neighborhood is stable.');
    expect(userContent).toContain('increasing demand');
    expect(userContent).toContain('ORIGINAL');
    expect(userContent).toContain('EDITED');
  });

  it('should handle identical texts', () => {
    const text = 'No changes were made.';
    const result = buildApproveEditPrompt(text, text);
    expect(Array.isArray(result)).toBe(true);
    expect(result[1].content).toContain(text);
  });
});
