import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  DeprecationPlan,
  EventDefinition,
  EventProperty,
  GovernanceState,
  MigrationConfirmation,
  PendingReleaseOperation,
  PlatformRule,
  ReleaseApproval,
  ReleaseBaselineSnapshot,
  ReleaseCandidate,
} from '@/models/domain'
import {
  clearCheckpoint,
  createId,
  deepClone,
  loadCheckpoint,
  loadState,
  resetState,
  saveCheckpoint,
  saveState,
} from '@/services/repository'
import {
  buildReleasePlan,
  captureReleaseBaselines,
  dependencyChangeSignature,
  hasCompleteBaselineSnapshots,
  releaseReadiness,
  validateGovernance,
} from '@/services/selectors'

const isOpenRelease = (release: ReleaseCandidate): boolean =>
  release.status === 'draft' || release.status === 'reviewing' || release.status === 'approved'

export interface RecoveryNotice {
  operationId: string
  kind: 'publish' | 'rollback'
  releaseId: string
  version: string
  replayed: boolean
}

export const useGovernanceStore = defineStore('governance', () => {
  const data = ref<GovernanceState>(loadState())
  const lastSavedAt = ref(new Date().toISOString())
  /** 页面加载时若存在未完成检查点，记录恢复结果供界面提示 */
  const lastRecovery = ref<RecoveryNotice | null>(null)

  // ---------------------------------------------------------------------------
  // 持久化与审计
  // ---------------------------------------------------------------------------
  const persist = (): void => {
    saveState(data.value)
    lastSavedAt.value = new Date().toISOString()
  }

  const audit = (
    entityType: string,
    entityId: string,
    action: string,
    detail: string,
    operationId?: string,
  ): void => {
    data.value.audit.unshift({
      id: createId('aud'),
      entityType,
      entityId,
      action,
      actor: '当前用户',
      detail,
      createdAt: new Date().toISOString(),
      operationId,
    })
  }

  // ---------------------------------------------------------------------------
  // 发布候选与事件契约基线联动
  // ---------------------------------------------------------------------------
  /**
   * 按基线变化重算单个候选：以候选冻结的基线快照为基准重新生成差异和受影响下游，
   * 变化字段上的已通过迁移确认退回待确认；不再受影响的下游移除，新增的下游补单。
   * 纯状态计算，不写审计，保证恢复重放时结果确定、不重复产生审计记录。
   * 返回被退回待确认的依赖 id 列表。
   */
  const reconcileRelease = (release: ReleaseCandidate): string[] => {
    const snapshots = release.baselineSnapshots ?? []
    if (!hasCompleteBaselineSnapshots(release)) return []
    const plan = buildReleasePlan(data.value, release.eventIds, snapshots)
    const planChanged =
      JSON.stringify(plan.differences) !== JSON.stringify(release.differences) ||
      JSON.stringify(plan.affectedDependencyIds) !== JSON.stringify(release.affectedDependencyIds)

    const nextConfirmations: MigrationConfirmation[] = []
    const resetDependencies: string[] = []
    let confirmationsChanged = false
    plan.affectedDependencyIds.forEach((dependencyId) => {
      const signature = plan.signatures.get(dependencyId) ?? ''
      const existing = release.migrationConfirmations.find(
        (item) => item.dependencyId === dependencyId,
      )
      const dependency = data.value.dependencies.find((item) => item.id === dependencyId)
      if (!existing) {
        nextConfirmations.push({
          id: createId('mig'),
          dependencyId,
          version: release.version,
          status: 'pending',
          reviewer: dependency?.owner ?? '',
          note: '',
          changeSignature: signature,
        })
        confirmationsChanged = true
        return
      }
      const updated: MigrationConfirmation = { ...existing, changeSignature: signature }
      // 已确认但确认所依据的变化字段已经改变：退回待确认
      if (
        existing.status === 'confirmed' &&
        existing.changeSignature !== undefined &&
        existing.changeSignature !== signature
      ) {
        updated.status = 'pending'
        updated.note = ''
        updated.confirmedAt = undefined
        if (dependency) dependency.status = 'migration_required'
        resetDependencies.push(dependencyId)
      }
      if (
        existing.changeSignature !== signature ||
        existing.status !== updated.status
      ) {
        confirmationsChanged = true
      }
      nextConfirmations.push(updated)
    })
    if (release.migrationConfirmations.length !== nextConfirmations.length) confirmationsChanged = true
    if (!planChanged && !confirmationsChanged) return []

    release.differences = plan.differences
    release.affectedDependencyIds = plan.affectedDependencyIds
    release.migrationConfirmations = nextConfirmations
    release.recomputedAt = new Date().toISOString()
    return resetDependencies
  }

  /** 基线推进（发布）后：开放候选引用了该基线时冻结到新基线并重算；公开版本不动。 */
  const advanceReleaseBaselines = (): void => {
    data.value.releases.filter(isOpenRelease).forEach((release) => {
      const refreshed = captureReleaseBaselines(data.value, release.eventIds, new Date().toISOString())
      release.baselineSnapshots = release.eventIds.map(
        (eventId) => refreshed.find((snapshot) => snapshot.eventId === eventId)!,
      )
      reconcileRelease(release)
    })
  }

  const reconcileOpenReleases = (): string[] => {
    const reset: string[] = []
    data.value.releases.filter(isOpenRelease).forEach((release) => {
      reconcileRelease(release).forEach((dependencyId) => reset.push(dependencyId))
    })
    return [...new Set(reset)]
  }

  // ---------------------------------------------------------------------------
  // 事件契约编辑（编辑后让开放候选跟随基线/契约重算）
  // ---------------------------------------------------------------------------
  const recordRecomputeAudit = (resetDependencies: string[]): void => {
    if (resetDependencies.length === 0) return
    const names = resetDependencies
      .map(
        (dependencyId) =>
          data.value.dependencies.find((dependency) => dependency.id === dependencyId)?.name ??
          dependencyId,
      )
      .join('、')
    audit(
      'release_chain',
      'releases',
      '基线变化重算发布候选',
      `契约基线变化后，未发布候选已按变化字段重算；${names} 的迁移确认退回待确认。`,
    )
  }

  const saveEvent = (event: EventDefinition): void => {
    const index = data.value.events.findIndex((item) => item.id === event.id)
    const saved = { ...event, updatedAt: new Date().toISOString() }
    if (index >= 0) {
      data.value.events[index] = saved
    } else {
      data.value.events.unshift(saved)
    }
    audit('event', event.id, index >= 0 ? '更新事件' : '创建事件', `${event.key} 契约已保存`)
    recordRecomputeAudit(reconcileOpenReleases())
    persist()
  }

  const saveProperty = (eventId: string, property: EventProperty): void => {
    const event = data.value.events.find((item) => item.id === eventId)
    if (!event) return
    const index = event.properties.findIndex((item) => item.id === property.id)
    if (index >= 0) {
      event.properties[index] = property
    } else {
      event.properties.push(property)
    }
    event.updatedAt = new Date().toISOString()
    audit('property', property.id, index >= 0 ? '更新属性' : '新增属性', `${event.key}.${property.name}`)
    recordRecomputeAudit(reconcileOpenReleases())
    persist()
  }

  const deleteProperty = (eventId: string, propertyId: string): void => {
    const event = data.value.events.find((item) => item.id === eventId)
    const property = event?.properties.find((item) => item.id === propertyId)
    if (!event || !property) return
    property.deletedAt = new Date().toISOString()
    event.updatedAt = new Date().toISOString()
    audit('property', property.id, '标记删除', `${event.key}.${property.name} 进入删除兼容期`)
    recordRecomputeAudit(reconcileOpenReleases())
    persist()
  }

  const savePlatformRule = (eventId: string, rule: PlatformRule): void => {
    const event = data.value.events.find((item) => item.id === eventId)
    if (!event) return
    const index = event.platformRules.findIndex((item) => item.id === rule.id)
    if (index >= 0) {
      event.platformRules[index] = rule
    } else {
      event.platformRules.push(rule)
    }
    event.updatedAt = new Date().toISOString()
    audit('platform_rule', rule.id, index >= 0 ? '更新平台规则' : '新增平台规则', `${event.key}/${rule.platform}`)
    persist()
  }

  // ---------------------------------------------------------------------------
  // 发布候选
  // ---------------------------------------------------------------------------
  const createRelease = (version: string, title: string, eventIds: string[]): ReleaseCandidate => {
    const now = new Date().toISOString()
    const snapshots: ReleaseBaselineSnapshot[] = captureReleaseBaselines(data.value, eventIds, now)
    const plan = buildReleasePlan(data.value, eventIds, snapshots)
    const release: ReleaseCandidate = {
      id: createId('rel'),
      version,
      title,
      status: 'reviewing',
      eventIds,
      affectedDependencyIds: plan.affectedDependencyIds,
      differences: plan.differences,
      baselineSnapshots: snapshots,
      migrationConfirmations: plan.affectedDependencyIds.map((dependencyId) => ({
        id: createId('mig'),
        dependencyId,
        version,
        status: 'pending',
        reviewer:
          data.value.dependencies.find((dependency) => dependency.id === dependencyId)?.owner ?? '',
        note: '',
        changeSignature: plan.signatures.get(dependencyId) ?? '',
      })),
      approvals: [
        { id: createId('appr'), role: 'data', actor: '顾清', status: 'pending', comment: '' },
        { id: createId('appr'), role: 'product', actor: '丁禾', status: 'pending', comment: '' },
        { id: createId('appr'), role: 'client', actor: '江驰', status: 'pending', comment: '' },
        { id: createId('appr'), role: 'qa', actor: '余安', status: 'pending', comment: '' },
      ],
      createdAt: now,
    }
    data.value.releases.unshift(release)
    data.value.currentVersion = version
    audit(
      'release',
      release.id,
      '创建发布候选',
      `${version} 包含 ${eventIds.length} 个事件，影响 ${plan.affectedDependencyIds.length} 个下游依赖`,
    )
    persist()
    return release
  }

  /** 旧候选缺少基线快照时先补齐：以当前基线冻结，随后按变化字段重算。 */
  const backfillReleaseBaselines = (releaseId: string): boolean => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    if (!release || hasCompleteBaselineSnapshots(release)) return false
    const now = new Date().toISOString()
    release.baselineSnapshots = captureReleaseBaselines(data.value, release.eventIds, now)
    const resetDependencies = reconcileRelease(release)
    audit(
      'release',
      release.id,
      '补齐基线快照',
      `${release.version} 已冻结 ${release.eventIds.length} 个事件的基线快照${resetDependencies.length > 0 ? '，变化字段上的迁移确认已退回待确认' : ''}。`,
    )
    persist()
    return true
  }

  const confirmMigration = (
    releaseId: string,
    confirmationId: string,
    reviewer: string,
    note: string,
  ): void => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    const confirmation = release?.migrationConfirmations.find((item) => item.id === confirmationId)
    if (!release || !confirmation) return
    confirmation.status = 'confirmed'
    confirmation.reviewer = reviewer
    confirmation.note = note
    confirmation.confirmedAt = new Date().toISOString()
    confirmation.changeSignature = dependencyChangeSignature(
      data.value,
      confirmation.dependencyId,
      release.differences,
      release.baselineSnapshots ?? [],
    )
    const dependency = data.value.dependencies.find((item) => item.id === confirmation.dependencyId)
    if (dependency) dependency.status = 'migrated'
    audit('dependency', confirmation.dependencyId, '确认迁移', `${reviewer}：${note}`)
    persist()
  }

  const updateApproval = (
    releaseId: string,
    role: ReleaseApproval['role'],
    status: ReleaseApproval['status'],
    actor: string,
    comment: string,
  ): void => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    const approval = release?.approvals.find((item) => item.role === role)
    if (!approval) return
    approval.status = status
    approval.actor = actor
    approval.comment = comment
    approval.createdAt = new Date().toISOString()
    audit('release', releaseId, status === 'approved' ? '审批通过' : '审批驳回', `${role}：${comment}`)
    persist()
  }

  // ---------------------------------------------------------------------------
  // 可恢复发布链：检查点 + 幂等重放
  // ---------------------------------------------------------------------------
  /** 幂等地施加一次发布操作；重放命中操作日志或已发布状态时不再生成任何记录。 */
  const applyPendingOperation = (pending: PendingReleaseOperation): void => {
    const release = data.value.releases.find((item) => item.id === pending.releaseId)
    if (!release) return

    // 剔除上次失败尝试已写入的本操作审计，避免重放重复
    data.value.audit = data.value.audit.filter(
      (entry) => entry.operationId !== pending.operationId,
    )

    if (pending.kind === 'publish') {
      if (release.status !== 'published' && !release.publishedAt) {
        release.status = 'published'
        release.publishedAt = pending.createdAt
      }
      release.eventIds.forEach((eventId) => {
        const event = data.value.events.find((item) => item.id === eventId)
        const baselineExists = data.value.baselines.some(
          (baseline) => baseline.operationId === pending.operationId && baseline.eventId === eventId,
        )
        if (event && !baselineExists) {
          data.value.baselines.unshift({
            id: createId('base'),
            eventId,
            version: event.version,
            properties: deepClone(event.properties),
            createdAt: pending.createdAt,
            status: 'published',
            releaseId: release.id,
            operationId: pending.operationId,
          })
        }
        if (event) event.status = 'published'
      })
      audit('release', release.id, '发布契约', `${release.version} 已发布`, pending.operationId)
      advanceReleaseBaselines()
      return
    }

    // rollback：回滚记录按 operationId 幂等，重放不重复生成
    const existingRecord = data.value.rollbacks.find(
      (record) => record.operationId === pending.operationId,
    )
    if (!existingRecord) {
      data.value.rollbacks.unshift({
        id: createId('rollback'),
        releaseId: pending.releaseId,
        version: pending.version,
        reason: pending.reason ?? '',
        operator: '当前用户',
        scope: pending.scope ?? '',
        createdAt: pending.createdAt,
        status: 'executed',
        evidence: pending.evidence ?? '',
        operationId: pending.operationId,
      })
    }
    release.status = 'rolled_back'
    audit(
      'rollback',
      existingRecord?.id ?? pending.releaseId,
      '执行回滚',
      `${release.version}：${pending.reason ?? ''}`,
      pending.operationId,
    )
  }

  /**
   * 从最后一个完整检查点恢复：
   * 检查点之后写入的修订不丢（先应用到检查点状态），再幂等重放未完成操作，
   * 已写入操作日志或已生效的部分直接跳过，不重复生成发布/回滚记录。
   */
  const recoverFromCheckpoint = (): RecoveryNotice | null => {
    const checkpoint = loadCheckpoint()
    if (!checkpoint) return null
    const committed = data.value.releaseJournal.some(
      (entry) => entry.operationId === checkpoint.operationId,
    )
    if (committed) {
      clearCheckpoint()
      return null
    }

    // 以最后一个完整检查点状态为底本；检查点之后写入的修订继续保留
    const restored = deepClone(checkpoint.state)
    const checkpointTime = new Date(checkpoint.createdAt).getTime()
    const isAfterCheckpoint = (timestamp?: string): boolean =>
      Boolean(timestamp && new Date(timestamp).getTime() > checkpointTime)

    // 检查点之后产生的审计、回滚记录（不含本操作的重复产物）和废弃修订继续保留
    restored.audit = [
      ...data.value.audit.filter(
        (entry) => isAfterCheckpoint(entry.createdAt) && entry.operationId !== checkpoint.operationId,
      ),
      ...restored.audit,
    ]
    restored.rollbacks = [
      ...data.value.rollbacks.filter(
        (record) => isAfterCheckpoint(record.createdAt) && record.operationId !== checkpoint.operationId,
      ),
      ...restored.rollbacks,
    ]
    // 废弃计划不属于发布/回滚操作的写入范围，保留检查点之后的当前修订
    restored.deprecations = data.value.deprecations
    restored.currentVersion = data.value.currentVersion
    restored.releaseJournal = data.value.releaseJournal

    // 已写入的契约修订（事件/属性）保留：用检查点之后的当前契约覆盖检查点底本
    data.value.events.forEach((currentEvent) => {
      if (!isAfterCheckpoint(currentEvent.updatedAt)) return
      const index = restored.events.findIndex((item) => item.id === currentEvent.id)
      if (index >= 0) restored.events[index] = deepClone(currentEvent)
      else restored.events.push(deepClone(currentEvent))
    })
    data.value = restored

    applyPendingOperation(checkpoint.pending)
    data.value.releaseJournal.unshift({
      operationId: checkpoint.operationId,
      kind: checkpoint.pending.kind,
      releaseId: checkpoint.pending.releaseId,
      version: checkpoint.pending.version,
      committedAt: new Date().toISOString(),
      replayed: true,
    })
    audit(
      'release_chain',
      checkpoint.pending.releaseId,
      '从检查点恢复提交',
      `${checkpoint.pending.kind === 'publish' ? '发布' : '回滚'} ${checkpoint.pending.version} 已从最后完整检查点重放，检查点后写入的修订已保留。`,
    )
    persist()
    clearCheckpoint()
    return {
      operationId: checkpoint.operationId,
      kind: checkpoint.pending.kind,
      releaseId: checkpoint.pending.releaseId,
      version: checkpoint.pending.version,
      replayed: true,
    }
  }

  lastRecovery.value = recoverFromCheckpoint()

  /**
   * 建立检查点后执行发布链操作。failCommit=true 时模拟提交阶段失败：
   * 操作修订已经写入，但检查点保留，下一次动作或重新进入页面时从检查点恢复重放。
   */
  const runRecoverable = (
    kind: 'publish' | 'rollback',
    releaseId: string,
    payload: {
      reason?: string
      scope?: string
      evidence?: string
      failCommit?: boolean
    },
  ): { ok: boolean; operationId: string; recovered: boolean } => {
    // 进入前先恢复可能存在的失败检查点，保留已写入修订并重放未完成操作
    const recovery = recoverFromCheckpoint()
    if (recovery) lastRecovery.value = recovery

    const release = data.value.releases.find((item) => item.id === releaseId)
    if (!release) return { ok: false, operationId: '', recovered: Boolean(recovery) }

    const operationId = createId(kind === 'publish' ? 'pub' : 'rbtx')
    const createdAt = new Date().toISOString()
    const pending: PendingReleaseOperation = {
      operationId,
      kind,
      releaseId,
      version: release.version,
      createdAt,
      reason: payload.reason,
      scope: payload.scope,
      evidence: payload.evidence,
      failCommit: payload.failCommit,
    }
    // 最后一个完整检查点：操作开始前的全量状态
    saveCheckpoint({
      operationId,
      state: deepClone(data.value),
      pending,
      createdAt,
    })

    applyPendingOperation(pending)
    persist() // 已写入修订在此落盘，即使后续提交失败也会保留

    if (payload.failCommit) {
      return { ok: false, operationId, recovered: Boolean(recovery) }
    }

    data.value.releaseJournal.unshift({
      operationId,
      kind,
      releaseId,
      version: release.version,
      committedAt: new Date().toISOString(),
      replayed: false,
    })
    persist()
    clearCheckpoint()
    return { ok: true, operationId, recovered: Boolean(recovery) }
  }

  const publishRelease = (releaseId: string, failCommit = false): boolean => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    if (!release) return false
    if (!hasCompleteBaselineSnapshots(release)) return false
    const resetDependencies = reconcileRelease(release)
    if (resetDependencies.length > 0) recordRecomputeAudit(resetDependencies)
    const readiness = releaseReadiness(release, issues.value)
    const migrationsReady = release.migrationConfirmations.every((item) => item.status === 'confirmed')
    const approvalsReady = release.approvals.every((item) => item.status === 'approved')
    if (resetDependencies.length > 0 || readiness < 90 || !migrationsReady || !approvalsReady) {
      if (resetDependencies.length > 0) persist()
      return false
    }
    const result = runRecoverable('publish', releaseId, { failCommit })
    return result.ok
  }

  // ---------------------------------------------------------------------------
  // 废弃与回滚
  // ---------------------------------------------------------------------------
  const saveDeprecation = (plan: DeprecationPlan): void => {
    const index = data.value.deprecations.findIndex((item) => item.id === plan.id)
    if (index >= 0) {
      data.value.deprecations[index] = plan
    } else {
      data.value.deprecations.unshift(plan)
    }
    const event = data.value.events.find((item) => item.id === plan.eventId)
    if (event && plan.status === 'stopped') event.status = 'deprecated'
    if (event && plan.status === 'retired') event.status = 'retired'
    audit('deprecation', plan.id, '更新废弃计划', `${event?.key ?? plan.eventId}：${plan.status}`)
    persist()
  }

  const executeRollback = (
    releaseId: string,
    reason: string,
    scope: string,
    evidence: string,
    failCommit = false,
  ): boolean => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    if (!release || release.status !== 'published') return false
    const result = runRecoverable('rollback', releaseId, { reason, scope, evidence, failCommit })
    return result.ok
  }

  const verifyRollback = (rollbackId: string, evidence: string): void => {
    const record = data.value.rollbacks.find((item) => item.id === rollbackId)
    if (!record) return
    record.status = 'verified'
    record.evidence = evidence
    audit('rollback', record.id, '验证回滚', evidence)
    persist()
  }

  const resetDemo = (): void => {
    data.value = resetState()
    lastRecovery.value = null
    lastSavedAt.value = new Date().toISOString()
  }

  const exportContract = (eventIds?: string[]): string => {
    const selectedEvents = eventIds
      ? data.value.events.filter((event) => eventIds.includes(event.id))
      : data.value.events
    return JSON.stringify(
      {
        version: data.value.currentVersion,
        generatedAt: new Date().toISOString(),
        events: selectedEvents.map((event) => ({
          key: event.key,
          displayName: event.displayName,
          version: event.version,
          trigger: event.trigger,
          platforms: event.platformRules.map((rule) => ({
            platform: rule.platform,
            enabled: rule.enabled,
            trigger: rule.trigger,
          })),
          properties: event.properties
            .filter((property) => !property.deletedAt)
            .map(({ name, type, required, enumValues, description }) => ({
              name,
              type,
              required,
              enumValues,
              description,
            })),
        })),
      },
      null,
      2,
    )
  }

  const issues = computed(() => validateGovernance(data.value))

  return {
    data,
    lastSavedAt,
    lastRecovery,
    issues,
    saveEvent,
    saveProperty,
    deleteProperty,
    savePlatformRule,
    createRelease,
    backfillReleaseBaselines,
    reconcileOpenReleases,
    confirmMigration,
    updateApproval,
    publishRelease,
    saveDeprecation,
    executeRollback,
    verifyRollback,
    resetDemo,
    exportContract,
  }
})
