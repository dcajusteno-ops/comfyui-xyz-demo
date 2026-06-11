# ComfyUI XYZ 控制台 — 项目交接文档

更新时间：2026-06-11  
项目目录：`F:\demo\comfyui-xyz-demo`

---

## 项目介绍

这是一个基于 `Vite + React + TypeScript` 的 **ComfyUI 前端控制台**，用来连接本地 ComfyUI，提供围绕生图任务、高清修复、图像对比、LoRA/Embedding 管理的一体化 UI。

重点是工具型控制台，不是展示站。通过本地 ComfyUI 的 HTTP/WebSocket API 收发数据，部分 LoRA 管理能力通过 ComfyUI-Lora-Manager 插件的 API 读取。

---

## 运行方式

### 开发

```bash
cd F:\demo\comfyui-xyz-demo
npm run dev -- --port 5173
```

前端地址：`http://127.0.0.1:5173`

### 构建 / 测试

```bash
npm run build
npm run test
```

### 依赖服务

| 服务 | 默认地址 |
|------|---------|
| ComfyUI | `http://127.0.0.1:8188` |
| 本地示例图文件服务 | `/xyz/example-images/file/...`（由本项目 server/ 提供） |
| LoRA Manager 插件 | `/api/lm/...`（ComfyUI 插件提供） |

**重要：** `vite.config.ts` 中 `/comfy` 代理的 `changeOrigin` 必须保持 `false`。改成 `true` 后 ComfyUI 会返回 403。

---

## 技术栈

- React 19
- TypeScript
- Vite
- Vitest
- lucide-react
- ComfyUI HTTP/WebSocket API
- ComfyUI-Lora-Manager 插件 API

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/App.tsx` | 主 UI 和所有交互逻辑（单文件大组件） |
| `src/styles.css` | 全局样式，含深色主题和 LoRA 管理器风格 |
| `src/types.ts` | 类型定义 |
| `src/lib/comfyClient.ts` | ComfyUI 和 LoRA Manager API 客户端 |
| `src/lib/workflowBuilders.ts` | 各模式工作流 prompt 构建逻辑 |
| `src/lib/xyz.ts` | XYZ 组合逻辑 |
| `src/data/multiTemplate.ts` | 多人工作流模板 |
| `server/exampleImages.ts` | 本地示例图/视频文件服务 |
| `vite.config.ts` | Vite 代理配置 |

---

## 页面 / Tab 总览

| Tab | 描述 |
|-----|------|
| 默认生图 | 标准 KSampler 工作流，checkpoint + LoRA + 提示词 + 采样参数 |
| WD1.4 | 上传图片，Tagger 识别，输出 tags |
| 多人工作流 | Mask 网格 + 多角色 prompt |
| 高清修复 | 多模式：全修 / 高清 / 手部 / 脸部 / 组合 |
| XYZ 控制器 | 多维参数组合批量执行 |
| LoRA 管理 | LoRA / Embedding 浏览、示例图拉取、详情查看 |

---

## 已完成的功能（详细）

### 基础生成能力

- 连接本地 ComfyUI，获取 checkpoint / sampler / scheduler / WD14 模型 / detector / upscale method 选项
- 提交 prompt，WebSocket + History 读取进度与结果
- 进度条、Toast 通知、错误提示
- 右侧输出面板：只展示最终图像（副产物不在输出列表中显示）

### 默认生图

- Checkpoint
- LoRA 权重
- 正向/反向提示词
- 宽高预设与自定义（含翻转）
- Batch / Seed 随机 / Steps / CFG / Sampler / Scheduler / Denoise
- 保存路径预设与自定义

### WD1.4 图像识别

- 上传图片、tagger 模型选择、threshold、character threshold、replace underscore、trailing comma、exclude tags
- Tags 输出展示

### 多人工作流

- 1024×1024 Mask 网格画布
- 角色新增 / 复制 / 删除 / 启用禁用
- 角色颜色、prompt、权重、feather、mask x/y/w/h
- Mask 拖拽和缩放
- 保留全局 prompt + 角色 prompt

### 高清修复（重点模块）

共 6 个修复模式 Tab，通过分段控制器切换：

| 模式 | 说明 |
|------|------|
| 全部修复 | 高清放大 + 手部修复 + 脸部修复 |
| 仅高清修复 | 只做 upscale |
| 仅手部 | 只做 hand detailer |
| 仅脸部 | 只做 face detailer |
| 高清+手部 | 高清放大 + 手部修复 |
| 高清+脸部 | 高清放大 + 脸部修复 |
| 手部+脸部 | 手部 + 脸部（不放大） |

参数：checkpoint / LoRA / 正反提示词 / 宽高 / scale by / Steps / CFG / Denoise / Seed / 采样器 / 保存路径 / 手部 detector / 脸部 detector / hand & face detailer 参数

**同步基础 Seed**：勾选"同步基础 Seed"后，高清修复的 seed 会从上一次基础生图结果中自动读取，实现与基础图相同的 seed。

**输出结果对比**：生成完成后，在右侧输出区会出现"对比基础图像"按钮，点击弹出滑块对比弹窗（见下方）。

### 图像对比弹窗（ImageComparerModal）

- 全屏弹窗，左侧"基础图像"，右侧"修复结果"，两图像叠加
- 白色竖线 + 圆形手柄，拖动滑块可左右扒开对比
- 图像 B 使用 `objectFit: contain` + clip-path 实现，两图对齐不变形
- 点击黑色背景区域或 × 按钮关闭（注意：点击图片上拖动不会误关闭）
- 顶部提示文字：「拖动中间滑块对比」

### XYZ 控制器

- 目标模板：默认生图 / 多人工作流 / 高清修复
- X/Y/Z 轴组合
- 逗号或换行枚举
- `起点..终点..步长` 数值范围
- 轴预设：Seed / CFG / Steps / 尺寸 / LoRA 强度 / 提示词追加
- 组合预览表
- 顺序执行
- 输出结果缩略图

### LoRA / Embedding 管理器

#### 接口层（comfyClient.ts）

已实现通用 `ManagedModelType = "loras" | "embeddings"` 接口，所有管理方法均可无缝切换 LoRA 和 Embedding：

- `listManagedModels` / `getManagedModelFolders` / `getManagedModelBaseModels` / `getManagedModelTopTags`
- `getManagedModelMetadataByPath` / `refreshManagedModelCivitaiMetadata` / `saveManagedModelMetadata`
- `setManagedModelFavorite` / `renameManagedModel` / `deleteManagedModel`
- `bulkDeleteManagedModels` / `moveManagedModel` / `bulkMoveManagedModels`
- `findManagedModelDuplicates` / `findManagedModelFilenameConflicts`
- `refreshManagedModelUpdates` / `ignoreManagedModelUpdate`
- `getManagedModelCivitaiByHash` / `downloadManagedModel` / `scanManagedModels`

#### UI 行为

- 顶部切换标签：LoRA / Embedding（2个，不多不少）
- 工具栏：A-Z 排序、刷新、一键拉取示例图（3个，不多不少）
- 侧边栏文件夹筛选：与卡片区独立滚动
- 卡片区：无复选框，无功能按钮，点击卡片进详情
- 卡片信息：标题（最多两行）、版本、文件夹/大小、触发词
- 限制级卡片模糊处理，支持点击显示
- 详情页 header 固定，主体独立滚动
- 详情页功能按钮只保留"拉取示例图"
- 详情页标题旁保留 Civitai 外链（跳转 `civitai.red`，不占功能按钮区）
- 详情页右侧只保留 Examples（图片/视频，支持点击大图，限制级模糊）
- 触发词面板：读取 / 添加 / 编辑 / 复制 / 保存，通过 metadata 同步

#### 示例图拉取

- 一键拉取：所有模型批量下载示例媒体
- 单个模型拉取：在详情页单独触发
- 示例媒体真实下载到本地 `example_images_path/<sha256>/`
- 前端读取本地路径 `/xyz/example-images/file/...`，不依赖网络 URL
- 支持图片和视频，文件服务支持 `HEAD` 和 `Range`

---

## 输出区行为

- **只显示最终图**：如果一次生成产生多张图（如高清修复会先保存基础图、再保存修复图），右侧输出列表只显示最后输出的图像
- **对比按钮**：当一次生成存在基础图（副产物）和最终图时，会在最终图下方显示"对比基础图像"按钮，点击触发滑块对比弹窗

---

## 当前未完成 / 仍需加强

### 高清修复

| 待做事项 | 说明 |
|---------|------|
| 修复结果精确区分副产物 | 当前通过 subfolder + nodeTitle 判断最终图，逻辑可能因工作流节点命名不同而失效，需要和 `workflowBuilders.ts` 里的 `SaveImage` prefix 对齐 |
| 对比弹窗增加 ESC 关闭 | 当前只有背景点击和 × 按钮关闭 |
| 对比弹窗触控支持 | 当前只考虑了鼠标，触屏拖动滑块尚未测试 |

### LoRA 管理

| 待做事项 | 说明 |
|---------|------|
| 搜索入口 | `LoraQueryState.search` 存在但 UI 已隐藏，如需恢复建议加到筛选行，不要加回工具栏 |
| 管理功能入口 | 收藏/重命名/移动/删除/批量/重复项/更新检查/医生检查 的底层 API 存在，但 UI 入口已按用户要求隐藏，如要恢复需先确认入口位置 |
| 示例图失败列表 | 批量拉取失败的模型没有分组显示 |
| 拉取后自动刷新详情 | 单模型拉取完成后，详情页不会自动刷新示例图列表 |
| 已下载去重精细化 | 当前按 filename 去重，可进一步按 hash 或 URL 去重 |

### XYZ 控制器

| 待做事项 | 说明 |
|---------|------|
| 批量中断 | 无法中途停止正在执行的 XYZ 队列 |
| 单个组合重试 | 失败的组合无法单独重跑 |
| 结果导出 | 无 XYZ 网格导出功能 |
| 更多字段 patch | 多人和高清修复的 XYZ 轴字段覆盖还不完整 |

### UI 打磨

| 待做事项 | 说明 |
|---------|------|
| 移动端适配 | 当前未做响应式 |
| 全局设置弹窗 | 保存路径、ComfyUI 地址等全局设置没有专属 UI |
| Toast 持久通知 | 通知队列只是内存态，无持久化 |
| LoRA 卡片继续对齐插件风格 | 与 ComfyUI-Lora-Manager 插件的视觉对齐仍可继续完善 |
| 详情页信息密度 | 空白区域控制仍可优化 |

---

## 验证记录（本次聊天最终状态）

```bash
npm run build   # ✅ 通过
```

最近测试通过的功能点：

- [x] 高清修复多模式切换正常
- [x] 输出区只显示最终图
- [x] 对比弹窗滑块可拖动，两图对齐不变形
- [x] 点击图片拖动滑块不会误关弹窗
- [x] LoRA / Embedding 切换正常
- [x] 示例图本地文件服务正常

---

## 接手建议（下一轮）

1. 先执行：

```bash
cd F:\demo\comfyui-xyz-demo
npm run build
npm run dev -- --port 5173
```

2. 确认 ComfyUI 在线：

```
http://127.0.0.1:8188/system_stats
```

3. 打开前端，切换到高清修复 Tab，试运行一次，确认：
   - 生成完成后右侧输出区只显示一张最终图
   - 有"对比基础图像"按钮
   - 点击后弹出滑块对比弹窗可以正常拖动

4. 如需继续改 UI，遵守以下规则：
   - **不要未经确认恢复用户已要求删除的按钮**（LoRA 管理器工具栏只保留3个，详情页功能按钮只保留1个）
   - 每次视觉改动后截图验证
   - 改 CSS 变量前先确认暗色主题下对应变量是否定义（参考 `styles.css` 第1473行附近）

---

## 常见问题

| 问题 | 解法 |
|------|------|
| ComfyUI 返回 403 | 检查 `vite.config.ts` 中 `/comfy` 代理的 `changeOrigin: false` |
| 示例图不显示 | 确认 `server/exampleImages.ts` 路径配置正确，`example_images_path` 指向正确目录 |
| 对比弹窗一点就关 | 已修复：现在只有点击背景本身（不是图片区域）才会关闭 |
| 输出显示多张图 | 已修复：通过 `subfolder` + `nodeTitle` 过滤副产物，只展示最终图 |
