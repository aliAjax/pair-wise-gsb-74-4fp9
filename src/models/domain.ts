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
  /** 由哪次发布操作写入，重放恢复时据此避免重复生成发布基线记录 */
  releaseId?: string
  operationId?: string
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

/**
 * 发布候选引用的事件契约基线快照。候选创建/补齐时冻结，
 * 差异始终以该快照为基准；已发布版本的快照永久保留，不随后续基线移动。
 */
export interface ReleaseBaselineSnapshot {
  eventId: string
  /** 基线版本；事件尚无已发布基线时为 null（以空契约为基准） */
  baselineVersion: string | null
  baselineId: string | null
  properties: EventProperty[]
  capturedAt: string
}

export interface MigrationConfirmation {
  id: string
  dependencyId: string
  version: string
  status: 'pending' | 'confirmed' | 'rejected'
  reviewer: string
  note: string
  confirmedAt?: string
  /**
   * 确认时该下游依赖受影响字段的签名。基线变化重算后签名不一致，
   * 说明确认依据的字段已经变动，确认退回待确认。
   */
  changeSignature?: string
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
  /** 创建时冻结的事件契约基线快照；缺失时禁止发布，必须先补齐 */
  baselineSnapshots?: ReleaseBaselineSnapshot[]
  /** 最近一次按基线变化重算候选的时间 */
  recomputedAt?: string
  migrationConfirmations: MigrationConfirmation[]
  approvals: ReleaseApproval[]
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
  /** 回滚操作的幂等键，重放恢复时据此避免重复生成回滚记录 */
  operationId?: string
}

export interface AuditEvent {
  id: string
  entityType: string
  entityId: string
  action: string
  actor: string
  detail: string
  createdAt: string
  /** 由哪次发布链操作产生，恢复重放时据此剔除并重放，避免重复审计 */
  operationId?: string
}

/**
 * 已完整提交的发布链操作日志。写入该日志的操作具备幂等性：
 * 失败重放时命中同 operationId 即跳过，不重复生成发布记录或回滚记录。
 */
export interface ReleaseOperationJournalEntry {
  operationId: string
  kind: 'publish' | 'rollback'
  releaseId: string
  version: string
  committedAt: string
  replayed: boolean
}

/**
 * 失败前最后一个完整检查点的待重放负载。
 * 检查点在操作开始前落盘；崩溃恢复时保留检查点之后写入的修订，
 * 按此负载重放操作，已写入日志的部分幂等跳过。
 */
export interface PendingReleaseOperation {
  operationId: string
  kind: 'publish' | 'rollback'
  releaseId: string
  version: string
  createdAt: string
  reason?: string
  scope?: string
  evidence?: string
  failCommit?: boolean
}

export interface ReleaseCheckpoint {
  operationId: string
  /** 检查点建立时的完整状态快照，用于回滚到最后一个完整检查点 */
  state: GovernanceState
  pending: PendingReleaseOperation
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
  /** 已完整提交的发布/回滚操作幂等日志 */
  releaseJournal: ReleaseOperationJournalEntry[]
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
