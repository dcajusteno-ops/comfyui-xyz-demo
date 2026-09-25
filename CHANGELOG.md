# Changelog

All notable changes to this project will be documented in this file.

## [v0.6.2] - 2026-09-25

### 🔧 工程与质量 (Engineering)

- **项目结构重整（对齐 comfyui-demo-main 的仓库布局），功能零变化**：
  - **全部源码收进 `desktop-source/`**：src、server、internal + main.go、e2e、scripts（构建脚本与 git 钩子）、public、workflows、ComfyUI-DrawText-Advanced 插件及全部工程配置（package.json / tsconfig / vite / playwright / eslint / go.mod）整体迁入，git 以 rename 记录（历史可追溯）。**根目录只保留 `ComfyUI-XYZ-Web.exe`、`run-exe.bat`、运行数据 `data/` 与 README / CHANGELOG**；
  - **全部文档收进 `docs/`**：活跃文档（待办与遗留事项、文档导航）在 `docs/` 根，归档文档按类型分目录（任务书 / 任务清单 / 计划与核验 / 体检报告）整体迁入 `docs/归档文档/`，索引与相互链接同步更新；
  - 路径适配：`scripts/build-exe.ps1` 产物改输出到仓库根目录（exe 与启动脚本同级的双击体验不变）；`run-exe.bat` 构建提示、playwright `DSH_EXE` 模式 exe 路径、pre-commit 钩子（`core.hooksPath` 指向 `desktop-source/scripts/githooks`，钩内先切源码目录）、WelcomeModal 里插件 GitHub 链接、README 快速开始均已同步；
  - **数据目录语义**：exe 与 dev server 均按进程工作目录解析 `data/`——exe 在根目录运行，正式数据仍在根 `data/`；dev 模式在 `desktop-source/` 里跑，开发数据落 `desktop-source/data/`，两者互不干扰。
- 质量门（新布局下全部实跑验证）：vitest **38 个测试文件 / 373 项全绿**、`tsc --noEmit` 0 错、`eslint src server` 0 error（41 warning 基线持平）、`go test ./internal/... .` 6 包全绿、`build-exe.ps1` 重建 exe 成功（14.7MB）。
- 版本号补齐：`package.json` / `package-lock.json` 由 0.6.0 升至 0.6.2（v0.6.1 发版时漏升）。

## [v0.6.1] - 2026-09-25

### ✨ 新功能 (Features)

- **数值轴范围写法补全：小数端点缺省步进 0.1，范围可与枚举混填**：此前 `..` 范围展开对**小数端点形同虚设**——缺省步进写死为 1，`0.4..1.0` 只会算出 `[0.4]` 一个值。现在缺省步进按端点类型取值：两端都是整数 → 1（`1..5` = 1～5，seed/步数语义不变）；含小数 → 0.1（`0.4..1.0` = 0.4、0.5、…、1.0，正是 LoRA 强度/重绘幅度的常用扫描粒度）。显式步进仍写第三段（`0.4..1.0..0.2`，倒序 `1.0..0.4` 自动反向）。范围展开从「必须整串」改为**逐 token 生效**，可与枚举值混填（`0.2, 0.4..1.0`）；非法范围（`0.4..`、`a..b`）原样保留不误伤。对所有数值轴生效（LoRA 强度、追加强度、CFG、步数、seed、重绘幅度等）。轴值输入框按字段类型显示写法提示（新导出 `axisValuePlaceholder`，与解析逻辑同源），「怎么用」帮助补充缺省步进规则说明。
- **外部工具启动器支持直接登记 http(s):// 网址（网页项目可一键拉起）**：此前网址类目标在运行时被 `stat()` 存在性检查拦下（网址无文件可查 → 404 "tool file not found"，表现为「启动失败」），表单与帮助虽宣称支持网页，实际只有磁盘上的 .html/.url 文件能跑——直接粘贴网址从未可用。现在：网址交给默认浏览器打开（`cmd /c start`），**跳过存在性检查**；本地路径行为不变（仍要求文件存在）。实现：`server/launcher.ts` 新增 `isWebUrl` + 网址分派分支（优先于扩展名分派，URL 路径里含 .html 不误判；工作目录用进程目录），Go 侧 `internal/launcher` 逐条对齐、两侧测试成对固化；表单 placeholder 与底部说明补充「或直接粘贴 http(s):// 网址」。
- **XYZ「LoRA 模型」轴支持批量取值，不再逐个填文件名**：三种写法——①**模型名 + 序号范围**（主推）：`模型名{1..4}` 直接拼出 模型名1…4，支持步进 `模型名{1..6..2}`（= 1、3、5），拼出的名字需与实际文件名完全一致；②**通配符限定模型**：`模型名*` 匹配库里所有以此开头的文件，`*关键词*` 包含匹配、`?` 单字符（不区分大小写，文件名带不带 `.safetensors` 都能命中）；③**库序号范围**（1 起始，顺序同 LoRA 管理器列表）：`1..6`、`1..9..2` 步进、`{2..4}`、`*`（已加载全部，上限 256），越界序号自动丢弃。可与文件名混填。组合预览、组合数、执行、网格导出、智能复盘全链路按展开后的真实文件名显示。轴值输入框在该类字段下显示写法提示，「怎么用」帮助同步补充；匹配范围是 LoRA 管理器当前已加载列表，不传库（离线）时序号取值保持字面值不误展开、拼名展开不受影响。
- **XYZ 控制器快捷预设扩充**：快捷轴按钮从 5 个扩到 11 个（Anima 目标模板下 12 个）——新增「步数」（20,26,32）、「采样器」「调度器」（取 `/object_info` 真实列表前三项）、「重绘幅度」（0.3,0.5,0.7）、「LoRA 模型」（填 `1..6`，直接用上面的范围语法批量跑库前 6 个；面板挂了 LoRA 时替换第 1 槽位、否则走追加轴）、「文字内容」（批量换写字内容，自动启用文字特效）、Anima 目标下追加「Anima 放大」（放大①百分比）。实现上把 5 段重复 JSX 重构为预设表 + `makeAxis` 渲染，行为不变（整体替换三行轴，值均可再改）。
- 顺带修复：「提示词追加」快捷按钮的值里换行写成字面 `\n`（两个字符），点按后不会被按行拆成多条组合——改为真实换行符。

### 🐛 修复 (Bug Fixes)

- **XYZ 结果网格被「长路径标签 + 大图」撑爆（格子互相叠盖）**：组合标签里的模型全路径（`AnimaLora/cs/xxx_training/xxx_epoch` 这类 40+ 字符无断点的 token）把 `.xyz-result` 的 min-content 顶到几百像素——网格项默认 `min-width: auto` 不会收缩到轨道宽度以下，整格溢出 `minmax(0,1fr)` 轨道、三格互相叠盖（大图跟随标签宽度撑到全面板宽，相邻格只剩窄条）。修复：`.xyz-result` 加 `min-width: 0` + 内层 `grid-template-columns: minmax(0, 1fr)`、子项统一 `min-width: 0` 放行收缩、`.xyz-result-head strong` 加 `overflow-wrap: anywhere` 允许长路径任意断行（`anywhere` 才参与 min-content 计算，`break-word` 不行）。已用真实浏览器注入长标签 + 1024×1344 大图实测：六格严格等宽（304px）、标签折行、图片收进格子、零溢出零叠盖（verify-xyz-grid.cjs 可复跑）。
- **输出面板被大图撑爆（图片尺寸与显示框不符）**：`.output-panel` 作为网格项未设 `min-width: 0`，图片固有宽度（1024px）通过 min-content 把 `minmax(260px, 318px)` 的列撑开——整个面板（含标题摘要、作为输入图下拉）溢出窗口被裁切。修复：`.output-panel` 加 `min-width: 0`、`.gallery-item` 列改 `minmax(0, 1fr)`、输出图片加 `max-width: 100%`。已用真实浏览器注入 1024×1344 图实测：面板宽度回落到 318px 列宽、图片 286px 完整收进显示框、无横向溢出。
- **文字特效开启但文字留空时，不再把占位字「测试文本」合成进图**：`insertDrawTextNode` 原先在 enabled 且文字为空白时会回退用「测试文本」占位并烧进输出图（误开开关时图片凭空多一行字，极难排查来源）。现在改为直接跳过写字节点，SaveImage 及整条工作流与未开启时逐节点一致。四个生成模板（默认/多人/高修/Anima）统一生效；新增回归测试守住该行为。
- **弹窗打开期间 toast 提示被遮罩盖住**：全局 toast 层级（10001）低于弹窗遮罩 `modal-backdrop`（11000），在 LoRA 管理器等弹窗内操作（如「一键提示示例图」）触发的提示会被半透明遮罩压暗+模糊，几乎不可见。toast 层级提升至 12000（高于全部弹窗遮罩），任何场景下提示始终可见。

### 🔧 工程与质量 (Engineering)

- **持久化状态整体迁移 localStorage → 服务端 `data/ui-state.json`（`/api/ui-state`）**：面板参数、预设、主题、翻译设置、折叠状态、欢迎弹窗已读标记、手机页表单——全部 15+ 个持久化键不再存浏览器 localStorage（按 origin 隔离，端口漂移/清浏览器数据即"重置"），统一走服务端 JSON 文件（原子写 + 备份 KEEP=30 防抖 + 写队列，与 notes 同款契约）。实现：
  - TS 中间件 `server/uiState.ts`（GET/PUT/DELETE，key 白名单 ≤120，2MB 上限，`null` 删除语义，`DSH_E2E=1` 内存态防测试污染）+ Go 移植 `internal/api/uistate.go`（两侧测试成对固化）；
  - 前端 `useLocalStorageState` → `usePersistentState`（调用方零语义变化，deepMerge 只补新键不变）：boot 门先拉取 `/api/ui-state` 再渲染（本地 <10ms；失败降级 localStorage 永不变砖），变更 800ms 防抖批量 PUT + `beforeunload` 兜底，**跳过首次挂载回写**（避免启动全量回写覆盖其它窗口变更）；
  - 旧 localStorage 数据（`comfyui_*`/`xyz_*` 前缀）在服务端为空时**一次性自动迁移**，迁移后本地保留作回滚备份；
  - boot 后、首帧前同步应用主题（dark 用户不再看到一帧 light）；
  - ErrorBoundary「重置本地配置」升级为同时清 localStorage 与服务端状态；
  - E2E/verify 脚本适配（`e2e/mocks.ts` + 6 个 verify 脚本拦截 `/api/ui-state` 返回欢迎弹窗已读标记）。
  质量门：vitest 367/367、tsc 0 错、eslint 0 error / 41 warning（基线持平）、Go 单测 + vet 全绿、verify-uistate 13/13（TS 落盘 + boot/reload 主题恢复端到端）、verify-exe 7/7、verify-gui 6/6；exe 已重建。

## [v0.6.0] - 2026-09-25

### ✨ 新功能 (Features)

- **外部工具启动器（复刻自 comfyui-demo-main，样式按本项目规范重写）**：顶栏新增「工具」入口——把常用本地程序/脚本（.exe/.bat/.cmd）或网页（.html/.url）登记成工具，一键拉起（弹窗内双击或点 ▶）。工具清单存 `data/launcher-tools.json`（原子写+写队列），支持从 .exe 提取程序图标（PowerShell ExtractAssociatedIcon，缓存 `data/icons/<md5>.png`）或选内置图标。**启动链路不经过 ComfyUI，未连接服务（离线）时完全可用**。实现：TS 中间件 `server/launcher.ts`（SSOT）+ Go 移植 `internal/launcher`（exe 与 dev 行为对齐，两侧测试成对固化 ext 分派/空白参数切分语义）+ 前端 `LauncherDialog`（ModalFrame/CSS 变量，零 styles.css 新增，lazy 分包）。
  **断连遮罩正常拦截背景**：断连时顶栏/侧栏等背景功能不可点（避免误操作连不上服务的功能），弹窗层级提到遮罩之上保证弹窗可用。离线功能入口收敛为**遮罩卡片上的「外部工具」快捷按钮**——断连时从这里一键拉起本地工具。
- **Go 单文件 exe 打包（`任务书-Go单文件exe.md` G1–G8）**：用 Go 1.25 把项目编译为单个
  `ComfyUI-XYZ-Web.exe`（约 15MB）——前端 `dist/` 经 `go:embed` 内嵌，TS 中间件层（notes/prompts/wildcards/
  fsBrowse、手机联动 SSE+队列、示例图管理器、LoRA 元数据、ComfyUI/阿里云反代含 WebSocket）全部移植为
  Go 实现，行为契约逐条对齐 `server/*.ts`（2MB 请求上限、temp+rename 原子写、备份 KEEP=30+防抖、
  revision 乐观并发 409、SSRF 双重防护、.safetensors 路径白名单）。**双击 exe 弹出独立桌面窗口
  （WebView2 壳，`-H=windowsgui` 无控制台黑窗），不打开浏览器**；`--web` 参数回退「服务 + 浏览器」模式。
  窗口与 exe 均带应用图标（靛蓝渐变 + XYZ，`scripts/gen_icon.py` 生成 → rsrc 编译 `.syso` 内嵌）。
  运行无需 Node/Go 环境；`scripts/build-exe.ps1` 一键构建（vite build + go build）。质量门：Go 单测全绿、
  TS 侧 vitest 340/340、代理/静态/WS 对拍 8/8 一致、桌面窗口模式 6/6 + 浏览器模式 E2E 7/7 通过
  （详细实施记录见任务书 §8）。
- **桌面窗口体验细化（G8 后追加）**：Per-Monitor V2 **DPI 感知**（`setDPIAware()`，修复高分屏界面发糊）；窗口默认 **1600×1000** 并**记忆上次尺寸/位置**（`data/window-state.json`，屏幕 95%/92% 钳制，最小 1100×700）；桌面模式**固定绑定 9123 端口**（与 dev 的 9999 解耦，可同时运行；localStorage 不再因端口漂移「重置」）+ **单实例互斥体**（重复启动弹提示框）；修复「启动器唤起外部程序无窗口」（去掉 `HideWindow:true` 的 SW_HIDE 误传，仅保留 `CREATE_NO_WINDOW|DETACHED_PROCESS`）；`scripts/build-exe.ps1` 补 UTF-8 BOM（Windows PowerShell 5.1 兼容）。

## [v0.5.0] - 2026-09-23

> 本版一次性落地 `任务清单-下个迭代.md` 的全部 12 项工程任务（T2 / T4–T14），并纳入此前已推送未发版的「核心链路单测」批次（T1）。

### 🐛 修复 (Bug Fixes)

- **生成中的实时预览裂图（“预览中...”显示失败）**：WS 二进制预览帧切片后 Blob 的 MIME type 为空，而 `blob:` URL 无内容嗅探，`<img>` 直接裂图（成品图走 `/view` HTTP 有正确响应头所以一直正常——这也是为什么只有预览坏）。现按帧头声明的图片类型（1=JPEG / 2=PNG / 3=WEBP）显式设置 MIME；顺带把旧预览 URL 从「立即 revoke」改为保留 3 帧缓冲延迟回收（原实现会在 `<img>` 还在加载时吊销 URL，造成裂图闪烁），并在完成/出错时统一释放。
- **XYZ multi/highres 目标补齐水印借用**：主界面跑多人/高清修复时会借用「文字特效」页的水印配置（App.tsx 一直如此），但 XYZ 跑这两个目标时不借——同一组合两条路径出图不一致。现四个 target 统一借用，且 drawText 轴仍按层合并（未打轴的字体/颜色不丢）。补 2 条回归测试（C2b/C2c）。
- **history 兜底路径会丢掉后续节点的文本输出**：`extractHistory` 用**函数级累积数组**判断「本节点有没有文本」，导致只有第一个产出文本的节点会走「扫描全部输出」的兜底，第二个及之后的节点若用自定义输出键名，其文本被静默丢弃。WebSocket 的 `executed` 路径用的是每条消息的局部数组、没有这个问题——两条路径本该等价却不等价。现统一为**按节点**判定（T1）。
- **图片去重口径统一**：`extractHistory` 原先不对图片去重（同一 `url` 会重复列出），现与 `executed` 路径一致按 `url` 去重（T1）。

### ✨ 新功能 (Features)

- **T12 局部重绘（Inpaint）**：图生图开启且已选参考图时，可「涂抹遮罩」指定重绘区域。
  涂抹编辑器（`MaskEditorModal`）为双画布实现：底图按面板的缩放方式（拉伸/居中裁剪）铺底、
  笔刷画在上层透明画布；导出 = 黑底 + 白笔（红通道即遮罩），按面板宽高导出，与缩放后的参考图天然对齐。
  工作流用核心节点 `LoadImageMask(channel=red) → VAEEncodeForInpaint(grow_mask_by=6)`（节点与参数已在 /object_info 实探确认）；
  未设遮罩时仍走原 `VAEEncode` 整图重绘路径。
- **T13 手机端远程生图**：手机页（`#/mobile-tag`）新增「生图」标签页。手机提交提示词 →
  服务端（`server/mobileGen.ts`）排队、按 /object_info 解析 checkpoint、构造极简 SD 工作流提交 ComfyUI →
  轮询 history → 手机直接看图（成图经服务端代理 `/api/mobile/gen/tasks/:id/image/:i`，手机无需直连 ComfyUI）。
  桌面端不参与，服务端自洽闭环；参数白名单校验（尺寸 256–2048 且 64 对齐、步数 ≤100 等）。
- **T11 任务队列面板**：顶栏新增「队列」入口，接上 ComfyUI `/api/queue`——查看运行中/等待中任务、
  单独移除 pending 任务、清空等待队列（此前只能「全杀当前」）。
- **T10 体验四件套**：
  1. 批量打标目录选择器：`FolderField` 文本输入 + 一键列出子目录（新只读接口 `/xyz/fs/folders`，server/fsBrowse.ts）；
  2. 全局快捷键：Ctrl+Enter 生成 / Ctrl+S 存预设 / 数字键切 tab（侧边栏顺序 1..10）；
  3. 显存预警：顶栏显存徽标（复用 /system_stats，30s 轮询 + 空闲 <15% 变红）；
  4. 记事本拓展：标签系统（增删/搜索过滤/侧栏聚合）+ 拖拽附加图片预览（压缩至最长边 400px JPEG、每条上限 6 张，防 notes.json 超限）。
- **T7 LoRA 配方（Recipes）界面**：LoRA 详情弹窗新增「配方」区块，展示该 LoRA 的配方列表，
  一键把配方语法插入正向提示词（复用既有 `onInsertWords` 通道；`comfyClient` 的 recipes 接口此前零引用，纯补 UI）。
- **T8 XYZ 最优组合一键回填**：复盘控制条新增「回填到面板」——把最优格子对应的完整组合 patch
  应用到目标模板（合并语义与 `buildXyzPrompt` 一致），闭合「批量试 → 选最优 → 回单张微调」。
- **T9 通配符词库在线编辑**：`/xyz/wildcards` 服务端插件（2MB 请求上限 + temp+rename 原子写 +
  侧车 revision 乐观并发，词库名白名单）+ 通配符弹窗内的在线编辑器；保存后重新加载注册表，`__name__` 引用即时生效。
- **T6 输出面板标题可辨认**：从 `promptId.slice(0,8)` 换成「任务名 · 尺寸 · 步数 · seed」一行摘要
  （元信息在提交时从**实际工作流**读出，XYZ 打补丁的组合、Anima 多段链路都不会与标题不一致），悬停可看完整 promptId。

### ⚡ 性能 (Performance)

- **T2 面板级代码分割**：非首屏面板（多人/高修/Anima/文字特效/WD1.4/XYZ/LoRA/记事本/老虎机）
  全部改 `React.lazy` + `Suspense`，GlobalModals 的大弹窗（PromptEditorDialog / LoraModals）一并按需加载；
  DefaultGenerationPanel 改从具体文件引入（走 barrel 会把懒加载面板的依赖一并拉回主 chunk，分包失效）。
  主 chunk **442.66 kB → 255.76 kB（-42%）**，全部 chunk < 500 kB。

### 🔧 工程与质量 (Engineering)

- **T4 `server/` 单测破零**：新增 56 项测试（3 个文件）——SSRF 防护契约（`isPrivateIp` / `isAllowedMediaUrl`，
  覆盖私网段、IPv6、IPv4-mapped、非法 IPv4）、LoRA 路径白名单（扩展名约束、白名单根、路径段级校验防前缀绕过）、
  `utils`（原子写 + 留档、写队列串行化与失败隔离、2MB 请求体上限、sendError 尊重 status）。全部使用临时目录，**不触碰仓库 data/**。
- **T5 lint 收敛**：`no-explicit-any` 96 → 12（`XyzController.gen` / `GlobalModals.loras` / `ui` 用
  `ReturnType<typeof useXxx>` 真类型化；`useOptions` setter 逐个类型化；`deepMerge` 改 unknown 收窄；
  追加提示词的动态键 updater 重构为类型化的 `appendPromptUpdater`）；2 处未用导入清除。
  warning **135 → 42**，error 恒为 0。仅 ComfyUI 动态 JSON 边界（server 3 处）保留带注释的豁免。
- **T14 巨型文件拆分**：`DrawTextControls.tsx` 995 → 610 行（抽出 `DrawTextCanvas` 390 行）、
  `LoraModals.tsx` 1213 → 872 行（抽出 `LoraModalsPanes` / `LoraExampleParts` 共 372 行）、
  `PromptEditorDialog.tsx` 902 → 861 行（类型与预设包抽至 `PromptEditorData`）；导出面与逻辑逐字不变。
  `workflowBuilders.ts` / `comfyClient.ts` 按 SSOT 约定保持单文件不动。

### ♻️ 重构 (Refactor)

- **结果解析逻辑消除重复实现（T1）**：`processTextValue` 与文本优先键列表原先在 `runPrompt` 与 `extractHistory` 里**各写一份**，现抽到新模块 `src/lib/comfyResult.ts`（`collectNodeTexts` / `collectNodeImages` / `mergeJobResult`），两条路径共用同一实现。`comfyClient.ts` 由 1062 行降至 958 行。
- **追加提示词的动态键 updater 收敛**：散落在 App.tsx 四处的「追加到 globalPrompt/positivePrompt」`(prev: any)` 逻辑重构为类型化的 `appendPromptUpdater<T>`（dedupe 开关区分灵感/标签与触发词两条路径），行为逐字不变。

### 🧪 测试 (Tests)

- 测试总数 **224 → 340**（+116），35 个文件全绿：
  - **T1 核心链路（此前完全零覆盖，+36）**：`src/lib/comfyResult.test.ts`（17 条——字符数组拼接、对象过滤、空值容错、优先键命中时不走兜底、**多节点连续处理时第二个节点同样能走兜底**（本次修复点）、图片 `url`/`nodeTitle` 取值、`mergeJobResult` 去重保序）；`src/hooks/useGeneration.test.ts`（19 条——`runPrompt` 成败分支/结果上限/`document.title` 联动、`runWd14`/`runClSingle` 三分支、`runXyzItems` 的 reset/中断/失败续跑、**XYZ 重跑原位替换**等三条回归防线）。
  - **T4 server 层（此前完全零覆盖，+56）**：SSRF 防护契约、LoRA 路径白名单、原子写/写队列/请求体上限；全部使用临时目录，不触碰仓库 `data/`。
  - **hook 层测试补齐（+18）**：`useLoras`（14 条：翻页合并去重、收藏乐观更新与失败回滚、触发词解析、mutation、doctorAction 分派等）与 `useXyz`（4 条），至此核心 hook 全部有覆盖。
  - 明确不测 `exportXyzGrid`（依赖 canvas 2D，jsdom 未实现；已由 E2E 间接覆盖），测试文件末尾注释了原因。
- **五项质量门**：`tsc --noEmit` 0 错误；`eslint src server` **0 error / 42 warning**（基线 135）；`vitest run` 340 项全绿；`vite build` 成功；E2E 冒烟 6 项全绿。

## [v0.4.2] - 2026-09-22

### 🎨 图生图闭环 (Img2Img Round-Trip)

- **三个模板补齐图生图**：默认生图 / 多人工作流 / 高清修复新增「图生图」开关（**默认关闭**，既有行为零变化）。仅用核心节点：`LoadImage → ImageScale → VAEEncode → KSampler`，重绘强度复用面板既有的「重绘」参数，零新增第三方节点依赖。
- **多人工作流保留分辨率对齐**：`ImageScale` 的宽高接 `ResolutionMasterSimplify` 的输出，不绕过原有分辨率对齐逻辑。
- **批量语义**：`batchSize > 1` 时用核心 `RepeatLatentBatch` 复制 latent；超出其上限 64 时按 64 执行并在面板给出提示（与非图生图的 `batch_size` 上限 4096 区分）。
- **节点键用非数字字符串**（`i2i_load` / `i2i_scale` / `i2i_encode` / `i2i_repeat`）：高修的 `detailerChain` 按 `nextId` 递增占号、默认生图的 drawText 固定占 `"8"`，数字键有碰撞风险。
- **输出图一键回流**：输出面板每张图新增「作为输入图 ▾」，可送往 默认生图 / 多人工作流 / 高清修复 / Anima 生图 / 图片识别（WD1.4）。
  - 送往 **Anima** 时一并打开 `stages.img2img`——它的触发条件是「阶段开关 && 有图」，只填图不会生效。
  - 送往 **图片识别** 时一并清空 `wdFile` 并在拖拽区显示「已选：xxx」——`runWd14` 里 `wdFile` 优先于 `imageName`，只设 `imageName` 会被静默顶替。
- **预设剥离参考图**：保存参数预设时把 `img2img.imageName` 置空（它指向 `input/` 内的具体文件，换机器/清理后必然失效，回填会被 ComfyUI 校验拒绝）。
- **枚举隔离**：图生图缩放的采样方法独立拉取 `ImageScale.upscale_method`。**不可复用**「放大方法」那份——后者取自 `LatentUpscaleBy`，含 `bislerp` 而无 `lanczos`，对 `ImageScale` 是非法值。
- **两条非阻断提示**：未选参考图时提示「本次将按文生图出图」；重绘强度 > 0.95 时提示「参考图几乎不起作用，建议 0.4–0.7」。
- **Anima 零回归**：`keepProportion` / `cropPosition` 保留原字段名（`deepMerge` 只补新键、不搬迁旧路径，改名会让老用户设置静默丢失）；Anima 的 builder 段逐节点未变。

### 🧪 测试与验证
- **E2E 恢复可用（6 用例全绿，约 4s）**：此前 E2E 一直跑不起来，真实根因有两条——① `playwright.config.ts` 的 `webServer.command` 用的是 `npm run dev` 而非 vite 二进制；② 即使起得来，ComfyUI 不在跑时 WebSocket `onclose` 会把状态置为 offline，全屏 `.connection-overlay` 拦截全部点击（`page.route` **拦不住 WebSocket**，原有 API mock 覆盖不到这条路径）。修法：`webServer.command` 改调 `node node_modules/vite/bin/vite.js`；`e2e/mocks.ts` 增加 `page.routeWebSocket(/\/comfy\/ws/)` 接管握手。README 中「E2E 不依赖 ComfyUI 运行」的说法至此才真正成立。
- 新增 `src/lib/img2img.test.ts`（16 条断言）：开关关闭时三个 builder 的 latent 仍指向原 `EmptyLatentImage`（零回归硬门槛）、命中链路、多人分辨率对齐、批量 clamp、`fit → crop` 映射、预设剥离、枚举不含 `bislerp`、字段缺失不抛错、Anima 逐节点零回归。
- 测试总数 208 → **224**（28 个文件全绿）；`tsc --noEmit` 0 错误、`eslint src server` 0 error / 129 warning（与改动前基线持平）、`vite build` 成功。
- 新增实机浏览器验证脚本 `.workbuddy/verify-all.cjs`（Playwright + 真实 dev server，单进程内起停）：确认三个面板开关默认关闭、点击后参数区展开、采样方法枚举不含 `bislerp`、控制台零错误。
- 环境更正：**vitest 在本机可运行**（`node node_modules/vitest/vitest.mjs run`），此前「破损 shell shim 下必然失败」的结论不成立。

## [v0.4.1] - 2026-09-22

### 🔒 服务端安全加固 (Server Security)
- **修复任意文件读取**：`/xyz/lora/extract-metadata` 此前对请求体 `file_path` 零校验，可探测/读取任意文件。现强制解析后扩展名为 `.safetensors`（非 safetensors 文件解析结果恒为空），并支持 `XYZ_LORA_ALLOWED_ROOTS` 环境变量进一步限定根目录；非法路径返回 403。
- **SSRF 双层防护**：示例图下载链路的媒体 URL（payload 中 metadata/civitai 可自带任意地址）增加私网/回环/链路本地 IP 黑名单校验；域名在 fetch 前做 DNS 解析复查（`dns.lookup all`），任一解析结果落在内网即拒绝。
- **请求体上限**：`readJsonBody` 收口到 `server/utils.ts` 统一实现并加 2MB 上限，超限返回 413（排干请求体后正常响应，连接可复用；超过 32 倍上限才强制断开）；exampleImages 的本地复制实现删除。

### 💾 数据完整性 (Data Integrity)
- **notes / prompts 乐观并发检测**：存储增加 `revision` 版本号，GET 返回、POST 携带 `baseRevision`，过期版本返回 409 并附最新数据（不带 baseRevision 的旧客户端保持 last-writer-wins 兼容）；写入按文件串行化 + 原子写（临时文件 + rename），杜绝并发交错写坏文件。
- **前端接入**：笔记保存携带 baseRevision（409 时对齐版本号 + 限流提示，下次保存以本窗口为准）；PromptSidebar / PromptEditorDialog 同步接入。
- **笔记防抖防丢**：离开笔记页立即落盘、`beforeunload` 用 `sendBeacon` 兜底——2 秒防抖窗口内的末次编辑不再丢失。
- **`package.json` 依赖清理**：移除死依赖 `marked`（全仓无引用却被 manualChunks 打包成孤儿 chunk）及 `@types/marked`、`@types/dompurify`（dompurify v3 自带类型）；`vite`、`@types/crypto-js` 归位 devDependencies。

### 🐛 功能修复 (Bug Fixes)
- **XYZ 重跑/重试失败不再清空其余结果**：`rerunXyzItem` / `retryFailedXyz` 原先以 `reset=true` 整体替换结果列表，重跑 1 条后其余组合（含成功图与网格导出数据）全部消失；现改为原位替换 + `reset=false`。
- **Anima 打 drawText 轴不再丢失水印配置**：轴值是只含部分字段的对象，原实现整体覆盖已合并的完整水印配置（字体/颜色全丢）；现以借用到的完整配置为基底按层合并。
- **Anima 耗时估算修正**：预估耗时原先无条件累加全部 12 个阶段，「极速直出」档显示约 4×；现只累加实际开启的阶段。
- **笔记「清空内容」按钮修复**：`RichTextEditor` 声明了 `onClear` 且调用方已传确认逻辑，但组件解构遗漏导致界面无入口——已补上按钮；顺带 `ToolbarButton` 提升到模块顶层（消除每次渲染子树重挂载）。
- **剪贴板降级**：`navigator.clipboard` 在局域网 HTTP（非安全上下文）下不存在，复制提示词改为自动回退 `execCommand`；HTML 剥标签改用惰性 `DOMParser`（不执行脚本、不加载图片）。
- **提示词仓库 / 编辑器接入版本号**（见上），另修复 `PromptLintBadge`、`ImageCompare` 依赖缺失告警。

### ♻️ 键名迁移与 lint 收敛 (Cleanup)
- **localStorage 键名统一**：`xyz_theme` / `xyz_welcome_seen` → `comfyui_xyz_theme` / `comfyui_xyz_welcome_seen`，`useLocalStorageState` 内置旧键一次性迁移（读新键缺失时自动搬旧值并删除），老用户无感升级。
- **字体 fallback 校正**：`fallbackOptions.fonts` 的占位值 "default" 对真实 DrawTextAdvanced 节点无效（节点校验 27 个真实字体文件）；`useOptions` 新增 `pickFont()`——object_info 字体清单中无当前字体时按「模糊命中优先、否则取首项」自动纠正，接入四组参数同步。
- **Anima 面板新增两条非阻断提示**：Anima 系模型（16 通道 latent）配 `sdxl_vae` 会解码失败（建议 qwen_image_vae）；放大档已开启但未选择放大模型时提交会被校验拒绝。
- **mobileSync**：DELETE 单任务/全清同步从待执行队列移除；SSE 心跳定时器在 dev server 关闭时清理。
- **lint**：新增 `no-unused-vars` 下划线前缀忽略惯例；修复 ImageLightbox 快捷键 effect 引用声明前变量、useNotes 全 handler useCallback 化、useUiState 懒初始化、MobileTagPage 事件驱动 objectURL 等——warning 152 → 129，error 0。

### 🛠️ 工程 (Engineering)
- **server/ 纳入检查范围**：`tsconfig.json` include 加入 `server`（首次检查即暴露并修复 4 个既有类型错误），lint 脚本改为 `eslint src server`。
- **pre-commit 质量门**：`scripts/githooks/pre-commit` 自动运行 `tsc --noEmit` + `eslint src server`（error 阻断、warning 放行），启用方式见 README「快速开始」第 4 步。

### ✅ 验证 (Verification)
- **全功能实机测试 18/18 通过**（ComfyUI 0.36.0 / RTX 5060 9GB，测试驱动见 `.workbuddy/gen-test/`）：默认生图 13.6s、**Anima 真机首跑 13.8s**（JANIMA_v10 + qwen_3_06b_base + qwen_image_vae，1024×1536 / 8 步 turbo）、Anima+水印、XYZ 双组合、多人 24.2s、高修 42.3s（双 KSampler denoise 1.0/0.58 逐项正确）、WD14 手机联动全流程 5.0s。
- 质量门：`tsc --noEmit`（含 server）0 错误 / `eslint src server` 0 error（129 warnings，均为已知技术债）/ `vite build` 成功（主 chunk 462.67 kB，marked 孤儿 chunk 消失）。

## [v0.4.0] - 2026-09-21

### 🎨 Anima 大模型接入 (Anima Generation Template)
- **全新第 4 个生图模板**：侧边栏「生图模板」组新增「Anima 生图」，与默认生图 / 多人工作流 / 高清修复并列。`TemplateKind` 与 `TabId` 同步扩展（`?tab=anima` 深链可用）。
- **三段式模型栈**：`UNETLoader` + `CLIPLoader` + `VAELoader`（替代 Checkpoint 单文件栈），UNet / CLIP / CLIP 类型 / VAE / weight_dtype 全部为 `/object_info` 驱动的下拉，**不硬编码任何文件名**。
- **12 个阶段开关**：图生图 / CFGZeroStar / 二次精修 / 放大① / 全图修复(SEGS) / 手部 / 脸部 / 眼部 / NSFW / 放大② / 通配符节点 / 保存图像，沿用 `.segmented` 开关组（与高清修复同款视觉）。
- **5 个档位预设**：完整复刻（默认，1:1 对齐原工作流）/ 精修 / 标准 / 极速直出 / 自定义；切换只改阶段开关，不动提示词、种子与 LoRA。
- **输出预览条**：常驻显示预计输出分辨率、放大链摘要与相对耗时量级，长边超阈值转为预警态（不阻断出图）。
- **图生图支持**：选图上传 → `LoadImage` → `ImageResizeKJv2` → `VAEEncode`；未选图时自动回落文生图并提示（惰性），补齐了项目 TODO 中「图生图工作流」这一项。
- **文字水印打通**：与多人/高修一致，在「文字特效 & 水印」页配置的文字/水印会在 Anima 生成时自动应用（`DrawTextAdvanced` 节点接入保存链，`syncWithImage` 跟随 Anima 画布尺寸）；XYZ 打 `drawText` 轴时以轴为准。此前 Anima 的运行入口漏传了该配置，导致水印对 Anima 不生效。

### ♻️ 复用高清修复的修复链 (Shared Detailer Chain)
- **提取共用模块 `src/lib/detailerChain.ts`**：把 `buildHighresPrompt` 的 SEGS + 4 处局部修复逻辑提取为 `appendDetailerChain()`，高修与 Anima 两条链路共用；**高修的输出逐节点不变**（由既有 64 组合单测 + 新增断言双重兜底）。
- **不再需要管道节点**：原工作流的 `ToDetailerPipe` / `EditDetailerPipe` / `FaceDetailerPipe` 只是"省连线"写法，与项目既有的逐节点显式输入 `FaceDetailer` 功能等价，故完全不引入；`ImpactSwitch` 同理改为代码层二选一。
- **常量节点全部内联**：`easy int` / `PrimitiveInt` / `PrimitiveFloat` / `PrimitiveBoolean` / `SeedNode` 等 10 个中转节点全部消除；**新增第三方节点依赖为零**。
- **细节参数补齐**：`DetailerParams` 新增 `noiseMaskFeather` / `tiledEncode` / `tiledDecode` / `inpaintModel` / `samDetectionHint` / `samDilation` / `samThreshold` / `samMaskHintThreshold` / `samMaskHintUseNegative` / `dropSize` 等可选字段（默认 `undefined` → 不下发，保证高修不变），使 Anima 的修复链参数与原工作流逐项对齐。

### 🔗 与现有基建打通 (Integrations)
- **XYZ 控制器**：新增 5 个标量轴（放大①/② 百分比、精修步数/CFG/重绘）与 1 个布尔轴模板 `animaStage_<key>`（覆盖全部 12 个开关，支持 `on,off` / `1,0` / `开,关`）。嵌套 patch 按层合并并带**存在性守卫**——给 SD 系参数打 Anima 专属轴不会凭空造出 `stages`/`hires`/`refine` 键。
- **参数预设**：Anima 独立分组，支持保存 / 应用 / 重命名 / 删除 / 导入导出；`applySnapshot` 泛化为「校验字段名 + 可用列表」可配，Anima 校验 `modelStack.unetName`（对 `options.unets`）而非 checkpoint。
- **LoRA 链路**：LoRA 管理器、简易弹窗、详情页「添加到…」按钮组（新增 Anima 按钮）、触发词插入、灵感老虎机、手机识图结果应用，全部支持 Anima 目标。
- **零改动即生效**：Prompt Lint（`<lora:>` / `{}` / `__file__` 已覆盖）、完成提醒、浏览器标签页进度、断线重连均无需改动。

### 🛠️ 公共代码加固 (Infra Hardening)
- **`readCombo` 兼容新版 COMBO 格式**：原先只认旧格式 `[[...]]`，遇到 `["COMBO", { options: [...] }]`（实测核心 `UpscaleModelLoader.model_name` 即为此格式）会静默返回 fallback 导致下拉为空。现两种格式都支持，并抽出 `parseComboEntry` 配单测。
- **`BaseControls` 模型选择区参数化**：新增可选 `modelSlot`，默认渲染原「大模型」下拉，非 Checkpoint 系模板可注入自己的模型栈控件；三个现有面板渲染结果不变。
- **`TabId` 守卫**：持久化的 tab 值不再做无校验直接使用，非法值（改名/删功能后的历史值）回落 `default`，消除主页面空白。
- **全局 ErrorBoundary**：渲染期异常不再白屏——显示错误摘要与「重置本地配置并刷新」入口（清除本应用写入的全部 `comfyui_*` / `xyz_*` localStorage 后重载），用于兜住「旧持久化数据 vs 新参数结构」这类兼容性崩溃。
- **`DetailerControls` 参数补全**：新增「羽化（feather）/ 裁剪系数（bboxCropFactor）/ 采样器 / 调度器」四个字段的 UI 入口（此前仅存在于参数模型、UI 改不了）；高清修复与 Anima 的全部修复阶段同时受益。

### 🐛 提示词标签块解析修复 (Prompt Tag Parsing Fix)
- **括号组按 tag 拆分**：`parsePromptTags` 原先按逗号切分时跟踪了圆括号深度，导致 `(masterpiece, best quality, ...)` 整段被当成**一个**标签块（占满三行）。A1111 / ComfyUI 的真实语义里 `(...)` 内的逗号**就是** tag 分隔符（括号负责给组内**每个词**乘 1.1），现已正确展开为逐词块。
- **修正组内加权的破坏性写入（重要）**：旧实现点 `+` 会生成 `(..., score_8:1.1)`，把权重加到**最后一个词**上——用户以为给整组加权，实际只有末词变成 1.21。现改为「展平」重写：`(a, b, c)` 点 `a` 的 `+` → `(a:1.2), (b:1.1), (c:1.1)`，语义完全等价。⚠️ **这是一处可见的行为变化**：给组内词加权后，该组会由组写法变为逐词权重写法（文本变长，但此后再点各块即可独立调权）。
- **权重显示修正**：`(a, b, c)` 的实际权重是 1.1，标签块上现在如实显示 `1.10`（此前显示为 1.00，会误导调参）。
- **保护 `{}` 动态语法**：`{face|face, detailed face}` 曾被逗号拆成 `{face|face` + `detailed face}` 两块，点加减会写出 `({face|face:1.1)` 这类破损语法（Anima 脸部/眼部修复的默认追加词即刻可见）。现 `{...}` 按整块原子处理，且**只显示不加权**——前端展开器 `resolveChoices()` 是纯文本替换、不解析权重，`({a|b,c}:1.1)` 展开后权重仍会错位。
- **畸形输入只读**：括号不配对（如 `(a, b`）的块不再提供加减按钮，避免把用户文本改坏。
- **Ctrl/Cmd + ↑/↓ 统一复用**：该快捷键此前是**第三份**独立实现（正则 `[^)]+` 跨逗号匹配，同样会把权重加到末词），现改为复用 `parsePromptTags` + `adjustWeightForTag`，与「+ / −」按钮行为完全一致；光标落在动态组内时保持文本不变。
- **连带修正 Prompt Lint**：重复词条检测复用同一解析，此前 `(1girl, solo), 1girl` 检测不出重复，现已覆盖。
- **重复词条支持一键清理**：此前「重复词条」只提示、不能修（`fixable: false`）。现 Lint 面板会显示「修复」按钮与「修复可修复项（N）」，一键去重。规则：① 保留**有效权重最大**的那次出现（权重并列取最早），因此 `text, (text:1.4)` 会留下强化过的 `(text:1.4)` 而非丢掉权重；② 只删除「组内只有它自己」的标签（裸词，或 `(text:1.4)` 这类单成员括号组），多成员括号组（如 `(a, b)`）内的重复词**不**自动删——从组里抠词会改变整组权重语义；③ 只删除、不重排，并保留原有换行格式。⚠️ 该操作为直接改写文本，没有撤销。
- **连续逗号清理修正**：`empty_segments` 的清理正则原为 `,\s*,+`，一次只能吃掉两个逗号，遇到 3 个以上连续逗号（如删除相邻的多个重复词条后）会残留 `, , ,`。现抽出共用的 `cleanupPromptSeparators()` 并改用 `,(\s*,)+`，任意数量的连续逗号都能压成一个。

### ✅ 验证 (Verification)
- **实机结构校验**：把生成的 Anima 工作流（完整复刻档 33 个节点 / 极速直出档 / 核心节点降级档）提交给真实 ComfyUI 做校验（注入一处故意错误使其只校验不执行），服务端返回的 `node_errors` **仅包含故意注入的那一个节点**，证明其余全部节点的 `class_type`、输入名与引用关系均符合服务端 schema。
- **测试**：208 个单测全绿（Anima 工作流 26 项、XYZ×Anima 8 项、`readCombo` 6 项、useOptions 扩展 3 项、提示词标签块解析 24 项、**Lint 去重与分隔符清理 14 项**、**ErrorBoundary 3 项**）；`tsc` 无错误；`eslint` 无 error；生产构建主 chunk 433 kB（< 500 kB）。
- **提示词块实机验证**：在真实页面填入 `(masterpiece, best quality, score_9, score_8), 1girl, long hair, blue eyes`，确认拆成 **7 个**块（旧版仅 4 个）、前 4 块显示权重 `1.10`；点首块 `+` 后为 `(masterpiece:1.2), (best quality:1.1), (score_9:1.1), (score_8:1.1), 1girl, long hair, blue eyes`；Anima 面板的 `{face|face, detailed face}` 与 `{eyes|eyes, detailed eyes}` 均为单块且只有翻译按钮。既有 `PromptTagBlocks` 的 5 个用例**一行未改**即通过。

## [v0.3.7] - 2026-09-19

### 📁 LoRA 管理侧边栏文件夹折叠 (Collapsible Folder Tree)
- **全层级折叠**：侧边栏中每个含子文件夹的目录（如 `SDXL`、`动漫`，含深层目录）在行尾显示折叠箭头，一键收起/展开整棵子树；叶子节点不显示箭头。
- **选择语义零回归**：点击文件夹名仍选中并过滤右侧列表；点击箭头仅切换折叠，不影响查询状态与已加载列表。
- **祖先自动展开**：通过「全部文件夹」下拉等途径选中位于折叠父级内的深层路径时，侧边栏自动展开其全部祖先并滚动到选中项可见（与「记忆滚动」叠加，`block: nearest` 幂等无跳动）。
- **折叠状态持久化**：默认全部展开，手动折叠过的目录跨刷新/重开/重进弹窗保留（`localStorage` 单一 key `comfyui_lora_sidebar_collapsed`，LoRA / Embedding 共享，失效路径无害）。
- **纯前端零新增依赖**：折叠箭头复用 `lucide-react`；改动集中 `FolderSidebar` + `lora-helper` 纯函数 + CSS，`LoraManagerPanel` 与后端 API 零改动；简易弹窗与功能标签页同时生效。

### 🛠️ 构建优化 (Build Optimization)
- **crypto-js 按需引入**：`translation.ts` 改为按需子模块（`md5` / `hmac-sha1` / `enc-base64`），不再整库拉入主 chunk（整库约 214 KB 源码，实际仅用 MD5 与 HMAC-SHA1 签名），主 chunk 实减约 59 kB。
- **vendor 分包**：`react-dom`（含 `react-dom/client` 子路径）与 `marked`/`dompurify` 拆为独立 chunk，主 chunk 684 → 402 kB，全部 chunk < 500 kB，消除构建警告；vendor hash 稳定、缓存更友好。

### 🧪 质量基建 (Quality Infrastructure)
- **组件层测试**：新增 `@testing-library/react` + jsdom 测试基建（`src/test/setup.ts`，滚动 API stub），23 个组件测试覆盖 FolderSidebar 折叠交互、LoraCard NSFW 模糊与遮罩、LoraChips 拖拽控件、PromptTagBlocks 权重胶囊，总计 117 测试全绿。
- **E2E 冒烟**：新增 Playwright（`npm run test:e2e`），5 个**不依赖 ComfyUI 运行**的冒烟用例（应用加载 / 标签切换 / 折叠持久化 / 简易弹窗 / 主题切换），API 在 Playwright 路由层 mock（`e2e/mocks.ts`）。
- **ESLint**：flat config（`typescript-eslint` + `react-hooks` + `react-refresh`），`npm run lint`；清理 56 处未用变量/导入、13 处自动修复项、2 处无用赋值、1 处缺失 error cause，删除 287 行完整死 hook `useExampleImages.ts`；`no-explicit-any` 与 react-hooks 新版启发式规则暂降级为 warning 逐个收敛。

### 🧹 修复与打磨
- **useOptions 解构错位修复**：修复清理 `stats` 未用变量时 `Promise.all` 按位置解构只删绑定、未删对应 `getSystemStats()` 调用，导致 `checkpointInfo` 等全部绑定错位一位、所有下拉选项为空的回归（用户实测发现）；新增 `useOptions` renderHook 单测（`useOptions.test.ts`）与 E2E「下拉选项由 object_info 填充」断言双重防线。
- **假排序下拉**：LoRA 管理器工具栏的装饰性 `A - Z` 假下拉（`onChange={() => undefined}`）改为非交互排序徽标。
- **README 版本标记**：31 个特性小节标题去除漂移的版本标记，版本事实源统一由 CHANGELOG 承担。
- **路径分隔符验证**：验证后端 folders 返回 `/` 分隔符，与侧边栏树路径一致，无失配场景。

## [v0.3.6] - 2026-09-06

### 💾 参数预设（Presets）
- **按工作流分组的命名快照**：在 默认生图 / 多人工作流 / 高清修复 面板标题栏直接「保存」当前完整参数为命名预设，选中后一键「应用」回填（checkpoint 失效时自动保留当前模型并提示）。
- **全生命周期管理**：支持重命名、删除（自定义确认弹窗）、导出/导入 JSON（按模板分组，导出仅含当前模板）。
- **本地持久化**：复用 `localStorage` 单一 key，刷新/重开均保留，不引入后端依赖。

### 🔔 桌面/手机双端完成提醒（Completion Notifications）
- **后台才打扰**：生图 / XYZ / WD、CL 识别 / 手机识图完成时，仅在页面切后台时弹系统通知（Notification API），前台沿用现有 Toast。
- **提示音与开关**：Web Audio 合成提示音（零音频资产）；「通知」弹窗顶部新增 桌面通知 / 提示音 / 仅后台提醒 三个开关。
- **手机端**：识图完成时震动（Vibration API）+ 提示音，不支持的环境静默降级。

### 🎲 动态提示词 / Wildcard
- **两种语法**：`{蓝天|星空|黄昏}` 随机多选 + `__styles__` 通配符词库引用，提交前展开，与 LoRA 语法并存。
- **可复现**：展开以当次生成 seed 为随机种子，同 seed 同输入同词库 → 结果一致（`randomizeSeed` 时自然随机）。
- **内置 4 个词库**（`public/wildcards/*.txt`）：画风 / 光影 / 镜头构图 / 质量词，`BaseControls` 与提示词编辑器均提供「通配符」入口 + 展开预览。

### 🧪 Prompt Lint / 体检
- **8 类实时静态检查**：括号配平、权重语法 / 越界、全角逗号、连续逗号 / 空片段、词条重复、未知 LoRA 引用、未知通配符引用、token 数估算。
- **分级呈现 + 一键修复**：error/warning/info 三级徽标，可修复项（全角逗号、空片段）一键修复，点击问题可定位选中。
- **上下文感知**：LoRA / 通配符名单由 App 透传，未提供时对应规则自动关闭。

### 🛠️ 修复与打磨
- **预设 / 通配符弹窗层级修复**：改为 `createPortal` 挂载到 `document.body`，彻底解决面板内 `backdrop-filter` / `transform` 包含块导致的弹窗被遮挡问题；通配符弹窗在提示词编辑器之上用更高 z-index。
- **陈旧测试断言对齐**：修正 `workflowBuilders.test.ts` 中 LoRA `__value__` 包装器的断言（v0.3.1 引入包装器后遗留）。

## [v0.3.5] - 2026-09-01

### 📱 WD1.4 局域网手机联动 (Local Network Mobile Companion)
- **手机远程识图**：手机与电脑连接同一 Wi-Fi 后，扫码或访问 `http://电脑局域网IP:9999/#/mobile-tag`，即可在手机上选图/拍照，由电脑上的 WD1.4 识别并返回 tags，手机端大字号展示、一键复制。
- **服务端驱动识别**：手机只负责「选图上传 + 收结果」，识别工作流由电脑端 Vite 中间件驱动 ComfyUI 执行——手机锁屏/切后台也不影响任务。
- **Web 端实时同步**：桌面「图片识别」新增「手机同步」标签页，SSE 实时推送手机任务流（缩略图/状态/结果），手机提交与完成均有 Toast 提醒，识别完成自动写入 WD 单图输出框。
- **一键应用到工作流**：手机识别结果可复制，或一键应用到 默认生图 / 多人工作流 / 高清修复 的正向提示词（自动去重）。
- **扫码直达入口**：「图片识别」面板新增「手机连接」按钮，弹窗展示局域网二维码（`qrcode` 为唯一新增依赖），扫码即达手机识图页；「手机同步」空态页内嵌同一二维码。
- **局域网访问打通**：dev/preview 服务默认监听 `0.0.0.0` 并放行 Host 校验；`run.bat` 自动添加 9999 端口防火墙规则，启动后打印本机与局域网访问地址。
- **前后端单一事实源**：WD14 工作流构造抽为共享纯函数 `src/lib/wd14Workflow.ts`，桌面与手机共用同一份 JSON，避免双份配置漂移。

### 🛠️ 修复与打磨
- **识别结果去重**：修复 WD14 Tagger 节点 `tags` 输出与 Save Text 节点 `text` 输出内容相同、导致识别结果显示两遍的问题（桌面 WD 单图同源问题一并修复）；并用真实 ComfyUI history 结构补充回归单测。
- **同步链路强化**：手机任务订阅提升至应用全局层，任意页面均实时接收手机更新；完成结果自动写入「图片识别」输出框并弹 Toast。
- **健壮性加固**：任务卡片对异常数据（未知状态/缺参数/坏时间戳）容错；标签栏窄屏自动换行，避免整页白屏风险。

### 🎰 灵感老虎机：随机提示词组合器 (Slot Machine)
- **全新独立标签页**：侧边栏「生图模板」组新增「灵感老虎机」，基于本地 1.7 万条提示词词库的随机组合工具，不影响任何既有功能。
- **六大默认词槽**：角色 / 服饰 / 动作 / 场景 / 画风 / 光影氛围，每槽独立配色、可锁定单槽重摇、可配置每次抽取数量（1-2 个）、支持自定义槽。
- **拉杆摇奖体验**：空格键快捷摇奖、逐槽滚动动画、空态时展示每槽示例词条（告别"空卡片"）。
- **一键落地**：应用到 默认生图 / 多人工作流 / 高清修复 的正向提示词框（自动去重），或一键复制；最近 20 次历史**点击即复制**并回填结果区，带状态反馈。
- **智能词库过滤**：自动剔除 NSFW、负面词与超过 80 字符的整句/整段提示词，避免被"画廊式提示词"污染抽取结果。

### 📊 XYZ 智能复盘 (Smart Review)
- **一键图像质量评分**：XYZ 批量跑完后逐格取图评分（纯前端 canvas）：清晰度（Laplacian 方差）50% + 曝光健康度 20% + 对比度 20% + 色彩丰富度 10%，批内归一化 0-100。
- **热度叠加层**：每格分数徽标 + 红绿渐变底色，可整体开关。
- **甜区高亮**：Top 10% 组合自动描边高亮，并输出「最优组合」摘要条。
- **轴向结论**：按轴取值聚合平均分，输出"当 XX=YY 时平均得分最高"的自然语言结论（如 `CFG=9 最优（均值 86.2）`）。
- **性能与健壮性**：图片降采样至 ≤160px + 分片计算不阻塞 UI；失败/无图格子自动跳过；重新运行 XYZ 自动清空上一轮复盘。

### 🛠️ 修复与打磨
- **XYZ 操作行对齐**：将「智能复盘」按钮并入 `中断队列 / 重试失败 / 导出结果 / 导出网格` 同一行；热度层开关与最优组合摘要改为复盘完成后的独立副行。
- **老虎机结果区排版**：词库过滤超长整句 + 结果胶囊与词槽窗口英文主词 ellipsis 截断（悬浮查看全文与中文释义）；移除按钮加大并增强悬停反馈。
- **老虎机 UI 整体打磨**：词槽卡片专属配色（顶部彩条 + 色点）、悬停上浮、空态示例词、历史记录时间戳与点击复制状态变绿。
- **稳定性修复**：修复历史点击复制回调中引用未初始化状态导致的 TDZ 运行时错误。

## [v0.3.3] - 2026-08-21

### 🌙 全新视觉体验：白昼与黑夜模式 (Dark/Light Mode)
- **丝滑切换动效**：引入现代化的 **View Transition API**，结合**圆形扩散 (Circular Clip-path)** 剪裁效果，实现极具交互感的明暗转换。
- **性能深度优化**：
  - **过渡抑制 (Transition Suppression)**：切换瞬间自动禁用全局常规 CSS 过渡，消除动画冲突导致的卡顿。
  - **渲染管线同步**：确保 React 状态更新与浏览器渲染帧同步。
- **UI 交互增强**：在侧边栏底部集成动态主题切换按钮，支持 Moon/Sun 图标与文字状态同步。
- **防闪烁处理**：在 HTML 头部注入内联脚本，优先读取本地存储的模式偏好，彻底杜绝页面加载瞬间的“白闪”现象。

### 📊 进度条视觉重塑 (Progress Bar Redesign)
- **玻璃拟态风格**：引入 `backdrop-filter: blur(20px)` 磨砂玻璃效果，提升视觉层次感。
- **微光扫过动效 (Shimmer Effect)**：为进度填充增加匀速流动的光影效果，提供更直观的运行反馈。
- **布局微调**：优化进度条高度为 6px，文字透明度调整为 0.7，实现更精致的视觉比例。

### 🔔 通知系统打磨 (Toast Improvements)
- **多层柔和阴影**：明暗模式分别适配不同的弥散阴影方案，确保通知项在不同背景下均有清晰的悬浮感。
- **交互反馈**：新增悬停（Hover）上浮动效与琥珀色边缘光晕。
- **布局修复**：优化通知堆叠时的间距逻辑，解决阴影重叠造成的视觉凌乱感。

## [v0.3.2] - 2026-08-21

### 📦 LoRA 管理增强 (Wild LoRA Management)
- **触发词一键提取与保存**：支持从 `.safetensors` 元数据中自动解析训练标签，并持久化保存至后端，实现“提取即保存”的闭环流程。
- **本地模型重命名**：集成模型文件重命名功能，支持直接在 UI 界面修改本地文件名，并自动同步刷新列表。

### 🎨 UI/UX 视觉打磨与主题适配
- **全局图标主题化**：修复了图标在深浅模式下的颜色偏移，确保全站图标完美适配 `currentColor` 变量。
- **XYZ 状态语义化**：重构了 XYZ 控制器的任务状态显示，新增“排队中 (Queued)”蓝色视觉反馈，并优化了运行、成功、失败的对比度。
- **通知系统优化**：引入分层阴影（Layered Shadows）与玻璃拟态效果，优化了多条通知堆叠时的视觉间距与层级感。
- **列表可见性修复**：彻底解决了已选 LoRA 列表在浅色模式下文字不可见及滑块轨道消失的问题。

## [v0.3.1] - 2026-08-20

### 🔧 核心逻辑修复 (Core Logic Fix)
- **LoRA 加载逻辑重构**：
  - **API 模式适配**：为 `Lora Loader (LoraManager)` 节点的 `loras` 输入字段引入了 `{"__value__": [...]}` 包装器，彻底解决了 ComfyUI API 的 `bad_linked_input` (400) 错误。
  - **路径格式统一**：强制在所有工作流中使用反斜杠 `\` 作为 LoRA 路径分隔符，完美兼容 Windows 环境。
  - **后缀管理优化**：在 API 模式下自动剥离 `.safetensors` 等扩展名，确保与自定义插件节点的识别逻辑完全匹配。
  - **稳定性补丁**：移除了之前临时的列表填充（Padding）逻辑，改用标准的包装器方案，并补全了 LoRA 对象的所有状态字段。

## [v0.3.0] - 2026-08-20

### 🏗️ 架构重构 (Major Refactor)
- **核心组件拆分**：将超过 6800 行的巨型组件 `App.tsx` 彻底拆分为模块化的组件、Hooks 和工具库。
- **功能模块化**：
  - `src/components/features/`：独立出生图 (Generation)、LoRA 管理 (Lora)、记事本 (Notes)、标签反推 (Tagging) 和 XYZ 控制器 (Xyz) 模块。
  - `src/hooks/`：提取业务逻辑到 `useGeneration`, `useLoras`, `useXyz`, `useUiState` 等自定义 Hooks 中。
  - `src/components/ui/`：建立统一的 UI 原子组件库（Modal, BaseControls, FormFields 等）。
- **性能与维护性提升**：更细粒度的组件拆分减少了不必要的重绘，显著提升了代码的可读性与长期维护性。

### 🧹 项目清理
- 移除冗余的文档文件 `PROJECT_INTRODUCTION.md` 和 `release_notes.txt`，统一整合至 `README.md` 和 `CHANGELOG.md`。
- 清理了重构过程中遗留的旧文件和临时任务文件。

---

## [v0.2.3.6] - 2026-08-19

### 📝 任务规划
- 新增 `AppRefactorTask.md`，为 `App.tsx` 的深度重构提供详细路径规划（已在 v0.3.0 完成）。

## [v0.2.3.5]

### 🎨 多人画布算法增强
- **融合模式选择**：支持 Mask 叠加、Latent 融合，支持角色独立融合模式。
- **Mask 羽化控制**：新增独立羽化参数及实时预览。
- **权重自动平衡**：根据重叠面积自动调整 Prompt 权重。

## [v0.2.3.4]

### ⚡ XYZ 性能巅峰优化
- **动态预览轴**：支持生成前预览组合并手动排除。
- **耗时估算**：实时计算预计生成时间。
- **WebSocket 复用**：全局单连接复用，衔接速度提升 30%。

## [v0.2.3.2]

### 📐 侧边栏布局重构
- **全局 AppSidebar**：将导航迁移至左侧，提升纵向视野。
- **迷你模式**：支持一键折叠，适配小屏幕响应式布局。

## [v0.2.3.1]

### 🩺 状态感知增强
- **实时连接监控**：新增 WebSocket 状态呼吸灯提醒。
- **断连覆盖层**：提供故障排除指南与自动重连机制。

## [v0.2.2]

### 📦 LoRA 管理器深度优化
- **性能优化**：引入硬件加速与 `React.memo`，支持 850+ LoRA 丝滑滚动。
- **横向视觉网格**：采用玻璃拟态风格，节省空间。
- **拖拽排序智能化**：新增边缘自动滚动与物理反馈。

## [v0.2.1]

### 🎨 文字装饰系统扩张
- **60 种样式**：新增爆炸气泡、条幅等视觉风格。
- **叠加系统**：支持多样式自由组合叠加。

## [v0.2.0]

### ✍️ 专业记事本升级
- **纯净编辑**：回归提示词本质，支持自动保存、一键清洗、全宽禅模式。
- **标签页进度同步**：浏览器标题实时显示生图进度。

---

*更多早期版本记录请参考 Git 提交历史。*
