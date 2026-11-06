import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ClassifierModelPicker from '../ClassifierModelPicker';
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner', StyleSheet: { create: v => v } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key.split('.').pop() }) }));
const model = (extra = {}) => ({ id: 'lfm', title: 'LFM', summary: 'Sort and describe', description: 'Detailed limitations', sizeMB: 419, ready: true, onSelect: jest.fn(), onDelete: jest.fn(), ...extra });
const mount = (models, busy = false) => renderer.create(<ClassifierModelPicker models={models} colors={{}} busy={busy} />);
const content = tree => JSON.stringify(tree.toJSON());
const button = (tree, label) => tree.root.findAllByType('Button').find(b => b.findAllByType('Text').some(t => t.props.children === label || (Array.isArray(t.props.children) && t.props.children[0] === label)));
test('only one explicit selection action; details do not select; deletion is hidden', () => {
 const m = model({ downloaded: true }); const tree = mount([m]);
 expect(content(tree)).not.toContain('Detailed limitations');
 expect(button(tree, 'delete')).toBeUndefined();
 act(() => button(tree, 'details').props.onPress());
 expect(m.onSelect).not.toHaveBeenCalled();
 expect(content(tree)).toContain('Detailed limitations');
 act(() => button(tree, 'use').props.onPress());
 expect(m.onSelect).toHaveBeenCalledTimes(1);
});
test('missing files never claim active; download and selection are one explicit action', () => {
 const tree = mount([model({ active: true, downloaded: false })]);
 expect(button(tree, 'downloadUse')).toBeDefined();
 expect(content(tree)).toContain('notDownloaded');
});
test('legacy models are collapsed unless the active model is legacy', () => {
 expect(content(mount([model({ legacy: true })]))).not.toContain('Sort and describe');
 expect(content(mount([model({ legacy: true, active: true, downloaded: true })]))).toContain('Sort and describe');
});
test('busy locks other downloads and management; cancelling remains busy', () => {
 const tree = mount([model({ downloaded: true })], true);
 expect(button(tree, 'use').props.disabled).toBe(true);
 act(() => button(tree, 'details').props.onPress());
 expect(button(tree, 'delete').props.disabled).toBe(true);
 const running = mount([model({ downloading: true, cancelling: true })], true);
 expect(button(running, 'cancelling').props.disabled).toBe(true);
});
test.each([[NaN, 0], [Infinity, 0], [-1, 0], [0.55, 55], [1.2, 100]])('progress %s is bounded and 100 means verifying', (progress, expected) => {
 const tree = mount([model({ downloading: true, progress })], true);
 expect(tree.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue.now).toBe(expected);
 if (expected === 100) expect(content(tree)).toContain('checking');
});
test('unsupported models expose retry and never claim active',()=>{
 const tree=mount([model({active:true,downloaded:true,unsupported:true})]);
 expect(content(tree)).toContain('unavailable');
 expect(button(tree,'retry')).toBeDefined();
});
test('obsolete model cleanup remains available before replacement weights are downloaded',()=>{
 const cleanup=jest.fn();const tree=mount([model({downloaded:false,cleanupLabel:'Remove old LFM files',onCleanup:cleanup})]);
 act(()=>button(tree,'details').props.onPress());
 act(()=>button(tree,'Remove old LFM files').props.onPress());expect(cleanup).toHaveBeenCalled();
});
