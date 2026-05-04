/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Globe from 'react-globe.gl';
import { calculateGeodesicPath, PathType as BasePathType } from './lib/geodesic';
import * as turf from '@turf/turf';
import { Globe as GlobeIcon, Crosshair, Trash2, MapPin, Layers, Info, ChevronRight, Menu, RotateCw, Search, X, Loader2, Edit2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

type PathType = BasePathType | 'full';

interface Point {
  id: string;
  lat: number;
  lng: number;
  name?: string;
}

interface Path {
  id: string;
  name: string;
  points: Point[];
  type: PathType;
  color: string;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}


const KM_TO_MILES = 0.621371;
const KM_TO_NAUTICAL = 0.539957;
const EARTH_CIRCUMFERENCE_KM = 40075.017;

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function lineDistanceKm(coords: [number, number][]) {
  if (coords.length < 2) return 0;
  return turf.length(turf.lineString(coords), { units: 'kilometers' });
}

type SurfaceKind = 'land' | 'water';

interface LandRegion {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const COARSE_LAND_REGIONS: LandRegion[] = [
  { name: 'North America', minLat: 7, maxLat: 72, minLng: -170, maxLng: -52 },
  { name: 'Central America', minLat: 5, maxLat: 24, minLng: -118, maxLng: -77 },
  { name: 'South America', minLat: -56, maxLat: 13, minLng: -82, maxLng: -34 },
  { name: 'Greenland', minLat: 59, maxLat: 84, minLng: -74, maxLng: -11 },
  { name: 'Africa', minLat: -35, maxLat: 38, minLng: -18, maxLng: 52 },
  { name: 'Europe', minLat: 35, maxLat: 72, minLng: -25, maxLng: 45 },
  { name: 'Asia', minLat: 5, maxLat: 78, minLng: 26, maxLng: 180 },
  { name: 'Asia West', minLat: 5, maxLat: 78, minLng: -180, maxLng: -168 },
  { name: 'Australia', minLat: -44, maxLat: -10, minLng: 112, maxLng: 154 },
  { name: 'New Zealand', minLat: -48, maxLat: -34, minLng: 166, maxLng: 179 },
  { name: 'Madagascar', minLat: -26, maxLat: -11, minLng: 43, maxLng: 51 },
  { name: 'Japan', minLat: 30, maxLat: 46, minLng: 129, maxLng: 146 },
  { name: 'Philippines', minLat: 5, maxLat: 21, minLng: 116, maxLng: 127 },
  { name: 'Indonesia', minLat: -11, maxLat: 7, minLng: 95, maxLng: 141 },
  { name: 'Antarctica', minLat: -90, maxLat: -60, minLng: -180, maxLng: 180 },
];

function normalizeLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function isLikelyLand(lat: number, lng: number) {
  const nLng = normalizeLng(lng);
  return COARSE_LAND_REGIONS.some(region => (
    lat >= region.minLat &&
    lat <= region.maxLat &&
    nLng >= region.minLng &&
    nLng <= region.maxLng
  ));
}

function surfaceKindForCoord(coord: [number, number]): SurfaceKind {
  const [lng, lat] = coord;
  return isLikelyLand(lat, lng) ? 'land' : 'water';
}

function segmentDistanceKm(a: [number, number], b: [number, number]) {
  return turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' });
}

function getSurfaceStretches(coords: [number, number][]) {
  let longestLandKm = 0;
  let longestWaterKm = 0;
  let currentKind: SurfaceKind | null = null;
  let currentKm = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const midpoint: [number, number] = [(prev[0] + curr[0]) / 2, (prev[1] + curr[1]) / 2];
    const kind = surfaceKindForCoord(midpoint);
    const km = segmentDistanceKm(prev, curr);

    if (currentKind === kind) {
      currentKm += km;
    } else {
      if (currentKind === 'land') longestLandKm = Math.max(longestLandKm, currentKm);
      if (currentKind === 'water') longestWaterKm = Math.max(longestWaterKm, currentKm);
      currentKind = kind;
      currentKm = km;
    }
  }

  if (currentKind === 'land') longestLandKm = Math.max(longestLandKm, currentKm);
  if (currentKind === 'water') longestWaterKm = Math.max(longestWaterKm, currentKm);

  return { longestLandKm, longestWaterKm };
}

function formatLatLng(lat: number, lng: number) {
  const latHem = lat >= 0 ? 'N' : 'S';
  const lngHem = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latHem}, ${Math.abs(lng).toFixed(5)}° ${lngHem}`;
}

export default function App() {
  const globeRef = useRef<any>();
  const [paths, setPaths] = useState<Path[]>([
    { id: '1', name: 'Path 1', points: [], type: 'shortest', color: '#F27D26' }
  ]);
  const [activePathId, setActivePathId] = useState<string>('1');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRotating, setIsRotating] = useState(true);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [newPathName, setNewPathName] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);

  // Globe Styles
  const [globeStyle, setGlobeStyle] = useState('dark');
  const globeStyles = {
    dark: {
      name: 'Tactical Dark',
      img: '//unpkg.com/three-globe/example/img/earth-dark.jpg',
      bump: '//unpkg.com/three-globe/example/img/earth-topology.png'
    },
    night: {
      name: 'Night Lights',
      img: '//unpkg.com/three-globe/example/img/earth-night.jpg',
      bump: '//unpkg.com/three-globe/example/img/earth-topology.png'
    },
    blue: {
      name: 'Blue Marble',
      img: '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
      bump: '//unpkg.com/three-globe/example/img/earth-topology.png'
    },
    day: {
      name: 'Topographic',
      img: '//unpkg.com/three-globe/example/img/earth-day.jpg',
      bump: '//unpkg.com/three-globe/example/img/earth-topology.png'
    }
  };
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const colors = ['#F27D26', '#3B82F6', '#10B981', '#EF4444', '#A855F7', '#FACC15'];

  const activePath = useMemo(() => 
    paths.find(p => p.id === activePathId) || paths[0], 
    [paths, activePathId]
  );

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = isRotating;
      globeRef.current.controls().autoRotateSpeed = 0.5;
    }
  }, [isRotating]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasInteracted(true);
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      const data = await resp.json();
      setSearchResults(data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectSearchResult = (res: SearchResult) => {
    const lat = parseFloat(res.lat);
    const lng = parseFloat(res.lon);
    setHasInteracted(true);
    
    // Jump to location
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat, lng, altitude: 1.5 }, 1000);
    }
    
    // Add point to active path
    const cityName = res.display_name.split(',')[0];
    addPoint({ lat, lng, name: cityName });
    setSearchResults([]);
    setSearchQuery('');
  };

  const addNewPath = () => {
    setHasInteracted(true);
    const newId = Math.random().toString(36).substr(2, 9);
    const newPath: Path = {
      id: newId,
      name: `Path ${paths.length + 1}`,
      points: [],
      type: 'shortest',
      color: colors[paths.length % colors.length]
    };
    setPaths(prev => [...prev, newPath]);
    setActivePathId(newId);
  };

  const removePath = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (paths.length === 1) {
      setPaths([{ id: '1', name: 'Path 1', points: [], type: 'shortest', color: '#F27D26' }]);
      setActivePathId('1');
      return;
    }
    const newPaths = paths.filter(p => p.id !== id);
    setPaths(newPaths);
    if (activePathId === id) {
      setActivePathId(newPaths[0].id);
    }
  };

  const updateActivePath = (updates: Partial<Path>) => {
    setHasInteracted(true);
    setPaths(prev => prev.map(p => p.id === activePathId ? { ...p, ...updates } : p));
  };

  const renamePath = (id: string) => {
    if (newPathName.trim()) {
      setPaths(prev => prev.map(p => p.id === id ? { ...p, name: newPathName } : p));
    }
    setEditingPathId(null);
  };

  const addPoint = ({ lat, lng, name }: { lat: number, lng: number, name?: string }) => {
    setHasInteracted(true);
    const newPoint = {
      id: Math.random().toString(36).substr(2, 9),
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      name
    };
    updateActivePath({ points: [...activePath.points, newPoint] });
  };

  const removePoint = (id: string) => {
    updateActivePath({ points: activePath.points.filter(p => p.id !== id) });
  };

  // Convert paths into data for Globe
  const globePaths = useMemo(() => {
    const allSegs: any[] = [];
    paths.forEach(path => {
      // If full orbit mode, and we have at least 2 points, just circle through them
      if (path.type === 'full' && path.points.length >= 2) {
         for (let i = 0; i < path.points.length; i++) {
           const start = path.points[i];
           const end = path.points[(i + 1) % path.points.length];
           try {
              const coordsShort = calculateGeodesicPath(
                [start.lng, start.lat],
                [end.lng, end.lat],
                { type: 'shortest', npoints: 150 }
              );
              const coordsLong = calculateGeodesicPath(
                [start.lng, start.lat],
                [end.lng, end.lat],
                { type: 'longest', npoints: 150 }
              );
              
              const shortKm = lineDistanceKm(coordsShort);
              const longKm = lineDistanceKm(coordsLong);
              const startName = start.name || `Point ${i + 1}`;
              const endName = end.name || `Point ${(i + 2) > path.points.length ? 1 : i + 2}`;
              
              // Standard segments for full orbit
              allSegs.push({
                id: `${path.id}-${i}-s`,
                color: path.color,
                active: path.id === activePathId,
                coords: coordsShort.map(c => [c[1], c[0]]),
                km: shortKm,
                label: `${path.name}: ${startName} → ${endName}<br/>Short arc: ${formatNumber(shortKm * KM_TO_MILES)} mi / ${formatNumber(shortKm)} km`
              });
              allSegs.push({
                id: `${path.id}-${i}-l`,
                color: path.color,
                active: path.id === activePathId,
                coords: coordsLong.map(c => [c[1], c[0]]),
                km: longKm,
                label: `${path.name}: ${startName} → ${endName}<br/>Long arc: ${formatNumber(longKm * KM_TO_MILES)} mi / ${formatNumber(longKm)} km`,
                dashed: true
              });
           } catch (err) { console.error(err); }
         }
      } else {
        // Standard arc paths
        for (let i = 0; i < path.points.length - 1; i++) {
          const start = path.points[i];
          const end = path.points[i + 1];
          try {
            const coords = calculateGeodesicPath(
              [start.lng, start.lat],
              [end.lng, end.lat],
              { type: path.type === 'full' ? 'shortest' : path.type, npoints: 300 }
            );
            const km = lineDistanceKm(coords);
            const startName = start.name || `Point ${i + 1}`;
            const endName = end.name || `Point ${i + 2}`;
            const typeLabel = path.type === 'longest' ? 'Long arc' : 'Short arc';
            
            allSegs.push({
              id: `${path.id}-${i}`,
              color: path.color,
              active: path.id === activePathId,
              coords: coords.map(c => [c[1], c[0]]),
              km,
              label: `${path.name}: ${startName} → ${endName}<br/>${typeLabel}: ${formatNumber(km * KM_TO_MILES)} mi / ${formatNumber(km)} km`,
              dashed: path.type === 'longest'
            });
          } catch (err) {
            console.error(err);
          }
        }
      }
    });
    return allSegs;
  }, [paths, activePathId]);

  const globePoints = useMemo(() => {
    return paths.flatMap(path => 
      path.points.map((p, idx) => ({
        ...p,
        pathId: path.id,
        color: path.color,
        active: path.id === activePathId,
        label: `<div style="font-family: monospace; font-size: 14px; line-height: 1.45;"><strong>${p.name || `${path.name} - ${idx === 0 ? 'Start' : 'Point ' + idx}`}</strong><br/>LAT ${p.lat.toFixed(5)}°<br/>LONG ${p.lng.toFixed(5)}°<br/>${formatLatLng(p.lat, p.lng)}</div>`
      }))
    );
  }, [paths, activePathId]);

  const activePathStats = useMemo(() => {
    if (!activePath || activePath.points.length < 2) {
      return { legs: [], totalKm: 0, longestKm: 0, longestLandKm: 0, longestWaterKm: 0 };
    }

    const legs: { label: string; km: number; type: string; longestLandKm: number; longestWaterKm: number }[] = [];
    const legCount = activePath.type === 'full' ? activePath.points.length : activePath.points.length - 1;

    for (let i = 0; i < legCount; i++) {
      const start = activePath.points[i];
      const end = activePath.points[(i + 1) % activePath.points.length];
      if (!start || !end || start.id === end.id) continue;

      let km = 0;
      let longestLandKm = 0;
      let longestWaterKm = 0;
      let typeLabel = activePath.type === 'shortest' ? 'Short arc' : activePath.type === 'longest' ? 'Long arc' : 'Full orbit';

      try {
        const coordsSets = activePath.type === 'full'
          ? [
              calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: 'shortest', npoints: 180 }),
              calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: 'longest', npoints: 180 })
            ]
          : [calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: activePath.type, npoints: 300 })];

        coordsSets.forEach(coords => {
          km += lineDistanceKm(coords);
          const surface = getSurfaceStretches(coords);
          longestLandKm = Math.max(longestLandKm, surface.longestLandKm);
          longestWaterKm = Math.max(longestWaterKm, surface.longestWaterKm);
        });
      } catch (err) {
        console.error('Failed to calculate leg stats', err);
      }

      legs.push({
        label: `${start.name || `Point ${i + 1}`} → ${end.name || `Point ${(i + 2) > activePath.points.length ? 1 : i + 2}`}`,
        km,
        type: typeLabel,
        longestLandKm,
        longestWaterKm
      });
    }

    const totalKm = legs.reduce((acc, leg) => acc + leg.km, 0);
    const longestKm = legs.reduce((max, leg) => Math.max(max, leg.km), 0);
    const longestLandKm = legs.reduce((max, leg) => Math.max(max, leg.longestLandKm), 0);
    const longestWaterKm = legs.reduce((max, leg) => Math.max(max, leg.longestWaterKm), 0);
    return { legs, totalKm, longestKm, longestLandKm, longestWaterKm };
  }, [activePath]);

  return (
    <div className="flex h-screen w-full bg-[#050608] font-sans text-white overflow-hidden">
      {/* Sidebar - Fix position and z-index */}
      <div 
        className={cn(
          "fixed top-0 left-0 h-full bg-[#0A0B0E] border-r border-[#2D2D2D] z-[1000] transition-all duration-300 ease-in-out shadow-2xl flex flex-col",
          isSidebarOpen ? "w-[560px]" : "w-0 overflow-hidden border-0"
        )}
      >
        <div className="flex items-center justify-between p-8 border-b border-[#2D2D2D] flex-none">
          <div className="flex items-center gap-2 text-[#F27D26]">
            <GlobeIcon className="w-8 h-8 animate-pulse" />
            <span className="font-mono text-2xl font-bold tracking-[0.2em] uppercase text-[#F27D26]">Geodesic Resolver</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 hover:bg-white/5 rounded transition-colors text-white/65 hover:text-white"
          >
            <ChevronRight className="w-8 h-8 rotate-180" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-9 scrollbar-custom">
          {/* Engine Controls */}
          <section className="space-y-4">
             <div className="flex items-center justify-between">
               <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">Engine Core</h3>
               <button 
                 onClick={() => {
                   setHasInteracted(true);
                   setIsRotating(!isRotating);
                 }}
                 className={cn(
                   "flex items-center gap-2 px-3 py-1.5 rounded-full text-[17px] uppercase font-bold transition-all",
                   isRotating ? "bg-[#F27D26]/20 text-[#F27D26] shadow-[0_0_10px_rgba(242,125,38,0.2)]" : "bg-white/5 text-white/65"
                 )}
               >
                 <RotateCw className={cn("w-5 h-5", isRotating && "animate-spin-slow")} />
                 {isRotating ? 'Auto-Rotate ON' : 'Rotation Halted'}
               </button>
             </div>
          </section>

          {/* Globe Configuration */}
          <section className="space-y-4">
            <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">Globe Configuration</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(globeStyles).map(([key, style]) => (
                <button
                  key={key}
                  onClick={() => setGlobeStyle(key)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-6 border rounded-xl transition-all",
                    globeStyle === key 
                      ? "border-[#F27D26] bg-[#F27D26]/5" 
                      : "border-white/5 bg-white/2 hover:border-white/10"
                  )}
                >
                  <div className="w-16 h-16 rounded-full border border-white/10 overflow-hidden">
                    <img src={style.img} alt={style.name} className="w-full h-full object-cover scale-150 rotate-12" />
                  </div>
                  <span className={cn("text-[17px] font-mono uppercase tracking-tighter", globeStyle === key ? "text-[#F27D26]" : "text-white/55")}>
                    {style.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Global Search */}
          <section className="space-y-3">
            <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">City Index Search</h3>
            <form onSubmit={handleSearch} className="relative group">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find location..."
                className="w-full bg-[#14161B] border border-[#2D2D2D] rounded-2xl px-6 py-6 text-lg font-mono focus:outline-none focus:border-[#F27D26]/60 transition-all placeholder:text-white/55"
              />
              <button 
                type="submit" 
                disabled={isSearching}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 group-focus-within:text-[#F27D26] hover:text-white transition-colors"
              >
                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              </button>
            </form>
            
            <AnimatePresence>
              {searchResults.length > 0 && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-[#14161B] border border-[#2D2D2D] rounded-lg mt-2 max-h-[180px] overflow-y-auto shadow-xl z-[1001]"
                >
                  {searchResults.map((res, i) => (
                    <button
                      key={i}
                      onClick={() => selectSearchResult(res)}
                      className="w-full text-left px-6 py-5 border-b border-[#2D2D2D] hover:bg-white/5 last:border-0 transition-colors text-[17px] font-mono leading-tight"
                    >
                      {res.display_name}
                    </button>
                  ))}
                  <button 
                    onClick={() => setSearchResults([])}
                    className="w-full text-center py-2 opacity-30 hover:opacity-100 flex items-center justify-center gap-2 border-t border-[#2D2D2D] text-[17px] uppercase font-bold"
                  >
                    <X className="w-5 h-5" /> Dismiss
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Paths Layer Control */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">Route Profiles</h3>
              <button 
                onClick={addNewPath}
                className="text-[17px] uppercase text-[#F27D26] hover:text-[#F27D26]/80 flex items-center gap-1.5 font-bold tracking-widest"
              >
                + New Profile
              </button>
            </div>
            <div className="space-y-2">
              {paths.map(p => (
                <div
                  key={p.id}
                  onClick={() => setActivePathId(p.id)}
                  className={cn(
                    "group relative flex flex-col p-8 cursor-pointer border rounded-lg transition-all duration-300",
                    activePathId === p.id 
                      ? "bg-[#14161B] border-[#F27D26]/50 shadow-[0_4px_24px_rgba(242,125,38,0.15)] ring-1 ring-[#F27D26]/20" 
                      : "bg-transparent border-[#2D2D2D] hover:border-white/20 hover:bg-white/2"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full shadow-[0_0_8px_currentColor]" style={{ color: p.color, backgroundColor: p.color }} />
                      
                      {editingPathId === p.id ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input 
                            autoFocus
                            value={newPathName}
                            onChange={e => setNewPathName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && renamePath(p.id)}
                            className="bg-[#0A0B0E] border border-[#2D2D2D] rounded px-2 py-0.5 text-lg text-white font-mono w-32 focus:outline-none focus:border-[#F27D26]/50"
                          />
                          <button onClick={() => renamePath(p.id)} className="text-[#10B981] hover:brightness-125">
                            <Check className="w-5 h-5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[17px] font-bold font-mono tracking-tight", activePathId === p.id ? "text-white" : "text-white/65")}>
                            {p.name.toUpperCase()}
                          </span>
                          {activePathId === p.id && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingPathId(p.id);
                                setNewPathName(p.name);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-white/45 hover:text-white transition-opacity"
                            >
                              <Edit2 className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {paths.length > 1 && (
                      <button 
                        onClick={(e) => removePath(p.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-white/55 hover:text-red-500 transition-all transform hover:scale-110"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[17px] font-mono opacity-20 uppercase">{p.points.length} nodes active</span>
                    {activePathId === p.id && (
                      <div className="px-2.5 py-1 rounded bg-[#F27D26]/10 text-[17px] font-mono text-[#F27D26] uppercase font-bold tracking-tighter">Active Viewport</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-[#2D2D2D]/30" />

          {/* Active Settings */}
          {activePath && (
            <div className="space-y-9 pb-10">
              <section className="space-y-3">
                <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">Navigation Logic</h3>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { val: 'shortest', lab: 'Short Arc', sub: 'Standard Geodesic' },
                    { val: 'longest', lab: 'Long way Around', sub: 'Major Arc Geodesic' },
                    { val: 'full', lab: 'Full Earth Orbit', sub: 'Infinite Geodesic Loop' }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => updateActivePath({ type: opt.val as PathType })}
                      className={cn(
                        "flex flex-col items-start px-6 py-5 text-left border transition-all rounded-lg duration-300",
                        activePath.type === opt.val 
                          ? "border-[#F27D26] bg-[#F27D26]/10 shadow-[0_0_15px_rgba(242,125,38,0.05)]" 
                          : "border-[#2D2D2D] bg-black/20 hover:border-white/10 hover:bg-white/2"
                      )}
                    >
                      <span className={cn("text-[17px] font-mono font-bold uppercase tracking-wider", activePath.type === opt.val ? "text-[#F27D26]" : "text-white/65")}>
                        {opt.lab}
                      </span>
                      <span className="text-[17px] font-mono text-white/45 mt-0.5">{opt.sub}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="font-mono text-[17px] uppercase opacity-75 tracking-[0.2em]">Geodesic Line Stats</h3>
                {activePath.points.length < 2 ? (
                  <div className="border border-dashed border-[#2D2D2D] p-8 text-center rounded-xl bg-black/20">
                    <Info className="w-8 h-8 mx-auto mb-3 text-[#F27D26]/50" />
                    <p className="text-[17px] font-mono uppercase text-white/50 leading-relaxed">Add two ocean points to calculate route distance, arc type, and earth-circumference share.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#F27D26]/40 bg-[#F27D26]/10 p-6">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-[#F27D26]/80">Total Miles</div>
                        <div className="mt-1 text-5xl font-black text-white">{formatNumber(activePathStats.totalKm * KM_TO_MILES)}</div>
                        <div className="mt-1 text-[17px] font-mono text-white/55">{formatNumber(activePathStats.totalKm)} km</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-white/60">Earth Share</div>
                        <div className="mt-1 text-5xl font-black text-[#F27D26]">{formatNumber((activePathStats.totalKm / EARTH_CIRCUMFERENCE_KM) * 100, 1)}%</div>
                        <div className="mt-1 text-[17px] font-mono text-white/55">of circumference</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-6">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-white/55">Nautical Miles</div>
                        <div className="mt-1 text-3xl font-bold text-white">{formatNumber(activePathStats.totalKm * KM_TO_NAUTICAL)}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-6">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-white/55">Longest Leg</div>
                        <div className="mt-1 text-3xl font-bold text-white">{formatNumber(activePathStats.longestKm * KM_TO_MILES)}</div>
                        <div className="text-[17px] font-mono text-white/45">miles</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-emerald-300/75">Longest Stretch On Land</div>
                        <div className="mt-1 text-3xl font-black text-white">{formatNumber(activePathStats.longestLandKm * KM_TO_MILES)}</div>
                        <div className="text-[17px] font-mono text-white/50">mi / {formatNumber(activePathStats.longestLandKm)} km</div>
                      </div>
                      <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 p-5">
                        <div className="text-[17px] font-mono uppercase tracking-[0.18em] text-sky-300/75">Longest Stretch On Water</div>
                        <div className="mt-1 text-3xl font-black text-white">{formatNumber(activePathStats.longestWaterKm * KM_TO_MILES)}</div>
                        <div className="text-[17px] font-mono text-white/50">mi / {formatNumber(activePathStats.longestWaterKm)} km</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#2D2D2D] bg-black/25 p-4 text-[14px] font-mono uppercase tracking-[0.16em] text-white/40 leading-relaxed">
                      Land/water stretches use a coarse globe land-mask estimate for quick visual planning.
                    </div>

                    <div className="rounded-xl border border-[#2D2D2D] bg-[#0D0E12] overflow-hidden">
                      {activePathStats.legs.map((leg, idx) => (
                        <div key={idx} className="p-6 border-b border-[#2D2D2D]/60 last:border-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[17px] font-mono font-bold text-white/80 truncate">Leg {idx + 1}</span>
                            <span className="text-[17px] font-mono text-[#F27D26] uppercase">{leg.type}</span>
                          </div>
                          <div className="mt-1 text-[17px] text-white/50 truncate">{leg.label}</div>
                          <div className="mt-2 flex items-end justify-between">
                            <span className="text-3xl font-black text-white">{formatNumber(leg.km * KM_TO_MILES)}</span>
                            <span className="pb-1 text-[17px] font-mono text-white/55">mi / {formatNumber(leg.km)} km</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[14px] font-mono uppercase tracking-[0.12em]">
                            <span className="rounded bg-emerald-500/10 px-3 py-2 text-emerald-300/75">Land max {formatNumber(leg.longestLandKm * KM_TO_MILES)} mi</span>
                            <span className="rounded bg-sky-400/10 px-3 py-2 text-sky-300/75">Water max {formatNumber(leg.longestWaterKm * KM_TO_MILES)} mi</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="font-mono text-[17px] uppercase opacity-65 tracking-[0.22em]">Node Telemetry</h3>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-custom">
                  {activePath.points.length === 0 ? (
                    <div className="border border-dashed border-[#2D2D2D] p-10 text-center rounded-xl bg-black/20 group hover:border-[#F27D26]/30 transition-all">
                      <Crosshair className="w-8 h-8 mx-auto mb-3 opacity-10 group-hover:opacity-30 transition-opacity" />
                      <p className="text-[17px] font-mono uppercase opacity-20 leading-relaxed italic">Point deployment ready. Click globe to designate coordinates or search for cities above.</p>
                    </div>
                  ) : (
                    activePath.points.map((p, idx) => (
                      <div 
                        key={p.id}
                        className="group flex flex-col p-8 bg-[#0D0E12] border border-[#2D2D2D] rounded-lg shadow-inner hover:border-[#F27D26]/40 transition-all relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between opacity-50 mb-3 border-b border-[#2D2D2D]/30 pb-2">
                          <span className="text-[17px] font-black uppercase tracking-[0.2em] text-[#F27D26]">{idx === 0 ? 'Origin' : `Nodal Point ${idx}`}</span>
                          <button onClick={() => removePoint(p.id)} className="hover:text-red-500 transition-colors">
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                        {p.name && (
                           <div className="text-[17px] font-bold mb-2 text-white/90 truncate">{p.name}</div>
                        )}
                        <div className="grid grid-cols-2 gap-6 text-[17px] font-mono bg-black/40 p-3 rounded border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-[17px] opacity-20 uppercase mb-0.5">longitude</span>
                            <span className="text-[#F27D26]/80">{p.lng.toFixed(5)}°</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[17px] opacity-20 uppercase mb-0.5">latitude</span>
                            <span className="text-[#F27D26]/80">{p.lat.toFixed(5)}°</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#2D2D2D] text-[11px] text-white/45 font-mono flex justify-between uppercase tracking-[0.3em] flex-none bg-[#07080A]">
          <span>Build Sigma-9 // Spherical Grid</span>
          <span>System Normal</span>
        </div>
      </div>

      {/* Main Content Area */}
      <main
        className={cn(
          "relative flex-1 bg-black overflow-hidden transition-[padding] duration-300",
          isSidebarOpen ? "pl-[560px]" : "pl-0"
        )}
      >
        {/* External Controls Toggle - Responsive to Sidebar */}
        <div 
          className={cn(
            "absolute top-8 z-[900] flex items-center gap-6 pointer-events-none transition-all duration-300",
            isSidebarOpen ? "left-[584px]" : "left-8"
          )}
        >
          {!isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="pointer-events-auto p-6 bg-[#0A0B0E] border border-[#2D2D2D] rounded-full shadow-[0_0_40px_rgba(0,0,0,0.8)] hover:bg-[#14161B] hover:border-[#F27D26]/50 transition-all text-white/65 hover:text-white"
            >
              <Menu className="w-8 h-8" />
            </button>
          )}
          
          <button 
            onClick={() => {
              setHasInteracted(true);
              setIsRotating(!isRotating);
            }}
            className={cn(
              "pointer-events-auto p-6 bg-[#0A0B0E] border border-[#2D2D2D] rounded-full shadow-2xl transition-all group relative overflow-hidden",
              isRotating ? "hover:border-[#F27D26]/50" : "hover:border-white/20"
            )}
            title={isRotating ? "Pause Rotation" : "Resume Rotation"}
          >
            <div className={cn(
              "absolute inset-0 bg-[#F27D26]/5 transition-opacity",
              isRotating ? "opacity-100" : "opacity-0"
            )} />
            <RotateCw className={cn(
              "w-6 h-6 transition-all duration-700",
              isRotating ? "text-[#F27D26] animate-spin-slow" : "text-white/45 rotate-45"
            )} />
          </button>
        </div>

        {/* Globe Viewports */}
        <div className="absolute inset-0 z-0 select-none">
          <Globe
            ref={globeRef}
            globeImageUrl={globeStyles[globeStyle as keyof typeof globeStyles].img}
            bumpImageUrl={globeStyles[globeStyle as keyof typeof globeStyles].bump}
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            
            onGlobeClick={(coords) => addPoint({ lat: coords.lat, lng: coords.lng })}
            
            pathsData={globePaths}
            pathPoints="coords"
            pathColor={(d: any) => d.color}
            pathDashArray={(d: any) => d.dashed ? [4, 4] : [0, 0]}
            pathDashLength={2}
            pathDashGap={1}
            pathDashAnimateTime={3000}
            pathStroke={(d: any) => d.active ? 6 : 3}
            pathLabel={(d: any) => d.label}
            
            pointsData={globePoints}
            pointLat="lat"
            pointLng="lng"
            pointColor={(d: any) => d.color}
            pointRadius={(d: any) => d.active ? 0.72 : 0.38}
            pointAltitude={0.015}
            pointLabel="label"
          />
        </div>

        {/* Cinematic HUD Layout */}
        <div className="absolute inset-0 z-[100] pointer-events-none select-none flex items-center justify-center">
          <motion.div
            initial={false}
            animate={{ 
              scale: hasInteracted ? 0.6 : 1,
              x: hasInteracted ? (window.innerWidth / 2) - 180 : (isSidebarOpen ? Math.min(180, window.innerWidth * 0.13) : 0),
              y: hasInteracted ? -(window.innerHeight / 2) + 80 : 0,
              opacity: 1
            }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <h1 className={cn(
              "font-black italic tracking-tighter uppercase leading-none transition-all duration-1000",
              hasInteracted ? "text-5xl text-white/80" : "text-[clamp(4.5rem,7.5vw,7rem)] text-white drop-shadow-[8px_8px_0px_#F27D26]"
            )}>
              Geodesic<br/>Resolver
            </h1>
            {!hasInteracted && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-6 flex flex-col items-center gap-2"
              >
                <div className="font-mono text-[17px] tracking-[0.5em] text-white/50 bg-[#F27D26]/10 backdrop-blur px-8 py-3 border-x-2 border-[#F27D26]">
                  PRECISION SPHERICAL MESHING
                </div>
                <div className="font-mono text-[17px] text-[#F27D26]/40 uppercase tracking-[1em] mt-2 animate-pulse">
                  System Awaiting Input
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>

        {/* Footer HUD Stats */}
        <div className="absolute bottom-8 right-8 z-[100] pointer-events-none select-none flex flex-col items-end gap-8">
           <div className="flex gap-6">
              <div className="bg-black/60 border border-white/5 backdrop-blur-xl p-6 px-7 rounded-xl shadow-2xl flex flex-col gap-1 items-end">
                <span className="text-[17px] text-white/55 uppercase tracking-[0.2em] font-bold">Coordinate Buffers</span>
                <span className="text-5xl font-mono font-bold text-white leading-none">
                  {paths.reduce((acc, p) => acc + p.points.length, 0)}
                </span>
              </div>
              <div className="bg-black/60 border border-white/5 backdrop-blur-xl p-6 px-7 rounded-xl shadow-2xl flex flex-col gap-1 items-end">
                <span className="text-[17px] text-white/55 uppercase tracking-[0.2em] font-bold">Rastered Paths</span>
                <span className="text-5xl font-mono font-bold text-[#F27D26] leading-none">{paths.length}</span>
              </div>
           </div>

           <div className="font-mono text-[17px] uppercase tracking-[0.2em] text-white/70 flex items-center gap-6 bg-black/80 px-7 py-6 border border-[#2D2D2D] backdrop-blur-2xl rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
             <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-[#10B981] shadow-[0_0_10px_#10B981] animate-pulse" />
               <span className="font-bold">Satellite Link Established</span>
             </div>
             <div className="w-px h-3 bg-white/20" />
             <span className="opacity-40 text-[17px]">Geodetic Frame 88.4% Nominal</span>
           </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .animate-spin-slow {
          animation: spin 15s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .scrollbar-custom::-webkit-scrollbar {
          width: 3px;
        }
        .scrollbar-custom::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb {
          background: rgba(242, 125, 38, 0.2);
          border-radius: 10px;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover {
          background: rgba(242, 125, 38, 0.4);
        }
        body {
          background: black;
          color: white;
          overflow: hidden;
        }
      `}} />
    </div>
  );
}
