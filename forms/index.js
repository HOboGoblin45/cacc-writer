import form1004 from './1004.js';
import form1073 from './1073.js';
import form1025 from './1025.js';
import form1004c from './1004c.js';
import commercial from './commercial.js';
import formUad36Urar from './uad36_urar.js';
import {
  ACTIVE_FORMS,
  DEFERRED_FORMS,
  getScopeMetaForForm,
} from '../server/config/productionScope.js';

export const DEFAULT_FORM_TYPE = '1004';

// ── Form registry — all 6 form types preserved ───────────────────────────────
// Active production: 1004, commercial, uad36_urar (Wave 1)
// Deferred (not extended): 1025, 1073, 1004c
// Wave 1: uad36_urar (UAD 3.6 dynamic conditional form)
// See server/config/productionScope.js for scope enforcement.
export const FORM_REGISTRY = {
  [form1004.id]: form1004,
  [form1073.id]: form1073,
  [form1025.id]: form1025,
  [form1004c.id]: form1004c,
  [commercial.id]: commercial,
  [formUad36Urar.formId]: formUad36Urar,
};

export function isValidFormType(formType) {
  return Boolean(FORM_REGISTRY[String(formType || '').trim()]);
}

export function getFormConfig(formType) {
  const key = String(formType || '').trim();
  return FORM_REGISTRY[key] || FORM_REGISTRY[DEFAULT_FORM_TYPE];
}

/**
 * listForms()
 * Returns all registered forms with scope metadata.
 * scope: 'active' | 'deferred'
 * supported: true | false
 */
export function listForms() {
  return Object.values(FORM_REGISTRY).map(f => ({
    id:        f.id,
    label:     f.label,
    uspap:     f.uspap,
    ...getScopeMetaForForm(f.id),
  }));
}

/**
 * getActiveForms()
 * Returns only active production forms (1004, commercial).
 */
export function getActiveForms() {
  return Object.values(FORM_REGISTRY)
    .filter(f => ACTIVE_FORMS.includes(f.id))
    .map(f => ({ id: f.id, label: f.label, uspap: f.uspap, scope: 'active', supported: true }));
}

/**
 * getDeferredForms()
 * Returns only deferred forms (1025, 1073, 1004c).
 * These are preserved but not actively supported in production.
 */
export function getDeferredForms() {
  return Object.values(FORM_REGISTRY)
    .filter(f => DEFERRED_FORMS.includes(f.id))
    .map(f => ({
      id:        f.id,
      label:     f.label,
      uspap:     f.uspap,
      scope:     'deferred',
      supported: false,
      ...getScopeMetaForForm(f.id),
    }));
}
