const fs = require('fs');
const sha = process.env.GITHUB_SHA;
const id = process.env.BUILD_ID;
const dist = process.argv[2] || 'dist';
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('GITHUB_SHA');
if (!/^[a-z0-9-]+$/.test(id)) throw new Error('BUILD_ID');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(`${dist}/version.json`, `${JSON.stringify({
  id, sha, short: sha.slice(0, 7), builtAt: new Date().toISOString(),
}, null, 2)}\n`);
