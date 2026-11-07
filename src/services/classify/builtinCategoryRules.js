import initialSettings from '../../../public/initialSettings.json';
import {normalizeCustomMatching} from './categorySemantics';

export function isEditableBuiltinCategory(id) {
  return Object.prototype.hasOwnProperty.call(initialSettings.categoryNameMap, id)
    && !['NA', 'NA_video', 'other'].includes(id);
}

// Store overrides separately from custom categories and from image classification records.
export function normalizeBuiltinCategoryRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isEditableBuiltinCategory(id) || !entry || typeof entry !== 'object') continue;
    const rule = typeof entry.rule === 'string' ? entry.rule.trim() : '';
    if (rule) out[id] = {rule, ...normalizeCustomMatching(entry)};
  }
  return out;
}
