<script setup lang="ts">
import { computed } from 'vue'
import type { DownstreamDependency, EventDefinition, EventProperty } from '@/models/domain'

const props = defineProps<{
  events: EventDefinition[]
  dependencies: DownstreamDependency[]
  selectedPropertyId: string
}>()

const allProperties = computed(() =>
  props.events.flatMap((event) =>
    event.properties
      .filter((property) => !property.deletedAt)
      .map((property) => ({ event, property })),
  ),
)

const selected = computed(
  () => allProperties.value.find((item) => item.property.id === props.selectedPropertyId) ?? null,
)

const rootId = computed(() => {
  let property: EventProperty | undefined = selected.value?.property
  const visited = new Set<string>()
  while (property?.lineageSourceId && !visited.has(property.id)) {
    visited.add(property.id)
    property = allProperties.value.find(
      (item) => item.property.id === property?.lineageSourceId,
    )?.property
  }
  return property?.id ?? selected.value?.property.id ?? ''
})

const lineageProperties = computed(() => {
  if (!rootId.value) return []
  const result = allProperties.value.filter(
    (item) => item.property.id === rootId.value || item.property.lineageSourceId === rootId.value,
  )
  let changed = true
  while (changed) {
    changed = false
    result.forEach((item) => {
      const children = allProperties.value.filter(
        (candidate) => candidate.property.lineageSourceId === item.property.id,
      )
      children.forEach((child) => {
        if (!result.some((current) => current.property.id === child.property.id)) {
          result.push(child)
          changed = true
        }
      })
    })
  }
  return result
})

const relatedDependencies = computed(() => {
  const ids = new Set(lineageProperties.value.map((item) => item.property.id))
  return props.dependencies.filter((dependency) =>
    dependency.propertyRefs.some((reference) => ids.has(reference.propertyId)),
  )
})

const graphHeight = computed(() =>
  Math.max(360, Math.max(lineageProperties.value.length * 78, relatedDependencies.value.length * 82) + 100),
)

const propertyY = (index: number): number => 76 + index * 78
const dependencyY = (index: number): number => 76 + index * 82
</script>

<template>
  <div class="lineage-shell">
    <svg :viewBox="`0 0 960 ${graphHeight}`" role="img" aria-label="属性血缘图">
      <defs>
        <marker
          id="lineage-arrow"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#718096" />
        </marker>
      </defs>
      <text x="28" y="28" fill="#526076" font-size="12" font-weight="700">契约属性</text>
      <text x="402" y="28" fill="#526076" font-size="12" font-weight="700">血缘传递</text>
      <text x="760" y="28" fill="#526076" font-size="12" font-weight="700">下游依赖</text>
      <line x1="320" y1="42" x2="320" :y2="graphHeight - 20" stroke="#e0e4e9" stroke-dasharray="4 4" />
      <line x1="692" y1="42" x2="692" :y2="graphHeight - 20" stroke="#e0e4e9" stroke-dasharray="4 4" />

      <g v-for="(item, index) in lineageProperties" :key="item.property.id">
        <rect
          x="28"
          :y="propertyY(index) - 25"
          width="266"
          height="52"
          rx="6"
          :fill="item.property.id === rootId ? '#e8f3ff' : '#ffffff'"
          :stroke="item.property.id === rootId ? '#1677ff' : '#d8dee7'"
        />
        <text x="43" :y="propertyY(index) - 5" fill="#1d2939" font-size="12" font-weight="700">
          {{ item.event.key }}.{{ item.property.name }}
        </text>
        <text x="43" :y="propertyY(index) + 15" fill="#6c788b" font-size="10">
          {{ item.event.displayName }} · {{ item.property.type }}
        </text>
      </g>

      <g v-for="(item, index) in lineageProperties" :key="`link-${item.property.id}`">
        <line
          v-if="item.property.lineageSourceId"
          x1="294"
          :y1="propertyY(
            Math.max(
              0,
              lineageProperties.findIndex(
                (candidate) => candidate.property.id === item.property.lineageSourceId,
              ),
            ),
          ) + 1"
          x2="358"
          :y2="propertyY(index) + 1"
          stroke="#718096"
          stroke-width="1.4"
          marker-end="url(#lineage-arrow)"
        />
        <rect
          v-if="item.property.lineageSourceId"
          x="344"
          :y="propertyY(index) - 27"
          width="244"
          height="54"
          rx="6"
          fill="#fbfcfe"
          stroke="#d8dee7"
        />
        <text
          v-if="item.property.lineageSourceId"
          x="358"
          :y="propertyY(index) - 6"
          fill="#344054"
          font-size="11"
          font-weight="700"
        >
          {{ allProperties.find((candidate) => candidate.property.id === item.property.lineageSourceId)?.property.name }}
          →
          {{ item.property.name }}
        </text>
        <text
          v-if="item.property.lineageSourceId"
          x="358"
          :y="propertyY(index) + 13"
          fill="#748094"
          font-size="10"
        >
          跨事件继承 · {{ item.property.platforms.join('/') }}
        </text>
      </g>

      <g v-for="(dependency, index) in relatedDependencies" :key="dependency.id">
        <line
          x1="604"
          :y1="propertyY(Math.min(index, Math.max(lineageProperties.length - 1, 0))) + 1"
          x2="726"
          :y2="dependencyY(index) + 1"
          stroke="#159570"
          stroke-width="1.4"
          marker-end="url(#lineage-arrow)"
        />
        <rect
          x="726"
          :y="dependencyY(index) - 27"
          width="208"
          height="54"
          rx="6"
          fill="#effaf6"
          stroke="#a8d9c8"
        />
        <text x="740" :y="dependencyY(index) - 6" fill="#16604a" font-size="11" font-weight="700">
          {{ dependency.name }}
        </text>
        <text x="740" :y="dependencyY(index) + 13" fill="#58756b" font-size="10">
          {{ dependency.type }} · {{ dependency.owner }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.lineage-shell {
  overflow: auto;
}

svg {
  display: block;
  min-width: 960px;
  width: 100%;
  background: #fff;
}
</style>
