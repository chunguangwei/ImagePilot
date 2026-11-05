import React from 'react';
import renderer, { act } from 'react-test-renderer';
import LfmCaptionSettings from '../LfmCaptionSettings';
import { captionModelReady, downloadCaptionModel } from '../../services/classify/lfmCaptionModel';
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner', Alert: { alert: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' } }) }));
jest.mock('../../services/classify/lfmCaptionModel', () => ({ captionModelReady: jest.fn(), downloadCaptionModel: jest.fn(), deleteCaptionModel: jest.fn(), CAPTION_SIZE_MB: 419 }));
jest.mock('../../services/classify/LfmCaptionService', () => ({ isCaptionBusy: () => false }));
const colors = { accent: 'blue', label: 'black', secondaryLabel: 'gray' };
beforeEach(() => { jest.clearAllMocks(); captionModelReady.mockResolvedValue(false); downloadCaptionModel.mockResolvedValue(); });
async function mount(config = {}) {
  const onChange = jest.fn(); let tree;
  function Parent() {
    const [value, setValue] = React.useState(config);
    return <LfmCaptionSettings config={value} onChange={async next => { onChange(next); setValue(next); }} colors={colors} />;
  }
  await act(async () => { tree = renderer.create(<Parent />); });
  return { tree, onChange };
}
test('off hides model download; turning on before download reveals it and completion enables captions', async () => {
  const { tree, onChange } = await mount();
  expect(tree.root.findAllByType('Button')).toHaveLength(0);
  expect(tree.root.findByType('Switch').props.disabled).toBe(false);
  await act(async () => { await tree.root.findByType('Switch').props.onValueChange(true); });
  expect(tree.root.findByType('Switch').props.value).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, language: 'system' }));
  await act(async () => { await tree.root.findByType('Button').props.onPress(); });
  expect(downloadCaptionModel).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree.toJSON())).toContain('已启用');
  expect(JSON.stringify(tree.toJSON())).not.toContain('English');
});
test('downloaded model can be enabled without downloading again, and off keeps files', async () => {
  captionModelReady.mockResolvedValue(true);
  const { tree } = await mount({ enabled: false, language: 'en' });
  await act(async () => { await tree.root.findByType('Switch').props.onValueChange(true); });
  expect(downloadCaptionModel).not.toHaveBeenCalled();
  await act(async () => { await tree.root.findByType('Switch').props.onValueChange(false); });
  expect(tree.root.findAllByType('Button')).toHaveLength(0);
});
