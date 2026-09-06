"""Retain immutable game dependencies; never restore a previous entry or page."""
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import zipfile

MAX_FILES = 20000
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024**3  # GitHub requires strictly less than 2 GiB.
MAX_TOTAL_BYTES = 2 * 1024**3  # Bound decompression and CI disk use as well.


def safe_path(name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', name):
        raise ValueError(f'invalid path: {name!r}')
    if any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError(f'invalid path: {name!r}')
    return name


def retained(name):
    safe_path(name)
    return (name.startswith('assets/') and Path(name).suffix in
            {'.js', '.css', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif', '.mp3', '.ogg', '.wav', '.glb', '.gltf', '.bin'}) or bool(
        re.fullmatch(r'audio/[A-Za-z0-9_-]+\.mp3|stockfish/stockfish-[A-Za-z0-9_.-]+\.(js|wasm)', name))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def limits(files):
    if len(files) > MAX_FILES:
        raise ValueError('Pages file count exceeds 20000')
    if any(size > MAX_FILE_BYTES or size < 0 for size in files.values()):
        raise ValueError('Pages file size exceeds 25 MiB')
    if sum(files.values()) > MAX_TOTAL_BYTES:
        raise ValueError('snapshot uncompressed size exceeds 2 GiB safety ceiling')


def inventory(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('distribution must be a real directory, not a symlink')
    files = {}
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'symlink: {path}')
        name = safe_path(path.relative_to(root).as_posix())
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f'non-regular file: {name}')
        files[name] = path.stat().st_size
    limits(files)
    headers = (root / '_headers').read_text()
    if any(len(line) > 2000 for line in headers.splitlines()):
        raise ValueError('header string exceeds 2000 characters')
    wildcard = re.search(r'^/\*\s*\n((?:[ \t]+[^\n]*\n?)*)', headers, re.M)
    if not wildcard or not re.search(r'Access-Control-Allow-Origin:\s*\*\s*$', wildcard[1], re.M | re.I):
        raise ValueError('wildcard dependency CORS header required')
    if not re.search(r'Cache-Control:.*max-age=0.*must-revalidate', headers, re.I):
        raise ValueError('stable entry revalidation header required')
    if 'component.js' not in files or 'index.html' not in files:
        raise ValueError('current component.js and index.html required')
    return files


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate metadata key: {key}')
        result[key] = value
    return result


def read_snapshot(path):
    if path.is_symlink() or path.stat().st_size >= MAX_ARCHIVE_BYTES:
        raise ValueError('invalid snapshot or archive size >= 2 GiB')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or len(names) > MAX_FILES + 1:
            raise ValueError('duplicate archive path or file count limit')
        for entry in entries:
            safe_path(entry.filename)
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if mode not in (0, stat.S_IFREG) or entry.is_dir() or entry.flag_bits & 1:
                raise ValueError('archive member must be a regular unencrypted file')
            if entry.file_size > MAX_FILE_BYTES or entry.file_size < 0:
                raise ValueError('archive file size limit')
        limits({entry.filename: entry.file_size for entry in entries})
        metadata = json.loads(archive.read('manifest.json'), object_pairs_hook=reject_duplicate_keys)
        if set(metadata) != {'version', 'files'} or metadata['version'] != 1 or not isinstance(metadata['files'], dict):
            raise ValueError('invalid manifest')
        files = metadata['files']
        if set(names) != set(files) | {'manifest.json'}:
            raise ValueError('archive/manifest paths differ')
        for name, item in files.items():
            if not retained(name) or not isinstance(item, dict) or set(item) != {'size', 'sha256'}:
                raise ValueError(f'invalid retained metadata: {name}')
            if type(item['size']) is not int or item['size'] != archive.getinfo(name).file_size:
                raise ValueError(f'file size metadata mismatch: {name}')
            if not isinstance(item['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', item['sha256']):
                raise ValueError(f'invalid hash: {name}')
            if digest(archive.read(name)) != item['sha256']:
                raise ValueError(f'hash mismatch: {name}')
        return files


def merge(root, previous, output):
    root, output = Path(root), Path(output)
    current = inventory(root)
    old = read_snapshot(Path(previous)) if previous else {}
    limits({**{name: item['size'] for name, item in old.items()}, **current})
    # Validate every collision before any restore write; entries are never extracted wholesale.
    for name, item in old.items():
        target = root / name
        if target.exists() and (not target.is_file() or digest(target.read_bytes()) != item['sha256']):
            raise ValueError(f'changed retained bytes: {name}; publish a new asset filename')
        if any(parent.is_file() for parent in target.parents if parent != root):
            raise ValueError(f'file/directory collision: {name}')
    if previous:
        with zipfile.ZipFile(previous) as archive:
            for name in old:
                target = root / name
                if name not in current:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
    files = {}
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(inventory(root)):
            if retained(name):
                data = (root / name).read_bytes()
                files[name] = {'size': len(data), 'sha256': digest(data)}
                archive.writestr(name, data)
        archive.writestr('manifest.json', json.dumps({'version': 1, 'files': files}, sort_keys=True))
    if output.stat().st_size >= MAX_ARCHIVE_BYTES:
        raise ValueError('archive size must be under 2 GiB')
    read_snapshot(output)
    print(f'Retained {len(files)} assets; snapshot {output.stat().st_size} bytes')


def select_release(pages):
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise ValueError('invalid release listing; only successful empty listings mean first release')
    releases = [release for page in pages for release in page
                if release['tag_name'].startswith('arcade-assets-') and not release['draft']]
    if not releases:
        return ''
    release = max(releases, key=lambda item: item['id'])
    if not re.fullmatch(r'arcade-assets-[0-9]+-[0-9]+', release['tag_name']):
        raise ValueError('invalid snapshot release tag')
    assets = release['assets']
    if len(assets) != 1 or assets[0]['name'] != 'snapshot.zip' or assets[0]['state'] != 'uploaded' or not 0 < assets[0]['size'] < MAX_ARCHIVE_BYTES:
        raise ValueError('latest snapshot release is incomplete or exceeds archive size limit')
    return release['tag_name']


def check_pin(caller, sha):
    text = Path(caller).read_text()
    uses = re.findall(r'^\s+uses: quiet-build/\.github/\.github/workflows/deploy-arcade-component\.yml@([a-f0-9]{40})\s*$', text, re.M)
    pins = re.findall(r'^\s+support-sha: ([a-f0-9]{40})\s*$', text, re.M)
    if not re.fullmatch('[a-f0-9]{40}', sha) or uses != [sha] or pins != [sha]:
        raise ValueError('caller reusable workflow and helper support SHA must match exactly')


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    if command == 'merge':
        merge(args[0], None if args[1] == '-' else args[1], args[2])
    elif command == 'select-release':
        print(select_release(json.loads(Path(args[0]).read_text())))
    elif command == 'check-pin':
        check_pin(*args)
    else:
        raise SystemExit('usage: retain_arcade_assets.py merge DIST PREVIOUS|- OUTPUT | select-release JSON | check-pin CALLER SHA')
