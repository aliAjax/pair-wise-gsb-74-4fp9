import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { useGovernanceStore } from './stores/governance'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

// 挂载前先恢复未完成提交（从最后一个完整检查点重放），再对齐未发布候选与基线
useGovernanceStore(pinia).bootstrap()

app
  .use(router)
  .use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: {
          staleTime: 10_000,
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    },
  })
  .use(TDesign)
  .mount('#app')
