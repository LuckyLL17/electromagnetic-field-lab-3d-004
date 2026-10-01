import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CameraBridge,
  CameraPose,
  DEFAULT_CONFIGS,
  FieldConfig,
  Mode,
  SideId,
  swapConfigs,
} from './dual-view';
import { EMView } from './scene';

const MODE_LABEL: Record<Mode, string> = {
  dipole: '电偶极子',
  coil: '通电螺线管',
  capacitor: '平行板电容器',
};
const MODE_SHORT: Record<Mode, string> = { dipole: '电偶极子', coil: '螺线管', capacitor: '平行板' };
const MODE_FIELD: Record<Mode, string> = {
  dipole: '静电场 E',
  coil: '近似磁场 B',
  capacitor: '静电场 E',
};
const MODE_RULE: Record<Mode, string> = {
  dipole: '+ → −',
  coil: '右手螺旋定则',
  capacitor: '+ → −（匀强近似）',
};
const MODES: Mode[] = ['dipole', 'coil', 'capacitor'];

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

/** 单侧视图卡：头部标签 + 本场型切换 + Canvas + 覆盖层 + 强度/矢量/重置控制。 */
function ViewPane({
  side,
  title,
  config,
  linked,
  bridge,
  fitNonce,
  resetNonce,
  onMode,
  onStrength,
  onToggleVectors,
  onReset,
  onUserChange,
}: {
  side: SideId;
  title: string;
  config: FieldConfig;
  linked: boolean;
  bridge: CameraBridge;
  fitNonce: number;
  resetNonce: number;
  onMode: (mode: Mode) => void;
  onStrength: (value: number) => void;
  onToggleVectors: () => void;
  onReset: () => void;
  onUserChange: (side: SideId, pose: CameraPose) => void;
}) {
  return (
    <section className={`view-pane pane-${side}`}>
      <div className="view-head">
        <div className="view-id">
          <span className={`side-badge ${side}`}>{side === 'left' ? 'A' : 'B'}</span>
          <div>
            <span className="eyebrow">VIEW {side.toUpperCase()}</span>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="mode-switch">
          {MODES.map((item) => (
            <button key={item} className={config.mode === item ? 'active' : ''} onClick={() => onMode(item)}>
              {MODE_SHORT[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="canvas-wrap">
        <EMView
          side={side}
          bridge={bridge}
          config={config}
          fitNonce={fitNonce}
          resetNonce={resetNonce}
          onUserChange={onUserChange}
        />
        <div className="viewer-legend">
          <span>
            <i className="dot protein" />场线
          </span>
          <span>
            <i className="dot ligand" />场源
          </span>
          <span>
            <i className="dot interaction" />矢量采样
          </span>
        </div>
        <div className={`link-chip ${linked ? 'on' : 'off'}`}>
          {linked ? '🔗 视角联动中' : '⊘ 视角独立'}
        </div>
        <div className="viewer-hint">左键旋转 · 滚轮缩放{linked ? ' · 联动同步' : ''}</div>
      </div>

      <div className="view-controls">
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
            onChange={(e) => onStrength(Number(e.target.value))}
          />
        </label>
        <div className="view-actions">
          <button onClick={onToggleVectors}>{config.showVectors ? '隐藏场矢量' : '显示场矢量'}</button>
          <button className="reset-btn" onClick={onReset} title="仅复位本侧相机视角">
            ↺ 重置本侧视角
          </button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  // 两侧独立保存场型 / 强度 / 矢量状态
  const [configs, setConfigs] = useState<Record<SideId, FieldConfig>>(DEFAULT_CONFIGS);
  const [linked, setLinked] = useState(false);
  // 每侧各自的取景 / 重置信号；单侧重置只 bump 自己的 nonce
  const [fitNonces, setFitNonces] = useState<Record<SideId, number>>({ left: 0, right: 0 });
  const [resetNonces, setResetNonces] = useState<Record<SideId, number>>({ left: 0, right: 0 });

  // 桥在整个应用生命周期内唯一；两个 Canvas 的 rig 都向它注册
  const bridgeRef = useRef<CameraBridge | null>(null);
  if (bridgeRef.current === null) bridgeRef.current = new CameraBridge();
  const bridge = bridgeRef.current;

  const updateSide = useCallback((side: SideId, patch: Partial<FieldConfig>) => {
    setConfigs((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }));
  }, []);

  const handleLinkedChange = useCallback(
    (value: boolean) => {
      setLinked(value);
      bridge.setLinked(value); // 开启时以左侧世界视角对齐，并保证两侧完整取景
    },
    [bridge],
  );

  // 交换配置：仅交换场型/强度/矢量；相机留在各自窗口
  const handleSwap = useCallback(() => {
    setConfigs((prev) => swapConfigs(prev));
    // 场型变了，两侧都可能需要重新取景
    setFitNonces((prev) => ({ left: prev.left + 1, right: prev.right + 1 }));
  }, []);

  const handleResetSide = useCallback((side: SideId) => {
    setResetNonces((prev) => ({ ...prev, [side]: prev[side] + 1 }));
  }, []);

  const handleUserChange = useCallback(
    (side: SideId, pose: CameraPose) => {
      bridge.userChanged(side, pose);
    },
    [bridge],
  );

  const left = configs.left;
  const right = configs.right;
  const sameMode = left.mode === right.mode;
  const strengthDelta = useMemo(
    () => Math.abs(left.strength - right.strength).toFixed(1),
    [left.strength, right.strength],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">✦</div>
          <div>
            <span className="eyebrow">ELECTROMAGNETISM / SPLIT-BENCH COMPARE</span>
            <h1>
              ElectroMag Lab <span>·</span> 双视图场型对照实验台
            </h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="dataset">
            A: {MODE_SHORT[left.mode]} / B: {MODE_SHORT[right.mode]}
          </span>
          <button
            className={linked ? 'link-btn on' : 'link-btn'}
            onClick={() => handleLinkedChange(!linked)}
            title="联动时两侧保持同一世界视角；独立时互不影响"
          >
            {linked ? '🔗 相机联动 · 开' : '🔗 相机联动 · 关'}
          </button>
          <button onClick={handleSwap} title="交换左右两侧的场型、强度与矢量配置">
            ⇄ 交换配置
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="dual-grid" data-linked={linked}>
          <ViewPane
            side="left"
            title={`${MODE_LABEL[left.mode]} · Field Line Tracer`}
            config={left}
            linked={linked}
            bridge={bridge}
            fitNonce={fitNonces.left}
            resetNonce={resetNonces.left}
            onMode={(mode) => updateSide('left', { mode })}
            onStrength={(value) => updateSide('left', { strength: value })}
            onToggleVectors={() => updateSide('left', { showVectors: !left.showVectors })}
            onReset={() => handleResetSide('left')}
            onUserChange={handleUserChange}
          />
          <div className="split-divider" aria-hidden>
            <span>VS</span>
          </div>
          <ViewPane
            side="right"
            title={`${MODE_LABEL[right.mode]} · Field Line Tracer`}
            config={right}
            linked={linked}
            bridge={bridge}
            fitNonce={fitNonces.right}
            resetNonce={resetNonces.right}
            onMode={(mode) => updateSide('right', { mode })}
            onStrength={(value) => updateSide('right', { strength: value })}
            onToggleVectors={() => updateSide('right', { showVectors: !right.showVectors })}
            onReset={() => handleResetSide('right')}
            onUserChange={handleUserChange}
          />
        </section>

        <aside className="sidebar">
          <section className="panel intro-panel">
            <span className="eyebrow">SPLIT FIELD EXPERIMENT</span>
            <h3>左右对照实验台</h3>
            <p>
              两侧各自保存场型、激励强度与矢量采样状态。可交换 A/B 配置；开启相机联动后两侧保持同一世界视角，独立控制时旋转、缩放与重置互不干扰。
            </p>
            <div className="metrics">
              <Metric label="A 场强系数" value={`${left.strength.toFixed(1)}×`} note="左视图" />
              <Metric label="B 场强系数" value={`${right.strength.toFixed(1)}×`} note="右视图" />
              <Metric label="强度差" value={`${strengthDelta}×`} note="|A − B|" />
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">BENCH CONTROL</span>
                <h3>对照与相机</h3>
              </div>
            </div>
            <div className="bench-actions">
              <button className={linked ? 'active' : ''} onClick={() => handleLinkedChange(!linked)}>
                {linked ? '解除相机联动' : '开启相机联动'}
              </button>
              <button onClick={handleSwap}>⇄ 交换 A / B 配置</button>
            </div>
            <p className="panel-note">
                              {linked
                                ? '联动：以当前左视图视角对齐，任意一侧旋转/缩放都会同步；换模型或缩放窗口时自动拉远以保证两侧都完整取景。'
                                : '独立：两侧相机完全隔离，单侧重置只复位自己；窗口缩放或换场型时各自重新取景。'}
            </p>
          </section>

          <section className="panel">
            <span className="eyebrow">COMPARE READOUT</span>
            <div className="readout">
              <div>
                <span>场型对比</span>
                <b>{sameMode ? '同型对照' : '异型对照'}</b>
              </div>
              <div>
                <span>A 场类型</span>
                <b>{MODE_FIELD[left.mode]}</b>
              </div>
              <div>
                <span>B 场类型</span>
                <b>{MODE_FIELD[right.mode]}</b>
              </div>
              <div>
                <span>A 方向约定</span>
                <b>{MODE_RULE[left.mode]}</b>
              </div>
              <div>
                <span>B 方向约定</span>
                <b>{MODE_RULE[right.mode]}</b>
              </div>
              <div>
                <span>相机模式</span>
                <b>{linked ? '联动（共享视角）' : '双相机独立'}</b>
              </div>
              <div>
                <span>矢量采样</span>
                <b>
                  A {left.showVectors ? '开' : '关'} / B {right.showVectors ? '开' : '关'}
                </b>
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
