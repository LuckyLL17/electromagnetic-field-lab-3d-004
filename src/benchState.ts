import { DEFAULT_ORBIT, DEFAULT_VIEWS, type OrbitState, type SideId, type ViewConfig } from './viewMath.js';

export interface BenchState {
  views: Record<SideId, ViewConfig>;
  linked: boolean;
  activeSide: SideId;
  sharedOrbit: OrbitState;
  localOrbits: Record<SideId, OrbitState>;
  fitDistances: Record<SideId, number>;
}

export type BenchAction =
  | { type: 'patch'; side: SideId; patch: Partial<ViewConfig> }
  | { type: 'orbit'; side: SideId; orbit: OrbitState }
  | { type: 'start'; side: SideId }
  | { type: 'toggleLink' }
  | { type: 'swap' }
  | { type: 'copyAcross' }
  | { type: 'resetSide'; side: SideId }
  | { type: 'resetCamera' }
  | { type: 'reportFit'; side: SideId; distance: number };

export const initialBenchState: BenchState = {
  views: {
    left: { ...DEFAULT_VIEWS.left },
    right: { ...DEFAULT_VIEWS.right },
  },
  linked: true,
  activeSide: 'left',
  sharedOrbit: DEFAULT_ORBIT,
  localOrbits: { left: DEFAULT_ORBIT, right: DEFAULT_ORBIT },
  fitDistances: { left: 0, right: 0 },
};

function fitted(orbit: OrbitState): OrbitState {
  return { ...orbit, zoom: 1 };
}

function frameSide(state: BenchState, side: SideId): BenchState {
  if (state.linked) {
    const next = fitted(state.sharedOrbit);
    return {
      ...state,
      sharedOrbit: next,
      localOrbits: { ...state.localOrbits, [side]: next },
    };
  }

  return {
    ...state,
    localOrbits: { ...state.localOrbits, [side]: fitted(state.localOrbits[side]) },
  };
}

function frameBoth(state: BenchState): BenchState {
  if (state.linked) {
    const next = fitted(state.sharedOrbit);
    return { ...state, sharedOrbit: next, localOrbits: { left: next, right: next } };
  }

  return {
    ...state,
    localOrbits: {
      left: fitted(state.localOrbits.left),
      right: fitted(state.localOrbits.right),
    },
  };
}

export function benchReducer(state: BenchState, action: BenchAction): BenchState {
  switch (action.type) {
    case 'patch': {
      const current = state.views[action.side];
      const nextConfig = { ...current, ...action.patch };
      const framingChanged =
        current.mode !== nextConfig.mode || current.showVectors !== nextConfig.showVectors;

      const next: BenchState = {
        ...state,
        activeSide: action.side,
        views: { ...state.views, [action.side]: nextConfig },
      };
      return framingChanged ? frameSide(next, action.side) : next;
    }

    case 'orbit': {
      if (state.linked) {
        return {
          ...state,
          sharedOrbit: action.orbit,
          localOrbits: { left: action.orbit, right: action.orbit },
        };
      }
      return {
        ...state,
        localOrbits: { ...state.localOrbits, [action.side]: action.orbit },
      };
    }

    case 'start':
      return { ...state, activeSide: action.side };

    case 'toggleLink': {
      if (!state.linked) {
        const seed = state.activeSide === 'left' ? state.localOrbits.left : state.localOrbits.right;
        return {
          ...state,
          linked: true,
          sharedOrbit: seed,
          localOrbits: { left: seed, right: seed },
        };
      }

      return {
        ...state,
        linked: false,
        localOrbits: { left: state.sharedOrbit, right: state.sharedOrbit },
      };
    }

    case 'swap':
      return frameBoth({
        ...state,
        views: { left: state.views.right, right: state.views.left },
      });

    case 'copyAcross': {
      const source = state.activeSide;
      const target: SideId = source === 'left' ? 'right' : 'left';
      const framingChanged =
        state.views[source].mode !== state.views[target].mode ||
        state.views[source].showVectors !== state.views[target].showVectors;
      const next: BenchState = {
        ...state,
        views: { ...state.views, [target]: { ...state.views[source] } },
      };
      return framingChanged ? frameSide(next, target) : next;
    }

    case 'resetSide': {
      const next: BenchState = {
        ...state,
        activeSide: action.side,
        views: { ...state.views, [action.side]: { ...DEFAULT_VIEWS[action.side] } },
        localOrbits: { ...state.localOrbits, [action.side]: DEFAULT_ORBIT },
      };

      // In linked mode the shared orbit is deliberately left intact. The reset
      // channel keeps its own reset pose stored for when the user unlinks.
      return next;
    }

    case 'resetCamera': {
      if (state.linked) {
        return {
          ...state,
          sharedOrbit: DEFAULT_ORBIT,
          localOrbits: { left: DEFAULT_ORBIT, right: DEFAULT_ORBIT },
        };
      }
      return {
        ...state,
        localOrbits: { ...state.localOrbits, [state.activeSide]: DEFAULT_ORBIT },
      };
    }

    case 'reportFit': {
      const distance = Number(action.distance.toFixed(4));
      if (Math.abs(state.fitDistances[action.side] - distance) < 0.01) return state;
      return {
        ...state,
        fitDistances: { ...state.fitDistances, [action.side]: distance },
      };
    }

    default:
      return state;
  }
}

export function sharedFitDistance(state: BenchState): number {
  const distances = Object.values(state.fitDistances).filter((distance) => distance > 0);
  return distances.length ? Math.max(...distances) : 0;
}
