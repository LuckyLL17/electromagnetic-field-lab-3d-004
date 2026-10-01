import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls, Text } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  CAMERA_FOV,
  CameraBridge,
  CONTENT_RADIUS,
  CameraPose,
  ControlsPort,
  DEFAULT_POSE,
  FieldConfig,
  fitDistance,
  poseWithFit,
  SideId,
} from './dual-view';

const colors = {
  field: '#68d7f2',
  vector: '#f6c86f',
  positive: '#f27f73',
  negative: '#6a9fff',
  coil: '#d995f2',
};

type Mode = FieldConfig['mode'];

function fieldAt(x: number, y: number, z: number, mode: Mode, strength: number) {
  if (mode === 'capacitor') {
    return new THREE.Vector3(0, strength * (0.9 + 0.12 * Math.cos(x * 1.7)), 0);
  }
  if (mode === 'coil') {
    return new THREE.Vector3(-z * 0.35 * strength, 0.15 * strength, x * 0.35 * strength);
  }
  const r2 = x * x + y * y + z * z + 0.18;
  const scale = strength / Math.pow(r2, 2.1);
  return new THREE.Vector3(3 * x * z * scale, (3 * y * y - r2) * scale, 3 * z * x * scale);
}

function FieldLines({ mode, strength }: { mode: Mode; strength: number }) {
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
          color={mode === 'coil' ? colors.coil : colors.field}
          lineWidth={1.6}
          transparent
          opacity={0.78}
        />
      ))}
    </group>
  );
}

function Vectors({
  mode,
  strength,
  showVectors,
}: {
  mode: Mode;
  strength: number;
  showVectors: boolean;
}) {
  const vectors = useMemo(
    () =>
      Array.from({ length: 25 }, (_, i) => {
        const x = -2.4 + (i % 5) * 1.2;
        const y = -2.4 + Math.floor(i / 5) * 1.2;
        const v = fieldAt(x, y, 0, mode, strength);
        const start = new THREE.Vector3(x, y, mode === 'capacitor' ? 0.15 : 0);
        const end = start.clone().add(v.normalize().multiplyScalar(0.35));
        return [start, end] as [THREE.Vector3, THREE.Vector3];
      }),
    [mode, strength],
  );
  if (!showVectors) return null;
  return (
    <group>
      {vectors.map((v, i) => (
        <Line key={i} points={v} color={colors.vector} lineWidth={1.3} />
      ))}
    </group>
  );
}

function Source({ mode, strength }: { mode: Mode; strength: number }) {
  if (mode === 'capacitor') {
    return (
      <group>
        <mesh position={[-3, 0, 0]}>
          <boxGeometry args={[0.16, 5.2, 0.55]} />
          <meshStandardMaterial color={colors.positive} />
        </mesh>
        <mesh position={[3, 0, 0]}>
          <boxGeometry args={[0.16, 5.2, 0.55]} />
          <meshStandardMaterial color={colors.negative} />
        </mesh>
        <Text position={[-2.82, 2.75, 0.2]} fontSize={0.2} color={colors.positive}>
          +Q
        </Text>
        <Text position={[2.82, 2.75, 0.2]} fontSize={0.2} color={colors.negative}>
          −Q
        </Text>
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
              color={colors.coil}
              emissive={colors.coil}
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
        <meshStandardMaterial color={colors.positive} emissive={colors.positive} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0.8, 0, 0]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color={colors.negative} emissive={colors.negative} emissiveIntensity={0.4} />
      </mesh>
      <Line
        points={[new THREE.Vector3(-0.8, 0, 0), new THREE.Vector3(0.8, 0, 0)]}
        color="#d8e4ef"
        lineWidth={2}
      />
    </group>
  );
}

/**
 * 球坐标 → OrbitControls（target 恒为原点）。
 * three 的球坐标约定：theta = atan2(x, z)，phi 为与 +Y 的夹角。
 */
function applyPose(controls: OrbitControlsImpl, pose: CameraPose) {
  const sinPhiRadius = pose.distance * Math.sin(pose.polar);
  controls.object.position.set(
    sinPhiRadius * Math.sin(pose.azimuth),
    pose.distance * Math.cos(pose.polar),
    sinPhiRadius * Math.cos(pose.azimuth),
  );
  controls.target.set(0, 0, 0);
  controls.update();
}

/**
 * ViewRig：每侧 Canvas 内部唯一的相机控制组件。
 *
 * 场景对象、OrbitControls、状态引用全部只存在于这一侧的 Canvas 渲染树中；
 * 对外只通过 ControlsPort 与 CameraBridge 通信，联动消息必须经桥转发，
 * 因此独立模式下一侧的任何操作都无法污染另一侧。
 */
function ViewRig({
  side,
  bridge,
  config,
  fitNonce,
  resetNonce,
  onUserChange,
}: {
  side: SideId;
  bridge: CameraBridge;
  config: FieldConfig;
  fitNonce: number;
  resetNonce: number;
  onUserChange: (side: SideId, pose: CameraPose) => void;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const onChangeLock = useRef(false);
  // 最新的场型/尺寸放在 ref 中，使端口只需注册一次
  const frameRef = useRef({ mode: config.mode, width: size.width, height: size.height });
  frameRef.current = { mode: config.mode, width: size.width, height: size.height };
  const userChangeRef = useRef(onUserChange);
  userChangeRef.current = onUserChange;

  const readPose = (controls: OrbitControlsImpl): CameraPose => ({
    azimuth: controls.getAzimuthalAngle(),
    polar: controls.getPolarAngle(),
    distance: controls.getDistance(),
  });

  // 注册前先把相机放到默认姿态，避免首次对齐时另一侧先取到错位姿态
  useEffect(() => {
    camera.position.set(6, 4.5, 8);
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
  }, [camera]);

  // 向桥注册本侧端口（整生命周期一次；注销幂等以兼容 StrictMode 重挂载）
  useEffect(() => {
    const port: ControlsPort = {
      side,
      getAspect: () => {
        const { width, height } = frameRef.current;
        return height > 0 ? width / height : 1;
      },
      requiredDistance: () => {
        const { mode, width, height } = frameRef.current;
        return fitDistance(mode, width / Math.max(height, 1));
      },
      getPose: () => (controlsRef.current ? readPose(controlsRef.current) : { ...DEFAULT_POSE }),
      setPose(pose) {
        const controls = controlsRef.current;
        if (!controls) return;
        onChangeLock.current = true;
        try {
          applyPose(controls, pose);
        } finally {
          onChangeLock.current = false;
        }
      },
      dispose() {},
    };
    return bridge.register(port);
  }, [bridge, side]);

  // 换场型 / 窗口尺寸变化：按本侧模型与宽高比重取景，再经桥通知另一侧
  const aspect = size.height > 0 ? size.width / size.height : 1;
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const required = fitDistance(config.mode, aspect);
    onChangeLock.current = true;
    try {
      applyPose(controls, poseWithFit(readPose(controls), required));
    } finally {
      onChangeLock.current = false;
    }
    // 联动时桥会把（可能因另一侧模型/宽高比而更大的）取景距离广播回来
    bridge.refit(side);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.mode, aspect, fitNonce]);

  // 本侧重置信号（resetNonce 由各自侧的按钮维护，不会影响另一侧）
  useEffect(() => {
    if (resetNonce === 0) return;
    bridge.reset(side);
  }, [resetNonce, bridge, side]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping={false}
      minDistance={3.5}
      maxDistance={24}
      onChange={() => {
        const controls = controlsRef.current;
        if (!controls || onChangeLock.current) return;
        userChangeRef.current(side, readPose(controls));
      }}
    />
  );
}

/**
 * 单侧完整三维视图：独立 Canvas、独立场景对象、独立相机。
 * 两侧 <EMView> 之间没有任何共享的 three 对象。
 */
export function EMView({
  side,
  bridge,
  config,
  fitNonce,
  resetNonce,
  onUserChange,
}: {
  side: SideId;
  bridge: CameraBridge;
  config: FieldConfig;
  fitNonce: number;
  resetNonce: number;
  onUserChange: (side: SideId, pose: CameraPose) => void;
}) {
  return (
    <Canvas camera={{ position: [6, 4.5, 8], fov: CAMERA_FOV, near: 0.1, far: 100 }}>
      <color attach="background" args={['#0b0b1c']} />
      <ambientLight intensity={1.2} />
      <pointLight position={[3, 4, 5]} color="#9a8cff" intensity={18} />
      <pointLight position={[-4, -2, 2]} color="#49d5e7" intensity={12} />
      <group rotation={[0.18, -0.24, 0]}>
        <Source mode={config.mode} strength={config.strength} />
        <FieldLines mode={config.mode} strength={config.strength} />
        <Vectors mode={config.mode} strength={config.strength} showVectors={config.showVectors} />
      </group>
      {/* 背景板在旋转组之外，且不计入 CONTENT_RADIUS 取景计算 */}
      <mesh position={[0, 0, -0.45]}>
        <planeGeometry args={[7, 6]} />
        <meshBasicMaterial color="#25234b" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
      <ViewRig
        side={side}
        bridge={bridge}
        config={config}
        fitNonce={fitNonce}
        resetNonce={resetNonce}
        onUserChange={onUserChange}
      />
    </Canvas>
  );
}

export { CONTENT_RADIUS };
