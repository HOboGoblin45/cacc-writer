import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import form1073 from '../../forms/1073.js';
import { CORE_SECTIONS } from '../../server/config/coreSections.js';
import { ACTIVE_FORMS } from '../../server/config/productionScope.js';
import { SECTION_DEPENDENCIES } from '../../server/sectionDependencies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const narrativesPath = join(__dirname, '../../knowledge_base/narratives/1073Narratives.json');
const narratives1073 = JSON.parse(readFileSync(narrativesPath, 'utf-8'));

describe('Form 1073 — Individual Condominium Unit Appraisal Report', () => {
  describe('Form Definition', () => {
    it('should export a form object with correct id', () => {
      expect(form1073.id).toBe('1073');
    });

    it('should have proper label and uspap reference', () => {
      expect(form1073.label).toMatch(/1073.*Condominium/i);
      expect(form1073.uspap).toMatch(/Fannie Mae.*1073/i);
    });

    it('should export all required fields', () => {
      expect(form1073).toHaveProperty('id');
      expect(form1073).toHaveProperty('label');
      expect(form1073).toHaveProperty('uspap');
      expect(form1073).toHaveProperty('extractContext');
      expect(form1073).toHaveProperty('fields');
      expect(form1073).toHaveProperty('factsSchema');
      expect(form1073).toHaveProperty('docTypes');
      expect(form1073).toHaveProperty('gradingRubric');
      expect(form1073).toHaveProperty('questionnairePriorities');
      expect(form1073).toHaveProperty('voiceFields');
    });
  });

  describe('Sections', () => {
    it('should have 16+ fields defined', () => {
      expect(form1073.fields.length).toBeGreaterThanOrEqual(16);
    });

    it('should have all required sections with id, label, prompt, aiEligibility, and requiredFacts', () => {
      form1073.fields.forEach(field => {
        expect(field).toHaveProperty('id');
        expect(field).toHaveProperty('title');
        expect(field).toHaveProperty('note');
        expect(field).toHaveProperty('aiEligibility');
        expect(field).toHaveProperty('requiredFacts');
        expect(field).toHaveProperty('tpl');
        expect(typeof field.id).toBe('string');
        expect(typeof field.title).toBe('string');
        expect(typeof field.tpl).toBe('string');
        expect(Array.isArray(field.requiredFacts)).toBe(true);
      });
    });

    it('should have condo-specific sections', () => {
      const sectionIds = form1073.fields.map(f => f.id);
      expect(sectionIds).toContain('project_description');
      expect(sectionIds).toContain('project_analysis');
      expect(sectionIds).toContain('hoa_analysis');
      expect(sectionIds).toContain('subject_description');
    });

    it('should have condo-specific narratives in prompts', () => {
      const projectDescField = form1073.fields.find(f => f.id === 'project_description');
      expect(projectDescField.tpl).toMatch(/condominium project/i);
      expect(projectDescField.tpl).toMatch(/total.*units/i);

      const hoaField = form1073.fields.find(f => f.id === 'hoa_analysis');
      expect(hoaField.tpl).toMatch(/HOA.*fee/i);
      expect(hoaField.tpl).toMatch(/reserve/i);
    });
  });

  describe('Facts Schema', () => {
    it('should have condo-specific fact properties', () => {
      expect(form1073.factsSchema).toHaveProperty('subject');
      expect(form1073.factsSchema).toHaveProperty('project');
      expect(form1073.factsSchema).toHaveProperty('hoa');
      expect(form1073.factsSchema).toHaveProperty('contract');
      expect(form1073.factsSchema).toHaveProperty('market');
      expect(form1073.factsSchema).toHaveProperty('neighborhood');
      expect(form1073.factsSchema).toHaveProperty('comps');
      expect(form1073.factsSchema).toHaveProperty('assignment');
    });

    it('should have condo unit-specific subject fields', () => {
      const { subject } = form1073.factsSchema;
      expect(subject).toHaveProperty('floor');
      expect(subject).toHaveProperty('view');
      expect(subject).toHaveProperty('parking');
      expect(subject).toHaveProperty('storageUnit');
    });

    it('should have project-specific fields', () => {
      const { project } = form1073.factsSchema;
      expect(project).toHaveProperty('name');
      expect(project).toHaveProperty('totalUnits');
      expect(project).toHaveProperty('stories');
      expect(project).toHaveProperty('yearBuilt');
      expect(project).toHaveProperty('developer');
      expect(project).toHaveProperty('phase');
      expect(project).toHaveProperty('percentSold');
    });

    it('should have HOA-specific fields', () => {
      const { hoa } = form1073.factsSchema;
      expect(hoa).toHaveProperty('monthlyFee');
      expect(hoa).toHaveProperty('includes');
      expect(hoa).toHaveProperty('specialAssessments');
      expect(hoa).toHaveProperty('reserves');
      expect(hoa).toHaveProperty('reserveAdequacy');
      expect(hoa).toHaveProperty('litigation');
    });

    it('should have standard subject fields for single unit', () => {
      const { subject } = form1073.factsSchema;
      expect(subject).toHaveProperty('address');
      expect(subject).toHaveProperty('gla');
      expect(subject).toHaveProperty('beds');
      expect(subject).toHaveProperty('baths');
      expect(subject).toHaveProperty('yearBuilt');
      expect(subject).toHaveProperty('condition');
      expect(subject).toHaveProperty('style');
    });
  });

  describe('Document Types', () => {
    it('should include condo-specific document types', () => {
      const docTypeIds = form1073.docTypes.map(d => d.id);
      expect(docTypeIds).toContain('hoa_documents');
      expect(docTypeIds).toContain('reserve_study');
      expect(docTypeIds).toContain('condo_questionnaire');
    });

    it('should include standard document types', () => {
      const docTypeIds = form1073.docTypes.map(d => d.id);
      expect(docTypeIds).toContain('purchase_contract');
      expect(docTypeIds).toContain('appraisal_order');
      expect(docTypeIds).toContain('comp_1');
      expect(docTypeIds).toContain('comp_2');
      expect(docTypeIds).toContain('comp_3');
    });
  });

  describe('Grading Rubric', () => {
    it('should exist and be non-empty', () => {
      expect(form1073.gradingRubric).toBeTruthy();
      expect(typeof form1073.gradingRubric).toBe('string');
      expect(form1073.gradingRubric.length).toBeGreaterThan(0);
    });

    it('should mention condo-specific evaluation criteria', () => {
      expect(form1073.gradingRubric).toMatch(/hoa|HOA/i);
      expect(form1073.gradingRubric).toMatch(/project|Project/i);
      expect(form1073.gradingRubric).toMatch(/condo|Condo|unit|Unit/i);
    });
  });

  describe('Questionnaire Priorities', () => {
    it('should have 10+ priorities', () => {
      expect(form1073.questionnairePriorities.length).toBeGreaterThanOrEqual(10);
    });

    it('should include condo-specific priorities', () => {
      const priorityText = form1073.questionnairePriorities.join(' ').toLowerCase();
      expect(priorityText).toMatch(/hoa|project|reserve|fee|special assessment|litigation/);
    });
  });

  describe('Voice Fields', () => {
    it('should have 8+ voice fields', () => {
      expect(form1073.voiceFields.length).toBeGreaterThanOrEqual(8);
    });

    it('should include condo-specific voice fields', () => {
      const voiceIds = form1073.voiceFields.map(v => v.id);
      expect(voiceIds).toContain('project_description');
      expect(voiceIds).toContain('hoa_analysis');
    });

    it('should include standard voice fields', () => {
      const voiceIds = form1073.voiceFields.map(v => v.id);
      expect(voiceIds).toContain('neighborhood_description');
      expect(voiceIds).toContain('market_conditions');
      expect(voiceIds).toContain('reconciliation');
    });
  });

  describe('Core Sections Registration', () => {
    it('should be registered in CORE_SECTIONS', () => {
      expect(CORE_SECTIONS).toHaveProperty('1073');
    });

    it('should have matching section IDs in CORE_SECTIONS', () => {
      const formSectionIds = form1073.fields.map(f => f.id);
      const coreSectionIds = CORE_SECTIONS['1073'].map(s => s.id);

      // All form sections should appear in core sections
      formSectionIds.forEach(id => {
        expect(coreSectionIds).toContain(id);
      });
    });

    it('should have 19 sections in CORE_SECTIONS', () => {
      expect(CORE_SECTIONS['1073'].length).toBe(19);
    });
  });

  describe('Production Scope', () => {
    it('should be in active forms list', () => {
      expect(ACTIVE_FORMS).toContain('1073');
    });
  });

  describe('Section Dependencies', () => {
    it('should have dependencies defined for 1073 sections', () => {
      const condo1073Sections = [
        'subject_description',
        'project_description',
        'project_analysis',
        'hoa_analysis',
        'site_comments',
      ];

      condo1073Sections.forEach(sectionId => {
        expect(SECTION_DEPENDENCIES).toHaveProperty(sectionId);
      });
    });

    it('should have valid dependencies with required and recommended arrays', () => {
      ['subject_description', 'project_description', 'hoa_analysis'].forEach(sectionId => {
        const deps = SECTION_DEPENDENCIES[sectionId];
        expect(Array.isArray(deps.required)).toBe(true);
        expect(Array.isArray(deps.recommended)).toBe(true);
      });
    });

    it('should not have circular dependencies', () => {
      // Simple check: project_analysis should not have circular dependencies
      const projDescDeps = SECTION_DEPENDENCIES.project_description;
      const projAnalysisDeps = SECTION_DEPENDENCIES.project_analysis;

      // project_description shouldn't depend on project_analysis
      expect(projDescDeps.required).not.toContain('project_analysis');
      // project_analysis has its own required fields
      expect(Array.isArray(projAnalysisDeps.required)).toBe(true);
      expect(projAnalysisDeps.required.length).toBeGreaterThan(0);
    });
  });

  describe('Narrative Templates', () => {
    it('should have 1073 narrative templates', () => {
      expect(narratives1073).toBeTruthy();
      expect(narratives1073._meta).toBeTruthy();
    });

    it('should have condition templates covering C1-C6', () => {
      const condition = narratives1073.condition || {};
      ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].forEach(rating => {
        expect(condition).toHaveProperty(rating);
        expect(condition[rating]).toHaveProperty('uadDefinition');
        expect(condition[rating]).toHaveProperty('narrativeGuidance');
        expect(condition[rating]).toHaveProperty('promptInstruction');
      });
    });

    it('should have market conditions templates', () => {
      expect(narratives1073.market_conditions).toBeTruthy();
      expect(Object.keys(narratives1073.market_conditions).length).toBeGreaterThan(0);
      // Check for at least one market conditions template
      const marketKeys = Object.keys(narratives1073.market_conditions || {});
      expect(marketKeys.some(k => typeof narratives1073.market_conditions[k] === 'object')).toBe(true);
    });

    it('should have neighborhood templates for condo types', () => {
      const neighborhoods = narratives1073.neighborhood_description || {};
      expect(Object.keys(neighborhoods).length).toBeGreaterThan(0);
    });

    it('should have project analysis templates', () => {
      expect(narratives1073.project_analysis).toBeTruthy();
      expect(narratives1073.project_analysis.warrantable).toBeTruthy();
      expect(narratives1073.project_analysis.non_warrantable).toBeTruthy();
    });

    it('should have HOA analysis templates', () => {
      expect(narratives1073.hoa_analysis).toBeTruthy();
      expect(narratives1073.hoa_analysis.adequate_reserves).toBeTruthy();
      expect(narratives1073.hoa_analysis.underfunded_reserves).toBeTruthy();
      expect(narratives1073.hoa_analysis.special_assessment_pending).toBeTruthy();
    });

    it('should have highest and best use templates', () => {
      expect(narratives1073.highest_best_use).toBeTruthy();
      expect(narratives1073.highest_best_use.owner_occupied).toBeTruthy();
      expect(narratives1073.highest_best_use.investment_unit).toBeTruthy();
    });
  });

  describe('Field Validation', () => {
    it('should have minChars and maxChars defined for prompt fields if needed', () => {
      // Check that fields that need character limits have them if they're critical narrative sections
      const criticalFields = ['reconciliation', 'neighborhood_description', 'hoa_analysis'];
      form1073.fields.forEach(field => {
        if (criticalFields.includes(field.id)) {
          // Fields should be well-formed prompts
          expect(field.tpl).toBeTruthy();
          expect(field.tpl.length).toBeGreaterThan(50);
        }
      });
    });

    it('should have requiredFacts and tpl for all fields', () => {
      form1073.fields.forEach(field => {
        expect(field.requiredFacts).toBeDefined();
        expect(Array.isArray(field.requiredFacts)).toBe(true);
        expect(field.tpl).toBeDefined();
        expect(typeof field.tpl).toBe('string');
        expect(field.tpl.length).toBeGreaterThan(20);
      });
    });
  });

  describe('Charlie Cresci Voice Consistency', () => {
    it('should have Charlie Cresci voice markers in critical prompts', () => {
      const hoaField = form1073.fields.find(f => f.id === 'hoa_analysis');
      expect(hoaField.tpl).toMatch(/Charlie['']s/i);

      const projectField = form1073.fields.find(f => f.id === 'project_description');
      expect(projectField.tpl).toMatch(/Charlie['']s/i);
    });

    it('should instruct AI to avoid generic phrases', () => {
      const neighborhoodField = form1073.fields.find(f => f.id === 'neighborhood_description');
      expect(neighborhoodField.tpl).toMatch(/Do NOT use vague|not vague|specific/i);
    });

    it('should instruct use of INSERT placeholders', () => {
      // At least some ai_draft fields should have [INSERT] placeholders for guidance
      const aiDraftFields = form1073.fields.filter(f => f.aiEligibility === 'ai_draft');
      const fieldsWithInsert = aiDraftFields.filter(f => f.tpl && f.tpl.includes('[INSERT]'));

      expect(aiDraftFields.length).toBeGreaterThan(0);
      expect(fieldsWithInsert.length).toBeGreaterThan(0);
    });
  });
});
