import { runCaptionPass } from './LfmCaptionService';
import { getCategoryList } from './vlmShared';
// SmolVLM is English-first; UI category labels remain localized.
import { categoryDescription } from './categorySemantics';
import { cleanSubjectCaption } from './subjectCaption';

function categoryLabel(category, categories, language) {
  const name = (language === 'en' ? category.en : category.zh) || category.zh || category.en || category.id;
  const duplicate = categories.filter(c => ((language === 'en' ? c.en : c.zh) || c.zh || c.en || c.id) === name).length > 1;
  return duplicate ? `${name} (${category.id})` : name;
}
export function lfmPrompt(categories, language) {
  const list = categories.map(c => `${categoryLabel(c, categories, language)}: ${categoryDescription(c, language)}`).join('\n');
  return language === 'en'
    ? `Describe the main subject and setting briefly, then choose the best category from the list. Follow the category meanings and custom rules. Ignore written text. Output JSON: description (8-12 English words), category (exact category name).\nCategories:\n${list}`
    : `简短描述图片主要主体和场景，再根据类别含义及自定义规则选择最符合的一类。忽略具体文字。输出JSON：description（约15字中文短语），category（下方完整类别名称）。\n类别：\n${list}`;
}

function outputGrammar(categories, language) {
  const choices = categories.map(c => JSON.stringify(JSON.stringify(categoryLabel(c, categories, language)))).join(' | ');
  // Constrain caption language; category names may still contain any user text.
  const captionChars = language === 'zh' ? '[一-鿿，。、；：！？（） ]+' : "[a-zA-Z ,.'()!?;:]+";
  return `root ::= "{" ws "\\\"description\\\"" ws ":" ws string ws "," ws "\\\"category\\\"" ws ":" ws category ws "}"\ncategory ::= ${choices}\nstring ::= "\\\"" ${captionChars} "\\\""\nws ::= [ \\t\\n\\r]*`;
}

export function parseLfmResult(raw, categories, language = 'zh') {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  if (text.startsWith('{')) value = JSON.parse(text);
  else {
    const category = text.match(/^(?:分类|类别|category|cat)\s*[:：]\s*(.+)$/im)?.[1]?.trim();
    const description = text.match(/^(?:描述|说明|description|desc)\s*[:：]\s*(.+)$/im)?.[1]?.trim()
      || text.split(/\r?\n/).filter(line => !/^(?:分类|类别|category|cat)\s*[:：]/i.test(line)).join(' ').trim();
    value = { category, description };
  }
  const names = categories.filter(c => categoryLabel(c, categories, language) === value.category);
  const matched = names.length ? names : categories.filter(c => c.id === value.category);
  if (matched.length !== 1) throw new Error('SmolVLM returned an unknown or ambiguous category');
  value.category = matched[0].id;
  const description = typeof value.description === 'string' ? cleanSubjectCaption(value.description) : '';
  if (!description) throw new Error('SmolVLM returned an empty description');
  if (language === 'zh' ? /[a-zA-Z]/.test(description) || !/[一-鿿]/.test(description) : /[一-鿿]/.test(description)) {
    throw new Error('SmolVLM returned a description in the wrong language');
  }
  return { success: true, engine: 'smolvlm', topPrediction: { name: value.category, appCategory: value.category }, vlmLabel: description, predictions: [] };
}

export function runLfmClassification(images, options) {
  const categories = getCategoryList();
  if (!categories.length) throw new Error('No categories available');
  return runCaptionPass(images, {
    ...options, config: { enabled: true },
    inference: {
      beforeLoad: () => require('./EmbeddingGemmaClassifier').disposeEmbeddingGemma(),
      prompt: lfmPrompt(categories, 'en'), grammar: outputGrammar(categories, 'en'),
      contextSize: 4096, maxTokens: 96,
      parse: text => parseLfmResult(text, categories, 'en'),
    },
  });
}

export async function classifyWithLfm(uri) {
  let output; let failure;
  await runLfmClassification([{ uri }], {
    save: async (_image, result) => { output = result; return { success: true }; },
    onFailure: async (_image, detail) => { failure = detail.error; },
  });
  if (!output) throw new Error(failure || 'SmolVLM classification failed');
  return output;
}
