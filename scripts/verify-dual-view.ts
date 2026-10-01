/**
 * 双视图核心逻辑验证（无 DOM / WebGL 依赖）。
 * 覆盖：配置交换、独立隔离、联动对齐/同步、联动解除后隔离、
 *      单侧重置、联动重置、窗口缩放/模型尺寸取景、窄屏降级、
 *      后挂载对齐与注销幂等。
 */
import {
  CameraBridge,
  CameraPose,
  DEFAULT_CONFIGS,
  DEFAULT_POSE,
  fitDistance,
  makeFakePort,
  poseWithFit,
  resetPose,
  swapConfigs,
  type FieldConfig,
  type SideId,
} from '../src/dual-view';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}
function approx(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

console.log('1) 配置交换：两侧独立保存，交换后互不别名');
{
  const a: FieldConfig = { mode: 'dipole', strength: 1.2, showVectors: true };
  const b: FieldConfig = { mode: 'coil', strength: 2.4, showVectors: false };
  const configs: Record<SideId, FieldConfig> = { left: a, right: b };
  const swapped = swapConfigs(configs);
  assert(swapped.left.mode === 'coil' && swapped.left.strength === 2.4, '左得到原右侧配置');
  assert(swapped.right.mode === 'dipole' && swapped.right.strength === 1.2, '右得到原左侧配置');
  assert(swapped.left.showVectors === false, '矢量开关随配置交换');
  swapped.left.strength = 3;
  assert(a.strength === 1.2, '交换产生副本，修改不污染源对象');
  assert(configs.left.strength === 1.2, '原状态对象不被交换修改');
  // 默认初始对照配置
  assert(DEFAULT_CONFIGS.left.mode === 'dipole' && DEFAULT_CONFIGS.right.mode === 'coil', '默认 A/B 异型对照');
}

console.log('2) 取景距离：模型尺寸差异');
{
  const wide = 1.6;
  const dDipole = fitDistance('dipole', wide);
  const dCap = fitDistance('capacitor', wide);
  assert(dCap > dDipole, '平行板（高跨度）需要更远取景距离');
  assert(approx(dCap, 9.22, 0.01), '平行板宽屏取景距离 ≈ 9.22');
  assert(approx(dDipole, 8.75, 0.01), '偶极子宽屏取景距离 ≈ 8.75（含矢量采样包围）');
  // poseWithFit 只在不足时拉远，已经够远不动
  const near: CameraPose = { ...DEFAULT_POSE, distance: 5 };
  assert(poseWithFit(near, dCap).distance === dCap, '距离不足时拉远到取景值');
  assert(poseWithFit({ ...DEFAULT_POSE, distance: 20 }, dCap).distance === 20, '用户主动拉远不被压回');
  assert(poseWithFit({ ...DEFAULT_POSE, distance: 99 }, dCap).distance === 24, '取景距离被 maxDistance=24 截断');
}

console.log('3) 取景距离：窗口缩放 / 窄屏降级（竖长窗口受垂直约束）');
{
  const capWide = fitDistance('capacitor', 1.6);
  const capNarrow = fitDistance('capacitor', 0.62);
  assert(capNarrow > capWide, '窄屏堆叠时需要更远距离才能完整取景');
  assert(approx(capNarrow, 14.87, 0.01), '窄屏(0.62)平行板 ≈ 14.87');
  assert(
    poseWithFit({ ...DEFAULT_POSE, distance: 10 }, fitDistance('capacitor', 0.2)).distance === 24,
    '极窄窗口所需距离超过 maxDistance 时截断在 24，保持可用范围',
  );
  const dipoleNarrow = fitDistance('dipole', 0.62);
  assert(dipoleNarrow > fitDistance('dipole', 1.6), '小模型在窄屏下同样按宽高比拉远');
}

console.log('4) 独立模式：一侧操作不污染另一侧');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'coil' });
  bridge.register(left);
  bridge.register(right);
  assert(bridge.isLinked() === false, '默认独立');
  const rightBefore = right.getPose();
  bridge.userChanged('left', { azimuth: 1.1, polar: 1.3, distance: 9 });
  const rightAfter = right.getPose();
  assert(approx(rightAfter.azimuth, rightBefore.azimuth), '左侧旋转不改变右侧方位角');
  assert(approx(rightAfter.distance, rightBefore.distance), '左侧缩放不改变右侧距离');
  assert(left.writes.length === 0, '独立模式左侧上报不会被回写');
  bridge.refit('left');
  assert(right.writes.length === 0, '独立模式左侧 refit 不触碰右侧');
  bridge.dispose();
}

console.log('5) 联动开启：同一世界视角，距离取两侧取景最大值');
{
  const bridge = new CameraBridge();
  // 左宽屏偶极子，右窄屏平行板 —— 距离必须满足更苛刻的一侧
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole', pose: { ...DEFAULT_POSE, azimuth: 0.5 } });
  const right = makeFakePort('right', { aspect: 0.62, mode: 'capacitor', pose: { ...DEFAULT_POSE, azimuth: 1.9 } });
  bridge.register(left);
  bridge.register(right);
  bridge.setLinked(true);
  const lp = left.getPose();
  const rp = right.getPose();
  assert(approx(lp.azimuth, 0.5) && approx(rp.azimuth, 0.5), '以左侧视角方向对齐两侧');
  assert(approx(lp.polar, rp.polar) && approx(lp.distance, rp.distance), '联动姿态三要素一致');
  const required = Math.max(
    fitDistance('dipole', 1.6),
    fitDistance('capacitor', 0.62),
  );
  assert(approx(rp.distance, required), '距离取两侧取景最大值（窄屏平行板 14.89）');
  assert(rp.distance >= 11.1, '默认距离不足时自动拉远');
  bridge.dispose();
}

console.log('6) 联动中：任一侧旋转/缩放实时同步');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'dipole' });
  bridge.register(left);
  bridge.register(right);
  bridge.setLinked(true);
  right.writes.length = 0;
  bridge.userChanged('left', { azimuth: 2.2, polar: 0.8, distance: 13 });
  assert(right.writes.length === 1, '右侧收到一次同步');
  assert(
    approx(right.getPose().azimuth, 2.2) && approx(right.getPose().distance, 13),
    '右侧姿态与左侧一致',
  );
  // 从右侧发起同样同步（距离 12 满足取景要求，不被纠正）
  bridge.userChanged('right', { azimuth: 0.3, polar: 1.2, distance: 12 });
  assert(approx(left.getPose().azimuth, 0.3) && approx(left.getPose().distance, 12), '右侧主控时左侧跟随');
  // 过近（换大模型）时源侧也会被纠正到取景距离
  const before = left.writes.length;
  bridge.userChanged('left', { azimuth: 0.3, polar: 1.2, distance: 4 });
  assert(left.writes.length === before + 1 && left.getPose().distance >= 8.7, '源侧过近时同样被拉远');
  bridge.dispose();
}

console.log('7) 解除联动后立即恢复隔离');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'dipole' });
  bridge.register(left);
  bridge.register(right);
  bridge.setLinked(true);
  bridge.userChanged('left', { azimuth: 2.2, polar: 0.8, distance: 13 });
  bridge.setLinked(false);
  const snapshot = right.getPose();
  const writesAfterUnlock = right.writes.length;
  bridge.userChanged('left', { azimuth: 0.1, polar: 2.0, distance: 7 });
  assert(right.writes.length === writesAfterUnlock, '解除后左侧操作不再写入右侧');
  assert(approx(right.getPose().azimuth, snapshot.azimuth), '解除后右侧保持自己的视角');
  const leftAzBeforeRefit = left.getPose().azimuth;
  left.writes.length = 0;
  bridge.refit('right');
  assert(left.writes.length === 0, '独立 refit 只作用于发起侧，不写入左侧');
  assert(approx(left.getPose().azimuth, leftAzBeforeRefit), '独立 refit 后左侧视角保持不变');
  bridge.dispose();
}

console.log('8) 单侧重置：只复位自己；联动重置作用于共享视角');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'coil' });
  bridge.register(left);
  bridge.register(right);
  // 先把两侧转到不同角度
  bridge.userChanged('left', { azimuth: 1.0, polar: 1.0, distance: 9 }); // 独立：不同步
  left.setPose({ azimuth: 1.0, polar: 1.0, distance: 9 });
  right.setPose({ azimuth: 2.0, polar: 1.3, distance: 12 });
  bridge.reset('left');
  const lp = left.getPose();
  assert(approx(lp.azimuth, resetPose().azimuth) && approx(lp.distance, DEFAULT_POSE.distance), '左侧回到默认姿态');
  assert(approx(right.getPose().azimuth, 2.0) && approx(right.getPose().distance, 12), '右侧不受单侧重置影响');
  // 联动下重置：共享视角一起回默认（距离仍满足取景）
  bridge.setLinked(true);
  bridge.reset('right');
  assert(approx(left.getPose().azimuth, DEFAULT_POSE.azimuth), '联动重置：左侧回默认');
  assert(approx(right.getPose().azimuth, DEFAULT_POSE.azimuth), '联动重置：右侧回默认');
  assert(
    approx(left.getPose().distance, right.getPose().distance),
    '联动重置后两侧距离一致',
  );
  bridge.dispose();
}

console.log('9) 联动下 refit（换场型/窗口缩放）同步取景');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'dipole' });
  bridge.register(left);
  bridge.register(right);
  bridge.setLinked(true);
  // 模拟窗口缩窄：重新创建右侧端口（真实场景中 rig 端口闭包随 size 重建）
  const narrowRight = makeFakePort('right', { aspect: 0.62, mode: 'capacitor' });
  bridge.register(narrowRight); // 重注册：注销旧右端口
  bridge.refit('left');
  const need = fitDistance('capacitor', 0.62);
  assert(approx(left.getPose().distance, need), '左同步拉远到窄屏取景距离');
  assert(approx(narrowRight.getPose().distance, need), '右自身取景距离一致');
  assert(approx(left.getPose().azimuth, narrowRight.getPose().azimuth), 'refit 后方向仍一致');
  bridge.dispose();
}

console.log('10) 后挂载对齐与注销幂等（StrictMode 重挂载）');
{
  const bridge = new CameraBridge();
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  const unregL = bridge.register(left);
  bridge.setLinked(true);
  bridge.userChanged('left', { azimuth: 1.7, polar: 0.9, distance: 10 });
  const right = makeFakePort('right', { aspect: 1.6, mode: 'dipole' });
  bridge.register(right);
  assert(approx(right.getPose().azimuth, 1.7) && approx(right.getPose().distance, 10), '联动状态下后挂载侧立即对齐');
  // 旧端口重挂载：先注销再注册，注销幂等
  const unregR = bridge.register(right);
  unregR();
  unregR(); // 重复注销不影响后来者
  const right2 = makeFakePort('right', { aspect: 1.6, mode: 'dipole' });
  bridge.register(right2);
  assert(approx(right2.getPose().azimuth, 1.7), '替换挂载的新端口正常对齐');
  unregL();
  bridge.dispose();
}

console.log('11) 联动开关幂等 + 无端口安全');
{
  const bridge = new CameraBridge();
  bridge.setLinked(false); // 无端口不报错
  bridge.reset('left');
  bridge.refit('right');
  bridge.setLinked(true);
  bridge.setLinked(true); // 重复开启不重复对齐报错
  assert(bridge.isLinked(), '状态保持开启');
  const left = makeFakePort('left', { aspect: 1.6, mode: 'dipole' });
  bridge.register(left);
  bridge.userChanged('left', { ...DEFAULT_POSE, azimuth: 0.9 });
  assert(approx(left.getPose().azimuth, DEFAULT_POSE.azimuth), '只有一侧时联动不回写源侧以外');
  bridge.dispose();
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
