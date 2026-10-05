<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCircleIcon, ErrorCircleIcon, SearchIcon } from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useValidationQuery } from '@/composables/useGovernanceQueries'
import type { EventDefinition, SampleValidationResult } from '@/models/domain'
import { validateSample } from '@/services/selectors'
import { useGovernanceStore } from '@/stores/governance'

const store = useGovernanceStore()
const validationQuery = useValidationQuery()
const issues = computed(() => validationQuery.data.value ?? store.issues)

const kindFilter = ref('')
const severityFilter = ref('')
const selectedEventId = ref(store.data.events[0]?.id ?? '')
const sampleText = ref('')
const validationResult = ref<SampleValidationResult | null>(null)

const kindOptions = [
  { label: '重复事件', value: 'duplicate_event' },
  { label: '同义属性', value: 'synonym_property' },
  { label: '命名越界', value: 'naming_violation' },
  { label: '类型变化', value: 'type_change' },
  { label: '删除字段引用', value: 'deleted_property_referenced' },
  { label: '必填差异', value: 'required_mismatch' },
]
const severityOptions = [
  { label: '严重', value: 'critical' },
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
]

const filteredIssues = computed(() =>
  issues.value.filter(
    (issue) =>
      (!kindFilter.value || issue.kind === kindFilter.value) &&
      (!severityFilter.value || issue.severity === severityFilter.value),
  ),
)
const selectedEvent = computed(
  () => store.data.events.find((event) => event.id === selectedEventId.value) ?? null,
)

const sampleForEvent = (event: EventDefinition): string => {
  const payload: Record<string, unknown> = {}
  event.properties
    .filter((property) => !property.deletedAt)
    .forEach((property) => {
      if (!property.required && property.name === 'coupon_id') return
      switch (property.type) {
        case 'string':
          payload[property.name] = `sample_${property.name}`
          break
        case 'number':
          payload[property.name] = 100
          break
        case 'boolean':
          payload[property.name] = true
          break
        case 'array':
          payload[property.name] = []
          break
        case 'object':
          payload[property.name] = {}
          break
        case 'enum':
          payload[property.name] = property.enumValues[0] ?? ''
          break
      }
    })
  return JSON.stringify(payload, null, 2)
}

watch(
  selectedEvent,
  (event) => {
    sampleText.value = event ? sampleForEvent(event) : '{}'
    validationResult.value = null
  },
  { immediate: true },
)

const runValidation = async (): Promise<void> => {
  if (!selectedEvent.value) return
  try {
    const parsed = JSON.parse(sampleText.value) as Record<string, unknown>
    validationResult.value = validateSample(selectedEvent.value, parsed)
    if (validationResult.value.valid) {
      await MessagePlugin.success('示例通过当前契约校验')
    } else {
      await MessagePlugin.error(`发现 ${validationResult.value.errors.length} 个类型或必填错误`)
    }
  } catch (error) {
    validationResult.value = {
      valid: false,
      errors: [error instanceof Error ? error.message : 'JSON 解析失败'],
      warnings: [],
    }
    await MessagePlugin.error('示例不是有效 JSON')
  }
}
</script>

<template>
  <div class="page">
    <PageHeader
      eyebrow="规则引擎"
      title="契约校验与示例检查"
      description="检查重复事件、同义属性、命名越界、类型变化和删除字段引用，并用 JSON 示例验证单事件契约。"
    />

    <section class="panel filter-panel">
      <div class="toolbar-row">
        <div class="toolbar-field">
          <span>问题类型</span>
          <t-select v-model="kindFilter" :options="kindOptions" placeholder="全部类型" clearable />
        </div>
        <div class="toolbar-field">
          <span>严重级别</span>
          <t-select
            v-model="severityFilter"
            :options="severityOptions"
            placeholder="全部级别"
            clearable
          />
        </div>
        <div class="filter-actions">
          <t-button variant="outline" @click="validationQuery.refetch()">
            <template #icon><SearchIcon /></template>
            重新扫描
          </t-button>
        </div>
      </div>
    </section>

    <div class="validation-layout">
      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">治理问题 {{ filteredIssues.length }} 项</h2>
        </div>
        <div class="validation-list issue-list">
          <article
            v-for="issue in filteredIssues"
            :key="issue.id"
            class="validation-item"
            :class="{ error: issue.severity === 'critical' || issue.severity === 'high' }"
          >
            <i class="validation-dot"></i>
            <div class="validation-copy">
              <strong>{{ issue.title }}</strong>
              <p>{{ issue.detail }}</p>
              <small>{{ issue.suggestion }}</small>
            </div>
            <div class="issue-tags">
              <StatusTag :value="issue.severity" />
              <StatusTag :value="issue.kind" />
            </div>
          </article>
          <div v-if="filteredIssues.length === 0" class="empty-state">当前筛选下没有问题。</div>
        </div>
      </section>

      <section class="panel sample-panel">
        <div class="panel-header">
          <h2 class="panel-title">示例校验</h2>
          <t-button theme="primary" @click="runValidation">
            <template #icon><CheckCircleIcon /></template>
            执行校验
          </t-button>
        </div>
        <div class="sample-controls">
          <div class="field">
            <label>选择事件</label>
            <t-select
              v-model="selectedEventId"
              :options="
                store.data.events.map((event) => ({
                  label: `${event.displayName} (${event.key})`,
                  value: event.id,
                }))
              "
              filterable
            />
          </div>
          <div class="field">
            <label>JSON 示例</label>
            <t-textarea v-model="sampleText" :autosize="{ minRows: 15, maxRows: 24 }" />
          </div>
        </div>
        <div
          v-if="validationResult"
          class="sample-result"
          :class="{ valid: validationResult.valid }"
        >
          <div class="result-head">
            <CheckCircleIcon v-if="validationResult.valid" />
            <ErrorCircleIcon v-else />
            <strong>{{ validationResult.valid ? '校验通过' : '校验未通过' }}</strong>
          </div>
          <ul v-if="validationResult.errors.length" class="error-list">
            <li v-for="error in validationResult.errors" :key="error">{{ error }}</li>
          </ul>
          <ul v-if="validationResult.warnings.length" class="warning-list">
            <li v-for="warning in validationResult.warnings" :key="warning">{{ warning }}</li>
          </ul>
          <p v-if="validationResult.valid && validationResult.warnings.length === 0">
            示例属性、类型、必填规则和枚举值均通过。
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  padding: 14px 16px;
}

.validation-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(420px, 0.8fr);
  gap: 16px;
  align-items: start;
}

.issue-list {
  padding: 16px;
}

.validation-copy small {
  display: block;
  margin-top: 7px;
  color: #1264c5;
  font-size: 11px;
}

.issue-tags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.sample-panel {
  position: sticky;
  top: 82px;
}

.sample-controls {
  display: grid;
  gap: 15px;
  padding: 16px;
}

.sample-result {
  margin: 0 16px 16px;
  padding: 14px;
  border: 1px solid #f2b8b5;
  border-radius: 6px;
  background: #fff7f6;
}

.sample-result.valid {
  border-color: #a8d9c8;
  background: #f2fbf7;
}

.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-head svg {
  color: #c7362c;
}

.sample-result.valid .result-head svg {
  color: #0f8a62;
}

.sample-result ul {
  margin: 10px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.65;
}

.sample-result p {
  margin: 9px 0 0;
  color: #4d6d60;
  font-size: 12px;
}

.error-list {
  color: #a81f17;
}

.warning-list {
  color: #a45a00;
}
</style>
