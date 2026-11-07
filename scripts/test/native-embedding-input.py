"""Execute the Android embedding image loader on a JVM; verify encoded bytes survive unchanged."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile

source = Path('android/app/src/main/java/com/imageclassifier/v2/GemmaModule.java').read_text()
embed = source[source.index('public void embed('):source.index('public void classify(')]
loader = re.search(r'newInstance\(\(Object\) (\w+)\(imagePath\)\)', embed).group(1)
start = source.index('  private static byte[] ' + loader + '(')
brace = source.index('{', start)
end, depth = brace + 1, 1
while depth:
    depth += (source[end] == '{') - (source[end] == '}')
    end += 1
method = source[start:end]
java = r'''
import java.io.*;
import java.util.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
public class EmbeddingInputHarness {
 static class Bitmap {
  BufferedImage image; Bitmap(BufferedImage i){image=i;}
  enum CompressFormat { PNG }
  boolean compress(CompressFormat f,int quality,OutputStream out)throws Exception{return ImageIO.write(image,"png",out);}
  void recycle(){}
 }
 static class BitmapFactory {
  static Bitmap decodeFile(String p)throws Exception{BufferedImage i=ImageIO.read(new File(p));return i==null?null:new Bitmap(i);}
 }
 METHOD
 public static void main(String[] args)throws Exception {
  File image=new File(args[0],"照片 with space.jpg");
  ImageIO.write(new BufferedImage(17,23,BufferedImage.TYPE_INT_RGB),"jpg",image);
  byte[] expected=java.nio.file.Files.readAllBytes(image.toPath());
  for(String path:new String[]{image.getAbsolutePath(),"file://"+image.getAbsolutePath()}){
   if(!Arrays.equals(expected,LOADER(path))) throw new AssertionError("Prepared JPEG bytes changed before embedding");
  }
  try{LOADER(new File(args[0],"missing.jpg").getPath());throw new AssertionError("Missing image must fail");}catch(IOException expectedFailure){}
  System.out.println("PASS: JPEG byte identity, plain/file URI paths with Unicode/spaces, missing file failure");
 }
}
'''.replace('METHOD', method).replace('LOADER', loader)
with tempfile.TemporaryDirectory(prefix='imagepilot-embedding-input-') as tmp:
    p = Path(tmp)
    (p / 'EmbeddingInputHarness.java').write_text(java)
    java_bin = Path(os.environ['JAVA_HOME']) / 'bin' if os.environ.get('JAVA_HOME') else Path(shutil.which('javac')).parent
    subprocess.run([str(java_bin / 'javac'), str(p / 'EmbeddingInputHarness.java')], check=True)
    subprocess.run([str(java_bin / 'java'), '-cp', tmp, 'EmbeddingInputHarness', tmp], check=True)
