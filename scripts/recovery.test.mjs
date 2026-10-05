// 端到端验证：事件契约基线 → 发布候选 → 迁移确认 → 可恢复发布/回滚链
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const memory = new Map()
const installLocalStorage = () => {
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
  }
}
installLocalStorage()

const createEnvironment = async () => {
  const server = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    logLevel: 'error',
  })
  const [storeModule, checkpointModule] = await Promise.all([
    server.ssrLoadModule('/src/stores/governance.ts'),
    server.ssrLoadModule('/src/services/repository.ts'),
  ])
  const piniaModule = await import('pinia')
  return {
    server,
    // 全新环境：清空全部本地数据（相当于首次打开）
    freshStore: () => {
      memory.clear()
      const pinia = piniaModule.createPinia()
      piniaModule.setActivePinia(pinia)
      return storeModule.useGovernanceStore()
    },
    // 模拟页面刷新：保留已持久化的状态和检查点，仅重建 store 实例
    reopenStore: () => {
      const pinia = piniaModule.createPinia()
      piniaModule.setActivePinia(pinia)
      return storeModule.useGovernanceStore()
    },
    loadCheckpoint: checkpointModule.loadCheckpoint,
  }
}

let passed = 0
const test = async (name, fn) => {
  const env = await createEnvironment()
  try {
    await fn(env)
    passed += 1
    console.log(`  ✓ ${name}`)
  } finally {
    await env.server.close()
  }
}

/**
 * 让 rel-001 满足就绪度门禁：对齐 evt-001 基线字段类型，
 * evt-005 退役消除重复事件问题（evt-003 的类型变化保留，因为它正是需要 dep-004 迁移的信号）。
 */
const makeRel001Publishable = (store) => {
  store.data.baselines.find((b) => b.id === 'base-001').properties.find((p) => p.id === 'prop-001').type =
    'string'
  store.data.events.find((e) => e.id === 'evt-005').status = 'retired'
}

const approveAll = (release) =>
  release.approvals.forEach((a) => {
    a.status = 'approved'
    a.actor = a.actor || '负责人'
    a.comment = '通过'
    a.createdAt = new Date().toISOString()
  })

const confirmAll = (store, release) =>
  release.migrationConfirmations.forEach((c) =>
    store.confirmMigration(release.id, c.id, c.reviewer || '负责人', '已完成迁移'),
  )

// ---------------------------------------------------------------------------
await test('旧候选缺少基线快照时禁止发布，补齐后可继续', ({ freshStore }) => {
  const store = freshStore()
  const rel001 = store.data.releases.find((r) => r.id === 'rel-001')
  assert.equal(rel001.baselineSnapshots?.length ?? 0, 0, '种子未发布候选没有基线快照')
  makeRel001Publishable(store)
  approveAll(rel001)
  assert.equal(store.publishRelease('rel-001'), false, '缺少基线快照禁止发布')
  assert.notEqual(rel001.status, 'published')

  assert.equal(store.backfillReleaseBaselines('rel-001'), true)
  assert.equal(rel001.baselineSnapshots.length, 3, '补齐 3 个事件基线快照')
  confirmAll(store, rel001)
  assert.equal(store.publishRelease('rel-001'), true, '补齐快照且门禁满足后可发布')
  assert.equal(rel001.status, 'published')
})

await test('基线变化后未发布候选按变化字段重算，已通过迁移确认退回待确认', ({ freshStore }) => {
  const store = freshStore()
  const rel001 = store.data.releases.find((r) => r.id === 'rel-001')
  store.backfillReleaseBaselines('rel-001')
  // dep-004 引用 evt-003.page_no；先确认它的迁移
  const dep004Confirmed = rel001.migrationConfirmations.find((c) => c.dependencyId === 'dep-004')
  store.confirmMigration('rel-001', dep004Confirmed.id, '搜索数据组', 'page_no 已兼容')
  assert.equal(dep004Confirmed.status, 'confirmed')
  assert.ok(dep004Confirmed.changeSignature?.includes('page_no'), '确认时记录变化字段签名')

  // 修改事件契约：dep-004 引用的 query_id 发生类型变化，签名改变后确认退回待确认
  const evt003 = store.data.events.find((e) => e.id === 'evt-003')
  const queryId = evt003.properties.find((p) => p.id === 'prop-010')
  queryId.type = 'number'
  store.saveProperty('evt-003', { ...queryId })

  const refreshed = rel001.migrationConfirmations.find((c) => c.dependencyId === 'dep-004')
  // query_id 类型变化 → dep-004 变化签名改变 → 已确认退回待确认
  assert.equal(refreshed.status, 'pending', '变化字段上的已确认迁移退回待确认')
  assert.equal(refreshed.confirmedAt, undefined)
  assert.equal(
    store.data.dependencies.find((d) => d.id === 'dep-004').status,
    'migration_required',
    '下游依赖状态回到需要迁移',
  )
  assert.ok(
    rel001.differences
      .find((d) => d.eventId === 'evt-003')
      .typeChanges.some((t) => t.includes('query_id')),
    '差异按变化字段重算',
  )
  // dep-006（引用 evt-005/evt-006）不受 evt-003 变化影响，确认状态保留
  assert.ok(
    rel001.migrationConfirmations.some((c) => c.dependencyId === 'dep-006'),
    '无关依赖的迁移确认仍保留在候选中',
  )
})

await test('公开版本保留原基线快照，基线推进不改变其差异', ({ freshStore }) => {
  const store = freshStore()
  const rel000 = store.data.releases.find((r) => r.id === 'rel-000')
  const snapshotBefore = JSON.stringify(rel000.baselineSnapshots)
  // 推进 evt-002 基线
  const evt002 = store.data.events.find((e) => e.id === 'evt-002')
  store.data.baselines.unshift({
    id: 'base-new-002',
    eventId: 'evt-002',
    version: '2.2.0',
    properties: JSON.parse(JSON.stringify(evt002.properties)),
    createdAt: new Date().toISOString(),
    status: 'published',
  })
  store.reconcileOpenReleases()
  assert.equal(
    JSON.stringify(rel000.baselineSnapshots),
    snapshotBefore,
    '已发布版本的基线快照不随后续基线移动',
  )
  assert.equal(rel000.status, 'published')
})

await test('发布提交失败后从最后检查点恢复，不重复生成发布基线记录', ({
  freshStore,
  reopenStore,
  loadCheckpoint,
}) => {
  const store = freshStore()
  const rel001 = store.data.releases.find((r) => r.id === 'rel-001')
  makeRel001Publishable(store)
  store.backfillReleaseBaselines('rel-001')
  approveAll(rel001)
  confirmAll(store, rel001)

  const baselineCountBefore = store.data.baselines.length
  assert.equal(store.publishRelease('rel-001', true), false, '模拟提交失败')
  assert.ok(loadCheckpoint(), '失败后检查点保留')
  // 已写入修订：发布状态与基线已经落盘
  assert.equal(rel001.status, 'published')
  assert.equal(store.data.baselines.length, baselineCountBefore + 3, '发布基线修订已写入')

  // 重新进入（刷新页面）：新 store 实例自动从检查点恢复重放
  const store2 = reopenStore()
  assert.equal(loadCheckpoint(), null, '恢复后检查点清除')
  const replayed = store2.data.releases.find((r) => r.id === 'rel-001')
  assert.equal(replayed.status, 'published')
  const newBaselines = store2.data.baselines.filter((b) => b.releaseId === 'rel-001')
  assert.equal(newBaselines.length, 3, '重放没有重复生成发布基线记录')
  assert.equal(store2.data.releaseJournal.filter((j) => j.releaseId === 'rel-001').length, 1)
  assert.equal(store2.lastRecovery?.kind, 'publish')
})

await test('回滚提交失败重放不重复生成回滚记录，且保留检查点后写入的修订', ({
  freshStore,
  reopenStore,
}) => {
  const store = freshStore()
  const rel000 = store.data.releases.find((r) => r.id === 'rel-000')
  assert.equal(rel000.status, 'published')
  const rollbackCountBefore = store.data.rollbacks.length

  assert.equal(
    store.executeRollback('rel-000', '指标异常', '全端', 'INC-1', true),
    false,
    '回滚提交失败',
  )
  assert.equal(store.data.rollbacks.length, rollbackCountBefore + 1, '回滚记录修订已写入')

  // 提交失败后、恢复之前继续写入的契约修订在恢复后必须保留
  const evt004 = store.data.events.find((e) => e.id === 'evt-004')
  evt004.description = '检查点之后写入的修订'
  store.saveEvent({ ...evt004 })

  const store2 = reopenStore()
  assert.equal(
    store2.data.rollbacks.filter((r) => r.releaseId === 'rel-000').length,
    1,
    '重放不重复生成回滚记录',
  )
  assert.equal(store2.data.releases.find((r) => r.id === 'rel-000').status, 'rolled_back')
  assert.equal(store2.data.releaseJournal.filter((j) => j.releaseId === 'rel-000').length, 1)
  assert.equal(
    store2.data.events.find((e) => e.id === 'evt-004').description,
    '检查点之后写入的修订',
    '检查点后写入的修订保留',
  )
  assert.equal(store2.lastRecovery?.kind, 'rollback')
})

await test('同一检查点重复恢复是幂等的', ({ freshStore, reopenStore }) => {
  const store = freshStore()
  const rel000 = store.data.releases.find((r) => r.id === 'rel-000')
  store.executeRollback('rel-000', '异常', '全端', 'INC-2', true)
  // 连续两个新实例（模拟反复刷新），第二次不应再产生任何记录
  const store2 = reopenStore()
  const rollbacks2 = store2.data.rollbacks.filter((r) => r.releaseId === 'rel-000').length
  const store3 = reopenStore()
  const rollbacks3 = store3.data.rollbacks.filter((r) => r.releaseId === 'rel-000').length
  assert.equal(rollbacks2, 1)
  assert.equal(rollbacks3, 1, '多次恢复不重复生成回滚记录')
})

await test('发布推进基线后，引用同事件的未发布候选跟随新基线重算', ({ freshStore }) => {
  const store = freshStore()

  // 先创建候选 R1（含 evt-001），它相对 2.3.0 基线存在 order_id 类型差异，dep-001 需迁移
  const r1 = store.createRelease('2026.11.0', '十一月候选', ['evt-001'])
  const dep001InR1 = r1.migrationConfirmations.find((c) => c.dependencyId === 'dep-001')
  assert.ok(dep001InR1, 'R1 中 dep-001 受 order_id 类型变化影响')
  assert.ok(r1.differences[0].typeChanges.some((t) => t.includes('order_id')))
  assert.equal(
    r1.baselineSnapshots.find((s) => s.eventId === 'evt-001').baselineVersion,
    '2.3.0',
  )

  // 再准备 rel-001 门禁（不影响 R1 已冻结的快照）
  makeRel001Publishable(store)
  const rel001 = store.data.releases.find((r) => r.id === 'rel-001')
  store.backfillReleaseBaselines('rel-001')
  approveAll(rel001)
  confirmAll(store, rel001)
  assert.equal(store.publishRelease('rel-001'), true)

  // R1 作为未发布候选必须跟随新基线：order_id 差异消失，dep-001 不再需要迁移
  assert.equal(
    r1.baselineSnapshots.find((s) => s.eventId === 'evt-001').baselineVersion,
    '2.4.0',
    'R1 基线快照已推进到新发布版本',
  )
  assert.equal(
    r1.differences.find((d) => d.eventId === 'evt-001').typeChanges.length,
    0,
    'R1 按新基线重算，order_id 差异消失',
  )
  assert.equal(
    r1.migrationConfirmations.some((c) => c.dependencyId === 'dep-001'),
    false,
    '不再受影响的下游迁移确认被移除',
  )
})

console.log(`\n全部 ${passed} 项验证通过`)
