import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchReducer, initialBenchState, sharedFitDistance } from './benchState.js';
import { fitDistance, orbitPosition, type OrbitState } from './viewMath.js';
import type { BenchState } from './benchState.js';

test('independent orbits and scene configurations do not contaminate each other', () => {
  const tilted: OrbitState = { theta: 1.4, phi: 0.8, zoom: 0.9 };
  const zoomed: OrbitState = { theta: 0.72, phi: 1.04, zoom: 1.8 };

  let state: BenchState = { ...initialBenchState, linked: false, localOrbits: { left: { ...tilted }, right: { ...tilted } } };
  state = benchReducer(state, { type: 'orbit', side: 'right', orbit: zoomed });
  state = benchReducer(state, { type: 'patch', side: 'left', patch: { strength: 2.8 } });

  assert.deepEqual(state.localOrbits.left, tilted);
  assert.deepEqual(state.localOrbits.right, zoomed);
  assert.equal(state.views.left.strength, 2.8);
  assert.notEqual(state.views.right.strength, 2.8);
});

test('swapping exchanges only experiment configurations, not camera poses', () => {
  const leftPose: OrbitState = { theta: 0.2, phi: 0.9, zoom: 1.2 };
  const rightPose: OrbitState = { theta: 1.9, phi: 1.2, zoom: 0.8 };
  let state: BenchState = {
    ...initialBenchState,
    linked: false,
    localOrbits: { left: leftPose, right: rightPose },
  };

  state = benchReducer(state, { type: 'swap' });

  assert.equal(state.views.left.mode, initialBenchState.views.right.mode);
  assert.equal(state.views.right.mode, initialBenchState.views.left.mode);
  assert.deepEqual(state.localOrbits.left, { ...leftPose, zoom: 1 });
  assert.deepEqual(state.localOrbits.right, { ...rightPose, zoom: 1 });
});

test('linking seeds both cameras from the active side and keeps synchronized poses', () => {
  const leftPose: OrbitState = { theta: 0.4, phi: 0.95, zoom: 1.1 };
  const rightPose: OrbitState = { theta: 2.0, phi: 1.25, zoom: 0.7 };
  let state: BenchState = {
    ...initialBenchState,
    linked: false,
    activeSide: 'right',
    localOrbits: { left: leftPose, right: rightPose },
  };

  state = benchReducer(state, { type: 'toggleLink' });
  assert.equal(state.linked, true);
  assert.deepEqual(state.sharedOrbit, rightPose);

  const moved: OrbitState = { theta: 2.2, phi: 1.0, zoom: 1.3 };
  state = benchReducer(state, { type: 'orbit', side: 'left', orbit: moved });
  assert.deepEqual(state.sharedOrbit, moved);
  assert.deepEqual(state.localOrbits.right, moved);

  state = benchReducer(state, { type: 'toggleLink' });
  assert.equal(state.linked, false);
  assert.deepEqual(state.localOrbits.left, moved);
  assert.deepEqual(state.localOrbits.right, moved);
});

test('single-side reset in linked mode cannot steer the shared camera', () => {
  const shared: OrbitState = { theta: 1.1, phi: 0.9, zoom: 1.4 };
  let state: BenchState = {
    ...initialBenchState,
    linked: true,
    sharedOrbit: shared,
    localOrbits: { left: shared, right: shared },
  };

  state = benchReducer(state, { type: 'resetSide', side: 'left' });

  assert.deepEqual(state.views.left, { ...initialBenchState.views.left });
  assert.notDeepEqual(state.views.right, state.views.left);
  assert.deepEqual(state.sharedOrbit, shared);
});

test('side controls make that channel the active camera channel', () => {
  const state = benchReducer(initialBenchState, {
    type: 'patch',
    side: 'right',
    patch: { strength: 0.9 },
  });

  assert.equal(state.activeSide, 'right');
  assert.equal(state.views.right.strength, 0.9);
  assert.equal(state.views.left.strength, initialBenchState.views.left.strength);
});

test('camera reset in independent mode affects only the active side', () => {
  const leftPose: OrbitState = { theta: 0.2, phi: 0.9, zoom: 1.2 };
  const rightPose: OrbitState = { theta: 1.9, phi: 1.2, zoom: 0.8 };
  let state: BenchState = {
    ...initialBenchState,
    linked: false,
    activeSide: 'left',
    localOrbits: { left: leftPose, right: rightPose },
  };

  state = benchReducer(state, { type: 'resetCamera' });

  assert.deepEqual(state.localOrbits.left, initialBenchState.localOrbits.left);
  assert.deepEqual(state.localOrbits.right, rightPose);
});

test('narrow aspect and larger linked model preserve complete framing', () => {
  const wideCapacitor = fitDistance('capacitor', true, 1.6, 42);
  const narrowCapacitor = fitDistance('capacitor', true, 0.55, 42);
  assert.ok(narrowCapacitor > wideCapacitor);

  let state: BenchState = { ...initialBenchState };
  state = benchReducer(state, { type: 'reportFit', side: 'left', distance: fitDistance('dipole', true, 1, 42) });
  state = benchReducer(state, { type: 'reportFit', side: 'right', distance: narrowCapacitor });

  assert.equal(sharedFitDistance(state).toFixed(3), narrowCapacitor.toFixed(3));
  const [x, y, z] = orbitPosition(initialBenchState.sharedOrbit, narrowCapacitor);
  assert.equal(Math.hypot(x, y, z).toFixed(3), narrowCapacitor.toFixed(3));
});
