import shapefile from 'shapefile';
import fs from 'node:fs/promises';

const [,, shpPath, outPath] = process.argv;
if (!shpPath || !outPath) {
  console.error('Usage: node scripts/convert-land-shp.mjs <input.shp> <output.geojson>');
  process.exit(1);
}

const features = [];
const source = await shapefile.open(shpPath);
while (true) {
  const result = await source.read();
  if (result.done) break;
  features.push({
    type: 'Feature',
    properties: result.value.properties || {},
    geometry: result.value.geometry,
  });
}
const geojson = { type: 'FeatureCollection', features };
await fs.writeFile(outPath, JSON.stringify(geojson));
console.log(JSON.stringify({ outPath, features: features.length, bytes: Buffer.byteLength(JSON.stringify(geojson)) }));
