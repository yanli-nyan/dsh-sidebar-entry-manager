// dsh-sidebar-entry-manager — 浏览器半边。
//
// 目标：让用户隐藏/显示左侧栏的面板入口行，并把偏好持久保存在本机。
//
// 宿主事实（写代码前已逐条实证，改动本文件前请先复核）：
//  · 面板行 = 座位 sidebar.panellist 的全部注册项，按 order 升序；
//    行过滤条件写死在 dsh-client-ui-sidebar/lib/client.js:  id === "plugins" || !unpinned.includes(id)。
//  · panelPins.setPinned(id, pinned) 首行就 `if (id === "plugins" || pinned !== current.includes(id)) return;`，
//    所以「插件」行永远藏不掉；pin 状态是内存 store，重载即重置，不读 localStorage。
//  · 宿主的 setPinned 只通过 sidebar 座位的 injectProps 下发给 SidebarRoot，
//    另一条路是「更多」菜单（sidebar.panellist.actions）的 ownerProps。没有公开 service。
//  · 「更多」按钮的显隐 = entriesOfSlot("sidebar.panellist.actions").length > 0；本插件必须占这个座位，
//    于是它必然存在 —— 这是宿主硬编码，不是本插件的副作用可以消除的。
//
// 本模块做四件事：
//  1) 注册 sidebar.panellist 入口 + main 管理面板 + settings.section 一节，双入口读写同一份偏好。
//  2) 偏好真相源是 localStorage，键 dsh-sidebar-entry-manager:prefs，形如 {"schedules": false}。
//  3) 对账（reconcile）优先走 sidebar 座位 injectProps 里的 setPinned + hooks.entryPins，
//     拿不到时退回「更多」菜单下发的 onPinnedChange；两条路都是宿主内部已有的公开下发点。
//  4) 「更多」菜单里不再列出面板入口清单，只保留一条「管理左侧栏入口…」，直接跳到管理面板。
window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar-entry-manager',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;

    /** locale 命名空间，同时决定 slot 注册诊断里的归属。 */
    const NS = 'sidebarEntryManager';
    /** 本插件在 sidebar.panellist / main / actions / settings.section 四处共用的 id / key。 */
    const PANEL_ID = 'sidebar-entry-manager';
    const PREFS_KEY = 'dsh-sidebar-entry-manager:prefs';
    const STYLE_ID = 'dsh-sidebar-entry-manager';
    /** 宿主硬编码常显的行，任何 setPinned 调用都会被静默拒绝，故在 UI 上锁死为只读。 */
    const ALWAYS_VISIBLE = 'plugins';

    /** 运行时字典。包内 locale/*.json 只供插件管理页读 meta，与这里无关。 */
    const DICTS = {
      zh: {
        "panel.label": "左侧栏入口",
        "panel.title": "左侧栏入口显示",
        "panel.desc": "决定哪些面板入口出现在左侧栏主排。关掉的入口不会消失，随时可以回到这里重新打开。",
        "panel.always": "始终显示",
        "panel.switchOn": "显示中",
        "panel.switchOff": "已隐藏",
        "panel.reset": "全部显示",
        "panel.footerHint": "偏好保存在本机浏览器，切换后立即生效；关掉的入口随时可以回到这里重新打开。",
        "panel.empty": "当前没有可管理的入口。",
        "panel.pending": "宿主侧栏还没就绪，切换开关后会在侧栏出现时生效。",
        "panel.note": "「插件」行与「更多」按钮由宿主固定显示，本插件无法隐藏它们；这是宿主硬编码的行为，不是本插件的开关能控制的部分。",
        "menu.manage": "管理左侧栏入口…",
        "settings.label": "左侧栏入口",
        "settings.hint": "与左侧栏面板里的设置共用同一份偏好。"
      },
      en: {
        "panel.label": "Sidebar entries",
        "panel.title": "Sidebar entry visibility",
        "panel.desc": "Choose which panel entries appear in the sidebar column. Hidden entries never disappear — reopen them here whenever you like.",
        "panel.always": "Always shown",
        "panel.switchOn": "Shown",
        "panel.switchOff": "Hidden",
        "panel.reset": "Show all",
        "panel.footerHint": "Saved in this browser and applied immediately. Turn a hidden entry back on here at any time.",
        "panel.empty": "There are no entries to manage right now.",
        "panel.pending": "The sidebar is not ready yet. Your choice applies as soon as it appears.",
        "panel.note": "The Plugins row and the More button are hard-coded by the host and cannot be hidden. This plugin only manages the rows in between.",
        "menu.manage": "Manage sidebar entries…",
        "settings.label": "Sidebar entries",
        "settings.hint": "Shares the same preferences as the sidebar panel."
      },
    };

    const CSS = [
      "/* 本插件自绘样式，类名统一 dsem_ 前缀，不覆盖宿主或其它插件的规则。 */",
      ".dsem_root{display:flex;flex-direction:column;gap:14px;padding:2px 0 20px;max-width:720px}",
      ".dsem_head{display:flex;flex-direction:column;gap:6px}",
      ".dsem_title{margin:0;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}",
      ".dsem_desc{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
      ".dsem_list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}",
      ".dsem_row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-2)}",
      ".dsem_row:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}",
      ".dsem_rowText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}",
      ".dsem_rowTitle{font-size:13px;line-height:1.4;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsem_rowHint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsem_lock{flex:0 0 auto;font-size:11px;line-height:1.4;padding:2px 8px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".dsem_switch{position:relative;flex:0 0 auto;width:38px;height:22px;padding:0;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:background 140ms ease,border-color 140ms ease}",
      ".dsem_switch.is-on{background:var(--dsw-alias-state-business-primary,#4f8cff);border-color:transparent}",
      ".dsem_knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform 140ms ease}",
      ".dsem_switch.is-on .dsem_knob{transform:translateX(16px)}",
      ".dsem_switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:2px}",
      ".dsem_footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
      ".dsem_reset{font:inherit;font-size:13px;padding:6px 12px;border-radius:var(--dsw-radius-sm,8px);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".dsem_reset:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}",
      ".dsem_footerHint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
      ".dsem_note{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
      ".dsem_menu{display:flex;flex-direction:column;gap:2px;min-width:200px;max-width:280px}",
      ".dsem_menuItem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.4;text-align:left;cursor:pointer}",
      ".dsem_menuItem:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}",
      ".dsem_menuItem:focus-visible{outline:none;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}",
      ".dsem_menuLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ].join('\n');
    // ------------------------------------------------------------------
    // 偏好存储：localStorage 是唯一真相源；内存 snapshot 让 React 同步读。
    // ------------------------------------------------------------------
    const listeners = new Set();
    let snapshot = readPreferences();
    /** 「更多」菜单下发的 onPinnedChange，就是宿主的 panelPins.setPinned。 */
    let pinnedChannel = null;

    function readPreferences() {
      const next = {};
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.keys(parsed).forEach((key) => {
              if (parsed[key] === false) next[key] = false;
            });
          }
        }
      } catch (error) {
        // 坏数据或 localStorage 被禁用：退回「全部显示」，不把异常抛给宿主。
      }
      return next;
    }

    function getPreferences() {
      return snapshot;
    }

    function subscribePreferences(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function publishPreferences(next) {
      snapshot = next;
      Array.from(listeners).forEach((listener) => {
        try {
          listener();
        } catch (error) {
          // 单个订阅者出错不影响其他订阅者。
        }
      });
    }

    function isEntryVisible(id) {
      return snapshot[id] !== false;
    }

    function writePreferences(next) {
      snapshot = next;
      try {
        if (Object.keys(next).length === 0) window.localStorage.removeItem(PREFS_KEY);
        else window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch (error) {
        // 写入失败时本次会话仍按内存值生效。
      }
      publishPreferences(next);
    }

    /**
     * 把偏好下发到宿主。
     * 宿主的 setPinned 语义幂等（只在需要改变时才真正 set），所以可以盲目调用，
     * 不需要先知道当前 pin 态；返回是否真的拿到了通道。
     */
    function applyPin(id, visible) {
      if (id === ALWAYS_VISIBLE) return false;
      if (typeof pinnedChannel !== 'function') return false;
      try {
        pinnedChannel(id, visible);
        return true;
      } catch (error) {
        return false;
      }
    }

    function setEntryVisible(id, visible) {
      if (id === ALWAYS_VISIBLE) return false;
      const next = Object.assign({}, snapshot);
      if (visible) delete next[id];
      else next[id] = false;
      writePreferences(next);
      return applyPin(id, visible);
    }

    function resetAll() {
      const hidden = Object.keys(snapshot);
      writePreferences({});
      hidden.forEach((id) => applyPin(id, true));
      return hidden.length;
    }

    /** 菜单 ownerProps 的 entries 是宿主真值，这里按偏好把它拉回一致。 */
    function reconcileEntries(entries) {
      if (!Array.isArray(entries) || typeof pinnedChannel !== 'function') return;
      entries.forEach((entry) => {
        if (!entry || entry.id === ALWAYS_VISIBLE) return;
        const want = isEntryVisible(entry.id);
        if (want === (entry.pinned === true)) return;
        try {
          pinnedChannel(entry.id, want);
        } catch (error) {
          // 宿主拒绝时保持现状，下次菜单打开再对账。
        }
      });
    }

    /** 全量下发一次：已存偏好逐条推给宿主。 */
    function syncAllPins() {
      if (typeof pinnedChannel !== 'function') return false;
      const preferences = getPreferences();
      Object.keys(preferences).forEach((id) => applyPin(id, preferences[id] !== false));
      return true;
    }

    // ------------------------------------------------------------------
    // 宿主通道：启动期直接从「sidebar」槽位的 entry.inject 里取 setPinned
    // ------------------------------------------------------------------
    /**
     * 宿主 ui-sidebar 的 apply 把 setPinned 藏在 injectProps 里，并以 entry.inject
     * 的形式存进槽位账本。该工厂在 root scope 下不需要任何参数，所以启动期
     * 同步调用它就能拿到真正的 pin 通道——不必等用户点开「更多」菜单
     * （菜单 children 只在 open 时才挂载，那是首屏失效的根因）。
     */
    function grabPinnedChannel(ctx) {
      let entries;
      try {
        entries = ctx.slots.entries('sidebar');
      } catch (error) {
        return null;
      }
      if (!Array.isArray(entries)) return null;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry || typeof entry.inject !== 'function') continue;
        let injected;
        try {
          injected = entry.inject();
        } catch (error) {
          continue;
        }
        if (injected && typeof injected.setPinned === 'function') return injected.setPinned;
      }
      return null;
    }

    /** force=true 时允许替换旧通道（宿主重挂 ui-sidebar 会换出新的 setPinned）。 */
    function tryAttachPinnedChannel(ctx, force) {
      if (typeof pinnedChannel === 'function' && !force) return true;
      const channel = grabPinnedChannel(ctx);
      if (typeof channel !== 'function') return typeof pinnedChannel === 'function';
      pinnedChannel = channel;
      syncAllPins();
      return true;
    }

    /**
     * 插件启动期抢占通道：一次性拿到后首屏即按偏好渲染。
     * 插件与 ui-sidebar 的加载顺序由 profile 的 bundle 顺序决定，若本插件先 apply，
     * 就订阅「sidebar」槽的注册变更，等宿主注册后补上。
     */
    function attachHostPins(ctx) {
      // 先试一次；抢不到就靠下面的订阅等宿主注册。
      tryAttachPinnedChannel(ctx, false);
      let stop = null;
      try {
        stop = ctx.slots.subscribe('sidebar', () => {
          tryAttachPinnedChannel(ctx, true);
        });
      } catch (error) {
        stop = null;
      }
      return () => {
        if (typeof stop === 'function') stop();
      };
    }

    /**
     * 首屏兜底：槽位订阅是微任务批处理的，若宿主注册与 React 首帧的时序错开，
     * 会在首帧闪一次「全部显示」。加一帧 rAF 再对账一次，成本可忽略。
     */
    function settlePinsNextFrame(ctx) {
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return () => {};
      const handle = window.requestAnimationFrame(() => tryAttachPinnedChannel(ctx, true));
      return () => {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle);
      };
    }

    function watchPreferences() {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
      const onStorage = (event) => {
        if (event && event.key !== null && event.key !== PREFS_KEY) return;
        publishPreferences(readPreferences());
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const tagId = '@local/dsh-sidebar-entry-manager/client.css';
      const selector = 'style[data-plugin-css=' + JSON.stringify(tagId) + ']';
      let tag = document.querySelector(selector);
      if (!tag) {
        tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-sidebar-entry-manager';
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      }
      return () => {
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    // ------------------------------------------------------------------
    // hooks
    // ------------------------------------------------------------------
    function usePreferences() {
      const [value, setValue] = React.useState(getPreferences);
      React.useEffect(() => subscribePreferences(() => setValue(getPreferences())), []);
      return value;
    }

    /** entriesOfSlot 每次调用都返回新数组，不能用 useSyncExternalStore，改走订阅 + setState。 */
    function usePanelEntries(ctx) {
      const read = () => {
        try {
          return ctx.slots.entriesOfSlot('sidebar.panellist').slice();
        } catch (error) {
          return [];
        }
      };
      const [entries, setEntries] = React.useState(read);
      React.useEffect(() => {
        let alive = true;
        const sync = () => {
          if (alive) setEntries(read());
        };
        sync();
        const dispose = ctx.slots.subscribe('sidebar.panellist', sync);
        return () => {
          alive = false;
          if (typeof dispose === 'function') dispose();
        };
      }, [ctx]);
      return entries;
    }

    function resolveLabel(options, fallback) {
      try {
        const label = options ? options.label : undefined;
        if (typeof label === 'function') {
          const value = label();
          if (typeof value === 'string' && value.length > 0) return value;
        } else if (typeof label === 'string' && label.length > 0) {
          return label;
        }
      } catch (error) {
        // label thunk 抛错时退回 id。
      }
      return fallback;
    }

    // ------------------------------------------------------------------
    // 原子组件
    // ------------------------------------------------------------------
    function EntryGlyph({ size }) {
      const px = typeof size === 'number' ? size : 18;
      return h('svg', {
        width: px,
        height: px,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('rect', { x: 1.75, y: 2.25, width: 12.5, height: 11.5, rx: 2.25, stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.5 }),
      h('path', { d: 'M6.25 2.4v11.2', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.5 }),
      h('rect', { x: 2.9, y: 4.4, width: 2.3, height: 1.3, rx: 0.65, fill: 'currentColor' }),
      h('rect', { x: 2.9, y: 7.15, width: 2.3, height: 1.3, rx: 0.65, fill: 'currentColor', opacity: 0.62 }),
      h('rect', { x: 2.9, y: 9.9, width: 2.3, height: 1.3, rx: 0.65, fill: 'currentColor', opacity: 0.34 }));
    }

    function Toggle({ checked, label, onToggle }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dsem_switch' + (checked ? ' is-on' : ''),
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        onClick: () => onToggle(!checked),
      }, h('span', { className: 'dsem_knob', 'aria-hidden': 'true' }));
    }

    function EntryList({ t, entries, preferences, onToggle }) {
      if (entries.length === 0) return h('p', { className: 'dsem_desc' }, t('panel.empty'));
      const sorted = entries.slice().sort((a, b) => {
        const left = a && a.options && typeof a.options.order === 'number' ? a.options.order : 0;
        const right = b && b.options && typeof b.options.order === 'number' ? b.options.order : 0;
        return left - right;
      });
      return h('ul', { className: 'dsem_list' }, sorted.map((entry) => {
        const options = (entry && entry.options) || {};
        const id = typeof options.id === 'string' ? options.id : '';
        const label = resolveLabel(options, id);
        const locked = id === ALWAYS_VISIBLE;
        const visible = locked ? true : preferences[id] !== false;
        return h('li', { key: id || label, className: 'dsem_row' },
          h('div', { className: 'dsem_rowText' },
            h('span', { className: 'dsem_rowTitle' }, label),
            h('span', { className: 'dsem_rowHint' }, id)),
          locked
            ? h('span', { className: 'dsem_lock' }, t('panel.always'))
            : h(Toggle, { checked: visible, label: label, onToggle: (next) => onToggle(id, next) }));
      }));
    }

    // ------------------------------------------------------------------
    // 管理面板本体（main 座位 + settings.section 共用）
    // ------------------------------------------------------------------
    function makePanelBody(ctx, t) {
      return function SidebarEntryPanelBody() {
        const entries = usePanelEntries(ctx);
        const preferences = usePreferences();
        const [unrouted, setUnrouted] = React.useState(false);

        React.useEffect(() => {
          // 兜底：宿主若在面板打开期间重挂侧栏（通道会换新），这里再对账一次。
          tryAttachPinnedChannel(ctx, true);
          syncAllPins();
        }, []);

        const onToggle = (id, next) => {
          setUnrouted(setEntryVisible(id, next) === false);
        };
        const onReset = () => {
          setUnrouted(false);
          resetAll();
        };

        return h('div', { className: 'dsem_root' },
          h('div', { className: 'dsem_head' },
            h('h2', { className: 'dsem_title' }, t('panel.title')),
            h('p', { className: 'dsem_desc' }, t('panel.desc'))),
          h(EntryList, { t: t, entries: entries, preferences: preferences, onToggle: onToggle }),
          h('div', { className: 'dsem_footer' },
            h('button', { type: 'button', className: 'dsem_reset', onClick: onReset }, t('panel.reset')),
            h('span', { className: 'dsem_footerHint' }, t('panel.footerHint'))),
          unrouted ? h('p', { className: 'dsem_note' }, t('panel.pending')) : null,
          h('p', { className: 'dsem_note' }, t('panel.note')));
      };
    }

    // ------------------------------------------------------------------
    // 「更多」菜单内容：只留一条「管理左侧栏入口…」+ 兜底对账
    // ------------------------------------------------------------------
    function makeMenuContent(ctx, t) {
      return function SidebarEntryMenu({ entries, onPinnedChange, onDismiss }) {
        // 菜单里不再列面板入口，但 ownerProps 里的 onPinnedChange 是宿主的 setPinned，
        // 作为启动期通道失手时的兜底：挂载后补抓一次，并按宿主真值对账。
        if (typeof onPinnedChange === 'function') pinnedChannel = onPinnedChange;
        const signature = JSON.stringify((entries || []).map((entry) => [entry && entry.id, !!(entry && entry.pinned)]));

        React.useEffect(() => {
          // 放在 effect 里：对账会写宿主 store，渲染期调用会触发 React 的跨组件更新警告。
          reconcileEntries(entries);
        }, [signature]);

        const manage = () => {
          if (typeof onDismiss === 'function') onDismiss();
          ctx.layout.selectPanel(PANEL_ID);
        };

        return h('div', { className: 'dsem_menu' },
          h('button', { type: 'button', className: 'dsem_menuItem', onClick: manage },
            h('span', { className: 'dsem_menuLabel' }, t('menu.manage'))));
      };
    }

    // ------------------------------------------------------------------
    // 插件入口
    // ------------------------------------------------------------------
    const inject = ['slots', 'locale', 'layout'];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.locale.register(NS, DICTS), 'sidebar-entry-manager: locale');
      ctx.effect(() => installStyles(), 'sidebar-entry-manager: styles');
      ctx.effect(() => watchPreferences(), 'sidebar-entry-manager: storage');
      // 必须在注册自身座位之前抢占宿主 pin 通道：越早拿到，首屏越早正确。
      ctx.effect(() => attachHostPins(ctx), 'sidebar-entry-manager: host pins');
      ctx.effect(() => settlePinsNextFrame(ctx), 'sidebar-entry-manager: pins settle');

      const PanelBody = makePanelBody(ctx, t);
      const MenuContent = makeMenuContent(ctx, t);

      // 左栏入口图标（order 20：排在官方 plugins 0 / schedules 10 之后）。
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => t('panel.label'),
        locale: NS,
      }, EntryGlyph));

      // 主区管理面板：key 与上面的 id 一致，宿主 selectPanel(PANEL_ID) 才能寻址。
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, PanelBody));

      // 「更多」菜单：只放一条「管理左侧栏入口…」，同时兜底拿宿主 setPinned。
      // 注意这个注册会让宿主的「更多」按钮出现，这是宿主对 actions 座位长度的硬编码。
      ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
        name: 'sidebar.panellist.actions',
        id: PANEL_ID,
        order: 0,
        locale: NS,
      }, MenuContent));

      // 设置页一节，与面板读写同一份偏好。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PANEL_ID,
        order: 25,
        label: () => t('settings.label'),
        locale: NS,
      }, PanelBody));

      if (typeof window !== 'undefined') {
        window.__dshSidebarEntryManager = {
          get: () => Object.assign({}, getPreferences()),
          set: setEntryVisible,
          reset: resetAll,
          entries: () => {
            try {
              return ctx.slots.entriesOfSlot('sidebar.panellist').map((entry) => entry.options ? entry.options.id : null);
            } catch (error) {
              return [];
            }
          },
        };
      }
    }

    return { name: 'dsh-sidebar-entry-manager', inject: inject, apply: apply };
  },
});
