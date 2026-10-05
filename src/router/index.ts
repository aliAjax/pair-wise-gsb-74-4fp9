import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
        },
        {
          path: 'events',
          name: 'events',
          component: () => import('@/views/EventTreeView.vue'),
        },
        {
          path: 'lineage',
          name: 'lineage',
          component: () => import('@/views/PropertyLineageView.vue'),
        },
        {
          path: 'validation',
          name: 'validation',
          component: () => import('@/views/ValidationView.vue'),
        },
        {
          path: 'releases',
          name: 'releases',
          component: () => import('@/views/ReleaseReviewView.vue'),
        },
        {
          path: 'deprecations',
          name: 'deprecations',
          component: () => import('@/views/DeprecationView.vue'),
        },
        {
          path: 'rollbacks',
          name: 'rollbacks',
          component: () => import('@/views/RollbackView.vue'),
        },
        {
          path: 'export',
          name: 'export',
          component: () => import('@/views/ContractExportView.vue'),
        },
      ],
    },
  ],
})

export default router
