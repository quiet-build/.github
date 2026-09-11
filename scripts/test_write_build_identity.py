import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class WriteBuildIdentityTests(unittest.TestCase):
    def write(self, env, dist='dist'):
        root = Path(tempfile.mkdtemp())
        script = Path(__file__).with_name('write_build_identity.js')
        subprocess.run(
            ['node', script, str(root / dist)],
            check=True,
            env={**os.environ, **env},
        )
        return json.loads((root / dist / 'version.json').read_text())

    def test_writes_identity(self):
        sha = '0123456789abcdef0123456789abcdef01234567'
        payload = self.write({'GITHUB_SHA': sha, 'BUILD_ID': 'sprout-lane'})
        self.assertEqual(payload['id'], 'sprout-lane')
        self.assertEqual(payload['sha'], sha)
        self.assertEqual(payload['short'], '0123456')
        self.assertTrue(payload['builtAt'])

    def test_rejects_short_sha(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.write({'GITHUB_SHA': 'abc', 'BUILD_ID': 'sprout-lane'})


if __name__ == '__main__':
    unittest.main()
