jest.mock('react-native-fs',()=>({hash:jest.fn(async()=> 'digest')}));
jest.mock('@react-native-async-storage/async-storage',()=>({}));
jest.mock('react-native-sqlite-storage',()=>({enablePromise:jest.fn()}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'View'}));
jest.mock('@react-navigation/native',()=>({}));
jest.mock('@react-navigation/stack',()=>({createStackNavigator:jest.fn()}));
jest.mock('@react-navigation/bottom-tabs',()=>({createBottomTabNavigator:jest.fn()}));
jest.mock('react-native-image-picker',()=>({}));
jest.mock('react-native-vector-icons/MaterialIcons',()=> 'Icon');
jest.mock('react-native-image-resizer',()=>({}));
import {RNFS} from '../WebAdapters.native';
import NativeFS from 'react-native-fs';
test('video frame hashing reaches the real native filesystem adapter',async()=>{
 expect(await RNFS.hash('/cache/frame.jpg','sha256')).toBe('digest');
 expect(NativeFS.hash).toHaveBeenCalledWith('/cache/frame.jpg','sha256');
});
