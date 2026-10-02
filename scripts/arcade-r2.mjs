import assert from 'node:assert/strict';
import { r2Ids, gameRepo } from './arcade-games.mjs';

export const bucket = 'mini-arcade-assets';
export const domain = 'assets.playminiarcade.com';
export const origin = `https://${domain}`;

export function requireCI() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Production changes are CI-only');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert(r2Ids.some(id => gameRepo(id) === process.env.GITHUB_REPOSITORY), 'Unapproved repository');
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, '4f5580647c2e15bdef232ad4f1b10302');
}

export async function api(path) {
  assert(process.env.CLOUDFLARE_API_TOKEN, 'Cloudflare CI token required');
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  assert(response.ok && body.success, `Cloudflare ${path}: HTTP ${response.status}; ${body.errors?.map(e => `${e.code}: ${e.message}`).join(', ')}`);
  return body.result;
}

