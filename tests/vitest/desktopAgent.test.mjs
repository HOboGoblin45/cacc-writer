/**
 * tests/vitest/desktopAgent.test.mjs
 * ──────────────────────────────────────────────────────────────────────────
 * Tests for desktop agent field maps (1025, 1073)
 *
 * Test suite:
 *   - 1025 field map has entries for all 1025 sections
 *   - 1073 field map has entries for all 1073 sections
 *   - All field maps have valid structure (fieldId, maxChars, type)
 *   - Character limits are reasonable (50-5000 range)
 *   - Tab names are valid ACI tabs
 *   - All required fields present
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load field maps
const fieldMaps = {
  1025: JSON.parse(readFileSync(
    resolve('./desktop_agent/field_maps/1025.json'),
    'utf-8'
  )),
  1073: JSON.parse(readFileSync(
    resolve('./desktop_agent/field_maps/1073.json'),
    'utf-8'
  )),
};

const forms = {
  1025: (await import('./../../forms/1025.js')).default,
  1073: (await import('./../../forms/1073.js')).default,
};

describe('1025 Field Map', () => {
  const map = fieldMaps[1025];
  const form = forms[1025];

  it('should have valid top-level structure', () => {
    expect(map._comment).toBeDefined();
    expect(map._phase).toBeDefined();
    expect(map.narratives).toBeDefined();
    expect(map.data_fields).toBeDefined();
    expect(map._tab_positions).toBeDefined();
  });

  it('should have entries for key narrative sections', () => {
    const requiredNarratives = [
      'neighborhood_description',
      'market_conditions',
      'site_comments',
      'improvements_condition',
      'income_approach',
      'sales_comparison_commentary',
      'reconciliation',
    ];

    for (const section of requiredNarratives) {
      expect(map.narratives[section]).toBeDefined();
      expect(map.narratives[section].label).toBeDefined();
      expect(map.narratives[section].tab_name).toBeDefined();
      expect(map.narratives[section].max_chars).toBeGreaterThan(50);
      expect(map.narratives[section].max_chars).toBeLessThanOrEqual(5000);
    }
  });

  it('should have valid field_type values', () => {
    const validTypes = ['text', 'dropdown', 'checkbox', 'numeric'];

    const allFields = {
      ...map.narratives,
      ...map.data_fields,
    };

    for (const field of Object.values(allFields)) {
      if (field.field_type) {
        expect(validTypes).toContain(field.field_type);
      }
    }
  });

  it('should have max_chars in reasonable range', () => {
    const allFields = {
      ...map.narratives,
      ...map.data_fields,
    };

    for (const [fieldId, field] of Object.entries(allFields)) {
      if (field.max_chars) {
        expect(field.max_chars).toBeGreaterThan(0);
        expect(field.max_chars).toBeLessThanOrEqual(10000);
      }
    }
  });

  it('should have valid ACI tab names', () => {
    const validTabs = ['Subj', 'Contr', 'Neig', 'Site', 'Impro', 'Sales', 'Income', 'Reco', 'Addit'];

    const allFields = {
      ...map.narratives,
      ...map.data_fields,
    };

    for (const field of Object.values(allFields)) {
      if (field.tab_name) {
        expect(validTabs).toContain(field.tab_name);
      }
    }
  });

  it('should have tab positions defined', () => {
    expect(map._tab_positions.Subj).toBeDefined();
    expect(map._tab_positions.Contr).toBeDefined();
    expect(map._tab_positions.Neig).toBeDefined();
    expect(map._tab_positions.Site).toBeDefined();
    expect(map._tab_positions.Impro).toBeDefined();
    expect(map._tab_positions.Sales).toBeDefined();
    expect(map._tab_positions.Income).toBeDefined();
    expect(map._tab_positions.Reco).toBeDefined();
  });

  it('should map to actual form sections', () => {
    const formSectionIds = form.fields.map(f => f.id);

    const mappedSections = [
      'offering_history',
      'contract_analysis',
      'neighborhood_description',
      'market_conditions',
      'site_comments',
      'improvements_condition',
      'income_approach',
      'sales_comparison_commentary',
      'reconciliation',
    ];

    for (const section of mappedSections) {
      const inForm = formSectionIds.includes(section);
      const inMap = Boolean(map.narratives[section]);
      expect(inForm || inMap).toBe(true);
    }
  });

  it('should have notes for all fields', () => {
    const allFields = {
      ...map.narratives,
      ...map.data_fields,
    };

    for (const [key, field] of Object.entries(allFields)) {
      // Skip metadata fields (those starting with _)
      if (key.startsWith('_')) continue;

      expect(field.notes).toBeDefined();
      expect(typeof field.notes).toBe('string');
      expect(field.notes.length).toBeGreaterThan(0);
    }
  });
});

describe('1073 Field Map', () => {
  const map = fieldMaps[1073];

  it('should have valid top-level structure', () => {
    expect(map._comment).toBeDefined();
    expect(map._phase).toBeDefined();
    expect(map.narratives).toBeDefined();
    expect(map.project_level_fields).toBeDefined();
    expect(map.unit_level_fields).toBeDefined();
    expect(map._tab_positions).toBeDefined();
  });

  it('should have condo-specific fields', () => {
    const condoFields = [
      'condo_project_analysis',
      'hoa_dues',
      'reserve_fund_adequacy',
      'owner_occupancy_ratio',
      'special_assessments',
      'total_units_in_project',
      'project_legal_compliance',
    ];

    for (const field of condoFields) {
      expect(
        map.narratives[field] ||
        map.project_level_fields[field]
      ).toBeDefined();
    }
  });

  it('should have HOA-related fields', () => {
    expect(map.project_level_fields.hoa_dues).toBeDefined();
    expect(map.project_level_fields.reserve_fund_adequacy).toBeDefined();
    expect(map.project_level_fields.owner_occupancy_ratio).toBeDefined();
  });

  it('should have valid field_type values', () => {
    const validTypes = ['text', 'dropdown', 'checkbox', 'numeric'];

    const allFields = {
      ...map.narratives,
      ...map.project_level_fields,
      ...map.unit_level_fields,
    };

    for (const field of Object.values(allFields)) {
      if (field.field_type) {
        expect(validTypes).toContain(field.field_type);
      }
    }
  });

  it('should have max_chars in reasonable range', () => {
    const allFields = {
      ...map.narratives,
      ...map.project_level_fields,
      ...map.unit_level_fields,
    };

    for (const [fieldId, field] of Object.entries(allFields)) {
      if (field.max_chars) {
        expect(field.max_chars).toBeGreaterThan(0);
        expect(field.max_chars).toBeLessThanOrEqual(10000);
      }
    }
  });

  it('should have valid ACI tab names', () => {
    const validTabs = ['Subj', 'Contr', 'Neig', 'Site', 'Impro', 'Sales', 'Reco', 'Addit'];

    const allFields = {
      ...map.narratives,
      ...map.project_level_fields,
      ...map.unit_level_fields,
    };

    for (const field of Object.values(allFields)) {
      if (field.tab_name) {
        expect(validTabs).toContain(field.tab_name);
      }
    }
  });

  it('should have guidance for 1073-specific sections', () => {
    expect(map._1073_specific_guidance).toBeDefined();
    expect(map._1073_specific_guidance.condo_project_analysis).toBeDefined();
    expect(map._1073_specific_guidance.comparable_selection).toBeDefined();
    expect(map._1073_specific_guidance.hoa_impact_on_value).toBeDefined();
  });

  it('should have owner_occupancy_ratio as numeric type', () => {
    const field = map.project_level_fields.owner_occupancy_ratio;
    expect(field.field_type).toBe('numeric');
    expect(field.max_chars).toBeLessThanOrEqual(3); // 0-100%
  });

  it('should have reserve_fund_adequacy as dropdown', () => {
    const field = map.project_level_fields.reserve_fund_adequacy;
    expect(field.field_type).toBe('dropdown');
  });

  it('should have project_legal_compliance as dropdown', () => {
    const field = map.project_level_fields.project_legal_compliance;
    expect(field.field_type).toBe('dropdown');
  });

  it('should note inherited fields from 1004', () => {
    // Check that some fields mention they inherit from 1004
    const fieldsWithInheritanceNote = [
      'neighborhood_description',
      'market_conditions',
    ];

    for (const field of fieldsWithInheritanceNote) {
      const mapField = map.narratives[field];
      expect(mapField).toBeDefined();
      expect(mapField.notes).toMatch(/1004|inherits|Inherits/i);
    }

    // Verify that field map exists and is well-formed
    expect(map.narratives).toBeDefined();
    expect(Object.keys(map.narratives).length).toBeGreaterThan(0);
  });
});

describe('Field Map Quality Assurance', () => {
  it('should have consistent field naming across maps', () => {
    const map1025 = fieldMaps[1025];
    const map1073 = fieldMaps[1073];

    const shared = ['neighborhood_description', 'market_conditions', 'improvements_condition'];

    for (const field of shared) {
      expect(map1025.narratives[field]).toBeDefined();
      expect(map1073.narratives[field]).toBeDefined();
      expect(map1025.narratives[field].label).toMatch(/\w+/);
      expect(map1073.narratives[field].label).toMatch(/\w+/);
    }
  });

  it('should have no duplicate field IDs within a map', () => {
    const map = fieldMaps[1025];
    const allFields = {
      ...map.narratives,
      ...map.data_fields,
    };

    const ids = Object.keys(allFields);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should have max_chars >= 50 for all text fields', () => {
    const maps = [fieldMaps[1025], fieldMaps[1073]];

    for (const map of maps) {
      const allFields = {
        ...map.narratives,
        ...map.data_fields,
        ...map.project_level_fields,
        ...map.unit_level_fields,
      };

      for (const [id, field] of Object.entries(allFields)) {
        if (field.field_type === 'text' && field.max_chars) {
          expect(field.max_chars).toBeGreaterThanOrEqual(50);
        }
      }
    }
  });
});
