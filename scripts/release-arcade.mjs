import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { api, bucket, origin, requireCI } from './arcade-r2.mjs';
import { r2Ids, selectedGames, gameDist } from './arcade-games.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const validPath = path => /^[a-zA-Z0-9_./-]+$/.test(path) && path.split('/').every(part => part && !part.startsWith('.'));
const channel = id => `${origin}/channels/${id}.js`;
const version = release => `${origin}/games/${release.id}/${release.digest}`;
const entryText = entry => `// ${JSON.stringify(entry)}\nimport "../games/${entry.id}/${entry.digest}/component.js";\n`;

export async function prepareRelease(root, id, sha) {
  assert(r2Ids.includes(id), 'Unapproved R2 game');
  assert.match(sha, commit);
  const directory = join(root, gameDist(id));
  const files = [];
  async function walk(prefix = '') {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), 'Release must not contain symlinks');
      if (['_headers', '_redirects', 'stats.html'].includes(path)) continue; // Hosting configuration is not a public asset.
      assert(validPath(path), `Unsafe public asset: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else {
        assert(entry.isFile(), `Not a regular file: ${path}`);
        assert(!/\.(?:map|env|pem|key)$/.test(path), `Non-runtime asset: ${path}`);
        const bytes = await readFile(join(directory, path));
        files.push({ path, size: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await walk();
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert(files.some(file => file.path === 'component.js'), 'Component entry required');
  assert(!files.some(file => file.path === 'release.json'), 'Reserved release manifest');
  const data = { id, sha, files };
  return { ...data, digest: digest(JSON.stringify(data)) };
}

export function validateRelease(release, id, expectedDigest) {
  assert(r2Ids.includes(id));
  assert.equal(release.id, id);
  assert.match(release.sha, commit);
  assert.match(expectedDigest, hex);
  assert.equal(release.digest, expectedDigest);
  assert(Array.isArray(release.files) && release.files.some(file => file.path === 'component.js'));
  assert.equal(new Set(release.files.map(file => file.path)).size, release.files.length);
  for (const file of release.files) {
    assert(validPath(file.path)); assert.match(file.sha256, hex);
    assert(Number.isSafeInteger(file.size) && file.size >= 0);
  }
  assert.equal(digest(JSON.stringify({ id, sha: release.sha, files: release.files })), expectedDigest);
  return release;
}

async function publicGet(url, optional = false) {
  const response = await fetch(url, { headers: { Origin: 'https://playminiarcade.com' }, signal: AbortSignal.timeout(30000) });
  if (optional && response.status === 404) return null;
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('access-control-allow-origin'), '*', `${url}: public CORS`);
  return response;
}

async function currentEntry(id) {
  const response = await publicGet(`${channel(id)}?check=${randomUUID()}`, true);
  if (!response) return null;
  assert.match(response.headers.get('cache-control') || '', /no-store/, 'Stable entry must bypass cache');
  const text = await response.text();
  const entry = JSON.parse(text.split('\n')[0].slice(3));
  assert.equal(entry.id, id); assert.match(entry.digest, hex); assert.match(entry.promotedBy, commit);
  assert.equal(text, entryText(entry), 'Unexpected stable entry');
  return entry;
}

async function loadRelease(id, key) {
  assert.match(key, hex);
  const response = await publicGet(`${origin}/games/${id}/${key}/release.json`);
  return validateRelease(await response.json(), id, key);
}

export async function verifyRelease(release) {
  validateRelease(release, release.id, release.digest);
  for (const file of release.files) {
    const url = `${version(release)}/${file.path}`;
    const response = await publicGet(url);
    assert.match(response.headers.get('cache-control') || '', /immutable/, `${url}: immutable caching`);
    if (/\.m?js$/.test(file.path)) assert.match(response.headers.get('content-type') || '', /(?:java|ecma)script/, `${url}: JavaScript MIME`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.size, url);
    assert.equal(digest(bytes), file.sha256, url);
  }
  // Run the real module graph from the final CDN, with the future host's origin and CSP.
  const require = createRequire(join(process.cwd(), 'package.json'));
  const { chromium } = require(process.env.GITHUB_REPOSITORY === 'quiet-build/mini-arcade-landing' ? 'playwright' : '@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const harness = 'https://playminiarcade.com/__r2_release_check';
    await page.route(harness, route => route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': `default-src 'none'; script-src ${origin} ${release.id === 'kids-chess' ? "'wasm-unsafe-eval'" : ''}; style-src 'unsafe-inline' ${origin}; img-src data: ${origin} ${release.id === 'neon-tide' ? 'blob:' : ''}; connect-src ${origin} ${release.id === 'neon-tide' ? 'https://neon-tide-api.matwming114.workers.dev wss://neon-tide-api.matwming114.workers.dev' : ''}; font-src ${origin}; media-src ${origin}; ${['kids-chess', 'gomoku-3d', 'voxel-garden'].includes(release.id) ? `worker-src blob: ${release.id === 'kids-chess' ? '' : origin}` : ''}`,
    }, body: `<pma-${release.id}></pma-${release.id}><script type="module" src="${version(release)}/component.js"></script>` })) ;
    await page.addInitScript(() => {
      window.ready = false; window.violations = [];
      document.addEventListener('pma-ready', () => { window.ready = true; });
      document.addEventListener('securitypolicyviolation', event => window.violations.push(event.blockedURI));
    });
    await page.goto(harness);
    await page.waitForFunction(() => window.ready, null, { timeout: 20000 });
    assert(await page.locator(`pma-${release.id}`).evaluate(element => element.shadowRoot?.textContent.length > 0));
    assert.deepEqual(await page.evaluate(() => window.violations), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  console.log(`Verified ${release.id}: ${release.files.length} assets and CDN module/CSP readiness`);
}

// Shared by publication and rollback: no entry write is reachable after failed verification.
export async function verifiedSwitch(verify, write) { await verify(); await write(); }

async function rcloneEnvironment() {
  const token = await api('/user/tokens/verify');
  assert.equal(token.status, 'active');
  assert.match(token.id, /^[a-f0-9]{32}$/);
  const secret = digest(process.env.CLOUDFLARE_API_TOKEN);
  console.log(`::add-mask::${secret}`);
  return { ...process.env, RCLONE_CONFIG: '/dev/null', RCLONE_CONFIG_ARCADE_TYPE: 's3',
    RCLONE_CONFIG_ARCADE_PROVIDER: 'Cloudflare', RCLONE_CONFIG_ARCADE_ACCESS_KEY_ID: token.id,
    RCLONE_CONFIG_ARCADE_SECRET_ACCESS_KEY: secret, RCLONE_CONFIG_ARCADE_REGION: 'auto',
    RCLONE_CONFIG_ARCADE_ENDPOINT: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_ARCADE_NO_CHECK_BUCKET: 'true' };
}

export async function main(mode) {
  requireCI();
  assert(['publish', 'rollback', 'inspect'].includes(mode));
  const sha = process.env.GITHUB_SHA;
  assert.match(sha, commit);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', 'HEAD'), sha);
  const rclone = async (...args) => execFileSync('rclone', args, { env: await rcloneEnvironment(), stdio: 'inherit' });
  if (mode === 'inspect') {
    await rclone('lsf', `arcade:${bucket}`, '--max-depth', '1');
    console.log('Dedicated bucket S3 access verified with CI credentials');
    return;
  }
  const ids = selectedGames(r2Ids);
  if (mode === 'rollback') assert.equal(ids.length, 1, 'Rollback exactly one game');
  for (const id of ids) {
    const before = await currentEntry(id);
    let release;
    if (mode === 'rollback') {
      assert(before, 'Existing channel required');
      assert.equal(before.digest, process.env.EXPECTED_DIGEST, 'Channel changed since rollback was requested');
      release = await loadRelease(id, process.env.RELEASE_DIGEST);
    } else {
      release = await prepareRelease(process.cwd(), id, sha);
      if (before) {
        const previous = await loadRelease(id, before.digest);
        if (JSON.stringify(previous.files) === JSON.stringify(release.files)) {
          console.log(`Skip ${id}: current release already has identical assets`); continue;
        }
      }
      const stage = join('.release/r2', id, release.digest);
      await mkdir(stage, { recursive: true });
      for (const file of release.files) {
        const target = join(stage, file.path);
        await mkdir(join(target, '..'), { recursive: true });
        await cp(join(gameDist(id), file.path), target);
      }
      await writeFile(join(stage, 'release.json'), JSON.stringify(release, null, 2) + '\n');
      await rclone('copy', stage, `arcade:${bucket}/games/${id}/${release.digest}`, '--immutable', '--checksum', '--metadata', '--metadata-set', 'cache-control=public, max-age=31536000, immutable, no-transform');
    }
    await verifiedSwitch(() => verifyRelease(release), async () => {
      assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], sha, 'Stale CI cannot promote over newer main');
      assert.deepEqual(await currentEntry(id), before, 'Channel changed during verification');
      if (before) git('merge-base', '--is-ancestor', before.promotedBy, sha);
      const entry = { id, digest: release.digest, promotedBy: sha };
      const file = join('.release/r2', `${id}.js`);
      await mkdir('.release/r2', { recursive: true });
      await writeFile(file, entryText(entry));
      await rclone('copyto', file, `arcade:${bucket}/channels/${id}.js`, '--ignore-times', '--metadata', '--metadata-set', 'cache-control=no-store', '--metadata-set', 'content-type=text/javascript');
      const live = await publicGet(channel(id));
      assert.match(live.headers.get('cache-control') || '', /no-store/);
      assert.equal(await live.text(), entryText(entry));
      await writeFile(join('.release/r2', `${id}-result.json`), JSON.stringify({ mode, before, after: entry }, null, 2));
      console.log(`${mode} ${id}: ${before?.digest || 'new'} -> ${release.digest}`);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
