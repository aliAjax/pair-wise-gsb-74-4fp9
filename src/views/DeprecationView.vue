<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { AddIcon, Edit1Icon, ErrorTriangleIcon } from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { DeprecationPlan } from '@/models/domain'
import { createId } from '@/services/repository'
import { useGovernanceStore } from '@/stores/governance'

const store = useGovernanceStore()
const editorVisible = ref(false)
const form = reactive<DeprecationPlan>({
  id: '',
  eventId: '',
  replacementEventId: '',
  reason: '',
  owner: '',
  stopCollectAt: '',
  retireAt: '',
  status: 'planned',
  migrationNote: '',
})

const statusOptions = [
  { label: '已计划', value: 'planned' },
  { label: '已公告', value: 'announced' },
  { label: '已停采', value: 'stopped' },
  { label: '已停用', value: 'retired' },
  { label: '已取消', value: 'cancelled' },
]

const plans = computed(() =>
  store.data.deprecations.map((plan) => ({
    plan,
    event: store.data.events.find((event) => event.id === plan.eventId),
    replacement: store.data.events.find((event) => event.id === plan.replacementEventId),
    dependencies: store.data.dependencies.filter((dependency) =>
      dependency.eventIds.includes(plan.eventId),
    ),
  })),
)

const openEditor = (plan?: DeprecationPlan): void => {
  Object.assign(
    form,
    plan
      ? structuredClone(plan)
      : {
          id: '',
          eventId: store.data.events.find((event) => event.status === 'published')?.id ?? '',
          replacementEventId: '',
          reason: '',
          owner: '',
          stopCollectAt: '',
          retireAt: '',
          status: 'planned',
          migrationNote: '',
        } satisfies DeprecationPlan,
  )
  editorVisible.value = true
}

const savePlan = async (): Promise<void> => {
  if (
    !form.eventId ||
    !form.owner.trim() ||
    !form.reason.trim() ||
    !form.stopCollectAt ||
    !form.retireAt
  ) {
    await MessagePlugin.error('事件、负责人、原因、停采日和停用日不能为空')
    return
  }
  if (new Date(form.retireAt) <= new Date(form.stopCollectAt)) {
    await MessagePlugin.error('停用日期必须晚于停采日期')
    return
  }
  store.saveDeprecation({ ...structuredClone(form), id: form.id || createId('plan') })
  editorVisible.value = false
  await MessagePlugin.success('废弃计划已保存')
}

const advance = async (plan: DeprecationPlan): Promise<void> => {
  const sequence: DeprecationPlan['status'][] = ['planned', 'announced', 'stopped', 'retired']
  const index = sequence.indexOf(plan.status)
  const next = plan.status === 'cancelled' ? 'planned' : sequence[Math.min(index + 1, 3)]
  if (!next) return
  store.saveDeprecation({ ...plan, status: next })
  await MessagePlugin.success(`废弃计划已推进到 ${next}`)
}
</script>

<template>
  <div class="page">
    <PageHeader
      eyebrow="生命周期"
      title="废弃计划"
      description="维护事件停采与停用日期、替代事件、迁移说明和受影响下游，降低旧口径残留成本。"
    />

    <section class="panel filter-panel">
      <div class="toolbar-row">
        <div>
          <strong>{{ plans.length }} 个废弃计划</strong>
          <p class="page-description">发布候选会自动关联待停用事件和迁移依赖。</p>
        </div>
        <div class="filter-actions">
          <t-button theme="primary" @click="openEditor()">
            <template #icon><AddIcon /></template>
            新建废弃计划
          </t-button>
        </div>
      </div>
    </section>

    <div class="deprecation-grid">
      <article v-for="item in plans" :key="item.plan.id" class="panel deprecation-card">
        <div class="deprecation-head">
          <div>
            <code>{{ item.event?.key }}</code>
            <h2>{{ item.event?.displayName }}</h2>
          </div>
          <StatusTag :value="item.plan.status" />
        </div>
        <p>{{ item.plan.reason }}</p>
        <dl class="deprecation-facts">
          <div>
            <dt>替代事件</dt>
            <dd>{{ item.replacement?.key ?? '不设替代' }}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{{ item.plan.owner }}</dd>
          </div>
          <div>
            <dt>停止采集</dt>
            <dd>{{ item.plan.stopCollectAt }}</dd>
          </div>
          <div>
            <dt>正式停用</dt>
            <dd>{{ item.plan.retireAt }}</dd>
          </div>
        </dl>
        <div class="migration-note">
          <strong>迁移说明</strong>
          <span>{{ item.plan.migrationNote || '尚未填写' }}</span>
        </div>
        <div class="affected-deps">
          <div>
            <ErrorTriangleIcon v-if="item.dependencies.length" />
            <strong>{{ item.dependencies.length }} 个下游仍引用</strong>
          </div>
          <span v-for="dependency in item.dependencies" :key="dependency.id">
            {{ dependency.name }} · {{ dependency.status }}
          </span>
        </div>
        <div class="card-actions">
          <t-button variant="outline" size="small" @click="openEditor(item.plan)">
            <template #icon><Edit1Icon /></template>
            编辑
          </t-button>
          <t-button
            v-if="item.plan.status !== 'retired' && item.plan.status !== 'cancelled'"
            theme="primary"
            size="small"
            @click="advance(item.plan)"
          >
            推进状态
          </t-button>
        </div>
      </article>
    </div>

    <t-dialog
      v-model:visible="editorVisible"
      :header="form.id ? '编辑废弃计划' : '新建废弃计划'"
      width="760px"
      :footer="false"
    >
      <div class="editor-form">
        <div class="field">
          <label>待废弃事件</label>
          <t-select
            v-model="form.eventId"
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
          <label>替代事件</label>
          <t-select
            v-model="form.replacementEventId"
            :options="
              store.data.events
                .filter((event) => event.id !== form.eventId)
                .map((event) => ({
                  label: `${event.displayName} (${event.key})`,
                  value: event.id,
                }))
            "
            clearable
          />
        </div>
        <div class="field">
          <label>负责人</label>
          <t-input v-model="form.owner" />
        </div>
        <div class="field">
          <label>计划状态</label>
          <t-select v-model="form.status" :options="statusOptions" />
        </div>
        <div class="field">
          <label>停止采集日期</label>
          <t-input v-model="form.stopCollectAt" type="date" />
        </div>
        <div class="field">
          <label>正式停用日期</label>
          <t-input v-model="form.retireAt" type="date" />
        </div>
        <div class="field field-wide">
          <label>废弃原因</label>
          <t-textarea v-model="form.reason" :autosize="{ minRows: 3, maxRows: 5 }" />
        </div>
        <div class="field field-wide">
          <label>迁移说明</label>
          <t-textarea v-model="form.migrationNote" :autosize="{ minRows: 4, maxRows: 7 }" />
        </div>
      </div>
      <div class="dialog-footer">
        <t-button variant="outline" @click="editorVisible = false">取消</t-button>
        <t-button theme="primary" @click="savePlan">保存计划</t-button>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.filter-panel {
  padding: 14px 16px;
}

.deprecation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.deprecation-card {
  display: grid;
  gap: 15px;
  padding: 18px;
}

.deprecation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.deprecation-head code {
  color: #1264c5;
  font-size: 11px;
}

.deprecation-head h2 {
  margin: 6px 0 0;
  font-size: 18px;
}

.deprecation-card > p {
  margin: 0;
  color: #5c687a;
  font-size: 13px;
  line-height: 1.6;
}

.deprecation-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.deprecation-facts > div {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid #e3e7ec;
  border-radius: 5px;
  background: #fafbfc;
}

.deprecation-facts dt {
  color: #778294;
  font-size: 10px;
}

.deprecation-facts dd {
  margin: 0;
  font-size: 12px;
}

.migration-note,
.affected-deps {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-left: 3px solid #8ba7c8;
  background: #f7f9fb;
}

.migration-note span,
.affected-deps span {
  color: #687386;
  font-size: 11px;
  line-height: 1.5;
}

.affected-deps {
  border-left-color: #d58b32;
  background: #fffaf0;
}

.affected-deps > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.affected-deps svg {
  color: #c46a00;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
