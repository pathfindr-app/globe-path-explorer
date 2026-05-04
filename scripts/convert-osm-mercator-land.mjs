import shapefile from 'shapefile';
import fs from 'node:fs/promises';

const [,, shpPath, outPath] = process.argv;
const R = 6378137;
const MAX_LAT = 85.0511287798066;
function mercatorToLonLat([x, y]) {
  const lng = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return [Number(lng.toFixed(6)), Number(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)).toFixed(6))];
}
function transformCoords(coords) {
  if (typeof coords?.[0] === 'number') return mercatorToLonLat(coords);
  return coords.map(transformCoords);
}
function bboxOfGeometry(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function scan(coords) {
    if (typeof coords?.[0] === 'number') {
      const [x, y] = coords;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else coords.forEach(scan);
  }
  scan(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}
if (!shpPath || !outPath) {
  console.error('Usage: node scripts/convert-osm-mercator-land.mjs <input.shp> <output.geojson>');
  process.exit(1);
}
const features = [];
const source = await shapefile.open(shpPath);
while (true) {
  const result = await source.read();
  if (result.done) break;
  const geometry = result.value.geometry;
  if (!geometry) continue;
  const transformed = { type: geometry.type, coordinates: transformCoords(geometry.coordinates) };
  features.push({
    type: 'Feature',
    properties: { source: 'OSM simplified land polygons' },
    bbox: bboxOfGeometry(transformed),
    geometry: transformed,
  });
}
const geojson = { type: 'FeatureCollection', name: 'OSM simplified land polygons 3857 transformed to 4326', features };
const text = JSON.stringify(geojson);
await fs.writeFile(outPath, text);
console.log(JSON.stringify({ outPath, features: features.length, bytes: Buffer.byteLength(text) }));
