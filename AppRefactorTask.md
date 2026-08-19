# App.tsx 深度重构任务书 (精细化版本)

## 1. 重构背景与核心指标
`App.tsx` 作为一个 6800+ 行的超大型组件，目前面临以下问题：
- **可读性差**：逻辑、样式、UI 混杂，寻找特定功能如海底捞针。
- **维护成本高**：修改一个状态可能引发不必要的全局重绘。
- **协作困难**：多人同时修改此文件极易产生合并冲突。

**核心指标目标**：
- `App.tsx` 行数控制在 **400 行以内**。
- 实现 **100% 的逻辑与 UI 分离**。
- 基础 UI 组件实现 **100% 可复用化**。

---

## 2. 核心拆分架构 (Target Directory Structure)
```text
src/
├── api/                # 所有的后端请求接口定义
├── components/
│   ├── ui/             # 原子组件：Button, Input, ModalFrame
│   ├── layout/         # 布局组件：Sidebar, Header, MainContainer
│   └── features/       # 业务组件：LoraManager, Notes, XyzPlot
├── constants/          # 全局常量：NSFW_LEVELS, TAB_KEYS
├── hooks/              # 业务逻辑封装：useLoras, useNotes, useGeneration
├── lib/                # 纯函数工具：buildFolderTree, formatters
├── types/              # TS 类型定义：OptionsState, LoraItem
└── App.tsx             # 容器入口，仅负责路由与布局拼装
```

---

## 3. 分阶段详细执行手册

### 阶段一：类型定义与常量提取 (基础建设)
- [ ] **TS 类型拆分**：创建 `src/types/` 目录。
  - `app.ts`：定义 `OptionsState`, `MatureBlurLevel`, `ProgressState`。
  - `lora.ts`：定义 `LoraItem`, `LoraOperation`, `LoraManagerSettings`。
  - `notes.ts`：定义 `NoteItem`。
- [ ] **常量提取**：创建 `src/constants/index.ts`。
  - 迁移 `fallbackOptions`, `NSFW_LEVELS`, `generationTabs`, `toolTabs`。
- [ ] **验证**：
  - 运行 `tsc` 检查全局类型引用是否正常。
  - 检查页面静态文本（如 Tab 标题）是否由常量渲染。

### 阶段二：工具函数 (Utils) 物理隔离
- [ ] **创建逻辑工具箱**：
  - `src/lib/lora-helper.ts`：迁移 `buildFolderTree`, `normalizePreview`, `loraSyntaxName`。
  - `src/lib/color-helper.ts`：迁移 `hexToRgba`, `getContrastColor`。
  - `src/lib/file-helper.ts`：迁移 `formatBytes`, `downloadTextFile`。
  - `src/lib/nsfw-helper.ts`：迁移 `getItemNsfwLevel`, `shouldBlurNsfwLevel`。
- [ ] **验证**：
  - 为 `buildFolderTree` 等复杂逻辑编写简单的单元测试（如有）。
  - 确保文件预览图的模糊逻辑在迁移后依然生效。

### 阶段三：原子 UI 组件库化
将 `App.tsx` 末尾的大量基础组件提取到 `src/components/ui`：
- [ ] **表单组件**：`NumberField`, `TextField`, `SelectField`, `MultiSelectField`, `TextAreaField`, `ColorAlphaField`。
- [ ] **容器组件**：`ModalFrame`, `PanelTitle`, `ScrollArea` (如有)。
- [ ] **反馈组件**：`ToastViewport`, `ToastIcon`, `LoadingOverlay`, `RunProgressStrip`。
- [ ] **验证**：
  - 逐个替换 `App.tsx` 中的原始定义。
  - 检查 Modal 弹出动画是否平滑，Toast 弹出位置是否正确。

### 阶段四：业务逻辑封装 (Custom Hooks)
将 `App.tsx` 顶层的 40+ 个 `useState` 和复杂的 `useEffect` 迁移到 Hooks：
- [ ] **`useLoras.ts`**：
  - 封装 `loraResult`, `loraQuery`, `loraLoading` 状态。
  - 封装 `syncLora`, `pullLoraExamples`, `handleLoraOperation` 方法。
- [ ] **`useNotes.ts`**：
  - 封装 `notes`, `activeNoteId`, `notesSearch` 状态。
  - 封装 `handleAddNote`, `handleDeleteNote`, `saveNotes` 方法。
- [ ] **`useGeneration.ts`**：
  - 封装 `runPrompt`, `runBatchTagger` 核心异步逻辑。
  - 封装 `progress`, `results`, `error` 状态。
- [ ] **验证**：
  - **断点测试**：在 Hook 内部打断点，确认数据流向正确。
  - **并发测试**：快速点击“生成”和“保存笔记”，观察状态是否竞争冲突。

### 阶段五：功能面板组件化 (Feature Components)
将原本嵌入在 `App.tsx` `render` 函数中的巨型 JSX 块移出：
- [ ] **Lora 管理模块**：`src/components/features/LoraManager/`
  - `LoraPanel.tsx`：主列表容器。
  - `LoraChips.tsx`：标签过滤区域。
  - `LoraDetailModal.tsx`：详情展示。
- [ ] **工作区模块**：`src/components/features/Workspace/`
  - `MultiCanvasEditor.tsx`
  - `CharacterEditor.tsx`
- [ ] **配置面板**：`src/components/features/Settings/`
  - `BaseGenerationSettings.tsx`
  - `AdvancedSettings.tsx`
- [ ] **验证**：
  - 切换不同功能的 Tab 页，确保组件按需加载且无状态丢失。
  - 检查面板间的层级关系（Z-Index）是否正常。

### 阶段六：状态分发与整合 (App.tsx 重塑)
- [ ] **引入 Context (可选)**：如果 Prop Drilling 超过三层，创建 `AppContext.tsx`。
- [ ] **重构 App.tsx**：
  ```tsx
  export default function App() {
    const { tab, setTab } = useAppNavigation();
    const loraApi = useLoras();
    const noteApi = useNotes();
    const genApi = useGeneration();

    return (
      <Layout sidebar={<Sidebar />} header={<Header />}>
        {tab === 'lora' && <LoraManager {...loraApi} />}
        {tab === 'notes' && <NotesManager {...noteApi} />}
        {/* ... 其他 Tab */}
        <GlobalModals />
        <ToastContainer />
      </Layout>
    );
  }
  ```
- [ ] **最终验证**：
  - **全量编译**：`npm run build` 确保无 Error。
  - **性能检查**：使用 React DevTools 观察重构后的渲染频率，应明显低于重构前。
  - **冒烟测试**：完成一次完整的“上传图片 -> 打标 -> 生图 -> 保存笔记”流程。

---

## 4. 关键避坑指南
1. **闭包陷阱**：在提取 `useCallback` 时，务必检查依赖项数组是否完整，防止状态过期。
2. **样式污染**：提取组件时，优先使用 Tailwind 或 CSS Modules，避免全局样式冲突。
3. **Prop Drilling**：不要为了拆分而拆分，如果一个状态被 5 个以上的深层子组件使用，请使用 Context。
4. **图片引用**：提取 `LoraCard` 时，注意图片懒加载逻辑的迁移，防止瞬间加载大量图片导致崩溃。
