# EventRail 多端埋点事件治理与发布评审平台

基于 Vue 3、TDesign、Pinia、Vue Router、TanStack Query、Axios、Vite 与 TypeScript 的独立前端工程。项目使用 Axios 自定义本地适配器模拟契约 API，查询缓存由 TanStack Query 管理，业务编辑状态由 Pinia 持久化到浏览器 `localStorage`。

## 功能

- 按业务域维护事件树、多端触发规则、属性和负责人
- 属性类型、枚举、必填条件、同义字段和跨事件血缘
- 重复事件、同义属性、命名越界、类型变化与删除字段引用检查
- JSON 示例的类型、枚举和必填规则校验
- 发布候选契约比较、受影响下游依赖和迁移确认
- 数据、产品、客户端和测试四角色批量审批与发布门禁
- **可恢复发布链**：候选冻结基线锚点与快照；基线变化后未发布候选按变化字段重算，受影响且覆盖字段改变的已确认迁移退回待确认，公开版本保留原快照
- **提交检查点与重放**：所有写操作落为幂等修订日志（journal）+ 检查点（checkpoint）；提交失败后从最后完整检查点恢复，已写入修订保留，重放不重复生成发布记录或回滚记录
- **旧候选基线补齐**：缺少基线快照的旧候选必须先回填（`backfilled`）基线才允许发布
- 事件废弃计划、替代事件和迁移说明
- 发布回滚记录与结果验证
- JSON 契约和 Markdown 契约文档导出

## 运行

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18474`。

## 构建

```bash
npm run build
```

## 可恢复发布链验证

```bash
npm run verify:release-chain
```

脚本在 Node 中以 localStorage shim 驱动真实 Pinia store，覆盖六个场景：基线变化重算与迁移退回、公开版本快照冻结、旧候选基线补齐门禁、提交中断后检查点恢复且记录不重复、变化字段签名的精细退回、发布落盘新基线后兄弟候选重算。

界面上可在「回滚记录」页点击 **提交中断恢复演练**：构造含发布记录与回滚记录的多修订事务，在第一条修订落盘检查点后模拟中断，再从检查点恢复并校验无重复记录。

## 数据层

- `src/services/api.ts`：Axios 实例与本地 API 适配器
- `src/composables/useGovernanceQueries.ts`：TanStack Query 查询组合
- `src/stores/governance.ts`：Pinia 编辑、审批、废弃、回滚与可恢复提交
- `src/services/commitLog.ts`：幂等修订、检查点日志、崩溃注入与恢复重放
- `src/services/reconcile.ts`：未发布候选基线对齐、差异重算与迁移确认退回
- `src/services/selectors.ts`：契约比较、影响分析和校验规则
