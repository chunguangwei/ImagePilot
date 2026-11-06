test.each(['zh','en'])('active %s hints do not recommend retired models', lang => {
 const messages = require(`../../../i18n/locales/${lang}/common.json`);
 expect(messages.imagePreview.embeddingCaptionHint).not.toMatch(/SmolVLM|LFM/);
 expect(messages.settings.classifierModel.vlmUnsupportedMsg).not.toMatch(/SmolVLM|LFM/);
 expect(messages.imagePreview.embeddingCaptionHint).toContain('E2B');
});
