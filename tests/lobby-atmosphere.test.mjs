import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectsSunRay, LOBBY_BENCHES } from '../lobby-atmosphere.js';

test('sun rays hit an elevated tread only inside its projected footprint', () => {
  const tread = { minX: 3, maxX: 6, minZ: 4, maxZ: 5, minY: 2, maxY: 2.1 };
  assert.equal(intersectsSunRay(2, 3, tread, 1, 0.5), true);
  assert.equal(intersectsSunRay(0, 3, tread, 1, 0.5), false);
  assert.equal(intersectsSunRay(2, 6, tread, 1, 0.5), false);
});

test('parallel rays and objects behind the ray origin do not create false shadows', () => {
  const box = { minX: 3, maxX: 6, minZ: 4, maxZ: 5, minY: 2, maxY: 3 };
  assert.equal(intersectsSunRay(4, 4.5, box, 0, 0), true);
  assert.equal(intersectsSunRay(1, 4.5, box, 0, 0), false);
  assert.equal(intersectsSunRay(4, 4.5, {...box, minY:-3, maxY:-2}, 0, 0), false);
});

test('bench footprints leave the central passage and lobby mascot clear', () => {
  for (const bench of LOBBY_BENCHES) {
    assert.ok(bench.x + bench.width / 2 + 0.38 < -2);
    assert.ok(Math.abs(bench.x + 3.4) > bench.width / 2 + 0.75);
    assert.ok(bench.z - bench.length / 2 > 0);
    assert.ok(bench.z + bench.length / 2 < 14);
  }
});
