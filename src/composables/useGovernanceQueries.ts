import { computed, type Ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { governanceApi, type EventListFilters } from '@/services/api'

export const useDashboardQuery = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: governanceApi.getDashboard,
  })

export const useEventsQuery = (filters: Ref<EventListFilters>) =>
  useQuery({
    queryKey: computed(() => ['events', filters.value]),
    queryFn: () => governanceApi.listEvents(filters.value),
    placeholderData: (previous) => previous,
  })

export const useReleaseQuery = (releaseId: Ref<string>) =>
  useQuery({
    queryKey: computed(() => ['release', releaseId.value]),
    queryFn: () => governanceApi.getRelease(releaseId.value),
    enabled: computed(() => Boolean(releaseId.value)),
  })

export const useReleasesQuery = () =>
  useQuery({
    queryKey: ['releases'],
    queryFn: governanceApi.listReleases,
  })

export const useValidationQuery = () =>
  useQuery({
    queryKey: ['validations'],
    queryFn: governanceApi.listValidations,
  })

export const useLineageQuery = () =>
  useQuery({
    queryKey: ['lineage'],
    queryFn: governanceApi.getLineage,
  })
