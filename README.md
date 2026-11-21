# 左侧栏入口显示 · dsh-sidebar-entry-manager

[English](./README.en.md) · [详细说明（现象 → 根因 → 方案）](./docs/详细说明.md)

![左侧栏入口显示](icon.svg)

| 项目 | 内容 |
| --- | --- |
| 界面显示名 | **左侧栏入口显示**（`locale/zh.json` → `meta.title`） |
| 包名 | `@local/dsh-sidebar-entry-manager` |
| 版本 | `1.1.1` |
| 形态 | DSH Web 客户端插件（宿主半边为空实现，全部逻辑在 `client.js`） |
| 依赖 | 只依赖宿主既有的 `slots` / `locale` / `layout` 服务；`dsh.client.inject` 为空数组 |
| 是否改动宿主或别的插件 | **不改**。只注册自己的座位、只写自己的 CSS 类名（`dsem_` 前缀） |

---

## 这是什么

左侧栏那一排面板入口（插件、自动化任务，以及今后任何插件 `register` 到 `sidebar.panellist` 的行）
会越装越长。本插件给这些行加了一层**显示开关**：

- 关掉的入口**不会消失**，随时可以回到管理面板里重新打开；
- 偏好存在本机浏览器，刷新、重启都还在；
- 管理界面有两个入口：点左侧栏新增的「左侧栏入口」图标，或进设置页的「左侧栏入口」一节；
- 侧栏底部的「**更多**」菜单里**不再重复列出面板入口**，只保留一条「管理左侧栏入口…」捷径。

## 能做到什么、做不到什么

先说清边界，避免装上去才发现「和想的不一样」。三条做不到的都是**宿主硬编码**，不是工作量问题。
依据是宿主 `@deepseek-ai/dsh-client-ui-sidebar@0.2.1-rc.3` 的 `lib/client.js`：

| | 能力 | 说明 |
| --- | --- | --- |
| ✅ | 隐藏任意非 `plugins` 的面板行 | 行过滤条件 `id === "plugins" \|\| !unpinned.includes(id)`（`client.js:471`） |
| ✅ | 被隐藏的入口仍可打开 | 管理面板里开关随时可以拨回去（1.1.1 起「更多」菜单不再列入口清单） |
| ✅ | 偏好持久化 | `localStorage` 键 `dsh-sidebar-entry-manager:prefs` |
| ✅ | 双入口管理界面 | 左栏面板 + 设置页，共用同一份偏好 |
| ❌ | 藏掉「插件」行 | 行过滤对 `plugins` 短路；`setPinned` 首行对 `plugins` 直接 `return`（`client.js:26`） |
| ❌ | 藏掉「更多」按钮 | 它的显隐 = `sidebar.panellist.actions` 是否有注册（`client.js:587`）。本插件注册该座位用来放「管理左侧栏入口…」菜单项，注册了它就会亮；去掉这条注册会让宿主菜单里的「面板入口」区块整块消失，但也会一并失去这台捷径 |
| ❌ | 把两行合并成一个入口 | 需要自己接管 `sidebar` 座位的渲染层，那是重写侧栏外壳，不在本插件范围内 |

所以左栏的**最少形态**是「插件 + 更多」两行；管理面板里「插件」显示为只读徽章「始终显示」。

## 用法

1. 点左侧栏新增的**「左侧栏入口」**图标 → 打开管理面板。
2. 在列表里关掉不想看见的入口。切换**立即生效**（关闭当前面板行会立刻从主排消失）。
3. 想找回来：点左侧栏的「**左侧栏入口**」图标（或侧栏底部「**更多**」→「**管理左侧栏入口…**」）回到管理面板，
   把对应开关拨回去即可；关掉的入口不会从列表里消失。
4. 「全部显示」按钮一键清空所有偏好。

设置页（DSH 设置 → 左侧栏入口）是同一个组件的另一处挂载，读写同一份偏好。

## 工作原理

宿主把「哪一行被收起」存在一个**内存**快照里（`createPanelPins()`，`client.js:17-30`），
重载即重置，不读也不写 localStorage。第三方插件能碰到这个快照的位置只有两处：

1. `sidebar` 座位的 `inject` 工厂返回值（`setPinned`、`hooks.entryPins`）—— 该工厂被原样存进槽位账本
   （`dsh-client-ui-slots/lib/index.js:214`），**不需要接管座位**，直接调 `entry.inject()` 就能拿到；
2. `sidebar.panellist.actions` 座位的 **ownerProps.onPinnedChange** —— 就是 `setPinned` 本身（1.0.0 用的路，现已降级为兜底）。

本插件**两条都走**：启动期用第 1 条（首屏即生效），「更多」菜单挂载时用第 2 条对账。数据流是：

```text
localStorage  ←→  模块内 snapshot  ──下发──>  宿主 setPinned(id, pinned)  ──>  宿主内存快照  ──>  侧栏行
      ↑                    ↑                              ↑
      │                    │                              └── 启动期从 sidebar 座位的 entry.inject 直接取出
      └── 管理面板开关 ─────┘
```

- **单向执行**：`localStorage` 是唯一真相源；宿主的 pin 态只是它的投影。
- **通道来源（关键）**：宿主 `ui-sidebar` 的 `apply` 把 `setPinned` 藏在它的 `injectProps` 工厂返回值里，
  而这个工厂以 `entry.inject` 的形式存进槽位账本（`dsh-client-ui-slots/lib/index.js:214`）。
  本插件在 `apply` 一开始就调 `ctx.slots.entries('sidebar')[i].inject()`，**同步**拿到 `setPinned`，
  不需要用户点开任何菜单。宿主若晚于本插件注册，则退化为订阅 `slots.subscribe('sidebar', …)` 补抓。
- 宿主 `setPinned` 本身是幂等的：只有当传入值与当前状态矛盾时才真正改快照，所以重复下发没有副作用。
- 第三道保险：`requestAnimationFrame` 一帧后再补抓一次，覆盖加载顺序抖动的极端情况。
- **对账（reconcile）**：「更多」菜单挂载时仍会用宿主下发的 `entries`（含每行 `pinned` 真值）比对一次，
  但菜单本身只渲染一条「管理左侧栏入口…」；这个对账只是兜底，不是唯一时机。

### 关于首屏（v1.1.0 已修复）

1.0.0 的缺陷是「刷新后所有侧栏行都显示，必须点开一次『更多』才生效」。根因：唯一的通道来源
`onPinnedChange` 来自 `sidebar.panellist.actions` 座位的 ownerProps，而宿主用 primitives 的 `Menu`
包裹该座位，`Menu` 在 `open === false` 时不挂载 children（`dsh-client-ui-primitives/lib/index.js:4373`），
所以不打开菜单就永远拿不到通道。

1.1.0 改为启动期直接读 `sidebar` 座位的 `entry.inject`（root scope 无参，可同步调用），首屏即按偏好渲染。
`onPinnedChange` 兼容路径保留，作为宿主改版后的退路。

### 关于「更多」菜单（v1.1.1 已精简）

1.1.0 的「更多」菜单会把每个面板入口再列一遍（带「已隐藏」标记）。这与宿主自带菜单在视觉上重叠，
1.1.1 把这整块列表删掉，只留一条「管理左侧栏入口…」。

代价要讲清楚：本插件是唯一注册 `sidebar.panellist.actions` 的插件，这段内容非空也正是宿主渲染「更多」按钮的条件
（`dsh-client-ui-sidebar/lib/client.js:587`）。所以「只删列表」并不等于「删掉按钮」——按钮仍在，点开只有一条管理入口；
若把这条注册也一起去掉，「更多」按钮会消失，同时被隐藏的入口就只能从左侧栏的「左侧栏入口」图标或设置页找回来。

**仍然存在的限制**：若宿主将来不再把 `setPinned` 放进 `sidebar` 座位的 `inject` 返回值，
插件会自动退回 1.0.0 的行为（点开一次「更多」后生效），此时管理面板底部的提示行会重新出现。

## 安装

产物：`build/dsh-sidebar-entry-manager-1.1.1.tgz`（npm pack 格式，包内只含运行所需文件，不含 `build/` 与 `docs/`）。

也可以从 GitHub Release 下载打包好的 tgz（发布后生效）：[Releases](https://github.com/yanli-nyan/dsh-sidebar-entry-manager/releases)。

> **从旧版本升级时**：先把已装的版本移除（插件页移除，或删掉 `dependencies` 那行 + `bundles` 里那项），
> 再按下面任一方式装 1.1.1 并重启。不要两个版本同时留在 `bundles` 里。
> 若旧版是通过 `https://github.com/...` 的 Release 地址装的，请把 `dependencies` 那一行换成本地 tgz 或新的 Release 地址。

先拿到 tarball 的**绝对路径**（按你的克隆位置替换前缀）：

```text
<本仓库根目录>\build\dsh-sidebar-entry-manager-1.1.1.tgz
```

> 仓库里 `build/` 是打包产物目录，已被 `.gitignore` 忽略。若你拿到的是源码而没有 `build/`，
> 在仓库根目录执行 `npm pack --pack-destination build` 即可重新生成。

### 方式一：DSH 插件页（推荐）

DSH 桌面端 → 左侧栏「**插件**」→ 安装 → 填上面那个 tgz 的**绝对路径**。

装完**完全退出并重新启动** DSH。

### 方式二：手工挂载（等价，供离线/排障）

1. 把 tgz 复制到 profile 的 `.plugin-manager/`：

```text
C:\Users\lenovo\.dsh\profiles\desktop\.plugin-manager\dsh-sidebar-entry-manager-1.1.1.tgz
```

2. 编辑 `C:\Users\lenovo\.dsh\profiles\desktop\package.json`，在 `dependencies` 里加一行：

```json
"@local/dsh-sidebar-entry-manager": "file:.plugin-manager/dsh-sidebar-entry-manager-1.1.1.tgz"
```

3. 同一文件的 `dsh.profile.bundles` **数组末尾**追加包名（顺序即叠加顺序，放末尾最安全）：

```json
"@local/dsh-sidebar-entry-manager"
```

4. 在该 profile 目录执行安装，然后完全退出并重启 DSH：

```powershell
cd C:\Users\lenovo\.dsh\profiles\desktop
pnpm install
```

3 和 4 都不能省：只加依赖不加入 `bundles`，包在磁盘上但不会被组合进 cordis 树。

### 生效前提

- 包里的 `cordis.patch.yml` 会向插件树 `insert` 一个 `sidebar-entry-manager` 节点，引用本包的 `dsh.client` 入口；
- `dsh.client.immediately: true` 表示不需要用户手动打开面板，Web 客户端一启动就装载 `client.js`；
- 改代码后必须重启 DSH（模块世代在启动时确定）。

## 验证

重启后：

- [ ] 左侧栏「插件」「自动化任务」之后出现 **左侧栏入口** 图标行；
- [ ] 点它 → 主区出现管理面板，列出当前全部面板入口，其中「插件」是只读的「始终显示」；
- [ ] 关掉「自动化任务」→ 该行立刻从左侧栏消失；
- [ ] 点「更多」→ 菜单里**只有一条「管理左侧栏入口…」**，不再重复列面板入口；点它回到管理面板；
- [ ] **重启 DSH 后，首次进入时「自动化任务」直接就是消失状态**（v1.1.0 修复项，无需点开「更多」）；
- [ ] 设置页出现「左侧栏入口」一节，内容与侧栏面板完全一致；
- [ ] 卸载/禁用插件后，左侧栏回到原状，无残留行、无残留 `<style>`。

## 卸载

- 插件页移除，或把 `dsh.profile.bundles` 里的包名与 `dependencies` 那行删掉后 `pnpm install` + 重启；
- 偏好残留在浏览器 `localStorage` 的 `dsh-sidebar-entry-manager:prefs` 键里（无副作用，键名唯一）；
  想彻底清干净可在浏览器控制台执行：

```js
localStorage.removeItem('dsh-sidebar-entry-manager:prefs')
```

宿主的 `plugins` 行、`Menu` 组件、其它插件文件**均未被改动**，无需还原任何东西。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build/dsh-sidebar-entry-manager-1.1.1.tgz` | 分发包（`.gitignore` 忽略，不放仓库里） |
| `docs/详细说明.md` | 现象 → 根因 → 方案 → 验证的完整长文 |
| `LICENSE` | MIT |
| `index.js` | 宿主半边：空 `apply()`（全部工作在浏览器半边） |
| `client.js` | **生效源**：四个座位注册 + 偏好 store + 对账 + 两套 UI + 自绘 CSS |
| `cordis.patch.yml` | 把本包挂进 Web 插件名册（`insert: sidebar-entry-manager`） |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示名与说明 |
| `icon.svg` | 插件图标（96×96，包内） |
| `README.md` / `README.en.md` | 中文 / 英文说明（均随包发布） |

### 注册的座位

| 座位 | 注册选项 | 作用 |
| --- | --- | --- |
| `sidebar.panellist` | `id: "sidebar-entry-manager"`, `order: 20` | 左栏入口图标（排在 `plugins` 0 / `schedules` 10 之后） |
| `main` | `key: "sidebar-entry-manager"` | 管理面板本体 |
| `sidebar.panellist.actions` | `id: "sidebar-entry-manager"`, `order: 0` | 「更多」菜单里的一条管理入口 + 兜底对账（v1.1.0 起不再依赖它拿通道） |
| `settings.section` | `id: "sidebar-entry-manager"`, `order: 25` | 设置页一节，与面板共用组件 |

组件全部走 `ctx.slots.inject(...)` 注册，随插件卸载一并回收。

### 调试出口

浏览器控制台：

```js
__dshSidebarEntryManager.get()      // 当前偏好，如 { schedules: false }
__dshSidebarEntryManager.entries()  // 当前注册到 sidebar.panellist 的 id
__dshSidebarEntryManager.set('schedules', false)  // 等于在面板里关掉它
__dshSidebarEntryManager.reset()
```

## 版本

| 版本 | 变更 |
| --- | --- |
| `1.0.0` | 首版：四个座位、偏好持久化、「更多」菜单对账、双入口管理界面 |
| `1.1.0` | **修复首屏失效**：改从 `sidebar` 座位的 `entry.inject` 启动期直取宿主 `setPinned`，不再依赖点开「更多」菜单；新增槽位订阅 + rAF 双兜底 |
| `1.1.1` | **精简「更多」菜单**：删掉重复的面板入口列表，只保留「管理左侧栏入口…」；管理面板的说明文案改为「入口关掉后随时可以回到这里重新打开」 |
