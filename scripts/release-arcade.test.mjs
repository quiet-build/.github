import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRelease, validateRelease, verifiedSwitch } from './release-arcade.mjs';
import { requireCI } from './arcade-r2.mjs';

test('versioned releases preserve the old entry on failure and include every runtime asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pma-r2-'));
  try {
    const dist = join(root, 'Games/animal-match/dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'component.js'), 'import "./assets/part.js";');
    await writeFile(join(dist, 'assets/part.js'), 'export const version = 1;');
    await writeFile(join(dist, '_headers'), 'not an object');
    const release = await prepareRelease(root, 'animal-match', 'a'.repeat(40));
    assert.equal(release.files.length, 2);
    validateRelease(release, 'animal-match', release.digest);
    assert.throws(() => validateRelease({ ...release, files: [] }, 'animal-match', release.digest));
    assert.deepEqual(await prepareRelease(root, 'animal-match', 'a'.repeat(40)), release);
    let active = 'old';
    await assert.rejects(verifiedSwitch(async () => { throw Error('incomplete upload'); }, async () => { active = 'bad'; }));
    assert.equal(active, 'old');
    await verifiedSwitch(async () => validateRelease(release, 'animal-match', release.digest), async () => { active = release.digest; });
    assert.equal(active, release.digest);
    await symlink(join(dist, 'component.js'), join(dist, 'leak.js'));
    await assert.rejects(prepareRelease(root, 'animal-match', 'a'.repeat(40)), /symlink/);
    await assert.rejects(prepareRelease(root, '../outside', 'a'.repeat(40)), /Unapproved/);
    if (process.env.GITHUB_ACTIONS !== 'true') assert.throws(requireCI, /CI-only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CI cannot publish a sibling repository game', async () => {
  const { selectedGames } = await import('./arcade-games.mjs');
  const saved = { ...process.env };
  try {
    process.env.GITHUB_REPOSITORY = 'quiet-build/grove-rally';
    delete process.env.ARCADE_GAMES;
    assert.deepEqual(selectedGames(), ['grove-rally']);
    process.env.ARCADE_GAMES = '["animal-match"]';
    assert.throws(selectedGames, /Unapproved game selection/);
  } finally { process.env = saved; }
});
