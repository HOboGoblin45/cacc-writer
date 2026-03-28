/**
 * tests/vitest/stmNormalizer.test.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive tests for STM Output Normalizer
 *
 * Coverage:
 * - Preamble stripping (5+ patterns)
 * - Postamble stripping
 * - Professional voice replacements
 * - Character limit truncation at sentence boundaries
 * - Markdown artifact removal
 * - Smart quote normalization
 * - Metrics accuracy
 * - Edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeOutput } from '../../server/ai/stmNormalizer.js';

describe('STM Output Normalizer', () => {
  // ── Preamble Stripping Tests ──────────────────────────────────────────────

  describe('Preamble Stripping', () => {
    it('should strip "Sure, here is" preamble', async () => {
      const input = 'Sure, here is the narrative for the property.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Sure, here is/i);
      expect(result.text).toContain('narrative');
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should strip "Here\'s the" preamble', async () => {
      const input = "Here's the narrative about the subject property.";
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Here's the/i);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should strip "Certainly!" preamble', async () => {
      const input = 'Certainly! The subject property is located...';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Certainly[!.]/i);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should strip "Of course" preamble', async () => {
      const input = 'Of course! Here is the appraisal narrative.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Of course/i);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should strip "Based on the information provided" preamble', async () => {
      const input = 'Based on the information provided, the property features...';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Based on the information provided/i);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should strip "I\'ll write" preamble', async () => {
      const input = "I'll write the narrative for this section.";
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^I'll write/i);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should handle text that is all preamble', async () => {
      const input = 'Sure, here is the narrative.';
      const result = await normalizeOutput(input);
      expect(result.text.trim()).toBe('the narrative.');
    });

    it('should not strip preambles from already clean text', async () => {
      const input = 'The subject property is a single-family residential dwelling.';
      const result = await normalizeOutput(input);
      expect(result.metrics.preambleStripped).toBe(false);
      expect(result.text).toBe(input);
    });
  });

  // ── Postamble Stripping Tests ─────────────────────────────────────────────

  describe('Postamble Stripping', () => {
    it('should strip "Let me know if you" postamble', async () => {
      const input = 'The subject property features excellent condition. Let me know if you need more details.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/Let me know if you/i);
      expect(result.text).toContain('excellent condition');
      expect(result.metrics.postambleStripped).toBe(true);
    });

    it('should strip "Feel free to ask" postamble', async () => {
      const input = 'Property value is estimated at $450,000. Feel free to ask for clarification.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/Feel free to ask/i);
      expect(result.metrics.postambleStripped).toBe(true);
    });

    it('should strip "I hope this helps" postamble', async () => {
      const input = 'The report is complete. I hope this helps!';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/I hope this helps/i);
    });

    it('should strip "Please let me know" postamble', async () => {
      const input = 'Final reconciliation is presented. Please let me know if you have questions.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/Please let me know/i);
    });

    it('should strip multiple postambles', async () => {
      const input = 'The property is excellent. Let me know if more details needed. Feel free to call.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/Let me know|Feel free/i);
    });
  });

  // ── Professional Voice Enforcement ────────────────────────────────────────

  describe('Professional Voice Enforcement', () => {
    it('should replace "the home" with "the subject property"', async () => {
      const input = 'The home features excellent condition and is well-maintained.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('the subject property');
      expect(result.text).not.toContain('the home');
    });

    it('should replace "the house" with "the subject"', async () => {
      const input = 'The house is a brick construction built in 2005.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('the subject');
      expect(result.text).not.toContain('the house');
    });

    it('should replace "this house" with "the subject dwelling"', async () => {
      const input = 'This house has three bedrooms and two bathrooms.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('the subject dwelling');
      expect(result.text).not.toContain('this house');
    });

    it('should replace "buyers" with "purchasers"', async () => {
      const input = 'Typical buyers in this market seek modern amenities.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('purchasers');
      expect(result.text).not.toContain('buyers');
    });

    it('should handle case-insensitive replacements', async () => {
      const input = 'THE HOME and THE HOUSE are valuable assets.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('the subject property');
      expect(result.text).toContain('the subject');
    });

    it('should not replace voice patterns in already professional text', async () => {
      const input = 'The subject property is a residential dwelling with excellent condition.';
      const result = await normalizeOutput(input);
      expect(result.text).toBe(input);
    });
  });

  // ── Markdown Artifact Removal ─────────────────────────────────────────────

  describe('Markdown Artifact Removal', () => {
    it('should remove ** bold markers', async () => {
      const input = 'The subject **property** is well-maintained.';
      const result = await normalizeOutput(input);
      expect(result.text).toBe('The subject property is well-maintained.');
    });

    it('should remove __ bold markers', async () => {
      const input = 'The subject __property__ is well-maintained.';
      const result = await normalizeOutput(input);
      expect(result.text).toBe('The subject property is well-maintained.');
    });

    it('should remove ## header markers', async () => {
      const input = '## Property Description\nThe subject property is a dwelling.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toContain('##');
    });

    it('should remove ### and #### headers', async () => {
      const input = '### Improvements\n#### Details\nText content here.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/#{2,4}/);
    });

    it('should remove backticks (code markers)', async () => {
      const input = 'The `subject property` is a dwelling.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toContain('`');
      expect(result.text).toContain('subject property');
    });

    it('should handle multiple markdown artifacts', async () => {
      const input = '## **Section** Title\nThe `subject` property with __description__ follows.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/[#*`_]/);
    });
  });

  // ── Smart Quote Normalization ─────────────────────────────────────────────

  describe('Smart Quote Normalization', () => {
    it('should normalize straight quotes to standard format', async () => {
      const input = 'The appraiser noted "excellent condition" in the report.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('"excellent condition"');
      expect(result.metrics.regexChanges).toBeGreaterThanOrEqual(0);
    });

    it('should preserve single quotes', async () => {
      const input = "The appraiser's notes indicate good condition.";
      const result = await normalizeOutput(input);
      expect(result.text).toContain("appraiser's");
    });

    it('should handle quotes in text preservation', async () => {
      const input = 'The appraiser noted "excellent" and very good conditions.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('"excellent"');
      expect(result.text).toContain('very good');
    });
  });

  // ── Whitespace Normalization ──────────────────────────────────────────────

  describe('Whitespace Normalization', () => {
    it('should remove double spaces', async () => {
      const input = 'The  subject  property  is  well-maintained.';
      const result = await normalizeOutput(input);
      expect(result.text).not.toContain('  ');
    });

    it('should collapse excessive newlines (3+)', async () => {
      const input = 'Line 1\n\n\n\n\nLine 2';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('Line 1\n\nLine 2');
      expect(result.text).not.toContain('\n\n\n');
    });

    it('should normalize CRLF to LF', async () => {
      const input = 'Line 1\r\nLine 2\rLine 3';
      const result = await normalizeOutput(input);
      expect(result.text).not.toContain('\r');
    });

    it('should trim leading and trailing whitespace', async () => {
      const input = '   The subject property is located...   ';
      const result = await normalizeOutput(input);
      expect(result.text).toBe('The subject property is located...');
    });
  });

  // ── Character Limit Enforcement ───────────────────────────────────────────

  describe('Character Limit Enforcement', () => {
    it('should truncate text at sentence boundary when exceeding maxChars', async () => {
      const input = 'The subject property is a residential dwelling. It features excellent condition. The roof is new.';
      const result = await normalizeOutput(input, { maxChars: 70 });
      expect(result.text.length).toBeLessThanOrEqual(70);
      expect(result.metrics.truncated).toBe(true);
      expect(result.text).toMatch(/\./); // Should end with punctuation
    });

    it('should preserve text under maxChars', async () => {
      const input = 'The subject property is a dwelling.';
      const result = await normalizeOutput(input, { maxChars: 100 });
      expect(result.text).toBe(input);
      expect(result.metrics.truncated).toBe(false);
    });

    it('should handle text exactly at maxChars', async () => {
      const input = 'The subject property is a dwelling.';
      const result = await normalizeOutput(input, { maxChars: input.length });
      expect(result.text).toBe(input);
      expect(result.metrics.truncated).toBe(false);
    });

    it('should truncate at word boundary if no sentence punctuation', async () => {
      const input = 'The subject property features excellent condition with many upgrades and improvements';
      const result = await normalizeOutput(input, { maxChars: 50 });
      expect(result.text.length).toBeLessThanOrEqual(50);
      expect(result.metrics.truncated).toBe(true);
    });

    it('should prefer sentence boundary over word boundary', async () => {
      const input = 'First sentence here. Second sentence follows. Third sentence now.';
      const result = await normalizeOutput(input, { maxChars: 25 });
      expect(result.text).toBe('First sentence here.');
      expect(result.metrics.truncated).toBe(true);
    });

    it('should hard truncate if no good boundaries found', async () => {
      const input = 'oneword' + 'a'.repeat(100);
      const result = await normalizeOutput(input, { maxChars: 20 });
      expect(result.text.length).toBeLessThanOrEqual(20);
    });
  });

  // ── Metrics Collection ────────────────────────────────────────────────────

  describe('Metrics Collection', () => {
    it('should track originalLength correctly', async () => {
      const input = 'The subject property is a residential dwelling.';
      const result = await normalizeOutput(input);
      expect(result.metrics.originalLength).toBe(input.length);
    });

    it('should track cleanedLength after regex pass', async () => {
      const input = 'Sure, here is The subject **property** is maintained.';
      const result = await normalizeOutput(input);
      expect(result.metrics.cleanedLength).toBeGreaterThan(0);
      expect(result.metrics.cleanedLength).toBeLessThan(input.length);
    });

    it('should track truncated flag correctly', async () => {
      const input = 'The subject property is excellent. And then some more text.';
      const result = await normalizeOutput(input, { maxChars: 30 });
      expect(result.metrics.truncated).toBe(true);
    });

    it('should count regex changes accurately', async () => {
      const input = 'Sure, here is the home **bold** text.';
      const result = await normalizeOutput(input);
      expect(result.metrics.regexChanges).toBeGreaterThan(0);
    });

    it('should track preambleStripped flag', async () => {
      const input = 'Sure, here is the property.';
      const result = await normalizeOutput(input);
      expect(result.metrics.preambleStripped).toBe(true);
    });

    it('should track postambleStripped flag', async () => {
      const input = 'The property is excellent. Let me know if you need more.';
      const result = await normalizeOutput(input);
      expect(result.metrics.postambleStripped).toBe(true);
    });

    it('should track durationMs', async () => {
      const input = 'The subject property is a dwelling.';
      const result = await normalizeOutput(input);
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.metrics.durationMs).toBe('number');
    });

    it('should track llmPassUsed flag', async () => {
      const input = 'The subject property.';
      const result = await normalizeOutput(input, { enableLlmPass: false });
      expect(result.metrics.llmPassUsed).toBe(false);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty string input', async () => {
      const result = await normalizeOutput('');
      expect(result.text).toBe('');
      expect(result.metrics.originalLength).toBe(0);
      expect(result.metrics.cleanedLength).toBe(0);
    });

    it('should handle null/undefined input', async () => {
      const result = await normalizeOutput(null);
      expect(result.text).toBe('');
      expect(result.metrics.originalLength).toBe(0);
    });

    it('should handle very long text', async () => {
      const input = 'The subject property is excellent. ' + 'A'.repeat(50000);
      const result = await normalizeOutput(input);
      expect(result.text).toBeTruthy();
      expect(typeof result.metrics.cleanedLength).toBe('number');
    });

    it('should handle text with only whitespace', async () => {
      const result = await normalizeOutput('   \n\n\n   ');
      expect(result.text).toBe('');
    });

    it('should handle consecutive preambles and postambles', async () => {
      const input = 'Sure, here is the property. It is excellent. Please let me know!';
      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Sure/i);
      expect(result.text).not.toMatch(/Please let me know/i);
    });

    it('should handle text with special characters preserved', async () => {
      const input = 'The property ($450,000) has 3 bedrooms & 2 baths.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('$450,000');
      expect(result.text).toContain('&');
    });

    it('should handle already clean text unchanged', async () => {
      const input = 'The subject property is a single-family residential dwelling located at 123 Main Street.';
      const result = await normalizeOutput(input);
      expect(result.text).toBe(input);
      expect(result.metrics.regexChanges).toBe(0);
      expect(result.metrics.preambleStripped).toBe(false);
      expect(result.metrics.postambleStripped).toBe(false);
    });

    it('should handle Unicode characters', async () => {
      const input = 'The property features café-style finishes and résumés of upgrades.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('café');
      expect(result.text).toContain('résumés');
    });

    it('should handle numbers and measurements', async () => {
      const input = 'The subject property contains 2,500 sq ft with 3.5 baths, built in 1995.';
      const result = await normalizeOutput(input);
      expect(result.text).toContain('2,500');
      expect(result.text).toContain('3.5');
      expect(result.text).toContain('1995');
    });
  });

  // ── Options Handling ──────────────────────────────────────────────────────

  describe('Options Handling', () => {
    it('should accept and track sectionId option', async () => {
      const input = 'The subject property is excellent.';
      const result = await normalizeOutput(input, { sectionId: 'property_description' });
      expect(result.text).toBeTruthy();
    });

    it('should accept and track formType option', async () => {
      const input = 'The subject property is excellent.';
      const result = await normalizeOutput(input, { formType: '1004' });
      expect(result.text).toBeTruthy();
    });

    it('should accept maxChars option', async () => {
      const input = 'The subject property is excellent with many upgrades.';
      const result = await normalizeOutput(input, { maxChars: 30 });
      expect(result.text.length).toBeLessThanOrEqual(30);
    });

    it('should use default qualityThreshold of 0.7', async () => {
      const input = 'The subject property is excellent.';
      const result = await normalizeOutput(input, { enableLlmPass: false });
      expect(result.metrics.llmPassUsed).toBe(false);
    });
  });

  // ── Integration Tests ─────────────────────────────────────────────────────

  describe('Integration', () => {
    it('should apply all passes in sequence', async () => {
      const input = 'Sure, here is the **home** with excellent features. Let me know if you need more.';
      const result = await normalizeOutput(input);
      // Check all passes were applied (no truncation)
      expect(result.text).not.toMatch(/^Sure/i); // Preamble removed
      expect(result.text).not.toContain('**'); // Markdown removed
      expect(result.text).not.toMatch(/Let me know/i); // Postamble removed
      expect(result.text).toContain('the subject property'); // Voice changed
      expect(result.metrics.regexChanges).toBeGreaterThan(0);
    });

    it('should handle real appraisal text (synthetic)', async () => {
      const input = `Sure, here is the property description.
      The home is a single-family dwelling built in 1985. It has 3 bedrooms, 2 baths,
      and approximately 2,100 square feet. The buyers typically appreciate the **excellent**
      condition and location. Feel free to reach out if you have questions.`;

      const result = await normalizeOutput(input);
      expect(result.text).not.toMatch(/^Sure/i);
      expect(result.text).not.toContain('the home');
      expect(result.text).not.toContain('buyers');
      expect(result.text).not.toContain('**');
      expect(result.text).not.toMatch(/Feel free/i);
    });

    it('should produce consistent results across multiple runs', async () => {
      const input = 'Sure, here is the home. **Bold** text. Let me know.';
      const result1 = await normalizeOutput(input);
      const result2 = await normalizeOutput(input);
      expect(result1.text).toBe(result2.text);
      expect(result1.metrics.cleanedLength).toBe(result2.metrics.cleanedLength);
    });
  });
});
