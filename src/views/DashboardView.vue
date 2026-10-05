<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ApiIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ErrorCircleIcon,
  FileSearchIcon,
  RefreshIcon,
} from 'tdesign-icons-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useDashboardQuery, useValidationQuery } from '@/composables/useGovernanceQueries'
import { releaseReadiness } from '@/services/selectors'
import { useGovernanceStore } from '@/stores/governance'

const store = useGovernanceStore()
const dashboardQuery = useDashboardQuery()
const validationQuery = useValidationQuery()

const dashboard = computed(() => dashboardQuery.data.value)
const issues = computed(() => validationQuery.data.value ?? store.issues)
const currentRelease = computed(() => dashboard.value?.currentRelease ?? null)
const readiness = computed(() =>
  currentRelease.value ? releaseReadiness(currentRelease.value, issues.value) : 0,
)

const pendingMigrations = computed(
  () =>
    currentRelease.value?.migrationConfirmations.filter((item) => item.status !== 'confirmed') ?? [],
)
const pendingApprovals = computed(
  () => currentRelease.value?.approvals.filter((item) => item.status === 'pending') ?? [],
)
</script>

<template>
  <div class="page">
    <PageHeader
      eyebrow="数据契约治理"
      title="事件治理工作台"
      description="聚合多端事件契约、校验问题、下游迁移与发布评审状态。"
    />

    <section v-if="dashboardQuery.isError.value" class="load-error">
      数据加载失败：{{ dashboardQuery.error.value?.message }}
    </section>

    <div class="metrics-grid">
      <div class="metric">
        <div class="metric-label">事件契约</div>
        <div class="metric-value">{{ dashboard?.eventCount ?? store.data.events.length }}</div>
        <div class="metric-note">{{ dashboard?.draftEventCount ?? 0 }} 个草稿或评审中</div>
      </div>
      <div class="metric">
        <div class="metric-label">下游依赖</div>
        <div class="metric-value">{{ dashboard?.dependencyCount ?? store.data.dependencies.length }}</div>
        <div class="metric-note">{{ dashboard?.pendingMigrations ?? 0 }} 个待迁移确认</div>
      </div>
      <div class="metric">
        <div class="metric-label">契约问题</div>
        <div class="metric-value danger-text">
          {{ dashboard?.validationIssueCount ?? issues.length }}
        </div>
        <div class="metric-note">{{ dashboard?.criticalIssueCount ?? 0 }} 个严重问题</div>
      </div>
      <div class="metric">
        <div class="metric-label">发布就绪度</div>
        <div class="metric-value">{{ readiness }}%</div>
        <div class="metric-note">{{ currentRelease?.version ?? '暂无评审版本' }}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <section class="panel release-panel">
        <div class="panel-header">
          <h2 class="panel-title">{{ currentRelease?.title ?? '发布评审' }}</h2>
          <StatusTag v-if="currentRelease" :value="currentRelease.status" />
        </div>
        <template v-if="currentRelease">
          <div class="release-summary">
            <div>
              <span>版本</span>
              <strong>{{ currentRelease.version }}</strong>
            </div>
            <div>
              <span>事件</span>
              <strong>{{ currentRelease.eventIds.length }}</strong>
            </div>
            <div>
              <span>下游依赖</span>
              <strong>{{ currentRelease.affectedDependencyIds.length }}</strong>
            </div>
            <div>
              <span>契约差异</span>
              <strong>{{ currentRelease.differences.length }}</strong>
            </div>
          </div>
          <div class="release-progress">
            <div class="progress-head">
              <span>迁移确认</span>
              <strong>
                {{ currentRelease.migrationConfirmations.length - pendingMigrations.length }}/{{
                  currentRelease.migrationConfirmations.length
                }}
              </strong>
            </div>
            <t-progress
              :percentage="
                currentRelease.migrationConfirmations.length
                  ? Math.round(
                      ((currentRelease.migrationConfirmations.length - pendingMigrations.length) /
                        currentRelease.migrationConfirmations.length) *
                        100,
                    )
                  : 100
              "
              :label="false"
            />
          </div>
          <div class="release-progress">
            <div class="progress-head">
              <span>批量审批</span>
              <strong>
                {{ currentRelease.approvals.length - pendingApprovals.length }}/{{
                  currentRelease.approvals.length
                }}
              </strong>
            </div>
            <t-progress
              :percentage="
                currentRelease.approvals.length
                  ? Math.round(
                      ((currentRelease.approvals.length - pendingApprovals.length) /
                        currentRelease.approvals.length) *
                        100,
                    )
                  : 100
              "
              :label="false"
            />
          </div>
          <RouterLink to="/releases" class="release-link">
            进入发布评审
            <ChevronRightIcon />
          </RouterLink>
        </template>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">契约健康</h2>
          <t-button variant="text" @click="dashboardQuery.refetch()">
            <template #icon><RefreshIcon /></template>
            刷新
          </t-button>
        </div>
        <div class="health-list">
          <div class="health-row">
            <span class="health-icon success"><CheckCircleIcon /></span>
            <div>
              <strong>已发布或已通过事件</strong>
              <span>{{ dashboard?.activeEventCount ?? 0 }} 个</span>
            </div>
          </div>
          <div class="health-row">
            <span class="health-icon warning"><ErrorCircleIcon /></span>
            <div>
              <strong>待确认迁移</strong>
              <span>{{ pendingMigrations.length }} 个下游依赖</span>
            </div>
          </div>
          <div class="health-row">
            <span class="health-icon neutral"><FileSearchIcon /></span>
            <div>
              <strong>规则校验问题</strong>
              <span>{{ issues.length }} 项，其中严重 {{ dashboard?.criticalIssueCount ?? 0 }} 项</span>
            </div>
          </div>
          <div class="health-row">
            <span class="health-icon neutral"><ApiIcon /></span>
            <div>
              <strong>本地 API 状态</strong>
              <span>Axios 适配器正常，TanStack Query 已缓存</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">优先校验项</h2>
        <RouterLink to="/validation" class="text-link">查看全部</RouterLink>
      </div>
      <div class="issue-grid">
        <article v-for="issue in issues.slice(0, 6)" :key="issue.id" class="issue-card">
          <div>
            <StatusTag :value="issue.severity" />
            <span>{{ issue.kind }}</span>
          </div>
          <strong>{{ issue.title }}</strong>
          <p>{{ issue.detail }}</p>
          <small>{{ issue.suggestion }}</small>
        </article>
        <div v-if="issues.length === 0" class="empty-state">当前没有契约校验问题。</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.load-error {
  padding: 12px 14px;
  border: 1px solid #f2b8b5;
  border-radius: 6px;
  color: #a81f17;
  background: #fff4f3;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.8fr);
  gap: 16px;
}

.release-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: #e6e9ee;
}

.release-summary > div {
  display: grid;
  gap: 7px;
  padding: 14px 16px;
  background: #fff;
}

.release-summary span,
.progress-head span {
  color: #6d788a;
  font-size: 11px;
}

.release-summary strong {
  font-size: 18px;
}

.release-progress {
  padding: 16px 18px 0;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.release-link {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 18px;
  color: #1264c5;
  font-size: 13px;
  text-decoration: none;
}

.health-list {
  display: grid;
  padding: 5px 16px 12px;
}

.health-row {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 11px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #edf0f3;
}

.health-row:last-child {
  border-bottom: 0;
}

.health-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  color: #49566b;
  background: #eef1f5;
}

.health-icon.success {
  color: #0e7a58;
  background: #e9f8f2;
}

.health-icon.warning {
  color: #b65300;
  background: #fff4e7;
}

.health-row > div {
  display: grid;
  gap: 4px;
}

.health-row strong {
  font-size: 12px;
}

.health-row span {
  color: #6e798b;
  font-size: 11px;
}

.issue-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: #e8ebef;
}

.issue-card {
  display: grid;
  gap: 9px;
  min-height: 156px;
  padding: 15px;
  background: #fff;
}

.issue-card > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.issue-card > div span {
  color: #8891a0;
  font-size: 10px;
  text-transform: uppercase;
}

.issue-card p {
  margin: 0;
  color: #657084;
  font-size: 12px;
  line-height: 1.5;
}

.issue-card small {
  color: #1264c5;
  font-size: 11px;
}

.text-link {
  color: #1264c5;
  font-size: 13px;
  text-decoration: none;
}
</style>
