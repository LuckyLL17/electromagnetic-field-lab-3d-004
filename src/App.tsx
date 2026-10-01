import { type ComponentRef, useEffect, useMemo, useReducer, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Line, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEFAULT_ORBIT,
  MODE_LABELS,
  MODE_SHORT_LABELS,
  areConfigsEqual,
  clampZoom,
  fitDistance,
  normalizedZoomDistance,
  orbitPosition,
  type FieldMode,
  type OrbitState,
  type SideId,
  type ViewConfig,
} from './viewMath';
import { benchReducer, initialBenchState, sharedFitDistance } from './benchState';

const COLORS = {
  field: '#68d7f2',
  vector: '#f6c86f',
  positive: '#f27f73',
  negative: '#6a9fff',
  coil: '#d995f2',
};

const FOV = 42;
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

function fieldAt(x: number, y: number, z: number, mode: FieldMode, strength: number): THREE.Vector3 {
  if (mode === 'capacitor') return new THREE.Vector3(0, strength * (0.9 + 0.12 * Math.cos(x * 1.7)), 0);
  if (mode === 'coil') return new THREE.Vector3(-z * 0.35 * strength, 0.15 * strength, x * 0.35 * strength);

  const r2 = x * x + y * y + z * z + 0.18;
  const scale = strength / Math.pow(r2, 2.1);
  return new THREE.Vector3(3 * x * z * scale, (3 * y * y - r2) * scale, 3 * z * x * scale);
}

function FieldLines({ mode }: { mode: FieldMode }) {
  const lines = useMemo(() => {
    if (mode === 'capacitor') {
      return Array.from({ length: 10 }, (_, i) => {
        const x = -2.6 + i * 0.58;
        return [new THREE.Vector3(x, -2, 0), new THREE.Vector3(x, 2, 0)];
      });
    }

    if (mode === 'coil') {
      return Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return Array.from({ length: 32 }, (_, j) => {
          const t = (j / 31) * Math.PI * 2;
          const r = 1.15 + 0.65 * Math.sin(a * 2) ** 2;
          return new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r * 0.55, Math.sin(a) * 0.3);
        });
      });
    }

    return Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return Array.from({ length: 34 }, (_, j) => {
        const t = (j / 33) * Math.PI * 2;
        const r = 1.05 + 0.23 * Math.sin(t * 2 + a);
        return new THREE.Vector3(
          Math.cos(a) * r * Math.cos(t),
          Math.sin(t) * r,
          Math.sin(a) * r * Math.cos(t),
        );
      });
    });
  }, [mode]);

  return (
    <group>
      {lines.map((line, i) => (
        <Line
          key={i}
          points={line}
          color={mode === 'coil' ? COLORS.coil : COLORS.field}
          lineWidth={1.6}
          transparent
          opacity={0.78}
        />
      ))}
    </group>
  );
}

function Vectors({ mode, strength, showVectors }: { mode: FieldMode; strength: number; showVectors: boolean }) {
  const vectors = useMemo(
    () =>
      Array.from({ length: 25 }, (_, i) => {
        const x = -2.4 + (i % 5) * 1.2;
        const y = -2.4 + Math.floor(i / 5) * 1.2;
        const direction = fieldAt(x, y, 0, mode, strength);
        const safeLength = direction.lengthSq() < 0.0001 ? 0.35 : direction.length();
        direction.multiplyScalar(0.35 / safeLength);

        const start = new THREE.Vector3(x, y, mode === 'capacitor' ? 0.15 : 0);
        const end = start.clone().add(direction);
        return [start, end] as [THREE.Vector3, THREE.Vector3];
      }),
    [mode, strength],
  );

  if (!showVectors) return null;

  return (
    <group>
      {vectors.map((vector, i) => (
        <Line key={i} points={vector} color={COLORS.vector} lineWidth={1.3} />
      ))}
    </group>
  );
}

function Source({ mode, strength }: { mode: FieldMode; strength: number }) {
  if (mode === 'capacitor') {
    return (
      <group>
        <mesh position={[-3, 0, 0]}>
          <boxGeometry args={[0.16, 5.2, 0.55]} />
          <meshStandardMaterial color={COLORS.positive} />
        </mesh>
        <mesh position={[3, 0, 0]}>
          <boxGeometry args={[0.16, 5.2, 0.55]} />
          <meshStandardMaterial color={COLORS.negative} />
        </mesh>
        <Text position={[-2.82, 2.75, 0.2]} fontSize={0.2} color={COLORS.positive}>+Q</Text>
        <Text position={[2.82, 2.75, 0.2]} fontSize={0.2} color={COLORS.negative}>−Q</Text>
      </group>
    );
  }

  if (mode === 'coil') {
    return (
      <group>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} position={[0, 0, (i - 3) * 0.34]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.55, 0.07, 10, 48]} />
            <meshStandardMaterial
              color={COLORS.coil}
              emissive={COLORS.coil}
              emissiveIntensity={strength * 0.12}
            />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group>
      <mesh position={[-0.8, 0, 0]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color={COLORS.positive} emissive={COLORS.positive} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0.8, 0, 0]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color={COLORS.negative} emissive={COLORS.negative} emissiveIntensity={0.4} />
      </mesh>
      <Line
        points={[new THREE.Vector3(-0.8, 0, 0), new THREE.Vector3(0.8, 0, 0)]}
        color="#d8e4ef"
        lineWidth={2}
      />
    </group>
  );
}

interface CameraRigProps {
  side: SideId;
  config: ViewConfig;
  orbit: OrbitState;
  sharedDistance: number;
  onOrbitChange: (side: SideId, orbit: OrbitState) => void;
  onInteractStart: (side: SideId) => void;
  onFitDistance: (side: SideId, distance: number) => void;
}

function CameraRig({
  side,
  config,
  orbit,
  sharedDistance,
  onOrbitChange,
  onInteractStart,
  onFitDistance,
}: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const applyingRef = useRef(false);
  const { camera, size } = useThree();

  const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
  const ownDistance = fitDistance(config.mode, config.showVectors, aspect, FOV);
  const baseDistance = sharedDistance > 0 ? sharedDistance : ownDistance;
  const distance = normalizedZoomDistance(baseDistance, orbit.zoom);
  const [x, y, z] = orbitPosition(orbit, distance);

  useEffect(() => {
    onFitDistance(side, ownDistance);
  }, [side, ownDistance, onFitDistance]);

  useEffect(() => {
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controlsRef.current?.target.set(0, 0, 0);
    applyingRef.current = true;
    controlsRef.current?.update();
    applyingRef.current = false;
  }, [camera, x, y, z, size.width, size.height]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableDamping={false}
      minDistance={2}
      maxDistance={80}
      onChange={() => {
        if (applyingRef.current) return;
        const position = camera.position;
        const radius = Math.max(position.length(), 0.001);
        const zoom = clampZoom(baseDistance / radius);
        const next = {
          theta: Math.atan2(position.x, position.z),
          phi: Math.acos(Math.min(1, Math.max(-1, position.y / radius))),
          zoom,
        };

        if (
          Math.abs(next.theta - orbit.theta) > 0.0001 ||
          Math.abs(next.phi - orbit.phi) > 0.0001 ||
          Math.abs(next.zoom - orbit.zoom) > 0.002
        ) {
          onOrbitChange(side, next);
        }
      }}
      onStart={() => {
        applyingRef.current = false;
        onInteractStart(side);
      }}
    />
  );
}

function EMCanvas({
  side,
  config,
  orbit,
  sharedDistance,
  onOrbitChange,
  onInteractStart,
  onFitDistance,
}: CameraRigProps) {
  return (
    <Canvas
      camera={{ position: orbitPosition(orbit, 8), fov: FOV, near: 0.1, far: 100 }}
      dpr={[1, 1.8]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0b0b1c']} />
      <ambientLight intensity={1.2} />
      <pointLight position={[3, 4, 5]} color="#9a8cff" intensity={18} />
      <pointLight position={[-4, -2, 2]} color="#49d5e7" intensity={12} />

      <group rotation={[0.18, -0.24, 0]}>
        <Source mode={config.mode} strength={config.strength} />
        <FieldLines mode={config.mode} />
        <Vectors mode={config.mode} strength={config.strength} showVectors={config.showVectors} />
      </group>

      <Grid
        position={[0, -2.85, 0]}
        args={[9, 9]}
        cellColor="#302b5c"
        sectionColor="#5b51a0"
        cellSize={0.5}
        sectionSize={2}
        fadeDistance={13}
        fadeStrength={1.5}
        infiniteGrid={false}
      />

      <CameraRig
        side={side}
        config={config}
        orbit={orbit}
        sharedDistance={sharedDistance}
        onOrbitChange={onOrbitChange}
        onInteractStart={onInteractStart}
        onFitDistance={onFitDistance}
      />
    </Canvas>
  );
}

function ModeTabs({
  value,
  onChange,
  compact = false,
}: {
  value: FieldMode;
  onChange: (mode: FieldMode) => void;
  compact?: boolean;
}) {
  const modes: FieldMode[] = ['dipole', 'coil', 'capacitor'];
  return (
    <div className={compact ? 'mini-modes' : 'mode-switch'}>
      {modes.map((mode) => (
        <button key={mode} className={value === mode ? 'active' : ''} onClick={() => onChange(mode)}>
          {compact ? MODE_SHORT_LABELS[mode] : MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

interface ViewPaneProps {
  side: SideId;
  config: ViewConfig;
  orbit: OrbitState;
  linked: boolean;
  sharedDistance: number;
  onPatch: (patch: Partial<ViewConfig>) => void;
  onOrbitChange: (side: SideId, orbit: OrbitState) => void;
  onInteractStart: (side: SideId) => void;
  onFitDistance: (side: SideId, distance: number) => void;
  onReset: (side: SideId) => void;
}

function ViewPane({
  side,
  config,
  orbit,
  linked,
  sharedDistance,
  onPatch,
  onOrbitChange,
  onInteractStart,
  onFitDistance,
  onReset,
}: ViewPaneProps) {
  return (
    <article className={`view-pane ${side}`}>
      <div className="pane-toolbar">
        <div>
          <span className="eyebrow">{side === 'left' ? 'SAMPLE A / LEFT' : 'SAMPLE B / RIGHT'}</span>
          <h2>{MODE_LABELS[config.mode]}</h2>
        </div>
        <ModeTabs value={config.mode} onChange={(mode) => onPatch({ mode })} compact />
      </div>

      <div className="canvas-wrap">
        <EMCanvas
          side={side}
          config={config}
          orbit={orbit}
          sharedDistance={sharedDistance}
          onOrbitChange={onOrbitChange}
          onInteractStart={onInteractStart}
          onFitDistance={onFitDistance}
        />
        <div className="viewer-legend">
          <span><i className="dot field" />场线</span>
          <span><i className="dot source" />场源</span>
          <span><i className="dot vector" />矢量 {config.showVectors ? '25' : '关'}</span>
        </div>
        <div className="viewer-hint">左键旋转 · 滚轮缩放 · {linked ? '任一侧操作均会联动' : '仅作用于本侧'}</div>
        <div className="pane-status">
          <span className={`status-led ${linked ? 'linked' : 'independent'}`} />
          {linked ? '相机联动' : '相机独立'} · 视角 {(orbit.zoom * 100).toFixed(0)}%
        </div>
        <button className="pane-reset" onClick={() => onReset(side)} title="重置该侧实验配置与取景">
          重置 {side === 'left' ? 'A' : 'B'}
        </button>
      </div>

      <div className="pane-controls">
        <label className="control">
          <span>
            激励强度 <b>{config.strength.toFixed(1)} ×</b>
          </span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={config.strength}
            onChange={(event) => onPatch({ strength: Number(event.target.value) })}
          />
        </label>
        <button
          className={config.showVectors ? 'ghost-toggle active' : 'ghost-toggle'}
          onClick={() => onPatch({ showVectors: !config.showVectors })}
        >
          {config.showVectors ? '隐藏场矢量' : '显示场矢量'}
        </button>
      </div>
    </article>
  );
}

function SidePanel({
  side,
  config,
  onPatch,
}: {
  side: SideId;
  config: ViewConfig;
  onPatch: (side: SideId, patch: Partial<ViewConfig>) => void;
}) {
  return (
    <section className="panel side-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">{side === 'left' ? 'LEFT CHANNEL' : 'RIGHT CHANNEL'}</span>
          <h3>{side === 'left' ? 'A 侧场源控制' : 'B 侧场源控制'}</h3>
        </div>
        <span className="channel-badge">{side === 'left' ? 'A' : 'B'}</span>
      </div>

      <label className="control">
        <span>
          激励强度 <b>{config.strength.toFixed(1)} ×</b>
        </span>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={config.strength}
          onChange={(event) => onPatch(side, { strength: Number(event.target.value) })}
        />
      </label>

      <div className="source-list">
        {(['dipole', 'coil', 'capacitor'] as FieldMode[]).map((mode) => (
          <button
            key={mode}
            className={config.mode === mode ? 'source active' : 'source'}
            onClick={() => onPatch(side, { mode })}
          >
            <span className={`source-dot ${mode}`} />
            {MODE_LABELS[mode]}
            <em>{mode === 'coil' ? 'B' : 'E'}</em>
          </button>
        ))}
      </div>

      <button
        className={config.showVectors ? 'wide-toggle active' : 'wide-toggle'}
        onClick={() => onPatch(side, { showVectors: !config.showVectors })}
      >
        场矢量采样：{config.showVectors ? '显示' : '隐藏'}
      </button>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(benchReducer, initialBenchState);
  const { views, linked, activeSide, sharedOrbit, localOrbits } = state;

  const leftOrbit = linked ? sharedOrbit : localOrbits.left;
  const rightOrbit = linked ? sharedOrbit : localOrbits.right;
  const linkedFitDistance = sharedFitDistance(state);
  const leftSharedDistance = linked ? linkedFitDistance : 0;
  const rightSharedDistance = linked ? linkedFitDistance : 0;
  const configsMatch = areConfigsEqual(views.left, views.right);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">✦</div>
          <div>
            <span className="eyebrow">ELECTROMAGNETISM / SPLIT FIELD BENCH</span>
            <h1>
              ElectroMag Lab <span>·</span> 双视图三维场型对比
            </h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="dataset">A {MODE_SHORT_LABELS[views.left.mode]} / B {MODE_SHORT_LABELS[views.right.mode]}</span>
          <button onClick={() => dispatch({ type: 'copyAcross' })}>复制{activeSide === 'left' ? 'A→B' : 'B→A'}</button>
          <button onClick={() => dispatch({ type: 'swap' })}>交换配置</button>
        </div>
      </header>

      <main className="layout">
        <section className="comparison-card">
          <div className="compare-toolbar">
            <div>
              <span className="eyebrow">COMPARATIVE 3D FIELD MAPPING</span>
              <h2>左右独立实验通道</h2>
            </div>
            <div className="compare-actions">
              <label className="link-switch">
                <input type="checkbox" checked={linked} onChange={() => dispatch({ type: 'toggleLink' })} />
                <span>{linked ? '相机联动' : '相机独立'}</span>
              </label>
              <button onClick={() => dispatch({ type: 'resetCamera' })}>{linked ? '重置共享取景' : `重置${activeSide === 'left' ? 'A' : 'B'}取景`}</button>
              <button onClick={() => dispatch({ type: 'swap' })} className="primary-action">交换 A/B</button>
            </div>
          </div>

          <div className="compare-note">
            {linked
              ? '两侧使用完全相同的相机位置；取两侧较大模型所需距离，保证较大小模型也完整入画。'
              : '两侧相机状态完全隔离；在任一视图旋转或缩放都不会污染另一侧。'}
            {!configsMatch ? ' · 当前场型配置不同。' : ' · 当前场型配置一致，可直接比较取景与控制行为。'}
          </div>

          <div className="split-view">
            <ViewPane
              side="left"
              config={views.left}
              orbit={leftOrbit}
              linked={linked}
              sharedDistance={leftSharedDistance}
              onPatch={(patch) => dispatch({ type: 'patch', side: 'left', patch })}
              onOrbitChange={(side, orbit) => dispatch({ type: 'orbit', side, orbit })}
              onInteractStart={(side) => dispatch({ type: 'start', side })}
              onFitDistance={(side, distance) => dispatch({ type: 'reportFit', side, distance })}
              onReset={(side) => dispatch({ type: 'resetSide', side })}
            />
            <div className="divider-badge" aria-hidden="true">
              VS
            </div>
            <ViewPane
              side="right"
              config={views.right}
              orbit={rightOrbit}
              linked={linked}
              sharedDistance={rightSharedDistance}
              onPatch={(patch) => dispatch({ type: 'patch', side: 'right', patch })}
              onOrbitChange={(side, orbit) => dispatch({ type: 'orbit', side, orbit })}
              onInteractStart={(side) => dispatch({ type: 'start', side })}
              onFitDistance={(side, distance) => dispatch({ type: 'reportFit', side, distance })}
              onReset={(side) => dispatch({ type: 'resetSide', side })}
            />
          </div>
        </section>

        <aside className="sidebar">
          <section className="panel intro-panel">
            <span className="eyebrow">FIELD EXPERIMENT</span>
            <h3>隔离对象、状态与动作</h3>
            <p>
              每个通道拥有独立的 Three.js 场景对象、场型、激励强度、矢量开关和相机状态；交换只交换实验配置，不交换取景。
            </p>
            <div className="metrics">
              <Metric label="联动状态" value={linked ? 'ON' : 'OFF'} note={linked ? '共享世界视角' : '状态隔离'} />
              <Metric label="活动通道" value={activeSide === 'left' ? 'A' : 'B'} note="最近操作" />
              <Metric label="场景实例" value="2" note="对象不共享" />
            </div>
          </section>

          <SidePanel side="left" config={views.left} onPatch={(side, patch) => dispatch({ type: 'patch', side, patch })} />
          <SidePanel side="right" config={views.right} onPatch={(side, patch) => dispatch({ type: 'patch', side, patch })} />

          <section className="panel">
            <span className="eyebrow">CAMERA STRATEGY</span>
            <div className="readout">
              <div><span>共享相机取舍</span><b>弃用</b></div>
              <div><span>采用方案</span><b>双相机同步</b></div>
              <div><span>同步内容</span><b>方向 / 缩放</b></div>
              <div><span>重置作用域</span><b>单通道隔离</b></div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
