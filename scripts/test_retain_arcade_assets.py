import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('retain_arcade_assets.py'))
        self.assertTrue(Path(spec.origin).exists(), 'retention implementation must exist')
        self.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.helper)

    def build(self, name, chunk):
        root = self.root / name
        for path, data in {'component.js': f'import "./assets/{chunk}.js"', 'index.html': name,
                           'sw.js': name, '_headers': '/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=0, must-revalidate\n',
                           f'assets/{chunk}.js': chunk, 'audio/music.mp3': 'music',
                           'stockfish/stockfish-18-lite-single.wasm': 'wasm'}.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(data)
        return root

    def test_two_builds_preserve_old_bytes_and_current_entry(self):
        old = self.build('old', 'a1234567')
        previous = self.root / 'previous.zip'
        self.helper.merge(old, None, previous)
        current = self.build('current', 'b1234567')
        self.helper.merge(current, previous, self.root / 'next.zip')
        self.assertEqual((current / 'assets/a1234567.js').read_text(), 'a1234567')
        self.assertEqual((current / 'assets/b1234567.js').read_text(), 'b1234567')
        self.assertEqual((current / 'component.js').read_text(), 'import "./assets/b1234567.js"')
        self.assertEqual((current / 'index.html').read_text(), 'current')
        self.assertEqual((current / 'sw.js').read_text(), 'current')
        with zipfile.ZipFile(self.root / 'next.zip') as archive:
            self.assertNotIn('component.js', archive.namelist())
            self.assertNotIn('_headers', archive.namelist())
            self.assertIn('audio/music.mp3', archive.namelist())
            self.assertIn('stockfish/stockfish-18-lite-single.wasm', archive.namelist())

    def test_same_path_changed_bytes_rejected_including_vendor(self):
        for path in ['assets/a1234567.js', 'audio/music.mp3', 'stockfish/stockfish-18-lite-single.wasm']:
            with self.subTest(path=path):
                old = self.build('old', 'a1234567')
                previous = self.root / (path.replace('/', '_') + '.zip')
                self.helper.merge(old, None, previous)
                current = self.build('current', 'a1234567')
                (current / path).write_text('changed')
                with self.assertRaisesRegex(ValueError, 'changed retained bytes'):
                    self.helper.merge(current, previous, self.root / 'next.zip')

    def test_malicious_archives_and_hashes_rejected(self):
        for path, mode, digest in [('../escape.js', 0, None), ('/absolute.js', 0, None),
                                  ('assets/../escape.js', 0, None), ('assets\\escape.js', 0, None),
                                  ('component.js', 0, None), ('assets/link.js', stat.S_IFLNK, None),
                                  ('assets/bad.js', 0, '0' * 64)]:
            with self.subTest(path=path):
                archive = self.root / 'bad.zip'
                with zipfile.ZipFile(archive, 'w') as out:
                    info = zipfile.ZipInfo(path)
                    info.external_attr = mode << 16
                    out.writestr(info, b'bad')
                    out.writestr('manifest.json', json.dumps({'version': 1, 'files': {
                        path: {'sha256': digest or hashlib.sha256(b'bad').hexdigest(), 'size': 3}}}))
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    self.helper.merge(self.build('current', 'b1234567'), archive, self.root / 'next.zip')

    def test_current_symlink_limits_and_corrupt_manifest_rejected(self):
        current = self.build('current', 'b1234567')
        link = current / 'assets/link.js'
        link.symlink_to(current / 'component.js')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.helper.merge(current, None, self.root / 'next.zip')
        link.unlink()
        self.helper.MAX_FILES = 2
        with self.assertRaisesRegex(ValueError, 'file count'):
            self.helper.merge(current, None, self.root / 'next.zip')
        self.helper.MAX_FILES = 20000
        self.helper.MAX_FILE_BYTES = 2
        with self.assertRaisesRegex(ValueError, 'file size'):
            self.helper.merge(current, None, self.root / 'next.zip')
        self.helper.MAX_FILE_BYTES = 25 * 1024 * 1024
        self.helper.MAX_ARCHIVE_BYTES = 10
        with self.assertRaisesRegex(ValueError, 'archive size'):
            self.helper.merge(current, None, self.root / 'next.zip')

    def test_release_selection_distinguishes_absence_and_corruption(self):
        self.assertEqual(self.helper.select_release([[]]), '')
        release = {'id': 1, 'tag_name': 'arcade-assets-123-1', 'draft': False,
                   'assets': [{'name': 'snapshot.zip', 'state': 'uploaded', 'size': 42}]}
        self.assertEqual(self.helper.select_release([[release]]), 'arcade-assets-123-1')
        release['assets'] = []
        with self.assertRaises(ValueError):
            self.helper.select_release([[release]])
        with self.assertRaises(ValueError):
            self.helper.select_release({'message': 'Bad credentials'})

    def test_duplicate_members_corrupt_metadata_and_uncompressed_limits(self):
        import warnings
        current = self.build('current', 'b1234567')
        archive = self.root / 'bad.zip'
        for metadata in ['not json', '{"version":1,"version":1,"files":{}}', '{"version":2,"files":{}}']:
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('manifest.json', metadata)
            with self.assertRaises(ValueError):
                self.helper.merge(current, archive, self.root / 'next.zip')
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('assets/a.js', 'a')
                out.writestr('assets/a.js', 'b')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.helper.merge(current, archive, self.root / 'next.zip')
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as out:
            out.writestr('assets/bomb.js', b'0' * (25 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, 'file size'):
            self.helper.merge(current, archive, self.root / 'next.zip')

    def test_headers_and_output_collision_fail_closed(self):
        current = self.build('current', 'b1234567')
        (current / '_headers').write_text('/*\n  Access-Control-Allow-Origin: *\n')
        with self.assertRaisesRegex(ValueError, 'revalidation'):
            self.helper.merge(current, None, self.root / 'next.zip')
        current = self.build('current', 'b1234567')
        output = self.root / 'next.zip'
        output.write_text('previous recoverable snapshot')
        with self.assertRaises(FileExistsError):
            self.helper.merge(current, None, output)
        self.assertEqual(output.read_text(), 'previous recoverable snapshot')

    def test_workflow_helper_pin_must_match(self):
        sha = 'a' * 40
        caller = self.root / 'deploy.yml'
        caller.write_text(f'    uses: quiet-build/.github/.github/workflows/deploy-arcade-component.yml@{sha}\n    with:\n      support-sha: {sha}\n')
        self.helper.check_pin(caller, sha)
        with self.assertRaises(ValueError):
            self.helper.check_pin(caller, 'b' * 40)


if __name__ == '__main__':
    unittest.main()
