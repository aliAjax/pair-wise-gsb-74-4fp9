<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CheckCircleIcon,
  DataBaseIcon,
  ErrorTriangleIcon,
  LinkIcon,
} from 'tdesign-icons-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import PropertyLineageGraph from '@/components/PropertyLineageGraph.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useLineageQuery } from '@/composables/useGovernanceQueries'
import { useGovernanceStore } from '@/stores/governance'

const store = useGovernanceStore()
const lineageQuery = useLineageQuery()

const selectedEventId = ref(store.data.events[0]?.id ?? '')
const selectedPropertyId = ref(store.data.events[0]?.properties[0]?.id ?? '')
const events = computed(() => lineageQuery.data.value?.events ?? store.data.events)
const dependencies = computed(() => lineageQuery.data.value?.dependencies ?? store.data.dependencies)
const selectedEvent = computed(() => events.value.find((event) => event.id === selectedEventId.value))
const properties = computed(
  () => selectedEvent.value?.properties.filter((property) => !property.deletedAt) ?? [],
)
const selectedProperty = computed(
  () => properties.value.find((property) => property.id === selectedPropertyId.value) ?? null,
)
const sourceProperty = computed(() =>
  selectedProperty.value?.lineageSourceId
    ? events.value
        .flatMap((event) => event.properties.map((property) => ({ event, property })))
        .find((item) => item.property.id === selectedProperty.value?.lineageSourceId)
    : null,
)
const relatedDependencies = computed(() =>
  dependencies.value.filter((dependency) =>
    dependency.propertyRefs.some(
      (reference) =>
        reference.propertyId === selectedPropertyId.value ||
        reference.propertyId === selectedProperty.value?.lineageSourceId,
    ),
  ),
)

watch(selectedEventId, () => {
  selectedPropertyId.value = properties.value[0]?.id ?? ''
})

const statusOf = (status: string): string =>
  status === 'migrated' || status === 'active' ? 'active' : 'migration_required'
</script>

<template>
  <div class="page">
    <PageHeader
      eyebrow="属性治理"
      title="属性血缘与下游影响"
      description="沿属性继承关系查看跨事件传播，并定位使用该字段的数据看板、告警、模型和数据集。"
    />

    <section class="panel lineage-controls">
      <div class="toolbar-row">
        <div class="toolbar-field event-field">
          <span>事件</span>
          <t-select
            v-model="selectedEventId"
            :options="events.map((event) => ({ label: `${event.displayName} (${event.key})`, value: event.id }))"
            filterable
          />
        </div>
        <div class="toolbar-field property-field">
          <span>属性</span>
          <t-select
            v-model="selectedPropertyId"
            :options="properties.map((property) => ({ label: property.name, value: property.id }))"
            filterable
          />
        </div>
      </div>
    </section>

    <div class="lineage-summary">
      <div>
        <LinkIcon />
        <span>血缘来源</span>
        <strong>
          {{ sourceProperty ? `${sourceProperty.event.key}.${sourceProperty.property.name}` : '本事件原始字段' }}
        </strong>
      </div>
      <div>
        <DataBaseIcon />
        <span>下游依赖</span>
        <strong>{{ relatedDependencies.length }} 个</strong>
      </div>
      <div>
        <CheckCircleIcon />
        <span>字段类型</span>
        <strong>{{ selectedProperty?.type ?? '-' }}</strong>
      </div>
      <div>
        <ErrorTriangleIcon />
        <span>同步状态</span>
        <strong>
          {{
            relatedDependencies.some((dependency) => dependency.status === 'migration_required')
              ? '存在待迁移'
              : '全部一致'
          }}
        </strong>
      </div>
    </div>

    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">血缘图</h2>
        <span class="muted">选取属性后自动展开跨事件继承及下游引用</span>
      </div>
      <PropertyLineageGraph
        :events="events"
        :dependencies="dependencies"
        :selected-property-id="selectedPropertyId"
      />
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">下游引用明细</h2>
      </div>
      <div class="dependency-grid">
        <article v-for="dependency in relatedDependencies" :key="dependency.id" class="dependency-card">
          <div class="dependency-head">
            <div>
              <strong>{{ dependency.name }}</strong>
              <span>{{ dependency.owner }} · {{ dependency.environment }}</span>
            </div>
            <StatusTag :value="statusOf(dependency.status)" />
          </div>
          <div class="dependency-meta">
            <span>类型</span>
            <strong>{{ dependency.type }}</strong>
          </div>
          <div class="dependency-meta">
            <span>引用属性</span>
            <strong>
              {{
                dependency.propertyRefs
                  .map((reference) => {
                    const event = events.find((item) => item.id === reference.eventId)
                    const property = event?.properties.find((item) => item.id === reference.propertyId)
                    return `${event?.key ?? reference.eventId}.${property?.name ?? reference.propertyId}`
                  })
                  .join(' / ')
              }}
            </strong>
          </div>
        </article>
        <div v-if="relatedDependencies.length === 0" class="empty-state">
          当前属性没有已登记的下游引用。
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lineage-controls {
  padding: 14px 16px;
}

.event-field {
  min-width: 360px;
}

.property-field {
  min-width: 260px;
}

.lineage-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #dfe3e8;
  border-radius: 6px;
  background: #dfe3e8;
}

.lineage-summary > div {
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: auto auto;
  gap: 4px 8px;
  padding: 14px 16px;
  background: #fff;
}

.lineage-summary svg {
  grid-row: 1 / 3;
  align-self: center;
  color: #1264c5;
}

.lineage-summary span {
  color: #707b8d;
  font-size: 11px;
}

.lineage-summary strong {
  font-size: 12px;
}

.dependency-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: #e8ebef;
}

.dependency-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: #fff;
}

.dependency-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dependency-head > div {
  display: grid;
  gap: 5px;
}

.dependency-head span,
.dependency-meta span {
  color: #748094;
  font-size: 10px;
}

.dependency-meta {
  display: grid;
  gap: 5px;
}

.dependency-meta strong {
  overflow-wrap: anywhere;
  font-size: 11px;
}
</style>
