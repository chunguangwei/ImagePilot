import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import DisclosureRow from '../shared/DisclosureRow';
import SettingsGroup from '../../screens/mobile/settings/SettingsGroup';
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: v => v } }));
jest.mock('../shared/VIcon', () => 'Icon');
const colors = {label:'#000',readableSecondary:'#636366',card:'#fff'};
test('inline disclosure communicates the same direction and expanded state', () => {
 const press=jest.fn(); const tree=renderer.create(<DisclosureRow title="Details" expanded={false} colors={colors} onPress={press} />);
 expect(tree.root.findByType('Icon').props.name).toBe('chevron-down');
 expect(tree.root.findByType('Button').props.accessibilityState.expanded).toBe(false);
 act(()=>tree.root.findByType('Button').props.onPress()); expect(press).toHaveBeenCalledTimes(1);
 tree.update(<DisclosureRow title="Details" expanded colors={colors} onPress={press} />);
 expect(tree.root.findByType('Icon').props.name).toBe('chevron-up');
 expect(tree.root.findByType('Button').props.accessibilityState.expanded).toBe(true);
});
test('closing a settings group hides controls from accessibility without resetting active children', () => {
 let mounts=0,unmounts=0;
 function Operation(){useEffect(()=>{mounts++;return()=>unmounts++;},[]);return <React.Fragment>Download</React.Fragment>;}
 let tree;act(()=>{tree=renderer.create(<SettingsGroup title="Models" colors={colors} defaultExpanded><Operation /></SettingsGroup>);});
 act(()=>tree.root.findByType('Button').props.onPress());
 expect(tree.root.findByProps({importantForAccessibility:'no-hide-descendants'}).props.style).toEqual({display:'none'});
 act(()=>tree.root.findByType('Button').props.onPress());
 expect(mounts).toBe(1);expect(unmounts).toBe(0);
 expect(tree.root.findByType('Button').props.accessibilityState.expanded).toBe(true);
});
