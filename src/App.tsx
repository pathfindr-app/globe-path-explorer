/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Globe from 'react-globe.gl';
import { calculateGeodesicPath, PathType as BasePathType } from './lib/geodesic';
import * as THREE from 'three';
import { buildLandIndex, calculateSurfaceStats, lineDistanceKm, type LandFeature, type LandIndex } from './lib/routeSurface';
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

interface CountryFeature {
  type: 'Feature';
  properties: {
    name?: string;
    [key: string]: unknown;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}


const KM_TO_MILES = 0.621371;
const KM_TO_NAUTICAL = 0.539957;
const EARTH_CIRCUMFERENCE_KM = 40075.017;

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function formatLatLng(lat: number, lng: number) {
  const latHem = lat >= 0 ? 'N' : 'S';
  const lngHem = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latHem}, ${Math.abs(lng).toFixed(5)}° ${lngHem}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function App() {
  const globeRef = useRef<any>();
  const lastPlacedRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const [paths, setPaths] = useState<Path[]>([
    { id: '1', name: 'Route 01', points: [], type: 'shortest', color: '#FFB84A' }
  ]);
  const [activePathId, setActivePathId] = useState<string>('1');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isRotating, setIsRotating] = useState(true);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [newPathName, setNewPathName] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  const [osmLandFeatures, setOsmLandFeatures] = useState<LandFeature[]>([]);
  const [landDataStatus, setLandDataStatus] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading');

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

  const colors = ['#FFB84A', '#FFD36E', '#C9842E', '#F0A336', '#FFE6A3', '#A9671D'];
  const assetBase = ((import.meta as any).env?.BASE_URL || '/') as string;

  const activePath = useMemo(() => 
    paths.find(p => p.id === activePathId) || paths[0], 
    [paths, activePathId]
  );

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(true);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = isRotating;
      globeRef.current.controls().autoRotateSpeed = 0.5;
    }
  }, [isRotating]);

  useEffect(() => {
    let cancelled = false;
    let osmTimer: number | undefined;

    fetch(`${assetBase}countries-110m.geojson`)
      .then(resp => resp.json())
      .then(data => {
        if (!cancelled) setCountries((data.features || []) as CountryFeature[]);
      })
      .catch(err => console.error('Failed to load country outline layer', err));

    if (isMobile) {
      setOsmLandFeatures([]);
      setLandDataStatus('fallback');
    } else {
      setLandDataStatus('loading');
      osmTimer = window.setTimeout(() => {
        fetch(`${assetBase}land-osm-simplified.geojson`)
          .then(resp => {
            if (!resp.ok) throw new Error(`OSM land data failed: ${resp.status}`);
            return resp.json();
          })
          .then(data => {
            if (cancelled) return;
            setOsmLandFeatures((data.features || []) as LandFeature[]);
            setLandDataStatus('ready');
          })
          .catch(err => {
            console.error('Failed to load OSM land precision layer', err);
            if (!cancelled) setLandDataStatus('fallback');
          });
      }, 1200);
    }

    return () => {
      cancelled = true;
      if (osmTimer) window.clearTimeout(osmTimer);
    };
  }, [assetBase, isMobile]);

  const countryLandIndex = useMemo<LandIndex | null>(() => {
    if (!countries.length) return null;
    return buildLandIndex(countries as unknown as LandFeature[], 10);
  }, [countries]);

  const osmLandIndex = useMemo<LandIndex | null>(() => {
    if (!osmLandFeatures.length) return null;
    return buildLandIndex(osmLandFeatures, 5);
  }, [osmLandFeatures]);

  const activeLandIndex = osmLandIndex || countryLandIndex;
  const routeSampleCount = isMobile ? 360 : 720;
  const fullOrbitSampleCount = isMobile ? 260 : 520;
  const shouldCalculateSurface = !isMobile || isSidebarOpen;
  const landSourceLabel = osmLandIndex
    ? 'OSM coastline polygons · high precision'
    : countryLandIndex
      ? 'Country polygons · fallback estimate'
      : 'Loading coastline data';

  const globeMaterial = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const style = globeStyles[globeStyle as keyof typeof globeStyles];
    const map = globeStyle === 'dark' ? null : loader.load(style.img);

    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 16;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.generateMipmaps = true;
    }

    const material = new THREE.MeshPhongMaterial({
      ...(map ? { map } : {}),
      bumpScale: 0,
      color: new THREE.Color(globeStyle === 'dark' ? '#d99345' : '#ffe0a3'),
      emissive: new THREE.Color(globeStyle === 'dark' ? '#301a08' : '#1d1207'),
      emissiveIntensity: globeStyle === 'dark' ? (isMobile ? 0.34 : 0.42) : (isMobile ? 0.22 : 0.29),
      specular: new THREE.Color('#c98f45'),
      shininess: 2.2,
      transparent: false
    });

    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
          float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.8);
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          vec3 amber = vec3(1.0, 0.61, 0.22);
          vec3 warmLight = vec3(1.0, 0.80, 0.48);

          gl_FragColor.rgb = mix(gl_FragColor.rgb * vec3(1.10, 0.88, 0.60), amber, 0.13);
          gl_FragColor.rgb += amber * rim * 0.40;
          gl_FragColor.rgb += warmLight * pow(rim, 4.5) * 0.16;
          gl_FragColor.rgb += vec3(dither * 0.010);
          gl_FragColor.rgb = max(gl_FragColor.rgb, vec3(0.075, 0.047, 0.018));
          #include <dithering_fragment>
        `
      );
    };

    return material;
  }, [globeStyle, isMobile]);

  const countryCapMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb84a'),
    transparent: true,
    opacity: isMobile ? 0.014 : 0.021,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending
  }), [isMobile]);

  const countrySideMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff8f24'),
    transparent: true,
    opacity: 0.009,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending
  }), []);

  const handleGlobeReady = useCallback(() => {
    if (!globeRef.current) return;
    const renderer = globeRef.current.renderer?.();
    if (renderer) {
      renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    }
    const scene = globeRef.current.scene?.();
    if (scene && !scene.getObjectByName('amber-country-rim-light')) {
      const key = new THREE.DirectionalLight('#ffc76a', 1.45);
      key.name = 'amber-country-rim-light';
      key.position.set(-2.2, 1.4, 1.9);
      scene.add(key);

      const fill = new THREE.AmbientLight('#ff9f2f', 1.15);
      fill.name = 'amber-country-fill-light';
      scene.add(fill);
    }
  }, [isMobile]);

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
      name: `Route ${String(paths.length + 1).padStart(2, '0')}`,
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
setPaths([{ id: '1', name: 'Route 01', points: [], type: 'shortest', color: '#FFB84A' }]);
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

  const clearActivePath = () => {
    if (!activePath?.points.length) return;
    setHasInteracted(true);
    updateActivePath({ points: [] });
  };

  const undoLastPoint = () => {
    if (!activePath?.points.length) return;
    setHasInteracted(true);
    updateActivePath({ points: activePath.points.slice(0, -1) });
  };

  const addViewCenterPoint = () => {
    const pov = globeRef.current?.pointOfView?.();
    if (!pov || typeof pov.lat !== 'number' || typeof pov.lng !== 'number') return;
    handlePlacePoint({ lat: pov.lat, lng: pov.lng });
  };

  const handlePlacePoint = useCallback((coords: { lat: number; lng: number }) => {
    const now = Date.now();
    const last = lastPlacedRef.current;
    if (last && now - last.time < 350 && Math.abs(last.lat - coords.lat) < 0.0002 && Math.abs(last.lng - coords.lng) < 0.0002) {
      return;
    }
    lastPlacedRef.current = { lat: coords.lat, lng: coords.lng, time: now };
    setIsRotating(false);
    addPoint({ lat: coords.lat, lng: coords.lng });
  }, [activePath.points, activePathId]);

  // Convert paths into data for Globe
  const globePaths = useMemo(() => {
    const allSegs: any[] = [];
    const addPathSegments = ({ id, path, coords, km, label, dashed = false }: { id: string; path: Path; coords: [number, number][]; km: number; label: string; dashed?: boolean }) => {
      const isActive = path.id === activePathId;
      if (isActive && activeLandIndex && shouldCalculateSurface) {
        const surface = calculateSurfaceStats(coords, activeLandIndex);
        surface.segments.forEach((segment, idx) => {
          allSegs.push({
            id: `${id}-${segment.kind}-${idx}`,
            color: segment.kind === 'land' ? '#fff0b8' : '#4fb5ff',
            active: isActive,
            coords: segment.coords.map(c => [c[1], c[0]]),
            km: segment.km,
            surfaceKind: segment.kind,
            label: `${label}<br/>${segment.kind === 'land' ? 'Land' : 'Water'} segment: ${formatNumber(segment.km * KM_TO_MILES)} mi / ${formatNumber(segment.km)} km`,
            dashed: dashed || segment.kind === 'water'
          });
        });
        return;
      }

      allSegs.push({
        id,
        color: path.color,
        active: isActive,
        coords: coords.map(c => [c[1], c[0]]),
        km,
        label,
        dashed
      });
    };

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
                { type: 'shortest', npoints: fullOrbitSampleCount }
              );
              const coordsLong = calculateGeodesicPath(
                [start.lng, start.lat],
                [end.lng, end.lat],
                { type: 'longest', npoints: fullOrbitSampleCount }
              );
              
              const shortKm = lineDistanceKm(coordsShort);
              const longKm = lineDistanceKm(coordsLong);
              const startName = start.name || `Point ${i + 1}`;
              const endName = end.name || `Point ${(i + 2) > path.points.length ? 1 : i + 2}`;
              
              addPathSegments({
                id: `${path.id}-${i}-s`,
                path,
                coords: coordsShort,
                km: shortKm,
                label: `${path.name}: ${startName} → ${endName}<br/>Short arc: ${formatNumber(shortKm * KM_TO_MILES)} mi / ${formatNumber(shortKm)} km`
              });
              addPathSegments({
                id: `${path.id}-${i}-l`,
                path,
                coords: coordsLong,
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
              { type: path.type === 'full' ? 'shortest' : path.type, npoints: routeSampleCount }
            );
            const km = lineDistanceKm(coords);
            const startName = start.name || `Point ${i + 1}`;
            const endName = end.name || `Point ${i + 2}`;
            const typeLabel = path.type === 'longest' ? 'Long arc' : 'Short arc';
            
            addPathSegments({
              id: `${path.id}-${i}`,
              path,
              coords,
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
  }, [paths, activePathId, activeLandIndex, routeSampleCount, fullOrbitSampleCount, shouldCalculateSurface]);

  const globePoints = useMemo(() => {
    return paths.flatMap(path => 
      path.points.map((p, idx) => ({
        ...p,
        pathId: path.id,
        color: path.color,
        active: path.id === activePathId,
        label: `<div class="crt-globe-label"><strong>${escapeHtml(p.name || `${path.name} - ${idx === 0 ? 'ORIGIN' : 'NODE ' + idx}`)}</strong><br/><span>LAT ${p.lat.toFixed(5)}°</span><br/><span>LONG ${p.lng.toFixed(5)}°</span><br/><em>${formatLatLng(p.lat, p.lng)}</em></div>`
      }))
    );
  }, [paths, activePathId]);

  const activePathStats = useMemo(() => {
    if (!activePath || activePath.points.length < 2) {
      return { legs: [], totalKm: 0, landKm: 0, waterKm: 0, landPct: 0, waterPct: 0, longestKm: 0, longestLandKm: 0, longestWaterKm: 0, coastlineCrossings: 0 };
    }

    const legs: { label: string; km: number; type: string; landKm: number; waterKm: number; landPct: number; waterPct: number; longestLandKm: number; longestWaterKm: number; coastlineCrossings: number }[] = [];
    const legCount = activePath.type === 'full' ? activePath.points.length : activePath.points.length - 1;

    for (let i = 0; i < legCount; i++) {
      const start = activePath.points[i];
      const end = activePath.points[(i + 1) % activePath.points.length];
      if (!start || !end || start.id === end.id) continue;

      let km = 0;
      let landKm = 0;
      let waterKm = 0;
      let longestLandKm = 0;
      let longestWaterKm = 0;
      let coastlineCrossings = 0;
      let typeLabel = activePath.type === 'shortest' ? 'Short arc' : activePath.type === 'longest' ? 'Long arc' : 'Full orbit';

      try {
        const coordsSets = activePath.type === 'full'
          ? [
              calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: 'shortest', npoints: fullOrbitSampleCount }),
              calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: 'longest', npoints: fullOrbitSampleCount })
            ]
          : [calculateGeodesicPath([start.lng, start.lat], [end.lng, end.lat], { type: activePath.type, npoints: routeSampleCount })];

        coordsSets.forEach(coords => {
          const legKm = lineDistanceKm(coords);
          km += legKm;
          if (shouldCalculateSurface && activeLandIndex) {
            const surface = calculateSurfaceStats(coords, activeLandIndex);
            landKm += surface.landKm;
            waterKm += surface.waterKm;
            coastlineCrossings += surface.coastlineCrossings;
            longestLandKm = Math.max(longestLandKm, surface.longestLandKm);
            longestWaterKm = Math.max(longestWaterKm, surface.longestWaterKm);
          } else {
            waterKm += legKm;
            longestWaterKm = Math.max(longestWaterKm, legKm);
          }
        });
      } catch (err) {
        console.error('Failed to calculate leg stats', err);
      }

      legs.push({
        label: `${start.name || `Point ${i + 1}`} → ${end.name || `Point ${(i + 2) > activePath.points.length ? 1 : i + 2}`}`,
        km,
        type: typeLabel,
        landKm,
        waterKm,
        landPct: km > 0 ? (landKm / km) * 100 : 0,
        waterPct: km > 0 ? (waterKm / km) * 100 : 0,
        longestLandKm,
        longestWaterKm,
        coastlineCrossings
      });
    }

    const totalKm = legs.reduce((acc, leg) => acc + leg.km, 0);
    const landKm = legs.reduce((acc, leg) => acc + leg.landKm, 0);
    const waterKm = legs.reduce((acc, leg) => acc + leg.waterKm, 0);
    const landPct = totalKm > 0 ? (landKm / totalKm) * 100 : 0;
    const waterPct = totalKm > 0 ? (waterKm / totalKm) * 100 : 0;
    const longestKm = legs.reduce((max, leg) => Math.max(max, leg.km), 0);
    const longestLandKm = legs.reduce((max, leg) => Math.max(max, leg.longestLandKm), 0);
    const longestWaterKm = legs.reduce((max, leg) => Math.max(max, leg.longestWaterKm), 0);
    const coastlineCrossings = legs.reduce((acc, leg) => acc + leg.coastlineCrossings, 0);
    return { legs, totalKm, landKm, waterKm, landPct, waterPct, longestKm, longestLandKm, longestWaterKm, coastlineCrossings };
  }, [activePath, activeLandIndex, routeSampleCount, fullOrbitSampleCount, shouldCalculateSurface]);

  return (
    <div className="crt-app flex h-screen w-full bg-[#050608] font-sans text-white overflow-hidden">
      {/* Sidebar - Fix position and z-index */}
      <div 
        className={cn(
          "crt-panel fixed bg-[#0A0B0E] border-[#2D2D2D] z-[1000] ease-in-out shadow-2xl flex flex-col overflow-hidden",
          isMobile
            ? "left-0 right-0 bottom-0 w-full h-[72dvh] max-h-[720px] border-t rounded-t-[28px] transition-transform duration-300"
            : "top-0 left-0 h-full border-r transition-all duration-300",
          isMobile
            ? (isSidebarOpen ? "translate-y-0" : "translate-y-[calc(100%-76px)]")
            : (isSidebarOpen ? "w-[430px]" : "w-0 border-0")
        )}
      >
        <div className={cn("flex items-center justify-between border-b border-[#2D2D2D] flex-none", isMobile ? "p-4" : "p-5")}>
          <div className="flex min-w-0 items-center gap-2 text-[#F27D26]">
            <GlobeIcon className="w-6 h-6" />
            <span className={cn("font-mono font-semibold uppercase text-[#F27D26] truncate", isMobile ? "text-lg tracking-[0.08em]" : "text-lg tracking-[0.08em]")}>Geodesic Resolver</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="shrink-0 p-2 hover:bg-white/5 rounded transition-colors text-white/65 hover:text-white"
          >
            <ChevronRight className={cn("w-8 h-8", isMobile ? "rotate-90" : "rotate-180")} />
          </button>
        </div>

        <div className={cn("flex-1 overflow-y-auto scrollbar-custom", isMobile ? "p-4 space-y-4 pb-24" : "p-5 space-y-5")}>
          {/* Engine Controls */}
          <section className="space-y-4">
             <div className={cn("flex gap-3", isMobile ? "flex-col items-stretch" : "items-center justify-between")}>
               <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Map</h3>
               <button 
                 onClick={() => {
                   setHasInteracted(true);
                   setIsRotating(!isRotating);
                 }}
                 className={cn(
                   "flex items-center gap-2 px-3 py-1.5 text-[13px] uppercase font-semibold transition-all",
                   isRotating ? "bg-[#F27D26]/20 text-[#F27D26] shadow-[0_0_10px_rgba(242,125,38,0.2)]" : "bg-white/5 text-white/65"
                 )}
               >
                 <RotateCw className={cn("w-5 h-5", isRotating && "animate-spin-slow")} />
                 {isRotating ? 'Auto-rotate' : 'Rotation paused'}
               </button>
             </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Plot</h3>
            <div className="grid grid-cols-4 gap-1">
              <div className="col-span-4 border border-[#2D2D2D] bg-black/25 px-3 py-3 font-mono text-[13px] uppercase leading-relaxed text-white/60">
                Click globe to add point. If a tap misses, use Add Center.
              </div>
              <button
                onClick={addViewCenterPoint}
                className="col-span-2 border border-[#F27D26]/45 bg-[#F27D26]/10 px-3 py-3 text-[13px] font-mono uppercase text-[#ffb84a]"
              >
                Add Center
              </button>
              <button
                onClick={undoLastPoint}
                disabled={!activePath?.points.length}
                className="border border-[#2D2D2D] px-3 py-3 text-[13px] font-mono uppercase text-white/65 disabled:opacity-25 disabled:hover:border-[#2D2D2D]"
              >
                Undo
              </button>
              <button
                onClick={clearActivePath}
                disabled={!activePath?.points.length}
                className="border border-[#2D2D2D] px-3 py-3 text-[13px] font-mono uppercase text-white/65 disabled:opacity-25 disabled:hover:border-[#2D2D2D]"
              >
                Clear
              </button>
            </div>
          </section>

          {/* Display Mode */}
          <section className="space-y-4">
            <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Map Style</h3>
            <div className={cn("grid gap-2", isMobile ? "grid-cols-2" : "grid-cols-2")}>
              {Object.entries(globeStyles).map(([key, style]) => (
                <button
                  key={key}
                  onClick={() => setGlobeStyle(key)}
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-3 border transition-all",
                    globeStyle === key 
                      ? "border-[#F27D26] bg-[#F27D26]/5" 
                      : "border-white/5 bg-white/2 hover:border-white/10"
                  )}
                >
                  <span className={cn("text-[12px] font-mono uppercase tracking-[0.04em]", globeStyle === key ? "text-[#F27D26]" : "text-white/55")}>
                    {style.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Global Search */}
          <section className="space-y-3">
            <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Search</h3>
            <form onSubmit={handleSearch} className="relative group">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search city or coordinates..."
                className="w-full bg-[#14161B] border border-[#2D2D2D] px-4 py-4 text-[15px] font-mono focus:outline-none focus:border-[#F27D26]/60 transition-all placeholder:text-white/55"
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
                      className="w-full text-left px-4 py-3 border-b border-[#2D2D2D] hover:bg-white/5 last:border-0 transition-colors text-[14px] font-mono leading-tight"
                    >
                      {res.display_name}
                    </button>
                  ))}
                  <button 
                    onClick={() => setSearchResults([])}
                    className="w-full text-center py-2 opacity-50 hover:opacity-100 flex items-center justify-center gap-2 border-t border-[#2D2D2D] text-[13px] uppercase font-semibold"
                  >
                    <X className="w-5 h-5" /> Clear Output
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Paths Layer Control */}
          <section className="space-y-4">
            <div className={cn("flex gap-3", isMobile ? "flex-col items-stretch" : "items-center justify-between")}>
              <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Routes</h3>
              <button 
                onClick={addNewPath}
                className="text-[13px] uppercase text-[#F27D26] hover:text-[#F27D26]/80 flex items-center gap-1.5 font-semibold tracking-[0.08em]"
              >
                + New Route
              </button>
            </div>
            <div className="space-y-2">
              {paths.map(p => (
                <div
                  key={p.id}
                  onClick={() => setActivePathId(p.id)}
                  className={cn(
                    "group relative flex flex-col p-4 cursor-pointer border transition-all duration-200",
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
                    <span className="text-[13px] font-mono opacity-50 uppercase">{p.points.length} points</span>
                    {activePathId === p.id && (
                      <div className="px-2 py-1 bg-[#F27D26]/10 text-[12px] font-mono text-[#F27D26] uppercase font-semibold">Active</div>
                    )}
                  </div>
                  {activePathId === p.id && p.points.length >= 2 && (
                    <div className="mt-3 border border-[#2D2D2D] bg-black/25 p-2">
                      <div className="flex items-center justify-between text-[12px] font-mono uppercase tracking-[0.04em] text-white/55">
                        <span>Land / Water</span>
                        <span className="text-[#F27D26]">{formatNumber(activePathStats.landPct, 1)}% / {formatNumber(activePathStats.waterPct, 1)}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden bg-black/60">
                        <div className="h-full bg-[#ffb84a]" style={{ width: `${Math.max(0, Math.min(100, activePathStats.landPct))}%` }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.04em] text-white/45">
                        <span>{landDataStatus === 'ready' ? 'OSM Ready' : landDataStatus === 'loading' ? 'Loading Coastline' : 'Fallback'}</span>
                        <span>{activePathStats.coastlineCrossings} crossings</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <hr className="border-[#2D2D2D]/30" />

          {/* Active Settings */}
          {activePath && (
            <div className="space-y-5 pb-10">
              <section className="space-y-3">
                <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Path Type</h3>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { val: 'shortest', lab: 'Short', sub: 'Minor' },
                    { val: 'longest', lab: 'Long', sub: 'Major' },
                    { val: 'full', lab: 'Loop', sub: 'Closed' }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => updateActivePath({ type: opt.val as PathType })}
                      className={cn(
                        "flex flex-col items-start px-3 py-3 text-left border transition-all duration-200",
                        activePath.type === opt.val 
                          ? "border-[#F27D26] bg-[#F27D26]/10 shadow-[0_0_15px_rgba(242,125,38,0.05)]" 
                          : "border-[#2D2D2D] bg-black/20 hover:border-white/10 hover:bg-white/2"
                      )}
                    >
                      <span className={cn("text-[13px] font-mono font-semibold uppercase tracking-[0.05em]", activePath.type === opt.val ? "text-[#F27D26]" : "text-white/65")}>
                        {opt.lab}
                      </span>
                      <span className="text-[11px] font-mono text-white/45 mt-0.5">{opt.sub}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="font-mono text-[13px] uppercase opacity-75 tracking-[0.14em]">Distance</h3>
                {activePath.points.length < 2 ? (
                  <div className="border border-dashed border-[#2D2D2D] p-8 text-center rounded-xl bg-black/20">
                    <Info className="w-8 h-8 mx-auto mb-3 text-[#F27D26]/50" />
                    <p className="text-[14px] font-mono uppercase text-white/55 leading-relaxed">Click the globe or search a place. Two points will calculate distance.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="border border-[#F27D26]/35 bg-[#F27D26]/8 p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-[#F27D26]/80">Miles</div>
                        <div className="mt-1 text-3xl font-semibold text-white">{formatNumber(activePathStats.totalKm * KM_TO_MILES)}</div>
                        <div className="mt-1 text-[13px] font-mono text-white/55">{formatNumber(activePathStats.totalKm)} km</div>
                      </div>
                      <div className="border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-white/60">Earth Share</div>
                        <div className="mt-1 text-3xl font-semibold text-[#F27D26]">{formatNumber((activePathStats.totalKm / EARTH_CIRCUMFERENCE_KM) * 100, 1)}%</div>
                        <div className="mt-1 text-[13px] font-mono text-white/55">of circumference</div>
                      </div>
                    </div>

                    <div className="border border-[#8a5b22]/50 bg-black/25 p-4">
                      <div className="mb-3 flex items-center justify-between text-[12px] font-mono uppercase tracking-[0.08em]">
                        <span className="text-white/55">Land / Water</span>
                        <span className="text-[#F27D26]">{formatNumber(activePathStats.landPct, 1)}% / {formatNumber(activePathStats.waterPct, 1)}%</span>
                      </div>
                      <div className="h-3 overflow-hidden border border-[#2D2D2D] bg-black/50">
                        <div
                          className="h-full bg-[#ffb84a]"
                          style={{ width: `${Math.max(0, Math.min(100, activePathStats.landPct))}%` }}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] font-mono uppercase tracking-[0.04em] text-white/50">
                        <span>Land {formatNumber(activePathStats.landKm * KM_TO_MILES)} mi</span>
                        <span className="text-right">Water {formatNumber(activePathStats.waterKm * KM_TO_MILES)} mi</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-mono uppercase tracking-[0.04em]">
                        <span className="border border-[#2D2D2D] bg-black/25 px-2 py-2 text-white/55">Crossings {activePathStats.coastlineCrossings}</span>
                        <span className="border border-[#2D2D2D] bg-black/25 px-2 py-2 text-right text-white/55">{landDataStatus === 'ready' ? 'OSM Ready' : landDataStatus === 'loading' ? 'Loading' : 'Fallback'}</span>
                      </div>
                      <div className="mt-2 text-[11px] font-mono uppercase tracking-[0.04em] text-white/40">{landSourceLabel}</div>
                    </div>

                    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="border border-white/10 bg-black/30 p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-white/55">Nautical</div>
                        <div className="mt-1 text-2xl font-semibold text-white">{formatNumber(activePathStats.totalKm * KM_TO_NAUTICAL)}</div>
                      </div>
                      <div className="border border-white/10 bg-black/30 p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-white/55">Longest Leg</div>
                        <div className="mt-1 text-2xl font-semibold text-white">{formatNumber(activePathStats.longestKm * KM_TO_MILES)}</div>
                        <div className="text-[13px] font-mono text-white/45">miles</div>
                      </div>
                    </div>

                    <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="border border-[#8a5b22]/50 bg-black/25 p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-white/55">Longest Land</div>
                        <div className="mt-1 text-2xl font-semibold text-white">{formatNumber(activePathStats.longestLandKm * KM_TO_MILES)}</div>
                        <div className="text-[13px] font-mono text-white/50">mi / {formatNumber(activePathStats.longestLandKm)} km</div>
                      </div>
                      <div className="border border-[#8a5b22]/50 bg-black/25 p-4">
                        <div className="text-[12px] font-mono uppercase tracking-[0.08em] text-white/55">Longest Water</div>
                        <div className="mt-1 text-2xl font-semibold text-white">{formatNumber(activePathStats.longestWaterKm * KM_TO_MILES)}</div>
                        <div className="text-[13px] font-mono text-white/50">mi / {formatNumber(activePathStats.longestWaterKm)} km</div>
                      </div>
                    </div>

                    <div className="border border-[#2D2D2D] bg-black/20 p-3 text-[12px] font-mono uppercase tracking-[0.04em] text-white/45 leading-relaxed">
                      {landDataStatus === 'ready'
                        ? 'Land/water uses OSM-derived coastline polygons with dense geodesic sampling. Blue route segments are water; pale segments are land. Full OSM coastline is too large for static delivery, so this uses the highest practical static OSM precision layer.'
                        : 'Land/water is using the lightweight country-polygon fallback for smoother interaction on this device. Desktop mode loads the higher-precision OSM coastline layer after the initial UI is responsive.'}
                    </div>

                    <div className="border border-[#2D2D2D] bg-[#0D0E12] overflow-hidden">
                      {activePathStats.legs.map((leg, idx) => (
                        <div key={idx} className="p-4 border-b border-[#2D2D2D]/60 last:border-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-mono font-semibold text-white/80 truncate">Leg {idx + 1}</span>
                            <span className="text-[12px] font-mono text-[#F27D26] uppercase">{leg.type}</span>
                          </div>
                          <div className="mt-1 text-[13px] text-white/50 truncate">{leg.label}</div>
                          <div className="mt-2 flex items-end justify-between">
                            <span className="text-2xl font-semibold text-white">{formatNumber(leg.km * KM_TO_MILES)}</span>
                            <span className="pb-1 text-[13px] font-mono text-white/55">mi / {formatNumber(leg.km)} km</span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-mono uppercase tracking-[0.04em]">
                            <span className="bg-black/30 px-2 py-2 text-white/55">Land {formatNumber(leg.landPct, 1)}%</span>
                            <span className="bg-black/30 px-2 py-2 text-white/55">Water {formatNumber(leg.waterPct, 1)}%</span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] font-mono uppercase tracking-[0.04em]">
                            <span className="bg-black/30 px-2 py-2 text-white/45">Land max {formatNumber(leg.longestLandKm * KM_TO_MILES)} mi</span>
                            <span className="bg-black/30 px-2 py-2 text-white/45">Water max {formatNumber(leg.longestWaterKm * KM_TO_MILES)} mi</span>
                          </div>
                          <div className="mt-2 bg-black/20 px-2 py-2 text-[12px] font-mono uppercase tracking-[0.04em] text-white/45">Coast crossings {leg.coastlineCrossings}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="font-mono text-[13px] uppercase opacity-65 tracking-[0.14em]">Points</h3>
                <div className={cn("space-y-2 overflow-y-auto pr-2 scrollbar-custom", isMobile ? "max-h-[260px]" : "max-h-[400px]")}>
                  {activePath.points.length === 0 ? (
                    <div className="border border-dashed border-[#2D2D2D] p-10 text-center rounded-xl bg-black/20 group hover:border-[#F27D26]/30 transition-all">
                      <Crosshair className="w-8 h-8 mx-auto mb-3 opacity-10 group-hover:opacity-30 transition-opacity" />
                      <p className="text-[14px] font-mono uppercase opacity-55 leading-relaxed">No points yet. Click a country or ocean on the globe, or search a place above.</p>
                    </div>
                  ) : (
                    activePath.points.map((p, idx) => (
                      <div 
                        key={p.id}
                        className="group flex flex-col p-4 bg-[#0D0E12] border border-[#2D2D2D] shadow-inner hover:border-[#F27D26]/40 transition-all relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between opacity-50 mb-3 border-b border-[#2D2D2D]/30 pb-2">
                          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#F27D26]">{idx === 0 ? 'Start' : `Point ${idx + 1}`}</span>
                          <button onClick={() => removePoint(p.id)} className="hover:text-red-500 transition-colors">
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                        {p.name && (
                           <div className="text-[17px] font-bold mb-2 text-white/90 truncate">{p.name}</div>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-[13px] font-mono bg-black/40 p-3 border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-[17px] opacity-20 uppercase mb-0.5">long</span>
                            <span className="text-[#F27D26]/80">{p.lng.toFixed(5)}°</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[17px] opacity-20 uppercase mb-0.5">lat</span>
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

        <div className={cn("border-t border-[#2D2D2D] text-[11px] text-white/45 font-mono justify-between uppercase tracking-[0.3em] flex-none bg-[#07080A]", isMobile ? "hidden" : "p-6 flex")}>
          <span>GEODESIC MAP</span>
          <span>READY</span>
        </div>
      </div>

      {/* Main Content Area */}
      <main
        className={cn(
          "relative flex-1 bg-black overflow-hidden transition-[padding] duration-300",
          !isMobile && isSidebarOpen ? "pl-[430px]" : "pl-0"
        )}
      >
        {/* External Controls Toggle - Responsive to Sidebar */}
        <div 
          className={cn(
            "absolute top-8 z-[900] flex items-center gap-6 pointer-events-none transition-all duration-300",
            isMobile ? "left-4 top-4" : (isSidebarOpen ? "left-[448px]" : "left-8")
          )}
        >
          {!isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="pointer-events-auto p-4 bg-[#0A0B0E] border border-[#2D2D2D] shadow-[0_0_28px_rgba(0,0,0,0.8)] hover:bg-[#14161B] hover:border-[#F27D26]/50 transition-all text-white/65 hover:text-white"
            >
              <Menu className="w-6 h-6" />
            </button>
          )}
          
          <button 
            onClick={() => {
              setHasInteracted(true);
              setIsRotating(!isRotating);
            }}
            className={cn(
              "pointer-events-auto p-4 bg-[#0A0B0E] border border-[#2D2D2D] shadow-2xl transition-all group relative overflow-hidden",
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

        {isMobile && (
          <div className="absolute bottom-24 left-0 right-0 z-[920] flex justify-center px-4 pointer-events-none">
            <button
              onClick={addViewCenterPoint}
              className="pointer-events-auto flex min-h-[52px] items-center gap-2 rounded-full border border-[#ffb84a]/35 bg-black/78 px-5 py-3 text-[13px] font-mono font-semibold uppercase tracking-[0.12em] text-[#ffe0a3] shadow-[0_18px_48px_rgba(0,0,0,0.55),0_0_24px_rgba(255,184,74,0.16)] backdrop-blur-xl active:scale-[0.98]"
            >
              <MapPin className="h-5 w-5 text-[#ffb84a]" />
              Drop node at center
            </button>
          </div>
        )}

        {/* Globe Viewports */}
        <div className="crt-viewport absolute inset-0 z-0 select-none">
          <Globe
            ref={globeRef}
            globeImageUrl={globeStyles[globeStyle as keyof typeof globeStyles].img}
            globeMaterial={globeMaterial}
            globeCurvatureResolution={5}
            showAtmosphere
            atmosphereColor="#ffb84a"
            atmosphereAltitude={isMobile ? 0.12 : 0.145}
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            onGlobeReady={handleGlobeReady}
            
            onGlobeClick={(coords) => handlePlacePoint({ lat: coords.lat, lng: coords.lng })}
            
            polygonsData={isMobile && !isSidebarOpen ? [] : countries}
            polygonCapMaterial={countryCapMaterial}
            polygonSideMaterial={countrySideMaterial}
            polygonStrokeColor={() => 'rgba(255, 214, 143, 0.42)'}
            polygonAltitude={() => isMobile ? 0.0018 : 0.0026}
            polygonCapCurvatureResolution={5}
            polygonLabel={(d: any) => `<div class="crt-globe-label"><strong>${escapeHtml(d.properties?.name || 'COUNTRY')}</strong><br/><span>Click to add point</span></div>`}
            onPolygonClick={(_polygon: any, _event: MouseEvent, coords: { lat: number; lng: number }) => handlePlacePoint({ lat: coords.lat, lng: coords.lng })}
            polygonsTransitionDuration={0}
            
            pathsData={globePaths}
            pathPoints="coords"
            pathColor={(d: any) => d.color}
            pathDashArray={(d: any) => d.dashed ? [1.5, 2.5] : [0.18, 0.82]}
            pathDashLength={(d: any) => d.active ? 0.92 : 0.55}
            pathDashGap={(d: any) => d.dashed ? 0.08 : 0.012}
            pathDashAnimateTime={(d: any) => d.active ? 4200 : 9000}
            pathStroke={(d: any) => d.active ? (isMobile ? 4.5 : 5.5) : 2.4}
            pathLabel={(d: any) => d.label}
            
            pointsData={globePoints}
            pointLat="lat"
            pointLng="lng"
            pointColor={(d: any) => d.color}
            pointRadius={(d: any) => d.active ? (isMobile ? 0.62 : 0.72) : 0.34}
            pointAltitude={0.018}
            pointLabel="label"
          />
          <div className="crt-phosphor-bloom" />
          <div className="crt-scanlines" />
          <div className="crt-mask" />
          <div className="crt-vignette" />
          <div className="crt-roll" />
          <div className="crt-glass" />
        </div>

        {/* Terminal Title Layout */}
        <div className="absolute inset-0 z-[100] pointer-events-none select-none flex items-center justify-center">
          <motion.div
            initial={false}
            animate={{ 
              scale: hasInteracted ? (isMobile ? 0.32 : 0.38) : (isMobile ? 0.34 : 0.42),
              x: hasInteracted ? (isMobile ? 0 : (window.innerWidth / 2) - 180) : (isMobile ? 0 : (isSidebarOpen ? Math.min(260, window.innerWidth * 0.18) : 0)),
              y: hasInteracted ? (isMobile ? -220 : -(window.innerHeight / 2) + 80) : (isMobile ? -210 : -Math.min(220, window.innerHeight * 0.30)),
              opacity: hasInteracted ? 0.18 : 0.28
            }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <h1 className={cn(
              "crt-hero font-black tracking-[-0.08em] uppercase leading-none transition-all duration-1000",
              hasInteracted ? "text-5xl text-[#ffc76a]/70" : (isMobile ? "text-[clamp(3.0rem,13vw,4.1rem)] text-[#ffd36e]" : "text-[clamp(4.5rem,7.5vw,7rem)] text-[#ffd36e]")
            )}>
              Geodesic<br/>Resolver
            </h1>
            {!hasInteracted && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-6 flex flex-col items-center gap-2"
              >
                <div className={cn("font-mono text-white/50 bg-[#F27D26]/10 backdrop-blur border-x-2 border-[#F27D26]", isMobile ? "text-[12px] tracking-[0.22em] px-4 py-2" : "text-[17px] tracking-[0.5em] px-8 py-3")}>
                  GREAT-CIRCLE MAP
                </div>
                <div className={cn("font-mono text-[#ffb84a]/70 uppercase mt-2 animate-pulse", isMobile ? "text-[11px] tracking-[0.35em]" : "text-[17px] tracking-[0.82em]")}>
                  CLICK GLOBE TO ADD POINTS
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>

        {/* Footer HUD Stats */}
        <div className={cn("absolute z-[100] pointer-events-none select-none flex flex-col", isMobile ? "top-4 right-4 items-end gap-2" : "bottom-8 right-8 items-end gap-8")}>
           <div className={cn("gap-6", isMobile ? "hidden" : "flex")}>
              <div className="bg-black/60 border border-white/5 backdrop-blur-xl p-6 px-7 rounded-xl shadow-2xl flex flex-col gap-1 items-end">
                <span className="text-[12px] text-white/55 uppercase tracking-[0.08em] font-semibold">Points</span>
                <span className="text-3xl font-mono font-semibold text-white leading-none">
                  {paths.reduce((acc, p) => acc + p.points.length, 0)}
                </span>
              </div>
              <div className="bg-black/60 border border-white/5 backdrop-blur-xl p-6 px-7 rounded-xl shadow-2xl flex flex-col gap-1 items-end">
                <span className="text-[12px] text-white/55 uppercase tracking-[0.08em] font-semibold">Routes</span>
                <span className="text-3xl font-mono font-semibold text-[#F27D26] leading-none">{paths.length}</span>
              </div>
           </div>

           <div className={cn("font-mono uppercase text-white/70 flex items-center bg-black/80 border border-[#2D2D2D] backdrop-blur-2xl rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)]", isMobile ? "hidden" : "text-[17px] tracking-[0.2em] gap-6 px-7 py-6")}>
             <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-[#ffd36e] shadow-[0_0_12px_#ffb84a] animate-pulse" />
               <span className="font-semibold">Ready</span>
             </div>
             <div className="w-px h-3 bg-white/20" />
             <span className="opacity-50 text-[13px]">Click globe to add point</span>
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
        html, body, #root {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
        }
        body {
          background: black;
          color: white;
          overflow: hidden;
        }
        @media (max-width: 767px) {
          * {
            box-sizing: border-box;
          }
        }
      `}} />
    </div>
  );
}
