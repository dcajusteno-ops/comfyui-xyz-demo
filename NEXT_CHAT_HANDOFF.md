# ComfyUI XYZ 项目交接说明

更新时间：2026-06-10  
项目路径：`F:\demo\comfyui-xyz-demo`

## 项目介绍

这是一个基于 `Vite + React + TypeScript` 的 ComfyUI 前端控制台，用来连接本地 ComfyUI，并提供一套围绕 LoRA / Embedding 管理、生成任务、图像识别、工作流组合的 UI。

当前项目的重点不是“纯展示”，而是偏工具型控制台。它已经包含：

- 默认生图页
- WD1.4 图像识别页
- 多人工作流页
- 高分修复页
- XYZ 控制器
- LoRA / Embedding 管理页

项目会通过本地 ComfyUI 的 HTTP / WebSocket API 读写数据，部分 LoRA 管理能力则会读取 LoRA Manager 的接口。

## 当前运行方式

开发启动：

```bash
npm run dev -- --port 5173
```

构建与测试：

```bash
npm run build
npm run test
```

前端默认地址：

```text
http://127.0.0.1:5173
```

ComfyUI 默认地址：

```text
http://127.0.0.1:8188
```

Vite 代理前缀：

```text
/comfy
```

## 已完成的主要功能

### 基础生成能力

- 默认生图
- WD1.4 识别
- 多人工作流
- 高分修复
- XYZ 组合执行
- 输出结果展示
- 进度条、Toast、错误提示

### LoRA / Embedding 管理

- LoRA / Embedding 双模式切换
- 列表筛选
- 详情弹窗
- 触发词查看与保存
- 收藏、重命名、移动、删除、批量管理
- 重复项与更新检查入口
- Civitai 外链入口

### 示例图 / 示例视频拉取

这部分是最近刚修好的重点。

以前的问题是：

- UI 显示“拉取成功”
- 但本地目录没有真实媒体文件
- 详情页和卡片还是在用网络 URL 渲染
- 关掉 VPN 后图片 / 视频就不可用了

现在的做法是：

- 不再依赖插件自己的“下载成功”状态
- 由项目自己发起示例媒体拉取
- 从 LoRA metadata 中取 `images` / `customImages`
- 真实下载到 `example_images_path/<sha256>/`
- 前端改为读取本地媒体路径
- 本地媒体统一走 `/xyz/example-images/file/...`
- 图片与视频都支持本地渲染
- 文件服务支持 `HEAD` 和 `Range`，视频播放器更稳

相关实现位置：

- `server/exampleImages.ts`
- `src/lib/comfyClient.ts`
- `src/App.tsx`
- `vite.config.ts`

## 当前代码状态

最近一次验证结果：

- `npm run build` 通过
- `npm run test` 通过
- 本地示例媒体接口可用
- 本地文件静态读取可用
- `HEAD` / `Range` 已验证

当前开发服务器已经重启在：

```text
http://127.0.0.1:5173
```

## 还没完全收尾的功能

下面这些不是“坏了”，而是还可以继续增强。

### LoRA 管理器仍有可增强项

- 列表里还可以继续补更细的状态展示
- 批量操作的失败模型列表可以再做得更明确
- 详情页里还可以继续加更完整的版本信息展示
- 触发词、说明文本、生成参数的编辑入口还能继续完善

### 示例图拉取还可以继续增强

- 批量拉取的失败模型分组展示
- 拉取过程的逐文件进度
- 单个模型拉取完成后自动刷新当前详情页
- 已下载文件的去重规则还可以再细化
- 如果 Civitai / 网络源完全不可用，后续可以考虑加更清晰的失败提示和重试策略

### XYZ 控制器还可以继续增强

- 批量中断
- 单个组合重试
- 失败组合导出
- 结果对比视图
- 更清晰的输出汇总

## 最近这次最关键的修复

这次的核心不是“隐藏远程 URL”，而是：

1. 真正把示例媒体下载到本地
2. 让渲染路径指向本地文件服务
3. 不再把插件接口里的假成功当成真实成功

所以现在的逻辑是：

- 详情页可以先看远程元数据
- 真正点“拉取示例图”后，会把图片 / 视频写入本地
- 成功后卡片和详情页都会优先读取本地文件
- 关掉 VPN 后，已拉取的示例媒体仍然可显示

## 下一轮继续工作的建议顺序

1. 先确认你本机上的 ComfyUI 和 LoRA Manager 的 `example_images_path` 指向正确目录。
2. 用一个有 `images/customImages` 的模型试一次单独拉取，确认本地目录里真的生成了文件。
3. 再做一轮批量拉取，看看失败模型是否都能被准确标记。
4. 如果你要继续收敛 UI，再补示例图失败态和进度态。

## 关键文件

- [src/App.tsx](F:/demo/comfyui-xyz-demo/src/App.tsx)
- [src/lib/comfyClient.ts](F:/demo/comfyui-xyz-demo/src/lib/comfyClient.ts)
- [src/types.ts](F:/demo/comfyui-xyz-demo/src/types.ts)
- [server/exampleImages.ts](F:/demo/comfyui-xyz-demo/server/exampleImages.ts)
- [vite.config.ts](F:/demo/comfyui-xyz-demo/vite.config.ts)

