import assert from 'node:assert/strict';
export const workspaceIds = ["animal-match", "box-pusher", "number-2048", "brick-drop", "brick-break", "mine-field", "garden-moles", "coin-catch", "cave-run", "lily-snap", "marble-tilt", "pellet-path", "sharp-eye", "circle-cat", "color-hop", "tile-clear", "arrow-aim", "block-slice", "one-line", "rooftop-run", "spot-pair", "sky-raid", "planet-guard", "lane-race", "card-run", "slide-nine", "camp-watch", "piece-turn", "speed-tap", "number-lock", "light-toggle", "pipe-fit", "piano-tap", "hoop-tap", "bid-hand", "shake-cola", "fast-dice", "circle-link", "touch-ball", "one-track", "red-green", "gate-climb", "strong-bow", "thin-line", "tick-mark", "bubble-pop", "egg-drop", "stick-span", "next-num", "ten-drops", "jump-snail", "hex-turn", "wall-bit", "gem-dodge", "cash-count", "su-doku", "black-jack", "tile-link", "core-ball", "draw-ring", "fruit-cut", "gold-hook", "tank-duel", "free-kick", "frog-cross", "bomb-squad", "dont-die", "donkey-jump", "room-exit"];
export const originalRepos = {
  "voxel-garden": "voxel-garden",
  "grove-rally": "grove-rally",
  "kids-chess": "kids-chess",
  "neon-tide": "neon-tide",
  "block-garden": "block-garden",
  "meteor-mail": "meteor-mail",
  "tiny-keeper": "tiny-keeper",
  "shape-switchyard": "shape-switchyard",
  "stack-bakery": "stack-bakery",
  "bloom-bouncer": "bloom-bouncer",
  "river-rounds": "river-rounds",
  "sprout-lane": "sprout-lane",
  "gomoku-3d": "kids-gomoku",
  "candy-snake": "candy-snake",
  "defense-arcade": "kids-defense-arcade",
  "flappy": "flappy-3d"
};
export const r2Ids = [...workspaceIds, ...Object.keys(originalRepos)];
export const gameRepo = id => `quiet-build/${originalRepos[id] || 'mini-arcade-landing'}`;
export const gameDist = id => workspaceIds.includes(id) ? `Games/${id}/dist` : 'dist';
export function selectedGames() {
  const allowed = r2Ids.filter(id => gameRepo(id) === process.env.GITHUB_REPOSITORY);
  assert(allowed.length, 'Unapproved repository');
  const selected = process.env.ARCADE_GAMES ? JSON.parse(process.env.ARCADE_GAMES) : allowed;
  assert(Array.isArray(selected) && selected.length && selected.every(id => allowed.includes(id)), 'Unapproved game selection for repository');
  return allowed.filter(id => selected.includes(id));
}
