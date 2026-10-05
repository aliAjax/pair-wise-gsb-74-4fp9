import axios, { type AxiosAdapter } from 'axios'
import type {
  DownstreamDependency,
  EventDefinition,
  ReleaseCandidate,
  ValidationIssue,
} from '@/models/domain'
import { loadState } from '@/services/repository'
import { validateGovernance } from '@/services/selectors'

export interface EventListFilters {
  keyword?: string
  status?: string
  platform?: string
  category?: string
}

export interface DashboardPayload {
  eventCount: number
  activeEventCount: number
  draftEventCount: number
  dependencyCount: number
  pendingMigrations: number
  validationIssueCount: number
  criticalIssueCount: number
  currentRelease: ReleaseCandidate | null
}

export interface LineagePayload {
  events: EventDefinition[]
  dependencies: DownstreamDependency[]
}

const localAdapter: AxiosAdapter = async (config) => {
  const state = loadState()
  const url = config.url ?? ''

  if (url === '/dashboard') {
    const issues = validateGovernance(state)
    const currentRelease =
      state.releases.find((release) => release.status === 'reviewing') ?? state.releases[0] ?? null
    const data: DashboardPayload = {
      eventCount: state.events.length,
      activeEventCount: state.events.filter((event) =>
        ['approved', 'published'].includes(event.status),
      ).length,
      draftEventCount: state.events.filter((event) =>
        ['draft', 'reviewing'].includes(event.status),
      ).length,
      dependencyCount: state.dependencies.length,
      pendingMigrations:
        currentRelease?.migrationConfirmations.filter((item) => item.status === 'pending').length ?? 0,
      validationIssueCount: issues.length,
      criticalIssueCount: issues.filter((issue) => issue.severity === 'critical').length,
      currentRelease,
    }
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url === '/events') {
    const params = (config.params ?? {}) as EventListFilters
    const keyword = params.keyword?.trim().toLowerCase() ?? ''
    const data = state.events.filter((event) => {
      const textMatches =
        !keyword ||
        event.key.toLowerCase().includes(keyword) ||
        event.displayName.toLowerCase().includes(keyword) ||
        event.owner.toLowerCase().includes(keyword)
      const platformMatches =
        !params.platform ||
        event.platformRules.some(
          (rule) => rule.platform === params.platform && rule.enabled,
        )
      return (
        textMatches &&
        platformMatches &&
        (!params.status || event.status === params.status) &&
        (!params.category || event.category === params.category)
      )
    })
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url.startsWith('/events/')) {
    const eventId = url.split('/')[2]
    const data = state.events.find((event) => event.id === eventId)
    if (!data) throw new Error(`事件不存在：${eventId}`)
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url === '/releases') {
    return {
      data: state.releases,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url.startsWith('/releases/')) {
    const releaseId = url.split('/')[2]
    const data = state.releases.find((release) => release.id === releaseId)
    if (!data) throw new Error(`发布候选不存在：${releaseId}`)
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url === '/validations') {
    const data: ValidationIssue[] = validateGovernance(state)
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  if (url === '/lineage') {
    const data: LineagePayload = {
      events: state.events,
      dependencies: state.dependencies,
    }
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  throw new Error(`本地 API 未实现：GET ${url}`)
}

const http = axios.create({
  baseURL: '/api',
  timeout: 5_000,
  adapter: localAdapter,
})

export const governanceApi = {
  getDashboard: async (): Promise<DashboardPayload> => {
    const response = await http.get<DashboardPayload>('/dashboard')
    return response.data
  },
  listEvents: async (filters: EventListFilters = {}): Promise<EventDefinition[]> => {
    const response = await http.get<EventDefinition[]>('/events', { params: filters })
    return response.data
  },
  getEvent: async (eventId: string): Promise<EventDefinition> => {
    const response = await http.get<EventDefinition>(`/events/${eventId}`)
    return response.data
  },
  listReleases: async (): Promise<ReleaseCandidate[]> => {
    const response = await http.get<ReleaseCandidate[]>('/releases')
    return response.data
  },
  getRelease: async (releaseId: string): Promise<ReleaseCandidate> => {
    const response = await http.get<ReleaseCandidate>(`/releases/${releaseId}`)
    return response.data
  },
  listValidations: async (): Promise<ValidationIssue[]> => {
    const response = await http.get<ValidationIssue[]>('/validations')
    return response.data
  },
  getLineage: async (): Promise<LineagePayload> => {
    const response = await http.get<LineagePayload>('/lineage')
    return response.data
  },
}
