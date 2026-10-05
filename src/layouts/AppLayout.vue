<script setup lang="ts">
import { useRouter } from 'vue-router'
import {
  AppIcon,
  ChartIcon,
  DataSearchIcon,
  FileSearchIcon,
  GitBranchIcon,
  HistoryIcon,
  LinkIcon,
  RefreshIcon,
  RollbackIcon,
  SettingIcon,
} from 'tdesign-icons-vue-next'
import { DialogPlugin } from 'tdesign-vue-next'
import { useGovernanceStore } from '@/stores/governance'

const router = useRouter()
const store = useGovernanceStore()

const navigation = [
  { label: '治理工作台', icon: ChartIcon, to: '/' },
  { label: '事件契约树', icon: GitBranchIcon, to: '/events' },
  { label: '属性血缘', icon: LinkIcon, to: '/lineage' },
  { label: '契约校验', icon: FileSearchIcon, to: '/validation' },
  { label: '发布评审', icon: DataSearchIcon, to: '/releases' },
  { label: '废弃计划', icon: SettingIcon, to: '/deprecations' },
  { label: '回滚记录', icon: RollbackIcon, to: '/rollbacks' },
  { label: '契约导出', icon: AppIcon, to: '/export' },
]

const reset = (): void => {
  const dialog = DialogPlugin.confirm({
    header: '恢复演示基线',
    body: '当前浏览器内的本地契约修改将被清除。',
    confirmBtn: '恢复',
    cancelBtn: '取消',
    onConfirm: () => {
      store.resetDemo()
      dialog.destroy()
      void router.push('/')
    },
  })
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">ER</span>
        <div>
          <strong>EventRail</strong>
          <small>事件契约治理</small>
        </div>
      </div>
      <nav class="nav-list">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: $route.path === item.to }"
        >
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-foot">
        <HistoryIcon />
        <div>
          <span>本地持久化</span>
          <strong>当前版本 {{ store.data.currentVersion }}</strong>
        </div>
      </div>
    </aside>

    <main class="main-shell">
      <header class="topbar">
        <div>
          <strong>多端埋点事件治理与发布评审</strong>
          <span>{{ store.data.events.length }} 个事件 · {{ store.data.dependencies.length }} 个下游依赖</span>
        </div>
        <div class="topbar-actions">
          <span class="sync-state">
            <HistoryIcon />
            {{ new Date(store.lastSavedAt).toLocaleTimeString('zh-CN') }}
          </span>
          <t-button variant="outline" @click="reset">
            <template #icon><RefreshIcon /></template>
            恢复基线
          </t-button>
        </div>
      </header>
      <section class="content-shell">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 18px 14px;
  color: #d8e1ec;
  background: #152238;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 8px 22px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  color: #102034;
  background: #68d7c0;
  font-size: 13px;
  font-weight: 800;
}

.brand div,
.sidebar-foot div {
  display: grid;
  gap: 3px;
}

.brand strong {
  color: #fff;
  font-size: 15px;
  letter-spacing: 0.05em;
}

.brand small {
  color: #8492a7;
  font-size: 11px;
}

.nav-list {
  display: grid;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 11px;
  border-radius: 5px;
  color: #adb9c9;
  font-size: 13px;
  text-decoration: none;
}

.nav-item svg {
  width: 16px;
  height: 16px;
}

.nav-item:hover {
  color: #fff;
  background: #21314a;
}

.nav-item.active {
  color: #fff;
  background: #274368;
  box-shadow: inset 3px 0 #68d7c0;
}

.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: auto;
  padding: 13px 10px;
  border-top: 1px solid #2a374b;
  color: #7f8da1;
}

.sidebar-foot span {
  font-size: 10px;
}

.sidebar-foot strong {
  color: #b2becd;
  font-size: 11px;
}

.main-shell {
  min-width: 0;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 0 24px;
  border-bottom: 1px solid #dfe3e8;
  background: rgba(255, 255, 255, 0.96);
}

.topbar > div:first-child {
  display: grid;
  gap: 4px;
}

.topbar strong {
  font-size: 14px;
}

.topbar span {
  color: #707b8d;
  font-size: 12px;
}

.topbar-actions,
.sync-state {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sync-state {
  gap: 7px;
}

.content-shell {
  max-width: 1560px;
  padding: 24px;
}
</style>
