import type {
  AuditEvent,
  CommitRevision,
  GovernanceState,
  RecoveryReport,
} from '@/models/domain'

const JOURNAL_KEY = 'eventrail-governance-journal-v1'
const CRASH_KEY = 'eventrail-governance-crash-arm-v1'

/** 模拟「提交在某个修订已写入检查点之后失败」的崩溃点 */
export interface CrashArm {
  transactionId: string
  afterIndex: number
}

export class CommitCrashError extends Error {
  constructor(
    readonly transactionId: string,
    readonly checkpointId: string,
    readonly afterIndex: number,
  ) {
    super(`提交 ${transactionId} 在第 ${afterIndex + 1} 条修订写入后中断，等待从检查点恢复`)
    this.name = 'CommitCrashError'
  }
}

interface CommitJournal {
  id: string
  action: string
  checkpointId: string
  startedAt: string
  revisions: CommitRevision[]
  /** 已完整写入检查点的修订下标；重放从 appliedUpTo + 1 开始 */
  appliedUpTo: number
}

const upsertBy = <T>(list: T[], item: T, key: (value: T) => string): void => {
  const index = list.findIndex((existing) => key(existing) === key(item))
  if (index >= 0) list[index] = item
  else list.unshift(item)
}

const appendAudit = (audit: GovernanceState['audit'], entry: AuditEvent): void => {
  if (!audit.some((existing) => existing.id === entry.id)) audit.unshift(entry)
}

/**
 * 将单条修订应用到状态。全部为幂等 upsert：
 * 同一条修订重放任意次，结果与发布/回滚/审计记录条数完全一致。
 */
export const applyRevision = (state: GovernanceState, revision: CommitRevision): void => {
  switch (revision.kind) {
    case 'event.upsert': {
      upsertBy(state.events, structuredClone(revision.event), (item) => item.id)
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'property.upsert': {
      const event = state.events.find((item) => item.id === revision.eventId)
      if (event) {
        upsertBy(event.properties, structuredClone(revision.property), (item) => item.id)
        event.updatedAt = revision.eventUpdatedAt
      }
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'property.delete': {
      const event = state.events.find((item) => item.id === revision.eventId)
      const property = event?.properties.find((item) => item.id === revision.propertyId)
      if (event) {
        if (property) property.deletedAt = revision.deletedAt
        event.updatedAt = revision.eventUpdatedAt
      }
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'platform_rule.upsert': {
      const event = state.events.find((item) => item.id === revision.eventId)
      if (event) {
        upsertBy(event.platformRules, structuredClone(revision.rule), (item) => item.id)
        event.updatedAt = revision.eventUpdatedAt
      }
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'release.create': {
      // 重放时发布候选已存在则原样保留，绝不重复生成发布记录
      if (!state.releases.some((item) => item.id === revision.release.id)) {
        state.releases.unshift(structuredClone(revision.release))
      }
      state.currentVersion = revision.currentVersion
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'release.baseline_backfill': {
      revision.snapshots.forEach((snapshot) => {
        if (!state.baselines.some((item) => item.id === snapshot.id)) {
          state.baselines.unshift(structuredClone(snapshot))
        }
      })
      const release = state.releases.find((item) => item.id === revision.releaseId)
      if (release) {
        const refs = release.baselineRefs ?? []
        revision.refs.forEach((ref) => {
          if (!refs.some((item) => item.eventId === ref.eventId)) refs.push({ ...ref })
        })
        release.baselineRefs = refs
        const snapshots = release.baselineSnapshots ?? []
        revision.snapshots.forEach((snapshot) => {
          if (!snapshots.some((item) => item.id === snapshot.id)) {
            snapshots.push(structuredClone(snapshot))
          }
        })
        release.baselineSnapshots = snapshots
      }
      revision.audits.forEach((entry) => appendAudit(state.audit, entry))
      return
    }
    case 'release.reconcile': {
      const release = state.releases.find((item) => item.id === revision.releaseId)
      // 已发布 / 已回滚候选冻结：公开版本保留原快照，不参与重算
      if (!release || release.status !== 'reviewing') return
      const { patch } = revision
      release.baselineRefs = structuredClone(patch.refs)
      release.baselineSnapshots = structuredClone(patch.snapshots)
      release.differences = structuredClone(patch.differences)
      release.affectedDependencyIds = [...patch.affectedDependencyIds]
      patch.removeConfirmationIds.forEach((confirmationId) => {
        release.migrationConfirmations = release.migrationConfirmations.filter(
          (item) => item.id !== confirmationId,
        )
      })
      patch.upsertConfirmations.forEach((confirmation) => {
        upsertBy(
          release.migrationConfirmations,
          structuredClone(confirmation),
          (item) => item.id,
        )
      })
      patch.dependencyStatus.forEach(({ dependencyId, status }) => {
        const dependency = state.dependencies.find((item) => item.id === dependencyId)
        if (dependency) dependency.status = status
      })
      revision.audits.forEach((entry) => appendAudit(state.audit, entry))
      return
    }
    case 'migration.confirm': {
      const release = state.releases.find((item) => item.id === revision.releaseId)
      const confirmation = release?.migrationConfirmations.find(
        (item) => item.id === revision.confirmation.id,
      )
      if (confirmation) Object.assign(confirmation, structuredClone(revision.confirmation))
      if (revision.dependencyStatus) {
        const dependency = state.dependencies.find(
          (item) => item.id === revision.confirmation.dependencyId,
        )
        if (dependency) dependency.status = revision.dependencyStatus
      }
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'approval.update': {
      const release = state.releases.find((item) => item.id === revision.releaseId)
      const approval = release?.approvals.find((item) => item.role === revision.approval.role)
      if (approval) Object.assign(approval, structuredClone(revision.approval))
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'release.publish': {
      const release = state.releases.find((item) => item.id === revision.releaseId)
      revision.baselines.forEach((snapshot) => {
        if (!state.baselines.some((item) => item.id === snapshot.id)) {
          state.baselines.unshift(structuredClone(snapshot))
        }
      })
      revision.eventVersions.forEach(({ eventId, version }) => {
        const event = state.events.find((item) => item.id === eventId)
        if (event) {
          event.status = 'published'
          event.version = version
        }
      })
      if (release) {
        release.status = 'published'
        release.publishedAt = revision.publishedAt
      }
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'deprecation.upsert': {
      upsertBy(state.deprecations, structuredClone(revision.plan), (item) => item.id)
      const event = state.events.find((item) => item.id === revision.plan.eventId)
      if (event && revision.plan.status === 'stopped') event.status = 'deprecated'
      if (event && revision.plan.status === 'retired') event.status = 'retired'
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'rollback.create': {
      // 重放时回滚记录已存在则跳过，绝不重复生成回滚记录
      if (!state.rollbacks.some((item) => item.id === revision.record.id)) {
        state.rollbacks.unshift(structuredClone(revision.record))
      }
      const release = state.releases.find((item) => item.id === revision.record.releaseId)
      if (release) release.status = 'rolled_back'
      appendAudit(state.audit, revision.audit)
      return
    }
    case 'rollback.verify': {
      const record = state.rollbacks.find((item) => item.id === revision.rollbackId)
      if (record) {
        record.status = 'verified'
        record.evidence = revision.evidence
      }
      appendAudit(state.audit, revision.audit)
      return
    }
  }
}

const hasDuplicateIds = (items: Array<{ id: string }>): boolean =>
  new Set(items.map((item) => item.id)).size !== items.length

const readJournal = (): CommitJournal | null => {
  const raw = localStorage.getItem(JOURNAL_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CommitJournal
  } catch {
    return null
  }
}

const writeJournal = (journal: CommitJournal): void => {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
}

export const clearCommitJournal = (): void => {
  localStorage.removeItem(JOURNAL_KEY)
  localStorage.removeItem(CRASH_KEY)
}

/** 安排下一次提交在第 afterIndex+1 条修订落盘后崩溃（仅触发一次） */
export const armCommitCrash = (transactionId: string, afterIndex = 0): void => {
  const arm: CrashArm = { transactionId, afterIndex }
  localStorage.setItem(CRASH_KEY, JSON.stringify(arm))
}

export const pendingCrashArm = (transactionId: string): CrashArm | null => {
  const raw = localStorage.getItem(CRASH_KEY)
  if (!raw) return null
  try {
    const arm = JSON.parse(raw) as CrashArm
    return arm.transactionId === transactionId || arm.transactionId === '*' ? arm : null
  } catch {
    return null
  }
}

export const disarmCrash = (): void => {
  localStorage.removeItem(CRASH_KEY)
}

/**
 * 以可恢复方式提交一批修订。
 * base 必须是最后一个完整检查点；每条修订应用后立即落盘新检查点，
 * 并推进日志 appliedUpTo。任何时刻失败都能从检查点 + 日志恢复。
 *
 * tail(draft) 允许在「前置修订已应用到 draft」之后构建衍生修订
 * （例如契约修订落盘后，再基于最新草稿重算未发布候选）。
 */
export const commitRevisions = (
  base: GovernanceState,
  action: string,
  head: CommitRevision[],
  tail: ((draft: GovernanceState) => CommitRevision[]) | undefined,
  transactionId: string,
  checkpointId: string,
  saveCheckpoint: (state: GovernanceState) => void,
): GovernanceState => {
  // 先写「未完成日志」，再开始应用：崩溃后日志一定存在
  const journal: CommitJournal = {
    id: transactionId,
    action,
    checkpointId,
    startedAt: new Date().toISOString(),
    revisions: head,
    appliedUpTo: -1,
  }
  writeJournal(journal)

  const working = structuredClone(base)

  const applyOne = (revision: CommitRevision, index: number): void => {
    applyRevision(working, revision)
    // 该修订已写入：先落检查点，再推进日志位点
    saveCheckpoint(working)
    journal.appliedUpTo = index
    writeJournal(journal)

    const arm = pendingCrashArm(transactionId)
    if (arm && arm.afterIndex === index) {
      disarmCrash()
      throw new CommitCrashError(transactionId, checkpointId, index)
    }
  }

  head.forEach((revision, index) => applyOne(revision, index))

  // 前置修订全部落检查点后，再在草稿上构建衍生修订并并入日志
  if (tail) {
    const tailRevisions = tail(working)
    if (tailRevisions.length > 0) {
      journal.revisions = [...journal.revisions, ...tailRevisions]
      writeJournal(journal)
      tailRevisions.forEach((revision) => applyOne(revision, journal.appliedUpTo + 1))
    }
  }

  clearCommitJournal()
  return working
}

/**
 * 从最后一个完整检查点恢复未完成提交，重放剩余修订。
 * 已写入修订通过幂等 upsert 保留，发布记录与回滚记录不会重复生成。
 */
export const recoverPendingCommit = (
  checkpoint: GovernanceState,
  saveCheckpoint: (state: GovernanceState) => void,
): { state: GovernanceState; report: RecoveryReport } | null => {
  const journal = readJournal()
  if (!journal) return null

  const state = structuredClone(checkpoint)
  const replayedKinds: string[] = []

  for (let index = journal.appliedUpTo + 1; index < journal.revisions.length; index += 1) {
    const revision = journal.revisions[index]!
    applyRevision(state, revision)
    replayedKinds.push(revision.kind)
    // 每条重放也落检查点：恢复过程再次失败仍可继续
    saveCheckpoint(state)
    journal.appliedUpTo = index
    writeJournal(journal)
  }

  // 重放幂等性校验：发布记录 / 回滚记录按确定性 ID 必须恰好存在一条
  const createdReleaseIds = journal.revisions
    .filter((revision) => revision.kind === 'release.create')
    .map((revision) => (revision.kind === 'release.create' ? revision.release.id : ''))
  const createdRollbackIds = journal.revisions
    .filter((revision) => revision.kind === 'rollback.create')
    .map((revision) => (revision.kind === 'rollback.create' ? revision.record.id : ''))
  const duplicateReleaseCreated =
    hasDuplicateIds(state.releases) ||
    createdReleaseIds.some(
      (id) => state.releases.filter((item) => item.id === id).length !== 1,
    )
  const duplicateRollbackCreated =
    hasDuplicateIds(state.rollbacks) ||
    createdRollbackIds.some(
      (id) => state.rollbacks.filter((item) => item.id === id).length !== 1,
    )

  saveCheckpoint(state)
  clearCommitJournal()

  return {
    state,
    report: {
      recovered: true,
      transactionId: journal.id,
      action: journal.action,
      checkpointId: journal.checkpointId,
      checkpointAt: journal.startedAt,
      replayedRevisionKinds: replayedKinds,
      revisionCount: replayedKinds.length,
      releaseCount: state.releases.length,
      rollbackCount: state.rollbacks.length,
      duplicateReleaseCreated,
      duplicateRollbackCreated,
    },
  }
}

export const hasPendingCommit = (): boolean => readJournal() !== null
