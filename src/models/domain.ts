export type Platform = 'web' | 'ios' | 'android' | 'server' | 'miniprogram'
export type EventStatus = 'draft' | 'reviewing' | 'approved' | 'published' | 'deprecated' | 'retired'
export type PropertyType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum'
export type ReleaseStatus = 'draft' | 'reviewing' | 'approved' | 'published' | 'rolled_back'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface EventProperty {
  id: string
  eventId: string
  name: string
  displayName: string
  type: PropertyType
  required: boolean
  description: string
  enumValues: string[]
  owner: string
  synonyms: string[]
  platforms: Platform[]
  lineageSourceId?: string
  deletedAt?: string
}

export interface PlatformRule {
  id: string
  eventId: string
  platform: Platform
  enabled: boolean
  trigger: string
  owner: string
  requiredPropertyIds: string[]
  note: string
}

export interface EventDefinition {
  id: string
  key: string
  displayName: string
  category: string
  description: string
  trigger: string
  status: EventStatus
  version: string
  owner: string
  properties: EventProperty[]
  platformRules: PlatformRule[]
  scenarioIds: string[]
  downstreamDependencyIds: string[]
  updatedAt: string
}

export interface BusinessScenario {
  id: string
  name: string
  domain: string
  owner: string
  platform: Platform
  eventIds: string[]
  status: 'active' | 'migrating' | 'retired'
}

export interface DownstreamDependency {
  id: string
  name: string
  type: 'dashboard' | 'alert' | 'model' | 'dataset' | 'experiment'
  owner: string
  environment: 'production' | 'staging' | 'analysis'
  eventIds: string[]
  propertyRefs: Array<{ eventId: string; propertyId: string }>
  status: 'active' | 'migration_required' | 'migrated' | 'disabled'
}

export interface EventVersionSnapshot {
  id: string
  eventId: string
  version: string
  properties: EventProperty[]
  createdAt: string
  status: 'published' | 'superseded'
  /** release：发布时落盘；backfilled：旧候选发布前补齐的基线 */
  source?: 'release' | 'backfilled'
}

/** 发布候选冻结的事件基线锚点，公开版本永不重锚 */
export interface ReleaseBaselineRef {
  eventId: string
  baselineId: string
  version: string
  source: 'release' | 'backfilled'
  linkedAt: string
}

export interface ContractDifference {
  eventId: string
  eventKey: string
  addedProperties: string[]
  removedProperties: string[]
  requiredChanges: string[]
  typeChanges: string[]
  enumChanges: string[]
}

export interface MigrationConfirmation {
  id: string
  dependencyId: string
  version: string
  status: 'pending' | 'confirmed' | 'rejected'
  reviewer: string
  note: string
  confirmedAt?: string
  /** 该确认项覆盖的变化字段签名（eventId.propertyName 排序集合），基线变化后按签名决定是否退回 */
  changedFields?: string[]
  resetNote?: string
  resetAt?: string
}

export interface ReleaseApproval {
  id: string
  role: 'data' | 'product' | 'client' | 'qa'
  actor: string
  status: 'pending' | 'approved' | 'rejected'
  comment: string
  createdAt?: string
}

export interface ReleaseCandidate {
  id: string
  version: string
  title: string
  status: ReleaseStatus
  eventIds: string[]
  affectedDependencyIds: string[]
  differences: ContractDifference[]
  migrationConfirmations: MigrationConfirmation[]
  approvals: ReleaseApproval[]
  /** 候选冻结的基线锚点；已发布候选永不重新锚定，公开版本保留原快照 */
  baselineRefs: ReleaseBaselineRef[]
  /** 冻结时刻的基线属性快照副本，供已发布版本自证 */
  baselineSnapshots: EventVersionSnapshot[]
  createdAt: string
  publishedAt?: string
}

export interface DeprecationPlan {
  id: string
  eventId: string
  replacementEventId?: string
  reason: string
  owner: string
  stopCollectAt: string
  retireAt: string
  status: 'planned' | 'announced' | 'stopped' | 'retired' | 'cancelled'
  migrationNote: string
}

export interface RollbackRecord {
  id: string
  releaseId: string
  version: string
  reason: string
  operator: string
  scope: string
  createdAt: string
  status: 'executed' | 'verified'
  evidence: string
}

export interface AuditEvent {
  id: string
  entityType: string
  entityId: string
  action: string
  actor: string
  detail: string
  createdAt: string
}

export interface GovernanceState {
  events: EventDefinition[]
  scenarios: BusinessScenario[]
  dependencies: DownstreamDependency[]
  baselines: EventVersionSnapshot[]
  releases: ReleaseCandidate[]
  deprecations: DeprecationPlan[]
  rollbacks: RollbackRecord[]
  audit: AuditEvent[]
  currentVersion: string
}

export interface ValidationIssue {
  id: string
  kind:
    | 'duplicate_event'
    | 'synonym_property'
    | 'naming_violation'
    | 'type_change'
    | 'deleted_property_referenced'
    | 'required_mismatch'
  severity: Severity
  title: string
  detail: string
  entityId: string
  suggestion: string
}

export interface SampleValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 可恢复发布链的修订（revision）。
 * 每一条修订都携带确定性 ID 与完整负载，应用时必须幂等（upsert），
 * 保证从检查点重放不会重复生成发布记录、回滚记录或审计记录。
 */
export type CommitRevision =
  | { kind: 'event.upsert'; event: EventDefinition; audit: AuditEvent }
  | {
      kind: 'property.upsert'
      eventId: string
      property: EventProperty
      eventUpdatedAt: string
      audit: AuditEvent
    }
  | {
      kind: 'property.delete'
      eventId: string
      propertyId: string
      deletedAt: string
      eventUpdatedAt: string
      audit: AuditEvent
    }
  | {
      kind: 'platform_rule.upsert'
      eventId: string
      rule: PlatformRule
      eventUpdatedAt: string
      audit: AuditEvent
    }
  | { kind: 'release.create'; release: ReleaseCandidate; currentVersion: string; audit: AuditEvent }
  | {
      kind: 'release.baseline_backfill'
      releaseId: string
      refs: ReleaseBaselineRef[]
      snapshots: EventVersionSnapshot[]
      audits: AuditEvent[]
    }
  | { kind: 'release.reconcile'; releaseId: string; patch: ReleaseReconcilePatch; audits: AuditEvent[] }
  | {
      kind: 'migration.confirm'
      releaseId: string
      confirmation: MigrationConfirmation
      dependencyStatus?: DownstreamDependency['status']
      audit: AuditEvent
    }
  | { kind: 'approval.update'; releaseId: string; approval: ReleaseApproval; audit: AuditEvent }
  | {
      kind: 'release.publish'
      releaseId: string
      publishedAt: string
      baselines: EventVersionSnapshot[]
      eventVersions: Array<{ eventId: string; version: string }>
      audit: AuditEvent
    }
  | { kind: 'deprecation.upsert'; plan: DeprecationPlan; audit: AuditEvent }
  | { kind: 'rollback.create'; record: RollbackRecord; audit: AuditEvent }
  | { kind: 'rollback.verify'; rollbackId: string; evidence: string; audit: AuditEvent }

/** 单条候选与当前基线重新对齐的幂等补丁 */
export interface ReleaseReconcilePatch {
  refs: ReleaseBaselineRef[]
  snapshots: EventVersionSnapshot[]
  differences: ContractDifference[]
  affectedDependencyIds: string[]
  /** 确认项的新增 / 更新 / 删除（按确认项 ID 幂等） */
  upsertConfirmations: MigrationConfirmation[]
  removeConfirmationIds: string[]
  dependencyStatus: Array<{ dependencyId: string; status: DownstreamDependency['status'] }>
}

/** 崩溃恢复报告，用于界面提示恢复点与重放结果 */
export interface RecoveryReport {
  recovered: boolean
  transactionId: string
  action: string
  checkpointId: string
  checkpointAt: string
  replayedRevisionKinds: string[]
  revisionCount: number
  releaseCount: number
  rollbackCount: number
  duplicateReleaseCreated: boolean
  duplicateRollbackCreated: boolean
}
