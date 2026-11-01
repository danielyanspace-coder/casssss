#!/usr/bin/env python3
"""Restore byte-identical historical source.tar.gz files after extraction."""
from pathlib import Path
import hashlib,json,subprocess,sys,zlib
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
manifest=json.loads((root/'PACKING.json').read_text())
for entry in manifest['gzip_archives']:
 destination=(root/entry['path']).resolve();source=(root/entry['stored_as']).resolve()
 if not destination.is_relative_to(root) or not source.is_relative_to(root):raise RuntimeError('Unsafe archive path')
 destination.parent.mkdir(parents=True,exist_ok=True)
 with destination.open('xb') as output:
  if entry.get('encoder')=='zlib':
   compressor=zlib.compressobj(entry['gzip_level'],zlib.DEFLATED,31)
   with source.open('rb') as original:
    for chunk in iter(lambda:original.read(1024*1024),b''):output.write(compressor.compress(chunk))
   output.write(compressor.flush())
  else:
   subprocess.run(['gzip',f"-{entry['gzip_level']}",'-n','-c',str(source)],stdout=output,check=True)
 digest=hashlib.sha256()
 with destination.open('rb') as restored:
  for chunk in iter(lambda:restored.read(1024*1024),b''):digest.update(chunk)
 if digest.hexdigest()!=entry['sha256']:
  destination.unlink();raise RuntimeError(f'Checksum mismatch: {entry["path"]}; the uncompressed original is retained at {source}')
 print('Restored and verified:',entry['path'])
print('Historical archives restored. Uncompressed packing files may now be removed.')
