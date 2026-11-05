const fs = require('fs');
const path = require('path');
test('Android old architecture exposes recurrent-state reset required by the caption service', () => {
  const bridge = fs.readFileSync(path.resolve(__dirname, '../../node_modules/llama.rn/android/src/oldarch/java/com/rnllama/RNLlamaModule.java'), 'utf8');
  expect(bridge).toMatch(/@ReactMethod\s+public void clearCache\(double id, boolean clearData, final Promise promise\)\s*\{\s*rnllama.clearCache\(id, clearData, promise\);/);
});
