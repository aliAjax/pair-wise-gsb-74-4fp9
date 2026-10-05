import type { GovernanceState, ReleaseCheckpoint } from '@/models/domain'
import { createSeedState } from '@/models/seed'

const STORAGE_KEY = 'eventrail-governance-v1'
const CHECKPOINT_KEY = 'eventrail-release-checkpoint-v1'

const migrate = (state: GovernanceState): GovernanceState => ({
  ...state,
  releaseJournal: state.releaseJournal ?? [],
  releases: state.releases.map((release) => ({
    ...release,
    baselineSnapshots: release.baselineSnapshots ?? [],
  })),
})

export const loadState = (): GovernanceState => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = migrate(createSeedState())
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    return migrate(JSON.parse(raw) as GovernanceState)
  } catch {
    const seed = migrate(createSeedState())
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
}

export const saveState = (state: GovernanceState): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deepClone(state)))
}

export const resetState = (): GovernanceState => {
  const seed = migrate(createSeedState())
  saveState(seed)
  clearCheckpoint()
  return seed
}

export const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** 治理状态全部为 JSON 可序列化数据；相比 structuredClone 可安全用于响应式 Proxy。 */
export const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 操作开始前建立完整检查点；提交失败后从这里恢复。 */
export const saveCheckpoint = (checkpoint: ReleaseCheckpoint): void => {
  localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(deepClone(checkpoint)))
}

export const loadCheckpoint = (): ReleaseCheckpoint | null => {
  const raw = localStorage.getItem(CHECKPOINT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReleaseCheckpoint
  } catch {
    return null
  }
}

export const clearCheckpoint = (): void => {
  localStorage.removeItem(CHECKPOINT_KEY)
}
