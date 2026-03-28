/**
 * tests/vitest/sanitize.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for input sanitization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  escapeHtml,
  sanitizeFilename,
  escapeSqlLike,
  sanitizeNarrative,
  sanitizeSearchQuery,
  sanitizeUrl,
} from '../../server/utils/sanitize.js';

describe('stripHtml', () => {
  it('should remove HTML tags', () => {
    expect(stripHtml('<b>bold</b>')).toBe('bold');
    expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  it('should handle nested tags', () => {
    expect(stripHtml('<div><p>Hello <b>world</b></p></div>')).toBe('Hello world');
  });

  it('should return empty string for non-strings', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(42)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });

  it('should pass through plain text', () => {
    expect(stripHtml('just text')).toBe('just text');
  });
});

describe('escapeHtml', () => {
  it('should escape all special characters', () => {
    expect(escapeHtml('<script>"alert(\'xss\')&</script>')).toBe(
      '&lt;script&gt;&quot;alert(&#39;xss&#39;)&amp;&lt;/script&gt;'
    );
  });

  it('should pass through safe text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('should handle non-strings', () => {
    expect(escapeHtml(null)).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('should remove path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd');
  });

  it('should remove directory separators', () => {
    expect(sanitizeFilename('path/to/file.txt')).toBe('pathtofile.txt');
    expect(sanitizeFilename('path\\to\\file.txt')).toBe('pathtofile.txt');
  });

  it('should remove control characters', () => {
    expect(sanitizeFilename('file\x00name.txt')).toBe('filename.txt');
  });

  it('should remove Windows-reserved characters', () => {
    expect(sanitizeFilename('file<>:"|?*.txt')).toBe('file.txt');
  });

  it('should return "unnamed" for empty result', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('../../')).toBe('unnamed');
    expect(sanitizeFilename(null)).toBe('unnamed');
  });

  it('should preserve valid filenames', () => {
    expect(sanitizeFilename('report_2024-01-15.pdf')).toBe('report_2024-01-15.pdf');
  });
});

describe('escapeSqlLike', () => {
  it('should escape % wildcard', () => {
    expect(escapeSqlLike('100%')).toBe('100\\%');
  });

  it('should escape _ wildcard', () => {
    expect(escapeSqlLike('field_name')).toBe('field\\_name');
  });

  it('should escape backslash', () => {
    expect(escapeSqlLike('path\\file')).toBe('path\\\\file');
  });

  it('should handle non-strings', () => {
    expect(escapeSqlLike(null)).toBe('');
  });
});

describe('sanitizeNarrative', () => {
  it('should strip HTML tags', () => {
    expect(sanitizeNarrative('<b>The subject</b> property')).toBe('The subject property');
  });

  it('should remove null bytes', () => {
    expect(sanitizeNarrative('Hello\x00World')).toBe('HelloWorld');
  });

  it('should collapse excessive newlines', () => {
    expect(sanitizeNarrative('Line 1\n\n\n\n\nLine 2')).toBe('Line 1\n\nLine 2');
  });

  it('should normalize CRLF', () => {
    expect(sanitizeNarrative('Line 1\r\nLine 2\rLine 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should cap at maxLength', () => {
    const long = 'a'.repeat(20000);
    expect(sanitizeNarrative(long, 100).length).toBe(100);
  });

  it('should handle non-strings', () => {
    expect(sanitizeNarrative(undefined)).toBe('');
  });
});

describe('sanitizeSearchQuery', () => {
  it('should remove control characters', () => {
    expect(sanitizeSearchQuery('hello\x00world')).toBe('helloworld');
  });

  it('should remove HTML brackets', () => {
    expect(sanitizeSearchQuery('<script>alert</script>')).toBe('scriptalert/script');
  });

  it('should cap at maxLength', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeSearchQuery(long, 50).length).toBe(50);
  });

  it('should handle non-strings', () => {
    expect(sanitizeSearchQuery(null)).toBe('');
  });
});

describe('sanitizeUrl', () => {
  it('should accept valid HTTP URLs', () => {
    expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(sanitizeUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('should reject javascript: protocol', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('should reject data: protocol', () => {
    expect(sanitizeUrl('data:text/html,<h1>hi</h1>')).toBeNull();
  });

  it('should reject file: protocol', () => {
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
  });

  it('should reject invalid URLs', () => {
    expect(sanitizeUrl('not a url')).toBeNull();
  });

  it('should accept custom protocols', () => {
    expect(sanitizeUrl('ftp://files.example.com', ['ftp:'])).toBe('ftp://files.example.com/');
  });

  it('should handle non-strings', () => {
    expect(sanitizeUrl(null)).toBeNull();
    expect(sanitizeUrl(42)).toBeNull();
  });
});
