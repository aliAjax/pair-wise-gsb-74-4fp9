import type {
  AuditEvent,
  ContractDifference,
  DownstreamDependency,
  EventVersionSnapshot,
  GovernanceState,
  MigrationConfirmation,
  ReleaseBaselineRef,
  ReleaseCandidate,
  ReleaseReconcilePatch,
} from '@/models/domain'
import { createId } from '@/services/repository'
import { compareEventContract, latestBaseline } from '@/services/selectors'

/** 差异中发生变化的属性名（增删 / 必填 / 类型 / 枚举均视为变化） */
export const changedPropertyNames = (difference: ContractDifference): string[] => {
  const names = [
    ...difference.addedProperties,
    ...difference.removedProperties,
    ...difference.requiredChanges.map((item) => item.split(':')[0]?.trim() ?? ''),
    ...difference.typeChanges.map((item) => item.split(':')[0]?.trim() ?? ''),
    ...difference.enumChanges.map((item) => item.split(':')[0]?.trim() ?? ''),
  ]
  return [...new Set(names.filter(Boolean))]
}

const signatureParts = (difference: ContractDifference, name: string): string[] => {
  const parts: string[] = []
  if (difference.addedProperties.includes(name)) parts.push('added')
  if (difference.removedProperties.includes(name)) parts.push('removed')
  difference.requiredChanges
    .filter((item) => item.startsWith(`${name}:`))
    .forEach((item) => parts.push(`required(${item.split(':').slice(1).join(':').trim()})`))
  difference.typeChanges
    .filter((item) => item.startsWith(`${name}:`))
    .forEach((item) => parts.push(`type(${item.split(':').slice(1).join(':').trim()})`))
  difference.enumChanges
    .filter((item) => item.startsWith(`${name}:`))
    .forEach((item) => parts.push(`enum(${item.split(':').slice(1).join(':').trim()})`))
  return parts
}

/**
 * 依赖在本次差异中实际引用到的变化字段签名。
 * 签名带变化指纹（类型 / 必填 / 枚举的目标值），
 * 同一字段连续两次以不同方式变化时签名不同，可正确退回已确认迁移。
 */
export const dependencyChangedFields = (
  state: GovernanceState,
  dependency: DownstreamDependency,
  differences: ContractDifference[],
): string[] => {
  const diffByEvent = new Map(differences.map((difference) => [difference.eventId, difference]))
  const keys = new Set<string>()

  dependency.propertyRefs.forEach((reference) => {
    const difference = diffByEvent.get(reference.eventId)
    if (!difference) return
    const event = state.events.find((item) => item.id === reference.eventId)
    const fromEvent = event?.properties.find((item) => item.id === reference.propertyId)?.name
    const fromBaseline = latestBaseline(state.baselines, reference.eventId)?.properties.find(
      (item) => item.id === reference.propertyId,
    )?.name
    const name = fromEvent ?? fromBaseline
    if (!name) return
    signatureParts(difference, name).forEach((part) =>
      keys.add(`${reference.eventId}.${name}#${part}`),
    )
  })
  return [...keys].sort()
}

const sameStringSet = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index])

const makeConfirmation = (
  release: ReleaseCandidate,
  dependencyId: string,
  changedFields: string[],
): MigrationConfirmation => ({
  id: createId('mig'),
  dependencyId,
  version: release.version,
  status: 'pending',
  reviewer:
    // 沿用同依赖既往确认人的登记，便于退回后重新确认
    release.migrationConfirmations.find((item) => item.dependencyId === dependencyId)?.reviewer ??
    '',
  note: '',
  changedFields,
})

export interface ReconcileResult {
  patch: ReleaseReconcilePatch
  audits: AuditEvent[]
  resetDependencyIds: string[]
}

/**
 * 为单个评审中候选生成「当前契约 vs 候选冻结基线」的幂等重算补丁。
 * - 基线锚点与快照保留候选创建（或补齐）时刻的版本，不重新锚定；
 * - 基线变化（事件契约修订）后，未发布候选按变化字段重算差异；
 * - 已确认迁移仅在其覆盖字段的变化指纹改变时退回待确认；
 * - 已发布 / 已回滚候选在调用前已被过滤，公开版本永不参与重算。
 * 无任何语义变化时返回 null。
 */
export const buildReconcilePatch = (
  state: GovernanceState,
  release: ReleaseCandidate,
  now: string,
): ReconcileResult | null => {
  if (release.status !== 'reviewing') return null

  // 锚点与快照保持冻结；仅补齐此前缺失的锚点（旧候选发布前补齐后首次重算）
  const refs: ReleaseBaselineRef[] = structuredClone(release.baselineRefs ?? [])
  const snapshots: EventVersionSnapshot[] = structuredClone(release.baselineSnapshots ?? [])
  release.eventIds.forEach((eventId) => {
    if (refs.some((ref) => ref.eventId === eventId)) return
    const baseline = latestBaseline(state.baselines, eventId)
    if (!baseline) return
    refs.push({
      eventId,
      baselineId: baseline.id,
      version: baseline.version,
      source: baseline.source ?? 'release',
      linkedAt: now,
    })
    snapshots.push(structuredClone(baseline))
  })

  const baselineById = new Map(snapshots.map((snapshot) => [snapshot.eventId, snapshot]))
  const differences: ContractDifference[] = []
  release.eventIds.forEach((eventId) => {
    const event = state.events.find((item) => item.id === eventId)
    if (!event) return
    const difference = compareEventContract(event, baselineById.get(eventId))
    const hasChange =
      difference.addedProperties.length > 0 ||
      difference.removedProperties.length > 0 ||
      difference.requiredChanges.length > 0 ||
      difference.typeChanges.length > 0 ||
      difference.enumChanges.length > 0
    if (hasChange) differences.push(difference)
  })

  const changedNamesByEvent = new Map<string, Set<string>>()
  differences.forEach((difference) => {
    changedNamesByEvent.set(difference.eventId, new Set(changedPropertyNames(difference)))
  })

  // 当前受影响依赖：propertyRef 命中变化字段
  const affected = state.dependencies
    .filter((dependency) =>
      dependency.propertyRefs.some((reference) => {
        const names = changedNamesByEvent.get(reference.eventId)
        if (!names || names.size === 0) return false
        const event = state.events.find((item) => item.id === reference.eventId)
        const fromEvent = event?.properties.find((item) => item.id === reference.propertyId)?.name
        const fromBaseline = latestBaseline(state.baselines, reference.eventId)?.properties.find(
          (item) => item.id === reference.propertyId,
        )?.name
        const name = fromEvent ?? fromBaseline
        return Boolean(name && names.has(name))
      }),
    )
    .map((dependency) => dependency.id)

  // 对齐迁移确认项：新增 / 退回 / 移除
  const existingByDependency = new Map(
    release.migrationConfirmations.map((item) => [item.dependencyId, item]),
  )
  const upsertConfirmations: MigrationConfirmation[] = []
  const removeConfirmationIds: string[] = []
  const dependencyStatus: Array<{ dependencyId: string; status: DownstreamDependency['status'] }> = []
  const resetDependencyIds: string[] = []
  const audits: AuditEvent[] = []

  affected.forEach((dependencyId) => {
    const dependency = state.dependencies.find((item) => item.id === dependencyId)
    if (!dependency) return
    const fields = dependencyChangedFields(state, dependency, differences)
    const previous = existingByDependency.get(dependencyId)

    if (!previous) {
      upsertConfirmations.push(makeConfirmation(release, dependencyId, fields))
      dependencyStatus.push({ dependencyId, status: 'migration_required' })
      return
    }

    const previousFields = previous.changedFields ?? []
    if (previous.status === 'confirmed' && !sameStringSet(previousFields, fields)) {
      // 覆盖字段发生变化：已通过的迁移确认退回待确认
      const reset: MigrationConfirmation = {
        ...previous,
        status: 'pending',
        changedFields: fields,
        resetNote:
          previousFields.length === 0
            ? '事件契约基线已变化，迁移确认缺少变化字段登记，按新差异退回待确认。'
            : `事件契约基线已变化（${fields.join('、') || '差异调整'}），原迁移确认退回待确认。`,
        resetAt: now,
      }
      upsertConfirmations.push(reset)
      resetDependencyIds.push(dependencyId)
      dependencyStatus.push({ dependencyId, status: 'migration_required' })
      audits.push({
        id: `${previous.id}-reset-${now.slice(0, 19)}`,
        entityType: 'dependency',
        entityId: dependencyId,
        action: '退回迁移确认',
        actor: '系统',
        detail: `发布候选 ${release.version} 基线重算，${dependency.name} 原确认覆盖字段已变化，退回待确认。`,
        createdAt: now,
      })
    } else {
      // 未确认项同步最新字段签名；已确认且字段未变则保留
      const fieldsChanged = !sameStringSet(previousFields, fields)
      if (fieldsChanged) {
        upsertConfirmations.push({ ...previous, changedFields: fields })
      }
    }
  })

  release.migrationConfirmations.forEach((confirmation) => {
    if (!affected.includes(confirmation.dependencyId)) {
      removeConfirmationIds.push(confirmation.id)
    }
  })

  const refsUnchanged =
    release.baselineRefs &&
    refs.length === release.baselineRefs.length &&
    refs.every((ref) =>
      release.baselineRefs!.some(
        (existing) =>
          existing.eventId === ref.eventId &&
          existing.baselineId === ref.baselineId &&
          existing.version === ref.version,
      ),
    )
  const diffUnchanged = JSON.stringify(release.differences ?? []) === JSON.stringify(differences)
  const affectedUnchanged =
    JSON.stringify([...(release.affectedDependencyIds ?? [])].sort()) ===
    JSON.stringify([...affected].sort())
  const confirmationsUnchanged =
    upsertConfirmations.length === 0 && removeConfirmationIds.length === 0

  if (refsUnchanged && diffUnchanged && affectedUnchanged && confirmationsUnchanged) return null

  return {
    patch: {
      refs,
      snapshots,
      differences,
      affectedDependencyIds: affected,
      upsertConfirmations,
      removeConfirmationIds,
      dependencyStatus,
    },
    audits,
    resetDependencyIds,
  }
}

/** 为候选中缺少基线的事件补齐基线快照（旧候选发布前必经步骤） */
export const buildBackfill = (
  state: GovernanceState,
  release: ReleaseCandidate,
  now: string,
): {
  refs: ReleaseBaselineRef[]
  snapshots: EventVersionSnapshot[]
  audits: AuditEvent[]
  eventIds: string[]
} => {
  const refs: ReleaseBaselineRef[] = []
  const snapshots: EventVersionSnapshot[] = []
  const audits: AuditEvent[] = []
  const existingEventIds = new Set((release.baselineRefs ?? []).map((ref) => ref.eventId))

  release.eventIds.forEach((eventId) => {
    if (existingEventIds.has(eventId)) return
    const event = state.events.find((item) => item.id === eventId)
    if (!event) return
    const snapshotId = createId('base')
    snapshots.push({
      id: snapshotId,
      eventId,
      version: event.version,
      properties: structuredClone(event.properties),
      createdAt: now,
      status: 'published',
      source: 'backfilled',
    })
    refs.push({
      eventId,
      baselineId: snapshotId,
      version: event.version,
      source: 'backfilled',
      linkedAt: now,
    })
    audits.push({
      id: `${snapshotId}-audit`,
      entityType: 'baseline',
      entityId: snapshotId,
      action: '补齐基线快照',
      actor: '当前用户',
      detail: `${event.key} 缺少历史基线，发布候选 ${release.version} 发布前按当前契约补齐 ${event.version} 快照。`,
      createdAt: now,
    })
  })

  return { refs, snapshots, audits, eventIds: refs.map((ref) => ref.eventId) }
}

/** 候选是否所有事件都已锚定基线快照（发布门禁） */
export const releaseMissingBaselineEventIds = (
  release: ReleaseCandidate,
): string[] => {
  const anchored = new Set((release.baselineRefs ?? []).map((ref) => ref.eventId))
  return release.eventIds.filter((eventId) => !anchored.has(eventId))
}
