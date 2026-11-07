"""Run the repository's table DDL and camera migration declarations on legacy SQLite.
No real app database is opened. Verifies preserved classification records and repeatability.
"""
import re, sqlite3
from pathlib import Path
source = Path('src/services/ImageStorageService.js').read_text()
ddl = re.search(r'const createTablesSql = `([\s\S]*?)`;', source)[1]
fields = re.findall(r"\{ name: '(\w+)', type: '(\w+)' \}", source[source.index('async migrateAddCameraSettings()'):source.index('async migrateStagingBox()')])
legacy = re.sub(r'^.*(?:cameraSettings|isoCategory|apertureCategory|shutterCategory|focalLengthCategory).*\n', '', ddl[:ddl.index('-- 索引优化')], flags=re.M)
legacy = re.sub(r'--[^\n]*', '', legacy)
legacy = re.sub(r',\s*\);', '\n);', legacy)
db = sqlite3.connect(':memory:')
db.executescript(legacy)
db.execute("INSERT INTO images(id,uri,fileName,category,message,mobileNetV3Detections) VALUES (?,?,?,?,?,?)",('old','ph://old','old.jpg','travel_scenery','旧描述','{"old":true}'))
original = db.execute('SELECT id,category,message,mobileNetV3Detections FROM images').fetchall()
for _ in range(2):
    db.executescript(ddl)  # Must not create an index on a column that has not been migrated yet.
    cols = {row[1] for row in db.execute('PRAGMA table_info(images)')}
    for name, typ in fields:
        if name not in cols: db.execute(f'ALTER TABLE images ADD COLUMN {name} {typ}')
    for name in ['isoCategory','apertureCategory','shutterCategory','focalLengthCategory']:
        db.execute(f'CREATE INDEX IF NOT EXISTS idx_{name} ON images({name})')
    assert db.execute('SELECT id,category,message,mobileNetV3Detections FROM images').fetchall() == original
print('PASS: legacy SQLite missing camera columns upgrades twice without changing stored classifications')
