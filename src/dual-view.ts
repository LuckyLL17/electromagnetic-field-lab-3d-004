/**
 * dual-view.ts
 *
 * 双视图对照实验台的状态与相机协同核心。
 *
 * 设计取舍：
 * - 使用「双独立 Canvas + 双相机」而不是共享相机。两个 Canvas 各自运行 R3F
 *   渲染循环，场景对象（THREE.Group/网格/材质）在两个场景树中分别创建，
 *   天然互不可见；联动靠 CameraBridge 把主控侧的相机姿态广播给另一侧，
 *   而不是共用同一个相机实例（共用会导致两个渲染器争抢 aspect / 投影矩阵）。
 * - 本文件刻意不导入 three，所有逻辑都是纯数据（azimuth/polar/distance），
 *   方便对交换、联动、重置等行为做无 WebGL 的单元验证。
 */

export type Mode = 'dipole' | 'coil' | 'capacitor';
export type SideId = 'left' | 'right';

/** 单侧实验配置：场型、强度、矢量开关——两侧各自独立保存。 */
export interface FieldConfig {
  mode: Mode;
  strength: number;
  showVectors: boolean;
}

/** 球形坐标相机姿态。target 固定为原点，联动时只同步这三个量。 */
export interface CameraPose {
  azimuth: number;
  polar: number;
  distance: number;
}

/**
 * 各场型内容（场源 + 场线 + 矢量采样，不含背景板）的包围半径。
 * 偶极子/螺线管的场线本身不大，但 5×5 矢量采样网格跨度约 ±2.75；
 * 平行板沿 y 方向跨度最大（极板 ±2.6 + 极号标注），需要更远的取景距离。
 */
export const CONTENT_RADIUS: Record<Mode, number> = {
  dipole: 2.8,
  coil: 2.8,
  capacitor: 2.95,
};

export const CAMERA_FOV = 42;

/** 初始相机姿态（与原单视图 position [6,4.5,8] 等价的球坐标；theta = atan2(x, z)）。 */
export const DEFAULT_POSE: CameraPose = {
  azimuth: Math.atan2(6, 8),
  polar: Math.acos(4.5 / Math.hypot(6, 4.5, 8)),
  distance: 11.1,
};

export const DEFAULT_CONFIGS: Record<SideId, FieldConfig> = {
  left: { mode: 'dipole', strength: 1.6, showVectors: true },
  right: { mode: 'coil', strength: 1.6, showVectors: true },
};

export function createConfig(mode: Mode = 'dipole', strength = 1.6, showVectors = true): FieldConfig {
  return { mode, strength, showVectors };
}

/** 交换两侧配置；相机姿态不跟随交换（保持在各自窗口）。 */
export function swapConfigs(
  configs: Record<SideId, FieldConfig>,
): Record<SideId, FieldConfig> {
  return { left: { ...configs.right }, right: { ...configs.left } };
}

/**
 * 计算保证完整取景所需的相机距离。
 *
 * 同时考虑：
 * - 模型尺寸差异（按场型包围球半径 CONTENT_RADIUS）；
 * - 窗口宽高比：竖长（窄屏降级后上下堆叠）窗口受垂直 fov 约束更严。
 */
export function fitDistance(mode: Mode, aspect: number, fovDeg = CAMERA_FOV): number {
  const radius = CONTENT_RADIUS[mode];
  const fov = (fovDeg * Math.PI) / 180;
  const distH = radius / Math.sin(fov / 2); // 垂直方向约束
  const distW = radius / (Math.sin(fov / 2) * Math.max(aspect, 1e-3)); // 水平方向约束
  return Math.max(distH, distW) * 1.12; // 留白边距
}

/** 保证距离既能装下当前模型，又落在用户允许的缩放范围内。 */
export function clampFit(distance: number, required: number): number {
  return Math.min(24, Math.max(distance, required));
}

/** 让姿态满足取景要求：联动时取两侧 required 的最大值。 */
export function poseWithFit(pose: CameraPose, required: number): CameraPose {
  const distance = clampFit(pose.distance, required);
  return distance === pose.distance ? pose : { ...pose, distance };
}

/** 复位：配置之外的相机姿态回到默认值（由各自侧的 rig 自己应用，互不调用）。 */
export function resetPose(): CameraPose {
  return { ...DEFAULT_POSE };
}

/**
 * ViewRig（位于各自 Canvas 内）暴露给桥的最小端口。
 * 只有桥会调用这些方法；每侧 rig 只注册自己那一个端口，
 * 因此独立模式下任何一侧都无法触碰另一侧的相机。
 */
export interface ControlsPort {
  readonly side: SideId;
  readonly getAspect: () => number;
  readonly requiredDistance: () => number;
  readonly getPose: () => CameraPose;
  setPose: (pose: CameraPose) => void;
  dispose: () => void;
}

export interface FakePortOptions {
  aspect?: number;
  mode?: Mode;
  pose?: CameraPose;
}

/** 供单元验证使用的内存版端口（行为与真实 rig 端口一致：写入会就地更新姿态）。 */
export function makeFakePort(side: SideId, options: FakePortOptions = {}): ControlsPort & {
  writes: CameraPose[];
} {
  const state = {
    pose: options.pose ? { ...options.pose } : { ...DEFAULT_POSE },
  };
  const writes: CameraPose[] = [];
  return {
    side,
    getAspect: () => options.aspect ?? 1.6,
    requiredDistance: () => fitDistance(options.mode ?? 'dipole', options.aspect ?? 1.6),
    getPose: () => ({ ...state.pose }),
    setPose(pose: CameraPose) {
      state.pose = { ...pose };
      writes.push({ ...pose });
    },
    dispose() {},
    get writes() {
      return writes;
    },
  };
}

/**
 * 相机联动桥。两个 ViewRig 在挂载时各自注册一个端口；桥在联动状态下
 * 转发「用户操作侧」的姿态，并在切换联动/插入新端口时做一次对齐。
 */
export class CameraBridge {
  private ports = new Map<SideId, ControlsPort>();
  private linked = false;
  /** 上一次广播的姿态，用于抑制回环和让后挂载的一侧对齐。 */
  private broadcast: { pose: CameraPose } | null = null;

  isLinked(): boolean {
    return this.linked;
  }

  register(port: ControlsPort): () => void {
    this.ports.set(port.side, port);
    if (this.linked) this.align(port);
    return () => {
      // 仅当当前注册者还是自己时才注销（StrictMode 重挂载场景）
      if (this.ports.get(port.side) === port) this.ports.delete(port.side);
    };
  }

  setLinked(value: boolean): void {
    if (value === this.linked) return;
    this.linked = value;
    this.broadcast = null;
    if (value) this.alignLinked();
  }

  /** rig 侧用户交互结束/变化时上报。独立模式直接忽略，不触碰另一侧。 */
  userChanged(source: SideId, pose: CameraPose): void {
    if (!this.linked) return;
    const origin = this.ports.get(source);
    if (!origin) return;
    const required = this.maxRequired();
    const next = poseWithFit(pose, required);
    this.broadcast = { pose: next };
    for (const port of this.ports.values()) {
      if (port.side !== source) port.setPose(next);
    }
    if (next.distance !== pose.distance) origin.setPose(next);
  }

  /** 某一侧需要重新取景（resize / 换场型）。联动时两侧同步。 */
  refit(source: SideId): void {
    if (!this.linked) {
      const port = this.ports.get(source);
      if (port) port.setPose(poseWithFit(port.getPose(), port.requiredDistance()));
      return;
    }
    // 联动必须保持同一世界视角：方向沿用当前共享姿态，距离取两侧取景最大值
    const required = this.maxRequired();
    const base = this.broadcast?.pose ?? this.ports.get(source)?.getPose() ?? DEFAULT_POSE;
    const next = poseWithFit(base, required);
    this.broadcast = { pose: next };
    for (const port of this.ports.values()) port.setPose(next);
  }

  /**
   * 单侧重置：只复位该侧自己的相机。
   * 联动模式下重置意味着「两侧共同回到默认世界视角」，
   * 因为任一侧相机姿态变化都会同步到另一侧。
   */
  reset(source: SideId): void {
    const port = this.ports.get(source);
    if (!port) return;
    const pose = resetPose();
    if (!this.linked) {
      port.setPose(poseWithFit(pose, port.requiredDistance()));
      return;
    }
    const next = poseWithFit(pose, this.maxRequired());
    this.broadcast = { pose: next };
    for (const p of this.ports.values()) p.setPose(next);
  }

  dispose(): void {
    for (const port of this.ports.values()) port.dispose();
    this.ports.clear();
    this.broadcast = null;
  }

  private maxRequired(): number {
    let value = 0;
    for (const port of this.ports.values()) {
      value = Math.max(value, port.requiredDistance());
    }
    return value;
  }

  /** 开启联动时的首次对齐：以左侧为基准，方向一致、距离取两侧取景最大值。 */
  private alignLinked(): void {
    const left = this.ports.get('left');
    const right = this.ports.get('right');
    const base = left?.getPose() ?? right?.getPose() ?? DEFAULT_POSE;
    const next = poseWithFit(base, this.maxRequired());
    this.broadcast = { pose: next };
    for (const port of this.ports.values()) port.setPose(next);
  }

  /** 联动开启状态下后挂载的一侧（如 StrictMode 重挂载）：跟随已有视角。 */
  private align(port: ControlsPort): void {
    if (this.broadcast) {
      port.setPose(poseWithFit(this.broadcast.pose, port.requiredDistance()));
      return;
    }
    this.alignLinked();
  }
}
