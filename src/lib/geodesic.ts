import * as turf from '@turf/turf';

export type PathType = 'shortest' | 'longest';

interface GeodesicPathOptions {
  npoints?: number;
  type?: PathType;
}

/**
 * Calculates a geodesic path between start and end.
 */
export function calculateGeodesicPath(
  start: [number, number], // [lng, lat]
  end: [number, number],
  options: GeodesicPathOptions = {}
) {
  const { npoints = 200, type = 'shortest' } = options;

  if (type === 'shortest') {
    // Normal great circle (shortest path)
    const gc = turf.greatCircle(start, end, { npoints });
    return getCoordsAndFlatten(gc);
  } else {
    // Round-the-world path (The longer arc of the great circle)
    const mid = turf.midpoint(start, end);
    const antipodeMid: [number, number] = [
      mid.geometry.coordinates[0] > 0 ? mid.geometry.coordinates[0] - 180 : mid.geometry.coordinates[0] + 180,
      -mid.geometry.coordinates[1]
    ];
    
    const part1 = turf.greatCircle(start, antipodeMid, { npoints: npoints / 2 });
    const part2 = turf.greatCircle(antipodeMid, end, { npoints: npoints / 2 });
    
    const coords1 = getCoordsAndFlatten(part1);
    const coords2 = getCoordsAndFlatten(part2);
    
    // Join them. For 3D Globe, we DON'T want to split at the antimeridian.
    // We want a continuous set of coordinates.
    return [...coords1, ...coords2];
  }
}

function getCoordsAndFlatten(feature: any): [number, number][] {
  const coords = turf.getCoords(feature);
  if (feature.geometry.type === 'MultiLineString') {
    return (coords as any).flat(1);
  }
  return coords;
}
