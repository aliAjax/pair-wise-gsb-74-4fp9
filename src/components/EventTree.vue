<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  UserIcon,
} from 'tdesign-icons-vue-next'
import StatusTag from '@/components/StatusTag.vue'
import type { EventDefinition } from '@/models/domain'

const props = defineProps<{
  events: EventDefinition[]
  selectedId: string
}>()

const emit = defineEmits<{
  select: [eventId: string]
}>()

const expanded = ref(new Set(['交易', '营销', '搜索', '用户']))

const categories = computed(() => {
  const groups = new Map<string, EventDefinition[]>()
  props.events.forEach((event) => {
    const group = groups.get(event.category) ?? []
    group.push(event)
    groups.set(event.category, group)
  })
  return [...groups.entries()]
})

const toggle = (category: string): void => {
  const next = new Set(expanded.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  expanded.value = next
}
</script>

<template>
  <div class="event-tree">
    <template v-for="[category, categoryEvents] in categories" :key="category">
      <button type="button" class="tree-button" @click="toggle(category)">
        <ChevronDownIcon v-if="expanded.has(category)" />
        <ChevronRightIcon v-else />
        <FolderIcon />
        <span>{{ category }}</span>
        <small>{{ categoryEvents.length }}</small>
      </button>
      <div v-if="expanded.has(category)" class="tree-children">
        <button
          v-for="event in categoryEvents"
          :key="event.id"
          type="button"
          class="event-button"
          :class="{ active: selectedId === event.id }"
          @click="emit('select', event.id)"
        >
          <FileIcon />
          <span class="event-label">
            <strong>{{ event.displayName }}</strong>
            <code>{{ event.key }}</code>
          </span>
          <StatusTag :value="event.status" />
        </button>
      </div>
    </template>
    <div v-if="events.length === 0" class="empty-state">没有符合条件的事件。</div>
    <div class="tree-footer">
      <UserIcon />
      <span>{{ new Set(events.map((event) => event.owner)).size }} 个负责团队</span>
    </div>
  </div>
</template>

<style scoped>
.event-tree {
  display: grid;
  gap: 4px;
  padding: 10px;
}

.tree-button,
.event-button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: 5px;
  color: #344054;
  background: transparent;
  cursor: pointer;
}

.tree-button {
  gap: 8px;
  padding: 0 9px;
  font-weight: 650;
  text-align: left;
}

.tree-button:hover,
.event-button:hover,
.event-button.active {
  background: #edf4ff;
}

.tree-button span {
  flex: 1;
}

.tree-button small {
  color: #7a8494;
}

.tree-children {
  display: grid;
  gap: 2px;
  padding: 2px 0 5px 24px;
}

.event-button {
  gap: 9px;
  padding: 7px 8px;
  text-align: left;
}

.event-button.active {
  box-shadow: inset 3px 0 #1677ff;
}

.event-label {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.event-label strong {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-label code {
  overflow: hidden;
  color: #7a8494;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-footer {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  padding: 10px;
  border-top: 1px solid #e6e9ee;
  color: #747f91;
  font-size: 11px;
}
</style>
