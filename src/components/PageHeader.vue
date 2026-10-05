<script setup lang="ts">
defineProps<{
  title: string
  description: string
  eyebrow?: string
}>()
</script>

<template>
  <header>
    <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
    <h1 class="page-title">{{ title }}</h1>
    <p class="page-description">{{ description }}</p>
  </header>
</template>

<style scoped>
.eyebrow {
  margin-bottom: 7px;
  color: #1264c5;
  font-size: 12px;
  font-weight: 700;
}
</style>
