import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildLandIndex, calculateSurfaceStats, isLand, type LandFeature } from './routeSurface';

const squareLand: LandFeature = {
  type: 'Feature',
  properties: { name: 'Test Land' },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
      [-10, -10],
    ]],
  },
};

test('classifies points against polygon land instead of broad bounding boxes', () => {
  const index = buildLandIndex([squareLand]);
  assert.equal(isLand([0, 0], index), true);
  assert.equal(isLand([20, 0], index), false);
});

test('surface stats produce mixed land and water plus coastline crossings', () => {
  const index = buildLandIndex([squareLand]);
  const coords: [number, number][] = [
    [-20, 0],
    [-5, 0],
    [5, 0],
    [20, 0],
  ];
  const stats = calculateSurfaceStats(coords, index);
  assert.ok(stats.landPct >= 25 && stats.landPct < 75, `landPct=${stats.landPct}`);
  assert.ok(stats.waterPct > 25 && stats.waterPct <= 75.1, `waterPct=${stats.waterPct}`);
  assert.equal(stats.coastlineCrossings, 2);
  assert.equal(stats.segments.length, 3);
  assert.deepEqual(stats.segments.map(s => s.kind), ['water', 'land', 'water']);
});
