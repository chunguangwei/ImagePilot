jest.mock('../../../adapters/WebAdapters',()=>({RNFS:{hash:jest.fn(),unlink:jest.fn(async()=>{})}}));
import {RNFS} from '../../../adapters/WebAdapters';
import retry from '../retryVideoFrames';
beforeEach(()=>jest.clearAllMocks());
test('duplicate extracted frames do not create false consensus, and all are cleaned',async()=>{
 RNFS.hash.mockResolvedValue('same');const classifyFrame=jest.fn(async()=>({category:'pets'}));
 const first={category:'other'};
 expect(await retry(first,{initialFrameHash:'same',extractFrame:async()=> 'file:///frame.jpg',classifyFrame,categoryOf:r=>r.category})).toBe(first);
 expect(classifyFrame).not.toHaveBeenCalled();expect(RNFS.unlink).toHaveBeenCalledTimes(3);
});
test('cleanup happens after inference failure and successful consensus',async()=>{
 RNFS.hash.mockResolvedValueOnce('a').mockResolvedValueOnce('b').mockResolvedValueOnce('c');
 const classifyFrame=jest.fn().mockRejectedValueOnce(new Error('inference')).mockResolvedValue({category:'pets'});
 expect((await retry({category:'other'},{extractFrame:async()=> 'file:///frame.jpg',classifyFrame,categoryOf:r=>r.category})).category).toBe('pets');
 expect(RNFS.unlink).toHaveBeenCalledTimes(3);
});
