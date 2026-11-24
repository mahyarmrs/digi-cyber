import data from './countries.json';

import type { Language } from '../../shared/types';

interface Country {
  lat: number;
  lon: number;
  en: string;
  fa: string;
}

const countries = data.countries as Record<string, Country>;
export const mapSize = { width: data.map.width, height: data.map.height };

// The same Mercator gen-map.mjs drew the map with, as fractions of its width and height.
export function project(lat: number, lon: number): { x: number; y: number } {
  const x = (data.map.width / 2 + data.map.scale * ((lon * Math.PI) / 180)) / data.map.width;
  const y = (data.map.ty - data.map.scale * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / data.map.height;
  return { x, y };
}

export function countryName(code: string, lang: Language): string {
  return countries[code.toUpperCase()]?.[lang] ?? code.toUpperCase();
}

export function countryPoint(code: string): { x: number; y: number } | null {
  const c = countries[code.toUpperCase()];
  if (!c || (c.lat === 0 && c.lon === 0)) return null;
  return project(c.lat, c.lon);
}
