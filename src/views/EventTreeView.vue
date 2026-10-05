<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import {
  AddIcon,
  DeleteIcon,
  Edit1Icon,
  RefreshIcon,
  SearchIcon,
} from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import EventTree from '@/components/EventTree.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useEventsQuery } from '@/composables/useGovernanceQueries'
import type {
  EventDefinition,
  EventProperty,
  Platform,
  PlatformRule,
  PropertyType,
} from '@/models/domain'
import { createId } from '@/services/repository'
import { useGovernanceStore } from '@/stores/governance'

const store = useGovernanceStore()
const queryClient = useQueryClient()

const filters = reactive({
  keyword: '',
  status: '',
  platform: '',
  category: '',
})
const filterRef = computed(() => ({ ...filters }))
const eventsQuery = useEventsQuery(filterRef)
const events = computed(() => eventsQuery.data.value ?? store.data.events)

const selectedId = ref(store.data.events[0]?.id ?? '')
const selectedEvent = computed(
  () => store.data.events.find((event) => event.id === selectedId.value) ?? null,
)
const eventEditorVisible = ref(false)
const propertyEditorVisible = ref(false)
const platformEditorVisible = ref(false)

const eventForm = reactive<EventDefinition>({
  id: '',
  key: '',
  displayName: '',
  category: '',
  description: '',
  trigger: '',
  status: 'draft',
  version: '1.0.0',
  owner: '',
  properties: [],
  platformRules: [],
  scenarioIds: [],
  downstreamDependencyIds: [],
  updatedAt: '',
})

const propertyForm = reactive<EventProperty>({
  id: '',
  eventId: '',
  name: '',
  displayName: '',
  type: 'string',
  required: false,
  description: '',
  enumValues: [],
  owner: '',
  synonyms: [],
  platforms: [],
  lineageSourceId: '',
})

const platformForm = reactive<PlatformRule>({
  id: '',
  eventId: '',
  platform: 'web',
  enabled: true,
  trigger: '',
  owner: '',
  requiredPropertyIds: [],
  note: '',
})

const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '评审中', value: 'reviewing' },
  { label: '已通过', value: 'approved' },
  { label: '已发布', value: 'published' },
  { label: '已废弃', value: 'deprecated' },
]
const platformOptions = [
  { label: 'Web', value: 'web' },
  { label: 'iOS', value: 'ios' },
  { label: 'Android', value: 'android' },
  { label: 'Server', value: 'server' },
  { label: '小程序', value: 'miniprogram' },
]
const typeOptions = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '布尔', value: 'boolean' },
  { label: '数组', value: 'array' },
  { label: '对象', value: 'object' },
  { label: '枚举', value: 'enum' },
]
const categoryOptions = ['交易', '营销', '搜索', '用户', '内容'].map((value) => ({
  label: value,
  value,
}))

const propertyColumns = [
  { colKey: 'name', title: '属性名', width: 180 },
  { colKey: 'displayName', title: '中文名', width: 130 },
  { colKey: 'type', title: '类型', width: 90 },
  { colKey: 'required', title: '必填', width: 80 },
  { colKey: 'platforms', title: '平台', width: 190 },
  { colKey: 'owner', title: '负责人', width: 130 },
  { colKey: 'actions', title: '操作', width: 120 },
]
const ruleColumns = [
  { colKey: 'platform', title: '平台', width: 100 },
  { colKey: 'enabled', title: '状态', width: 90 },
  { colKey: 'trigger', title: '触发时机', minWidth: 260 },
  { colKey: 'owner', title: '负责人', width: 130 },
  { colKey: 'actions', title: '操作', width: 90 },
]

const invalidate = async (): Promise<void> => {
  await queryClient.invalidateQueries({ queryKey: ['events'] })
  await queryClient.invalidateQueries({ queryKey: ['lineage'] })
  await queryClient.invalidateQueries({ queryKey: ['validations'] })
  await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
}

const openEventEditor = (): void => {
  if (!selectedEvent.value) return
  Object.assign(eventForm, structuredClone(selectedEvent.value))
  eventEditorVisible.value = true
}

const addEvent = (): void => {
  Object.assign(eventForm, {
    id: '',
    key: '',
    displayName: '',
    category: '交易',
    description: '',
    trigger: '',
    status: 'draft',
    version: '1.0.0',
    owner: '',
    properties: [],
    platformRules: [],
    scenarioIds: [],
    downstreamDependencyIds: [],
    updatedAt: '',
  } satisfies EventDefinition)
  eventEditorVisible.value = true
}

const saveEvent = async (): Promise<void> => {
  if (
    !eventForm.key.trim() ||
    !eventForm.displayName.trim() ||
    !eventForm.owner.trim() ||
    !eventForm.trigger.trim()
  ) {
    await MessagePlugin.error('事件名、中文名、负责人和触发时机不能为空')
    return
  }
  if (store.data.events.some((event) => event.key === eventForm.key && event.id !== eventForm.id)) {
    await MessagePlugin.error('事件名已存在')
    return
  }
  const saved: EventDefinition = {
    ...structuredClone(eventForm),
    id: eventForm.id || createId('evt'),
    updatedAt: new Date().toISOString(),
  }
  store.saveEvent(saved)
  selectedId.value = saved.id
  eventEditorVisible.value = false
  await invalidate()
  await MessagePlugin.success('事件契约已保存')
}

const openPropertyEditor = (property?: EventProperty): void => {
  if (!selectedEvent.value) return
  Object.assign(
    propertyForm,
    property
      ? structuredClone(property)
      : {
          id: '',
          eventId: selectedEvent.value.id,
          name: '',
          displayName: '',
          type: 'string',
          required: false,
          description: '',
          enumValues: [],
          owner: selectedEvent.value.owner,
          synonyms: [],
          platforms: ['web', 'ios', 'android', 'server'],
          lineageSourceId: '',
        } satisfies EventProperty,
  )
  propertyEditorVisible.value = true
}

const saveProperty = async (): Promise<void> => {
  if (!selectedEvent.value || !propertyForm.name.trim() || !propertyForm.displayName.trim()) {
    await MessagePlugin.error('属性名和中文名不能为空')
    return
  }
  const duplicate = selectedEvent.value.properties.some(
    (property) => property.name === propertyForm.name && property.id !== propertyForm.id,
  )
  if (duplicate) {
    await MessagePlugin.error('当前事件已存在同名属性')
    return
  }
  const saved = {
    ...structuredClone(propertyForm),
    id: propertyForm.id || createId('prop'),
    eventId: selectedEvent.value.id,
  }
  store.saveProperty(selectedEvent.value.id, saved)
  propertyEditorVisible.value = false
  await invalidate()
  await MessagePlugin.success('属性已保存')
}

const openRuleEditor = (rule?: PlatformRule): void => {
  if (!selectedEvent.value) return
  Object.assign(
    platformForm,
    rule
      ? structuredClone(rule)
      : {
          id: '',
          eventId: selectedEvent.value.id,
          platform: 'web',
          enabled: true,
          trigger: selectedEvent.value.trigger,
          owner: selectedEvent.value.owner,
          requiredPropertyIds: [],
          note: '',
        } satisfies PlatformRule,
  )
  platformEditorVisible.value = true
}

const saveRule = async (): Promise<void> => {
  if (!selectedEvent.value || !platformForm.trigger.trim() || !platformForm.owner.trim()) {
    await MessagePlugin.error('平台触发时机和负责人不能为空')
    return
  }
  store.savePlatformRule(selectedEvent.value.id, {
    ...structuredClone(platformForm),
    id: platformForm.id || createId('rule'),
    eventId: selectedEvent.value.id,
  })
  platformEditorVisible.value = false
  await invalidate()
  await MessagePlugin.success('平台规则已保存')
}

const removeProperty = async (propertyId: string): Promise<void> => {
  if (!selectedEvent.value) return
  store.deleteProperty(selectedEvent.value.id, propertyId)
  await invalidate()
  await MessagePlugin.warning('属性已标记删除，仍引用它的下游依赖会进入迁移清单')
}

const toggleProperty = (row: EventProperty, value: boolean): void => {
  if (!selectedEvent.value) return
  store.saveProperty(selectedEvent.value.id, { ...row, required: value })
}

const updateRequired = (row: EventProperty, value: unknown): void => {
  toggleProperty(row, Boolean(value))
}

const setPropertyType = (value: unknown): void => {
  propertyForm.type = value as PropertyType
}

const setSynonyms = (value: unknown): void => {
  propertyForm.synonyms = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const setEnumValues = (value: unknown): void => {
  propertyForm.enumValues = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const setPlatform = (value: unknown): void => {
  platformForm.platform = value as Platform
}
</script>

<template>
  <div class="page">
    <PageHeader
      eyebrow="契约目录"
      title="事件树与契约编辑"
      description="按业务域维护事件、属性、枚举、多端触发规则和负责人，所有编辑均进入版本差异。"
    />

    <section class="panel filter-panel">
      <div class="toolbar-row">
        <div class="toolbar-field keyword-field">
          <span>关键词</span>
          <t-input v-model="filters.keyword" placeholder="事件名、中文名或负责人">
            <template #prefix-icon><SearchIcon /></template>
          </t-input>
        </div>
        <div class="toolbar-field">
          <span>业务域</span>
          <t-select
            v-model="filters.category"
            :options="categoryOptions"
            placeholder="全部业务域"
            clearable
          />
        </div>
        <div class="toolbar-field">
          <span>状态</span>
          <t-select
            v-model="filters.status"
            :options="statusOptions"
            placeholder="全部状态"
            clearable
          />
        </div>
        <div class="toolbar-field">
          <span>平台</span>
          <t-select
            v-model="filters.platform"
            :options="platformOptions"
            placeholder="全部平台"
            clearable
          />
        </div>
        <div class="filter-actions">
          <t-button variant="outline" @click="eventsQuery.refetch()">
            <template #icon><RefreshIcon /></template>
            刷新
          </t-button>
          <t-button theme="primary" @click="addEvent">
            <template #icon><AddIcon /></template>
            新增事件
          </t-button>
        </div>
      </div>
    </section>

    <div class="event-workspace">
      <aside class="panel tree-panel">
        <div class="panel-header">
          <h2 class="panel-title">事件树</h2>
          <span class="muted">{{ events.length }} 个</span>
        </div>
        <EventTree
          :events="events"
          :selected-id="selectedId"
          @select="(eventId) => (selectedId = eventId)"
        />
      </aside>

      <section v-if="selectedEvent" class="event-detail">
        <div class="panel contract-head">
          <div>
            <div class="contract-code">{{ selectedEvent.key }}</div>
            <h2>{{ selectedEvent.displayName }}</h2>
            <p>{{ selectedEvent.description }}</p>
          </div>
          <div class="contract-actions">
            <StatusTag :value="selectedEvent.status" />
            <t-button variant="outline" @click="openEventEditor">
              <template #icon><Edit1Icon /></template>
              编辑契约
            </t-button>
          </div>
        </div>

        <div class="contract-facts">
          <div>
            <span>版本</span>
            <strong>{{ selectedEvent.version }}</strong>
          </div>
          <div>
            <span>业务域</span>
            <strong>{{ selectedEvent.category }}</strong>
          </div>
          <div>
            <span>负责人</span>
            <strong>{{ selectedEvent.owner }}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{{ new Date(selectedEvent.updatedAt).toLocaleString('zh-CN') }}</strong>
          </div>
          <div class="fact-wide">
            <span>触发时机</span>
            <strong>{{ selectedEvent.trigger }}</strong>
          </div>
        </div>

        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">属性契约</h2>
            <t-button theme="primary" variant="outline" @click="openPropertyEditor()">
              <template #icon><AddIcon /></template>
              新增属性
            </t-button>
          </div>
          <t-table
            row-key="id"
            :data="selectedEvent.properties.filter((property) => !property.deletedAt)"
            :columns="propertyColumns"
            size="small"
            stripe
          >
            <template #name="{ row }">
              <code>{{ row.name }}</code>
              <div v-if="row.synonyms.length" class="synonym">
                别名 {{ row.synonyms.join(' / ') }}
              </div>
            </template>
            <template #type="{ row }">
              <StatusTag :value="row.type" />
              <div v-if="row.enumValues.length" class="enum-values">
                {{ row.enumValues.join(' / ') }}
              </div>
            </template>
            <template #required="{ row }">
              <t-switch
                :value="row.required"
                size="small"
                @change="updateRequired(row, $event)"
              />
            </template>
            <template #platforms="{ row }">
              <span class="platform-list">{{ row.platforms.join(' / ') }}</span>
            </template>
            <template #actions="{ row }">
              <div class="action-stack">
                <t-button variant="text" size="small" @click="openPropertyEditor(row)">
                  <template #icon><Edit1Icon /></template>
                </t-button>
                <t-button
                  variant="text"
                  theme="danger"
                  size="small"
                  @click="removeProperty(row.id)"
                >
                  <template #icon><DeleteIcon /></template>
                </t-button>
              </div>
            </template>
          </t-table>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">平台差异</h2>
            <t-button theme="primary" variant="outline" @click="openRuleEditor()">
              <template #icon><AddIcon /></template>
              新增平台规则
            </t-button>
          </div>
          <t-table
            row-key="id"
            :data="selectedEvent.platformRules"
            :columns="ruleColumns"
            size="small"
            stripe
          >
            <template #enabled="{ row }">
              <StatusTag :value="row.enabled ? 'active' : 'disabled'" />
            </template>
            <template #actions="{ row }">
              <t-button variant="text" size="small" @click="openRuleEditor(row)">
                <template #icon><Edit1Icon /></template>
              </t-button>
            </template>
          </t-table>
        </section>
      </section>
      <div v-else class="panel empty-state">从左侧选择一个事件查看契约。</div>
    </div>

    <t-dialog
      v-model:visible="eventEditorVisible"
      :header="eventForm.id ? '编辑事件契约' : '新增事件契约'"
      width="760px"
      :footer="false"
    >
      <div class="editor-form">
        <div class="field">
          <label>事件名</label>
          <t-input v-model="eventForm.key" placeholder="lower_snake_case" />
        </div>
        <div class="field">
          <label>中文名</label>
          <t-input v-model="eventForm.displayName" />
        </div>
        <div class="field">
          <label>业务域</label>
          <t-select v-model="eventForm.category" :options="categoryOptions" />
        </div>
        <div class="field">
          <label>事件状态</label>
          <t-select v-model="eventForm.status" :options="statusOptions" />
        </div>
        <div class="field">
          <label>契约版本</label>
          <t-input v-model="eventForm.version" />
        </div>
        <div class="field">
          <label>负责人</label>
          <t-input v-model="eventForm.owner" />
        </div>
        <div class="field field-wide">
          <label>事件说明</label>
          <t-textarea v-model="eventForm.description" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
        <div class="field field-wide">
          <label>触发时机</label>
          <t-textarea v-model="eventForm.trigger" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
      </div>
      <div class="dialog-footer">
        <t-button variant="outline" @click="eventEditorVisible = false">取消</t-button>
        <t-button theme="primary" @click="saveEvent">保存事件</t-button>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="propertyEditorVisible"
      :header="propertyForm.id ? '编辑属性' : '新增属性'"
      width="760px"
      :footer="false"
    >
      <div class="editor-form">
        <div class="field">
          <label>属性名</label>
          <t-input v-model="propertyForm.name" />
        </div>
        <div class="field">
          <label>中文名</label>
          <t-input v-model="propertyForm.displayName" />
        </div>
        <div class="field">
          <label>数据类型</label>
          <t-select
            v-model="propertyForm.type"
            :options="typeOptions"
            @change="setPropertyType"
          />
        </div>
        <div class="field switch-field">
          <label>是否必填</label>
          <t-switch v-model="propertyForm.required" />
        </div>
        <div class="field">
          <label>责任人</label>
          <t-input v-model="propertyForm.owner" />
        </div>
        <div class="field">
          <label>同义属性名</label>
          <t-input
            :value="propertyForm.synonyms.join(',')"
            placeholder="逗号分隔"
            @change="setSynonyms"
          />
        </div>
        <div class="field field-wide">
          <label>适用平台</label>
          <t-select
            v-model="propertyForm.platforms"
            :options="platformOptions"
            multiple
            clearable
          />
        </div>
        <div v-if="propertyForm.type === 'enum'" class="field field-wide">
          <label>枚举值</label>
          <t-input
            :value="propertyForm.enumValues.join(',')"
            placeholder="逗号分隔"
            @change="setEnumValues"
          />
        </div>
        <div class="field field-wide">
          <label>属性说明</label>
          <t-textarea v-model="propertyForm.description" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
      </div>
      <div class="dialog-footer">
        <t-button variant="outline" @click="propertyEditorVisible = false">取消</t-button>
        <t-button theme="primary" @click="saveProperty">保存属性</t-button>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="platformEditorVisible"
      :header="platformForm.id ? '编辑平台规则' : '新增平台规则'"
      width="680px"
      :footer="false"
    >
      <div class="editor-form">
        <div class="field">
          <label>平台</label>
          <t-select
            v-model="platformForm.platform"
            :options="platformOptions"
            @change="setPlatform"
          />
        </div>
        <div class="field switch-field">
          <label>启用采集</label>
          <t-switch v-model="platformForm.enabled" />
        </div>
        <div class="field">
          <label>负责人</label>
          <t-input v-model="platformForm.owner" />
        </div>
        <div class="field field-wide">
          <label>平台必填属性</label>
          <t-select
            v-model="platformForm.requiredPropertyIds"
            :options="
              selectedEvent?.properties
                .filter((property) => !property.deletedAt)
                .map((property) => ({ label: property.name, value: property.id })) ?? []
            "
            multiple
            clearable
          />
        </div>
        <div class="field field-wide">
          <label>触发时机</label>
          <t-textarea v-model="platformForm.trigger" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
        <div class="field field-wide">
          <label>差异说明</label>
          <t-textarea v-model="platformForm.note" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
      </div>
      <div class="dialog-footer">
        <t-button variant="outline" @click="platformEditorVisible = false">取消</t-button>
        <t-button theme="primary" @click="saveRule">保存规则</t-button>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.filter-panel {
  padding: 14px 16px;
}

.keyword-field {
  min-width: 260px;
}

.event-workspace {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.tree-panel {
  position: sticky;
  top: 82px;
  max-height: calc(100vh - 106px);
  overflow: auto;
}

.event-detail {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.contract-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
}

.contract-code {
  color: #1264c5;
  font-family: monospace;
  font-size: 12px;
}

.contract-head h2 {
  margin: 7px 0;
  font-size: 20px;
}

.contract-head p {
  margin: 0;
  color: #657084;
  font-size: 13px;
}

.contract-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.contract-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #dfe3e8;
  border-radius: 6px;
  background: #dfe3e8;
}

.contract-facts > div {
  display: grid;
  gap: 6px;
  padding: 13px 15px;
  background: #fff;
}

.contract-facts span {
  color: #727d8f;
  font-size: 11px;
}

.contract-facts strong {
  font-size: 12px;
}

.contract-facts .fact-wide {
  grid-column: 1 / -1;
}

.synonym,
.enum-values {
  margin-top: 4px;
  color: #7a8494;
  font-size: 10px;
}

.platform-list {
  color: #596579;
  font-size: 11px;
}

.switch-field {
  align-content: start;
}

.switch-field > label {
  min-height: 32px;
  display: flex;
  align-items: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid #e8ebef;
}
</style>
