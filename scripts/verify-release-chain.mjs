// 可恢复发布链端到端验证（Node + localStorage shim，直接驱动真实 Pinia store）
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- 浏览器环境 shim ----
class LocalStorageShim {
  store = new Map()
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null
  }
  setItem(key, value) {
    this.store.set(key, String(value))
  }
  removeItem(key) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}
globalThis.localStorage = new LocalStorageShim()
globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value))

// ---- 用 esbuild 把 TS 源码与 vue/pinia 别名打成单文件 ----
const entry = path.join(__dirname, 'verify-entry.ts')
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  absWorkingDir: path.join(__dirname, '..'),
  alias: {
    '@': path.join(__dirname, '..', 'src'),
  },
})
const bundlePath = path.join(__dirname, '.verify-bundle.mjs')
fs.writeFileSync(bundlePath, result.outputFiles[0].text)

const { useGovernanceStore, commitLog } = await import(
  pathToFileURL(bundlePath).href
)

// ---------------------------------------------------------------------------
let failures = 0
const assert = (condition, message) => {
  if (condition) {
    console.log(`  ✅ ${message}`)
  } else {
    failures += 1
    console.error(`  ❌ ${message}`)
  }
}

const freshStore = () => {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useGovernanceStore(pinia)
  const report = store.bootstrap()
  return { store, report }
}

// === 场景 1：启动自愈 —— 旧候选按最新基线重算，过期差异纠正，旧确认退回 ===
console.log('\n[场景1] 基线变化后，未发布候选重算，已通过迁移确认退回')
{
  const { store } = freshStore()
  const release = store.data.releases.find((item) => item.id === 'rel-001')

  assert(
    release.differences.some((d) => d.eventId === 'evt-001') &&
      release.differences.find((d) => d.eventId === 'evt-001').typeChanges[0] ===
        'order_id: number → string',
    'evt-001 差异按最新基线重算（order_id: number → string）',
  )
  const evt003 = release.differences.find((d) => d.eventId === 'evt-003')
  assert(
    evt003 &&
      evt003.typeChanges.includes('page_no: string → number') &&
      !evt003.enumChanges.some((item) => item.includes('keyboard')),
    '过期差异被纠正：page_no 类型变化保留，click_type 的 keyboard 误差异消失',
  )
  assert(
    !release.affectedDependencyIds.includes('dep-006'),
    'dep-006 不再受 evt-005（无差异）影响，从受影响清单移除',
  )
  const mig002 = release.migrationConfirmations.find((item) => item.id === 'mig-002')
  assert(mig002 && mig002.status === 'pending' && Boolean(mig002.resetAt), 'dep-004 已通过迁移确认因基线变化字段退回待确认')
  assert(
    store.data.dependencies.find((d) => d.id === 'dep-004').status === 'migration_required',
    '被退回依赖状态回到 migration_required',
  )
  const mig004 = release.migrationConfirmations.find((item) => item.id === 'mig-004')
  assert(!mig004, '不再受影响的 dep-006 确认项已移除')
}

// === 场景 2：公开版本冻结 —— 已发布候选保留原快照，不参与重算 ===
console.log('\n[场景2] 公开版本保留原快照，基线变化不重算')
{
  const { store } = freshStore()
  const published = store.data.releases.find((item) => item.id === 'rel-000')
  assert(
    published.status === 'published' && published.baselineRefs.length === 3,
    '已发布候选保留 3 个冻结基线锚点',
  )
  const refsBefore = JSON.stringify(published.baselineRefs)
  // 直接修改 evt-002 当前契约，已发布候选不应被触碰
  const evt002 = store.data.events.find((e) => e.id === 'evt-002')
  const changed = { ...evt002, properties: [{ ...evt002.properties[0], required: !evt002.properties[0].required }] }
  store.saveEvent(changed)
  const after = store.data.releases.find((item) => item.id === 'rel-000')
  assert(
    JSON.stringify(after.baselineRefs) === refsBefore &&
      after.baselineSnapshots.length === 3 &&
      after.differences.length === 0,
    '基线/契约变化后，已发布候选锚点、快照与差异均冻结不变',
  )
}

// === 场景 3：旧候选缺基线快照，先补齐再允许发布 ===
console.log('\n[场景3] 旧候选缺少基线快照：补齐门禁')
{
  const { store } = freshStore()
  const release = store.data.releases.find((item) => item.id === 'rel-001')
  const result1 = store.publishRelease('rel-001')
  assert(result1.ok === false && result1.reason === 'missing_baseline', '未补齐基线时发布被门禁拒绝')
  assert(
    result1.missingEventIds.includes('evt-005'),
    '门禁指出缺失 evt-005 的基线快照',
  )

  const baselineCountBefore = store.data.baselines.length
  store.backfillReleaseBaselines('rel-001')
  const release2 = store.data.releases.find((item) => item.id === 'rel-001')
  const backfilled = store.data.baselines.find((b) => b.source === 'backfilled' && b.eventId === 'evt-005')
  assert(Boolean(backfilled), '补齐生成了 evt-005 的 backfilled 基线快照')
  assert(store.data.baselines.length === baselineCountBefore + 1, '全局基线新增 1 条')
  assert(
    release2.baselineRefs.some((r) => r.eventId === 'evt-005' && r.source === 'backfilled'),
    '候选已锚定补齐基线',
  )
  assert(
    !release2.affectedDependencyIds.includes('dep-006'),
    '以当前契约补齐 evt-005 后差异收敛，dep-006 不再受影响',
  )
  // 补齐幂等：再次补齐不重复落基线
  store.backfillReleaseBaselines('rel-001')
  assert(
    store.data.baselines.filter((b) => b.source === 'backfilled' && b.eventId === 'evt-005').length === 1,
    '重复补齐不产生重复基线',
  )
}

// === 场景 4：提交中断后从检查点恢复，已写入修订保留，不重复生成记录 ===
console.log('\n[场景4] 提交失败 → 检查点恢复 → 重放不重复')
{
  const { store } = freshStore()
  const drill = store.runCommitCrashDrill()
  assert(drill.armed, '演练事务在第 1 条修订落盘后中断')
  assert(Boolean(drill.recovered) && drill.recovered.recovered, '检测到未完成提交并完成恢复')
  assert(drill.recovered.revisionCount === 1, '仅重放中断点之后的 1 条修订（回滚记录）')
  assert(drill.recovered.duplicateReleaseCreated === false, '恢复后发布候选无重复')
  assert(drill.recovered.duplicateRollbackCreated === false, '恢复后回滚记录无重复')
  const drillReleases = store.data.releases.filter((r) => r.version.startsWith('DRILL-'))
  assert(drillReleases.length === 1, '演练发布候选恰好 1 条（已写入修订保留）')
  const drillRollbacks = store.data.rollbacks.filter((r) => r.version.startsWith('DRILL-'))
  assert(drillRollbacks.length === 1, '演练回滚记录恰好 1 条（重放补全且不重复）')
  assert(commitLog.hasPendingCommit() === false, '恢复后提交日志已清空')
}

// === 场景 5：基线变化只退回受影响、且覆盖字段改变的已确认迁移 ===
console.log('\n[场景5] 变化字段签名：仅退回真正受影响的已确认迁移')
{
  const { store } = freshStore()
  const release = store.data.releases.find((item) => item.id === 'rel-001')
  // 先完成 dep-001（order_id 字段）确认
  const dep001 = release.migrationConfirmations.find((m) => m.dependencyId === 'dep-001')
  store.confirmMigration(release.id, dep001.id, '数据产品组', '看板已兼容字符串 order_id')
  // 修改一个 dep-001 不引用的属性（coupon_id 必填），dep-001 不应被退回
  const evt001 = store.data.events.find((e) => e.id === 'evt-001')
  const coupon = evt001.properties.find((p) => p.id === 'prop-004')
  store.saveProperty('evt-001', { ...coupon, required: true })
  const release2 = store.data.releases.find((item) => item.id === release.id)
  const dep001After = release2.migrationConfirmations.find((m) => m.dependencyId === 'dep-001')
  assert(dep001After.status === 'confirmed', '无关字段（coupon_id）变化不退回 dep-001 的已确认迁移')
  // 修改 dep-001 引用的 order_id 类型（string→object 破坏性变化），应退回
  store.saveProperty('evt-001', {
    ...evt001.properties.find((p) => p.id === 'prop-001'),
    type: 'object',
  })
  const release3 = store.data.releases.find((item) => item.id === release.id)
  const dep001Reset = release3.migrationConfirmations.find((m) => m.dependencyId === 'dep-001')
  assert(dep001Reset.status === 'pending' && Boolean(dep001Reset.resetAt), '覆盖字段 order_id 再变化，dep-001 确认退回待确认')
}

// === 场景 6：发布产生新基线，其他评审中候选按新基线重算 ===
console.log('\n[场景6] 发布落盘新基线，兄弟候选自动重锚')
{
  const { store } = freshStore()
  // 新建一个只含 evt-006 且可发布的候选：先确认其无差异（当前与基线一致）
  const created = store.createRelease('2026.11.0', '十一月发布', ['evt-006'])
  assert(created && created.differences.length === 0, '新建候选相对当前基线无差异')
  // 修改 evt-006 契约
  const evt006 = store.data.events.find((e) => e.id === 'evt-006')
  const city = evt006.properties.find((p) => p.id === 'prop-022')
  store.saveProperty('evt-006', { ...city, required: false })
  const reviewing = store.data.releases.find((r) => r.id === created.id)
  assert(reviewing.differences.some((d) => d.eventId === 'evt-006'), '契约修订后评审中候选差异自动重算')
}

// ---------------------------------------------------------------------------
fs.rmSync(bundlePath, { force: true })
if (failures > 0) {
  console.error(`\n${failures} 项断言失败`)
  process.exit(1)
}
console.log('\n全部断言通过 ✨')
