import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeight, DAISEN_VIEW } from '../daisen-landscape.js';

test('bank joins the pond edge gently without tall terrain obscuring the mountain', () => {
  assert.ok(terrainHeight(27, 5) <= 0.04);
  assert.ok(Math.abs(terrainHeight(27.001, 5) - terrainHeight(27, 5)) < 0.001);
  for (let x = 27; x <= 500; x += 2) for (let z = -250; z <= 50; z += 10) {
    const height = terrainHeight(x, z);
    assert.ok(Number.isFinite(height) && height >= 0 && height < 1.3);
  }
});

test('landscape crop retains the summit and excludes the foreground sign', () => {
  const summitV = 1 - 0.32, signV = 1 - 0.67;
  assert.ok(summitV > DAISEN_VIEW.cropBottom);
  assert.ok(signV < DAISEN_VIEW.cropBottom);
  assert.ok(Math.abs(DAISEN_VIEW.cropBottom + DAISEN_VIEW.cropHeight - 1) < 1e-9);
});
