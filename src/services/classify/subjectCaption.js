// Keep complete subject/scene clauses, not OCR guesses. This cannot correct visual hallucinations.
export function cleanSubjectCaption(value) {
  const text = String(value || '').replace(/<\|[^>]+\|>/g, '')
    .replace(/[“「『][^”」』]*[”」』]|"[^"]*"/g, '')
    .replace(/\b\d+(?:[-/.]\d+)*\b/g, '')
    .replace(/^(?:描述|主体|Description|Caption)\s*[:：]\s*/i, '');
  const clauses = text.split(/[，,。.!！?？;；\n]/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/(?:写着|写有|印着|印有|刻有|标有|文字(?:是|为|内容)|text\s+(?:that\s+)?(?:reads|says)|(?:reads|says|written|printed|inscribed)\b)/i.test(s));
  const chinese = /[\u3400-\u9fff]/.test(clauses[0] || '');
  return clauses.slice(0, 2).join(chinese ? '，' : ', ').replace(/\s+/g, ' ').trim();
}
