const { cleanSubjectCaption } = require('../subjectCaption');
test('ignores quoted writing, dates and transcription clauses without inventing a subject',()=>{
 expect(cleanSubjectCaption('一个金色的“GO”奖牌，底部有橙色的底座，上面写着“2018年第五届世界杯”。')).toBe('一个金色的奖牌，底部有橙色的底座');
 expect(cleanSubjectCaption('A gold trophy on a table, with text that reads "2020 winner".')).toBe('A gold trophy on a table');
});
test('keeps a concise complete subject phrase and skips numbers',()=>{
 expect(cleanSubjectCaption('一杯咖啡放在红色盘子上，旁边有银色勺子，背景是一张木桌。')).toBe('一杯咖啡放在红色盘子上，旁边有银色勺子');
 expect(cleanSubjectCaption('上面写着“2020”。')).toBe('');
});
