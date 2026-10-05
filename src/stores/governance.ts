import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AuditEvent,
  CommitRevision,
  DeprecationPlan,
  EventDefinition,
  EventProperty,
  EventVersionSnapshot,
  GovernanceState,
  MigrationConfirmation,
  PlatformRule,
  RecoveryReport,
  ReleaseApproval,
  ReleaseBaselineRef,
  ReleaseCandidate,
  RollbackRecord,
} from '@/models/domain'
import { loadState, resetState, saveState } from '@/services/repository'
import {
  armCommitCrash,
  CommitCrashError,
  commitRevisions,
  hasPendingCommit,
  recoverPendingCommit,
} from '@/services/commitLog'
import {
  buildBackfill,
  buildReconcilePatch,
  dependencyChangedFields,
  releaseMissingBaselineEventIds,
} from '@/services/reconcile'
import {
  affectedDependencies,
  contractDifferences,
  latestBaseline,
  releaseReadiness,
  validateGovernance,
} from '@/services/selectors'

export interface PublishResult {
  ok: boolean
  reason?: 'missing_baseline' | 'gates' | 'crashed'
  missingEventIds?: string[]
}

const deterministicId = (prefix: string, seed: string): string => {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return `${prefix}-${hash.toString(36)}`
}

export const useGovernanceStore = defineStore('governance', () => {
  const data = ref<GovernanceState>(loadState())
  const lastSavedAt = ref(new Date().toISOString())
  const recoveryInfo = ref<RecoveryReport | null>(null)

  const issues = computed(() => validateGovernance(data.value))

  // ---------------------------------------------------------------------------
  // 可恢复提交：所有写操作只构造修订，由提交链按检查点顺序落盘
  // ---------------------------------------------------------------------------

  const commit = (
    action: string,
    buildHead: (now: string) => CommitRevision[],
    buildTail?: (draft: GovernanceState, now: string) => CommitRevision[],
  ): boolean => {
    const now = new Date().toISOString()
    const transactionId = deterministicId('txn', `${action}-${now}`)
    const checkpointId = deterministicId('ckpt', `${transactionId}-base`)
    const head = buildHead(now)
    try {
      data.value = commitRevisions(
        data.value,
        action,
        head,
        buildTail ? (draft) => buildTail(draft, now) : undefined,
        transactionId,
        checkpointId,
        saveState,
      )
      lastSavedAt.value = new Date().toISOString()
      return true
    } catch (error) {
      if (error instanceof CommitCrashError) {
        recoveryInfo.value = null
        return false
      }
      throw error
    }
  }

  /** 启动 / 手动恢复：从最后一个完整检查点重放未确认修订 */
  const recover = (): RecoveryReport | null => {
    if (!hasPendingCommit()) return null
    // 崩溃可能发生在同一会话：内存状态停留在提交前，磁盘检查点才包含已写入修订，
    // 因此恢复必须以磁盘上的最后完整检查点为基准
    const result = recoverPendingCommit(loadState(), saveState)
    if (!result) return null
    data.value = result.state
    lastSavedAt.value = new Date().toISOString()
    recoveryInfo.value = result.report
    return result.report
  }

  // 启动时自愈：崩溃残留的未完成提交，以及历史候选过期的差异 / 迁移状态
  const reconcileAllDraft = (draft: GovernanceState, now: string): CommitRevision[] => {
    const revisions: CommitRevision[] = []
    draft.releases
      .filter((release) => release.status === 'reviewing')
      .forEach((release) => {
        const result = buildReconcilePatch(draft, release, now)
        if (result) {
          revisions.push({
            kind: 'release.reconcile',
            releaseId: release.id,
            patch: result.patch,
            audits: result.audits,
          })
        }
      })
    return revisions
  }

  const bootstrap = (): RecoveryReport | null => {
    const report = recover()
    // 恢复（或无残留）后，对评审中候选做一次幂等自愈，对齐当前基线
    commit('基线变化重算未发布候选', () => [], (draft, now) => reconcileAllDraft(draft, now))
    return report
  }

  /** 基于「契约修订已应用」的草稿，为相关未发布候选追加重算修订 */
  const reconcileTail =
    (eventIds: string[]) =>
    (draft: GovernanceState, now: string): CommitRevision[] => {
      const revisions: CommitRevision[] = []
      draft.releases
        .filter(
          (release) =>
            release.status === 'reviewing' &&
            release.eventIds.some((eventId) => eventIds.includes(eventId)),
        )
        .forEach((release) => {
          const result = buildReconcilePatch(draft, release, now)
          if (result) {
            revisions.push({
              kind: 'release.reconcile',
              releaseId: release.id,
              patch: result.patch,
              audits: result.audits,
            })
          }
        })
      return revisions
    }

  const makeAudit = (
    entityType: string,
    entityId: string,
    action: string,
    detail: string,
    now: string,
  ): AuditEvent => ({
    id: deterministicId('aud', `${entityType}-${entityId}-${action}-${now}`),
    entityType,
    entityId,
    action,
    actor: '当前用户',
    detail,
    createdAt: now,
  })

  // ---------------------------------------------------------------------------
  // 事件 / 属性 / 平台规则
  // ---------------------------------------------------------------------------

  const saveEvent = (event: EventDefinition): boolean =>
    commit(event.id && data.value.events.some((item) => item.id === event.id) ? '更新事件契约' : '创建事件契约', (now) => {
      const index = data.value.events.findIndex((item) => item.id === event.id)
      const saved = { ...event, updatedAt: now }
      return [
        {
          kind: 'event.upsert',
          event: saved,
          audit: makeAudit('event', event.id, index >= 0 ? '更新事件' : '创建事件', `${event.key} 契约已保存`, now),
        },
      ]
    })

  const saveProperty = (eventId: string, property: EventProperty): boolean =>
    commit(
      '更新事件属性',
      (now) => {
        const event = data.value.events.find((item) => item.id === eventId)
        if (!event) return []
        const index = event.properties.findIndex((item) => item.id === property.id)
        return [
          {
            kind: 'property.upsert',
            eventId,
            property,
            eventUpdatedAt: now,
            audit: makeAudit(
              'property',
              property.id,
              index >= 0 ? '更新属性' : '新增属性',
              `${event.key}.${property.name}`,
              now,
            ),
          },
        ]
      },
      // 契约修订已落草稿后，未发布候选按变化字段重算
      reconcileTail([eventId]),
    )

  const deleteProperty = (eventId: string, propertyId: string): boolean =>
    commit(
      '标记删除属性',
      (now) => {
        const event = data.value.events.find((item) => item.id === eventId)
        const property = event?.properties.find((item) => item.id === propertyId)
        if (!event || !property) return []
        return [
          {
            kind: 'property.delete',
            eventId,
            propertyId,
            deletedAt: now,
            eventUpdatedAt: now,
            audit: makeAudit(
              'property',
              propertyId,
              '标记删除',
              `${event.key}.${property.name} 进入删除兼容期`,
              now,
            ),
          },
        ]
      },
      reconcileTail([eventId]),
    )

  const savePlatformRule = (eventId: string, rule: PlatformRule): boolean =>
    commit('更新平台规则', (now) => {
      const event = data.value.events.find((item) => item.id === eventId)
      if (!event) return []
      const index = event.platformRules.findIndex((item) => item.id === rule.id)
      return [
        {
          kind: 'platform_rule.upsert',
          eventId,
          rule,
          eventUpdatedAt: now,
          audit: makeAudit(
            'platform_rule',
            rule.id,
            index >= 0 ? '更新平台规则' : '新增平台规则',
            `${event.key}/${rule.platform}`,
            now,
          ),
        },
      ]
    })

  // ---------------------------------------------------------------------------
  // 发布候选
  // ---------------------------------------------------------------------------

  const createRelease = (version: string, title: string, eventIds: string[]): ReleaseCandidate | null => {
    let created: ReleaseCandidate | null = null
    const ok = commit('创建发布候选', (now) => {
      const allDifferences = contractDifferences(data.value, eventIds)
      const differences = allDifferences.filter(
        (difference) =>
          difference.addedProperties.length > 0 ||
          difference.removedProperties.length > 0 ||
          difference.requiredChanges.length > 0 ||
          difference.typeChanges.length > 0 ||
          difference.enumChanges.length > 0,
      )
      const affected = affectedDependencies(data.value, differences)
      const releaseId = deterministicId('rel', `${version}-${now}`)

      // 冻结创建时刻的基线锚点与快照；缺基线的事件留待发布前补齐
      const refs: ReleaseBaselineRef[] = []
      const snapshots: EventVersionSnapshot[] = []
      eventIds.forEach((eventId) => {
        const baseline = latestBaseline(data.value.baselines, eventId)
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

      const migrationConfirmations: MigrationConfirmation[] = affected.map((dependencyId) => {
        const dependency = data.value.dependencies.find((item) => item.id === dependencyId)
        return {
          id: deterministicId('mig', `${releaseId}-${dependencyId}`),
          dependencyId,
          version,
          status: 'pending',
          reviewer: dependency?.owner ?? '',
          note: '',
          changedFields: dependency
            ? dependencyChangedFields(data.value, dependency, differences)
            : [],
        }
      })

      created = {
        id: releaseId,
        version,
        title,
        status: 'reviewing',
        eventIds,
        affectedDependencyIds: affected,
        differences,
        migrationConfirmations,
        approvals: [
          { id: deterministicId('appr', `${releaseId}-data`), role: 'data', actor: '顾清', status: 'pending', comment: '' },
          { id: deterministicId('appr', `${releaseId}-product`), role: 'product', actor: '丁禾', status: 'pending', comment: '' },
          { id: deterministicId('appr', `${releaseId}-client`), role: 'client', actor: '江驰', status: 'pending', comment: '' },
          { id: deterministicId('appr', `${releaseId}-qa`), role: 'qa', actor: '余安', status: 'pending', comment: '' },
        ],
        baselineRefs: refs,
        baselineSnapshots: snapshots,
        createdAt: now,
      }

      return [
        {
          kind: 'release.create',
          release: created,
          currentVersion: version,
          audit: makeAudit(
            'release',
            releaseId,
            '创建发布候选',
            `${version} 包含 ${eventIds.length} 个事件，影响 ${affected.length} 个下游依赖`,
            now,
          ),
        },
      ]
    })
    return ok ? created : null
  }

  /** 旧候选缺少基线快照：先补齐再允许发布 */
  const backfillReleaseBaselines = (releaseId: string): boolean =>
    commit(
      '补齐候选基线快照',
      (now) => {
        const release = data.value.releases.find((item) => item.id === releaseId)
        if (!release) return []
        const missing = releaseMissingBaselineEventIds(release)
        if (missing.length === 0) return []
        const backfill = buildBackfill(data.value, release, now)
        if (backfill.refs.length === 0) return []
        return [
          {
            kind: 'release.baseline_backfill',
            releaseId,
            refs: backfill.refs,
            snapshots: backfill.snapshots,
            audits: backfill.audits,
          },
        ]
      },
      // 回填后差异可能整体收敛（如旧事件以当前契约为基线），基于补齐后的草稿重算
      (draft, now) => {
        const release = draft.releases.find((item) => item.id === releaseId)
        if (!release) return []
        const result = buildReconcilePatch(draft, release, now)
        return result
          ? [{ kind: 'release.reconcile', releaseId, patch: result.patch, audits: result.audits }]
          : []
      },
    )

  const confirmMigration = (
    releaseId: string,
    confirmationId: string,
    reviewer: string,
    note: string,
  ): boolean =>
    commit('确认下游迁移', (now) => {
      const release = data.value.releases.find((item) => item.id === releaseId)
      const confirmation = release?.migrationConfirmations.find((item) => item.id === confirmationId)
      if (!confirmation) return []
      const updated: MigrationConfirmation = {
        ...confirmation,
        status: 'confirmed',
        reviewer,
        note,
        confirmedAt: now,
        resetNote: undefined,
        resetAt: undefined,
      }
      return [
        {
          kind: 'migration.confirm',
          releaseId,
          confirmation: updated,
          dependencyStatus: 'migrated',
          audit: makeAudit('dependency', confirmation.dependencyId, '确认迁移', `${reviewer}：${note}`, now),
        },
      ]
    })

  const updateApproval = (
    releaseId: string,
    role: ReleaseApproval['role'],
    status: ReleaseApproval['status'],
    actor: string,
    comment: string,
  ): boolean =>
    commit('提交发布审批', (now) => {
      const release = data.value.releases.find((item) => item.id === releaseId)
      const approval = release?.approvals.find((item) => item.role === role)
      if (!approval) return []
      return [
        {
          kind: 'approval.update',
          releaseId,
          approval: { ...approval, status, actor, comment, createdAt: now },
          audit: makeAudit(
            'release',
            releaseId,
            status === 'approved' ? '审批通过' : '审批驳回',
            `${role}：${comment}`,
            now,
          ),
        },
      ]
    })

  const publishRelease = (releaseId: string): PublishResult => {
    const release = data.value.releases.find((item) => item.id === releaseId)
    if (!release) return { ok: false, reason: 'gates' }

    const missingEventIds = releaseMissingBaselineEventIds(release)
    if (missingEventIds.length > 0) {
      return { ok: false, reason: 'missing_baseline', missingEventIds }
    }

    const migrationsReady = release.migrationConfirmations.every((item) => item.status === 'confirmed')
    const approvalsReady = release.approvals.every((item) => item.status === 'approved')
    if (!migrationsReady || !approvalsReady || releaseReadiness(release, issues.value) < 90) {
      return { ok: false, reason: 'gates' }
    }

    const ok = commit(
      '发布事件契约',
      (now) => {
        const current = data.value.releases.find((item) => item.id === releaseId)!
        const baselines = current.eventIds
          .map((eventId) => {
            const event = data.value.events.find((item) => item.id === eventId)
            if (!event) return null
            return {
              id: deterministicId('base', `publish-${releaseId}-${eventId}`),
              eventId,
              version: event.version,
              properties: structuredClone(event.properties),
              createdAt: now,
              status: 'published' as const,
              source: 'release' as const,
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))

        return [
          {
            kind: 'release.publish',
            releaseId,
            publishedAt: now,
            baselines,
            eventVersions: baselines.map((snapshot) => ({
              eventId: snapshot.eventId,
              version: snapshot.version,
            })),
            audit: makeAudit('release', releaseId, '发布契约', `${current.version} 已发布`, now),
          },
        ]
      },
      // 发布落盘新基线后基于草稿重算；已发布候选在 buildReconcilePatch 内被冻结过滤
      (draft, now) => reconcileAllDraft(draft, now),
    )

    return ok ? { ok: true } : { ok: false, reason: 'crashed' }
  }

  // ---------------------------------------------------------------------------
  // 废弃 / 回滚
  // ---------------------------------------------------------------------------

  const saveDeprecation = (plan: DeprecationPlan): boolean =>
    commit('更新废弃计划', (now) => {
      const event = data.value.events.find((item) => item.id === plan.eventId)
      return [
        {
          kind: 'deprecation.upsert',
          plan,
          audit: makeAudit(
            'deprecation',
            plan.id,
            '更新废弃计划',
            `${event?.key ?? plan.eventId}：${plan.status}`,
            now,
          ),
        },
      ]
    })

  const executeRollback = (
    releaseId: string,
    reason: string,
    scope: string,
    evidence: string,
  ): boolean =>
    commit('执行发布回滚', (now) => {
      const release = data.value.releases.find((item) => item.id === releaseId)
      if (!release) return []
      const record: RollbackRecord = {
        id: deterministicId('rollback', `${releaseId}-${now}`),
        releaseId,
        version: release.version,
        reason,
        operator: '当前用户',
        scope,
        createdAt: now,
        status: 'executed',
        evidence,
      }
      return [
        {
          kind: 'rollback.create',
          record,
          audit: makeAudit('rollback', record.id, '执行回滚', `${release.version}：${reason}`, now),
        },
      ]
    })

  const verifyRollback = (rollbackId: string, evidence: string): boolean =>
    commit('验证发布回滚', (now) => [
      {
        kind: 'rollback.verify',
        rollbackId,
        evidence,
        audit: makeAudit('rollback', rollbackId, '验证回滚', evidence, now),
      },
    ])

  // ---------------------------------------------------------------------------
  // 故障演练：安排一次「提交中断」，随后从检查点恢复，验证不产生重复记录
  // ---------------------------------------------------------------------------

  const runCommitCrashDrill = (): { armed: boolean; recovered: RecoveryReport | null } => {
    // 构造一个含「发布记录 + 回滚记录」的多修订事务
    const drillVersion = `DRILL-${Date.now().toString(36)}`
    let releaseCreated = false
    armCommitCrash('*', 0) // 第 1 条修订落盘检查点后中断

    const ok = commit('中断演练：回滚提交', (now) => {
      const releaseId = deterministicId('rel', `drill-${drillVersion}`)
      const release: ReleaseCandidate = {
        id: releaseId,
        version: drillVersion,
        title: '提交中断恢复演练（可删除）',
        status: 'reviewing',
        eventIds: [],
        affectedDependencyIds: [],
        differences: [],
        migrationConfirmations: [],
        approvals: [],
        baselineRefs: [],
        baselineSnapshots: [],
        createdAt: now,
      }
      releaseCreated = true
      const rollback: RollbackRecord = {
        id: deterministicId('rollback', `drill-${drillVersion}`),
        releaseId,
        version: drillVersion,
        reason: '演练：提交在检查点后中断',
        operator: '演练',
        scope: '演练事务',
        createdAt: now,
        status: 'executed',
        evidence: 'DRILL',
      }
      return [
        {
          kind: 'release.create',
          release,
          currentVersion: drillVersion,
          audit: makeAudit('release', releaseId, '演练创建候选', `${drillVersion} 第 1 条修订`, now),
        },
        {
          kind: 'rollback.create',
          record: rollback,
          audit: makeAudit('rollback', rollback.id, '演练回滚', `${drillVersion} 第 2 条修订`, now),
        },
      ]
    })

    // ok=false：第 1 条（发布记录）已写入检查点，第 2 条（回滚记录）随中断未确认
    const armed = !ok && releaseCreated
    // 从最后一个完整检查点恢复：重放回滚修订，发布/回滚记录都必须恰好一条
    const recovered = recover()
    return { armed, recovered }
  }

  const resetDemo = (): void => {
    data.value = resetState()
    recoveryInfo.value = null
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

  return {
    data,
    lastSavedAt,
    issues,
    recoveryInfo,
    commit,
    recover,
    bootstrap,
    saveEvent,
    saveProperty,
    deleteProperty,
    savePlatformRule,
    createRelease,
    backfillReleaseBaselines,
    confirmMigration,
    updateApproval,
    publishRelease,
    saveDeprecation,
    executeRollback,
    verifyRollback,
    runCommitCrashDrill,
    resetDemo,
    exportContract,
  }
})
