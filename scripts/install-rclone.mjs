import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const platform = `${process.platform}-${process.arch}`;
const builds = {
  'darwin-arm64': ['osx-arm64', 'c61d7a371c62bcbbe882c3423aa4b8bf63485c248dd0f692997b8f0c3f6d0c6f'],
  'linux-x64': ['linux-amd64', '982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab'],
};
assert(builds[platform], 'Unsupported runner');
const [suffix, checksum] = builds[platform];
const name = `rclone-v1.75.1-${suffix}`;
const directory = join(process.env.RUNNER_TEMP || tmpdir(), 'mini-arcade-rclone-1.75.1');
await mkdir(directory, { recursive: true });
const response = await fetch(`https://github.com/rclone/rclone/releases/download/v1.75.1/${name}.zip`);
assert(response.ok, 'Pinned rclone download failed');
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum);
const zip = join(directory, `${name}.zip`);
await writeFile(zip, bytes);
execFileSync('unzip', ['-q', '-o', zip, '-d', directory]);
const bin = join(directory, name);
execFileSync(join(bin, 'rclone'), ['version'], { stdio: 'inherit' });
if (process.env.GITHUB_PATH) await appendFile(process.env.GITHUB_PATH, `${bin}\n`);
else console.log(`rclone directory: ${bin}`);
