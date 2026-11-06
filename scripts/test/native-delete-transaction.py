"""Run the production delete method against deterministic SQLite failure scenarios."""
from pathlib import Path
import tempfile, subprocess, os, shutil
source = Path('android/app/src/main/java/com/imageclassifier/v2/database/ImageDataService.java').read_text()
start = source.index('    public Map<String, Object> removeImagesByUris(')
brace = source.index('{', start); depth = 1; end = brace + 1
while depth:
    depth += (source[end] == '{') - (source[end] == '}'); end += 1
method = source[start:end]
java = r'''
import java.util.*;
public class DeleteHarness {
 static String TAG="test";
 static class Log { static void e(String t,String m,Exception e){} static void w(String t,String m){} }
 static class SQLiteDatabase {
  int begins=0, ends=0, locks=0; boolean active=false, failDelete=false, failEnd=false;
  void beginTransaction(){ begins++; if(locks-->0) throw new android.database.sqlite.SQLiteDatabaseLockedException("locked"); active=true; }
  int delete(String t,String w,String[] a){if(failDelete)throw new IllegalStateException("delete failed");return 1;}
  void setTransactionSuccessful(){if(!active)throw new IllegalStateException("no transaction");}
  boolean inTransaction(){return active;}
  void endTransaction(){ends++;if(!active)throw new IllegalStateException("no current transaction");active=false;if(failEnd)throw new IllegalStateException("commit failed");}
 }
 static class Helper { SQLiteDatabase db=new SQLiteDatabase(); SQLiteDatabase getDatabase(){return db;} }
 Helper dbHelper=new Helper();
 String generateStableId(String s){return s;}
 METHOD
 static void check(boolean b,String m){if(!b)throw new AssertionError(m);}
 public static void main(String[] args){
  DeleteHarness h=new DeleteHarness(); Map<String,Object> r=h.removeImagesByUris(Arrays.asList("photo"));
  check(Boolean.TRUE.equals(r.get("success")) && h.dbHelper.db.ends==1,"success commits once");
  h=new DeleteHarness();h.dbHelper.db.locks=1;r=h.removeImagesByUris(Arrays.asList("photo"));
  check(Boolean.TRUE.equals(r.get("success")) && h.dbHelper.db.begins==2 && h.dbHelper.db.ends==1,"failed begin must retry without ending an absent transaction");
  h=new DeleteHarness();h.dbHelper.db.locks=100;r=h.removeImagesByUris(Arrays.asList("photo"));
  check(Boolean.FALSE.equals(r.get("success")) && h.dbHelper.db.ends==0 && h.dbHelper.db.begins<=5,"persistent lock bounded and original error retained");
  check(String.valueOf(r.get("error")).contains("locked"),"original lock error");
  h=new DeleteHarness();h.dbHelper.db.failDelete=true;r=h.removeImagesByUris(Arrays.asList("photo"));
  check(Boolean.FALSE.equals(r.get("success")) && h.dbHelper.db.ends==1 && ((Number)r.get("deletedCount")).intValue()==0,"delete error rolls back once");
  h=new DeleteHarness();h.dbHelper.db.failEnd=true;r=h.removeImagesByUris(Arrays.asList("photo"));
  check(Boolean.FALSE.equals(r.get("success")) && h.dbHelper.db.ends==1,"commit failure must not report success");
  System.out.println("PASS: success, transient lock, persistent lock, delete failure, commit failure");
 }
}
'''.replace('METHOD',method)
with tempfile.TemporaryDirectory(prefix='imagepilot-delete-test-') as tmp:
    p=Path(tmp); (p/'DeleteHarness.java').write_text(java)
    ex=p/'android/database/sqlite/SQLiteDatabaseLockedException.java';ex.parent.mkdir(parents=True);ex.write_text('package android.database.sqlite; public class SQLiteDatabaseLockedException extends RuntimeException { public SQLiteDatabaseLockedException(String m){super(m);} }')
    root=Path(os.environ['JAVA_HOME'])/'bin' if os.environ.get('JAVA_HOME') else Path(shutil.which('javac')).parent
    subprocess.run([str(root/'javac'),str(p/'DeleteHarness.java'),str(ex)],check=True)
    subprocess.run([str(root/'java'),'-cp',tmp,'DeleteHarness'],check=True)
