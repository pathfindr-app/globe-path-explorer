import * as fs from 'node:fs';
import { buildLandIndex, calculateSurfaceStats, lineDistanceKm } from '../src/lib/routeSurface';
import { calculateGeodesicPath } from '../src/lib/geodesic';
const geo = JSON.parse(fs.readFileSync('./public/land-osm-simplified.geojson', 'utf8'));
const indexStart = performance.now();
const index = buildLandIndex(geo.features, 5);
const indexMs = performance.now() - indexStart;
for (const npoints of [260, 360, 520, 720]) {
  const coords = calculateGeodesicPath([-156.3319, 20.7984], [139.6917, 35.6895], { type: 'shortest', npoints });
  const start = performance.now();
  const stats = calculateSurfaceStats(coords, index);
  const ms = performance.now() - start;
  console.log(JSON.stringify({ npoints, ms: Math.round(ms * 10) / 10, segments: stats.segments.length, crossings: stats.coastlineCrossings, miles: Math.round(lineDistanceKm(coords) * 0.621371) }));
}
console.log(JSON.stringify({ indexMs: Math.round(indexMs * 10) / 10, features: geo.features.length, cells: index.cells.size }));
