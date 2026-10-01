export type SideId = 'left' | 'right';
export type FieldMode = 'dipole' | 'coil' | 'capacitor';

export interface ViewConfig {
  mode: FieldMode;
  strength: number;
  showVectors: boolean;
}

export interface OrbitState {
  theta: number;
  phi: number;
  zoom: number;
}

export const DEFAULT_ORBIT: OrbitState = { theta: 0.72, phi: 1.04, zoom: 1 };

export const DEFAULT_VIEWS: Record<SideId, ViewConfig> = {
  left: { mode: 'dipole', strength: 1.6, showVectors: true },
  right: { mode: 'coil', strength: 2.2, showVectors: true },
};

export const MODE_LABELS: Record<FieldMode, string> = {
  dipole: '电偶极子',
  coil: '通电螺线管',
  capacitor: '平行板电容器',
};

export const MODE_SHORT_LABELS: Record<FieldMode, string> = {
  dipole: '电偶极子',
  coil: '螺线管',
  capacitor: '平行板',
};

// Radius of the visible field/object group, excluding the comparison frame and grid.
const CONTENT_RADIUS: Record<FieldMode, { compact: number; full: number }> = {
  dipole: { compact: 1.55, full: 2.75 },
  coil: { compact: 1.9, full: 2.6 },
  capacitor: { compact: 3.05, full: 3.55 },
};

export function contentRadius(mode: FieldMode, showVectors: boolean): number {
  const radii = CONTENT_RADIUS[mode];
  return showVectors ? radii.full : radii.compact;
}

/**
 * Distance required for a perspective camera to keep the whole rotated content
 * sphere inside the limiting viewport edge. The sphere accounts for model size
 * differences and remains valid when the content group is rotated.
 */
export function fitDistance(mode: FieldMode, showVectors: boolean, aspect: number, fovDegrees: number): number {
  const fov = (fovDegrees * Math.PI) / 180;
  const limitingFov = aspect < 1 ? fov * Math.max(aspect, 0.18) : fov;
  return (contentRadius(mode, showVectors) * 1.12) / Math.sin(limitingFov / 2);
}

export function orbitPosition(orbit: OrbitState, distance: number): [number, number, number] {
  return [
    distance * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    distance * Math.cos(orbit.phi),
    distance * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  ];
}

export function clampZoom(value: number): number {
  return Math.min(2.2, Math.max(0.65, value));
}

export function normalizedZoomDistance(baseDistance: number, zoom: number): number {
  return baseDistance / clampZoom(zoom);
}

export function areConfigsEqual(a: ViewConfig, b: ViewConfig): boolean {
  return a.mode === b.mode && a.showVectors === b.showVectors && Math.abs(a.strength - b.strength) < 0.001;
}

export function cloneDefaultView(side: SideId): ViewConfig {
  return { ...DEFAULT_VIEWS[side] };
}
