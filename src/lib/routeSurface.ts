import * as turf from '@turf/turf';

export type SurfaceKind = 'land' | 'water';

export interface LandFeature {
  type: 'Feature';
  bbox?: number[];
  properties?: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface LandIndex {
  features: LandFeature[];
  bboxes: [number, number, number, number][];
  cellSize: number;
  cells: Map<string, number[]>;
}

export interface SurfaceSegment {
  kind: SurfaceKind;
  coords: [number, number][];
  km: number;
}

export interface SurfaceStats {
  landKm: number;
  waterKm: number;
  landPct: number;
  waterPct: number;
  longestLandKm: number;
  longestWaterKm: number;
  coastlineCrossings: number;
  segments: SurfaceSegment[];
}

const MAX_LAT = 90;

function normalizeLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function clampLat(lat: number) {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

export function segmentDistanceKm(a: [number, number], b: [number, number]) {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function lineDistanceKm(coords: [number, number][]) {
  if (coords.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += segmentDistanceKm(coords[i - 1], coords[i]);
  return km;
}

function scanCoords(coords: any, bbox: [number, number, number, number]) {
  if (Array.isArray(coords) && typeof coords[0] === 'number') {
    const lng = normalizeLng(coords[0]);
    const lat = clampLat(coords[1]);
    bbox[0] = Math.min(bbox[0], lng);
    bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lng);
    bbox[3] = Math.max(bbox[3], lat);
    return;
  }
  if (Array.isArray(coords)) coords.forEach(part => scanCoords(part, bbox));
}

export function featureBbox(feature: LandFeature): [number, number, number, number] {
  if (feature.bbox?.length === 4) {
    return [
      normalizeLng(feature.bbox[0]),
      clampLat(feature.bbox[1]),
      normalizeLng(feature.bbox[2]),
      clampLat(feature.bbox[3]),
    ];
  }
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  scanCoords(feature.geometry.coordinates, bbox);
  return bbox;
}

function cellKey(x: number, y: number) {
  return `${x}:${y}`;
}

export function buildLandIndex(features: LandFeature[], cellSize = 5): LandIndex {
  const cells = new Map<string, number[]>();
  const bboxes: [number, number, number, number][] = [];
  features.forEach((feature, idx) => {
    const [minLngRaw, minLatRaw, maxLngRaw, maxLatRaw] = featureBbox(feature);
    const minLng = Math.min(minLngRaw, maxLngRaw);
    const maxLng = Math.max(minLngRaw, maxLngRaw);
    const minLat = Math.min(minLatRaw, maxLatRaw);
    const maxLat = Math.max(minLatRaw, maxLatRaw);
    bboxes[idx] = [minLng, minLat, maxLng, maxLat];
    const x0 = Math.floor((minLng + 180) / cellSize);
    const x1 = Math.floor((maxLng + 180) / cellSize);
    const y0 = Math.floor((minLat + 90) / cellSize);
    const y1 = Math.floor((maxLat + 90) / cellSize);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y);
        const bucket = cells.get(key);
        if (bucket) bucket.push(idx);
        else cells.set(key, [idx]);
      }
    }
  });
  return { features, bboxes, cellSize, cells };
}

function bboxContains(bbox: [number, number, number, number], coord: [number, number]) {
  const [lng, lat] = coord;
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

export function isLand(coord: [number, number], index: LandIndex | null): boolean {
  if (!index || !index.features.length) return false;
  const lng = normalizeLng(coord[0]);
  const lat = clampLat(coord[1]);
  const x = Math.floor((lng + 180) / index.cellSize);
  const y = Math.floor((lat + 90) / index.cellSize);
  const candidates = index.cells.get(cellKey(x, y)) || [];
  const point = turf.point([lng, lat]);
  for (const featureIndex of candidates) {
    const feature = index.features[featureIndex];
    if (!bboxContains(index.bboxes[featureIndex], [lng, lat])) continue;
    try {
      if (turf.booleanPointInPolygon(point, feature as any)) return true;
    } catch {
      // Skip malformed source geometry rather than poisoning the whole route.
    }
  }
  return false;
}

export function calculateSurfaceStats(coords: [number, number][], index: LandIndex | null): SurfaceStats {
  let landKm = 0;
  let waterKm = 0;
  let longestLandKm = 0;
  let longestWaterKm = 0;
  let coastlineCrossings = 0;
  let currentKind: SurfaceKind | null = null;
  let currentKm = 0;
  let currentCoords: [number, number][] = [];
  const segments: SurfaceSegment[] = [];

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const midpoint: [number, number] = [normalizeLng((prev[0] + curr[0]) / 2), (prev[1] + curr[1]) / 2];
    const kind: SurfaceKind = isLand(midpoint, index) ? 'land' : 'water';
    const km = segmentDistanceKm(prev, curr);

    if (kind === 'land') landKm += km;
    else waterKm += km;

    if (currentKind === kind) {
      currentKm += km;
      currentCoords.push(curr);
    } else {
      if (currentKind) {
        if (currentKind === 'land') longestLandKm = Math.max(longestLandKm, currentKm);
        if (currentKind === 'water') longestWaterKm = Math.max(longestWaterKm, currentKm);
        segments.push({ kind: currentKind, coords: currentCoords, km: currentKm });
        coastlineCrossings += 1;
      }
      currentKind = kind;
      currentKm = km;
      currentCoords = [prev, curr];
    }
  }

  if (currentKind) {
    if (currentKind === 'land') longestLandKm = Math.max(longestLandKm, currentKm);
    if (currentKind === 'water') longestWaterKm = Math.max(longestWaterKm, currentKm);
    segments.push({ kind: currentKind, coords: currentCoords, km: currentKm });
  }

  const totalKm = landKm + waterKm;
  return {
    landKm,
    waterKm,
    landPct: totalKm > 0 ? (landKm / totalKm) * 100 : 0,
    waterPct: totalKm > 0 ? (waterKm / totalKm) * 100 : 0,
    longestLandKm,
    longestWaterKm,
    coastlineCrossings: Math.max(0, coastlineCrossings),
    segments,
  };
}
