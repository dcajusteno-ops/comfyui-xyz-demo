# ComfyUI XYZ 控制台 — 项目全景文档

## 📖 项目简介

**ComfyUI XYZ 控制台** 是一个基于 `Vite + React + TypeScript` 构建的深度定制化 ComfyUI 前端控制台。它旨在为本地 ComfyUI 提供一个工具型、一体化的操作界面，专注于提升生图任务、高清修复、图像对比、以及 LoRA/Embedding 资产管理的效率。

项目通过本地 ComfyUI 的 HTTP/WebSocket API 进行实时数据交互，并集成 `ComfyUI-Lora-Manager` 插件 API 实现高级模型管理功能。

---

## 🚀 快速开始

### 1. 环境准备
- 确保本地已安装 [Node.js](https://nodejs.org/)。
- 确保本地 ComfyUI 服务已启动（默认地址：`http://127.0.0.1:8188`）。
- 建议安装 `ComfyUI-Lora-Manager` 插件以启用模型管理功能。

### 2. 安装与运行
```bash
# 克隆项目并进入目录
cd f:\demo\comfyui-xyz-demo

# 安装依赖
npm install

# 启动开发服务器（默认端口 5173）
npm run dev -- --port 5173
```
前端访问地址：`http://127.0.0.1:5173`

### 3. 注意事项
- **代理配置**：`vite.config.ts` 中的 `/comfy` 代理必须保持 `changeOrigin: false`，否则 ComfyUI 会返回 403 错误。
- **示例图服务**：项目内置了本地示例图/视频文件服务，路径由 `server/exampleImages.ts` 配置。

---

## 🎯 核心功能模块

### 1. 默认生图 (Default Generation)
- **标准工作流**：支持 Checkpoint、LoRA 权重、正反向提示词、采样参数（Steps/CFG/Seed/Sampler/Scheduler/Denoise）的完整控制。
- **实时预览**：支持解析 WebSocket 二进制数据，在输出面板展示模糊效果的实时预览图。
- **输出管理**：智能过滤副产物，右侧输出列表仅展示最终生成的图像。

### 2. WD1.4 图像识别 (Tagger)
- **多模型支持**：集成 WD1.4 和 CL Tagger 引擎。
- **智能提取**：上传图片后自动识别 Tags，支持自定义阈值（Threshold）、排除词（Exclude Tags）及格式化输出。

### 3. 多人工作流 (Multi-character)
- **Mask 网格画布**：提供 1024×1024 的蒙版网格，支持多角色区域划分。
- **角色编辑**：支持角色新增/复制/删除、独立 Prompt、权重及羽化（Feather）控制。
- **交互绑定**：画布蒙版与右侧编辑器双向联动，点击区域自动切换角色。

### 4. 高清修复 (Highres Fix)
- **多模式切换**：包含全部修复、仅高清、仅手部、仅脸部、高清+手部、高清+脸部、手部+脸部等 7 种模式。
- **图像对比弹窗**：生成完成后提供“对比基础图像”按钮，通过滑块对比弹窗（ImageComparerModal）实现原图与修复图的无损对比。
- **种子同步**：支持“同步基础 Seed”，自动读取上一次生图的种子，确保修复一致性。

### 5. XYZ 控制器 (XYZ Plot)
- **多维组合**：支持 X/Y/Z 三轴参数组合（Seed, CFG, Steps, 尺寸, LoRA 强度等）。
- **批量执行**：顺序执行组合任务，提供实时进度条及浏览器标签页标题进度提醒。
- **网格导出**：支持将生成结果导出为带轴标题的高清矩阵长图。

### 6. LoRA / Embedding 管理器
- **资产浏览**：卡片式展示，支持 A-Z 排序、文件夹筛选、限制级内容模糊处理。
- **元数据同步**：支持从 Civitai 拉取元数据，管理触发词（Trigger Words）、版本、大小等信息。
- **示例媒体本地化**：
  - **一键拉取**：将示例图片/视频真实下载到本地 `example_images_path`。
  - **本地渲染**：渲染路径指向项目内置文件服务，不再依赖网络 URL，支持断网浏览。
- **管理功能**：底层已实现收藏、重命名、移动、删除、批量操作及重复项检查（UI 入口当前已根据需求精简）。

---

## 🛠️ 技术栈与项目结构

### 技术栈
- **Frontend**: React 19, TypeScript, Vite, Lucide React, Vitest
- **Backend**: Node.js (Vite Dev Server Proxy)
- **API**: ComfyUI HTTP/WS API, ComfyUI-Lora-Manager API

### 关键文件说明
- [App.tsx](file:///f:/demo/comfyui-xyz-demo/src/App.tsx): 主 UI 及核心交互逻辑（单文件大组件）。
- [comfyClient.ts](file:///f:/demo/comfyui-xyz-demo/src/lib/comfyClient.ts): API 客户端封装。
- [workflowBuilders.ts](file:///f:/demo/comfyui-xyz-demo/src/lib/workflowBuilders.ts): 工作流 Prompt 构建逻辑。
- [xyz.ts](file:///f:/demo/comfyui-xyz-demo/src/lib/xyz.ts): XYZ 组合逻辑实现。
- [exampleImages.ts](file:///f:/demo/comfyui-xyz-demo/server/exampleImages.ts): 本地媒体文件服务。
- [styles.css](file:///f:/demo/comfyui-xyz-demo/src/styles.css): 全局样式与深色主题定义。

---

## 🚧 待办事项与增强建议 (TODO)

### 高清修复
- [ ] **副产物过滤优化**：进一步精确区分不同工作流节点下的最终图与中间图。
- [ ] **交互增强**：对比弹窗增加 ESC 键关闭支持，优化触屏拖动体验。

### LoRA 管理
- [ ] **UI 刷新逻辑**：单模型拉取示例图后自动刷新详情页展示。
- [ ] **搜索增强**：在筛选行恢复已隐藏的搜索入口。
- [ ] **失败管理**：批量拉取失败的模型分组展示，并提供重试机制。

### XYZ 控制器
- [ ] **任务控制**：实现中途停止执行队列的功能。
- [ ] **重试机制**：支持对失败的组合进行单独重试。

### 全局优化
- [ ] **响应式适配**：完善移动端布局适配。
- [ ] **设置面板**：建立专属 UI 用于配置 ComfyUI 地址、保存路径等全局参数。

---

## 📋 验证记录 (Last Updated: 2026-08-19)
- `npm run build`: ✅ 通过
- `npm run test`: ✅ 通过
- 高清修复多模式切换: ✅ 正常
- 输出区最终图过滤: ✅ 正常
- 本地示例媒体拉取与显示: ✅ 正常
- 实时预览 (Binary WS): ✅ 正常

---

## 🤝 接手建议
1. 启动项目前，请确认 `vite.config.ts` 中的代理地址指向您本地的 ComfyUI。
2. 首次运行 LoRA 管理器时，建议试运行单个模型的“拉取示例图”，确认本地存储路径配置正确。
3. 修改样式时，请参考 `styles.css` 中的 CSS 变量，确保兼容深色主题。
