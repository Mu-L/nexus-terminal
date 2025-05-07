<script setup lang="ts">
import type { ConnectionInfo } from '../stores/connections.store'; // +++ 导入 ConnectionInfo 类型 +++
import { computed, defineAsyncComponent, type PropType, type Component, ref, watch, onMounted } from 'vue'; // +++ Add onMounted +++
import { useI18n } from 'vue-i18n'; // <-- Import useI18n
// 添加依赖 font-awesome
import '@fortawesome/fontawesome-free/css/all.min.css';
import { Splitpanes, Pane } from 'splitpanes';
import { useLayoutStore, type LayoutNode, type PaneName } from '../stores/layout.store';
import { useSessionStore } from '../stores/session.store';
import { useFileEditorStore } from '../stores/fileEditor.store'; // <-- Import FileEditorStore
import { useSettingsStore } from '../stores/settings.store'; // +++ Import SettingsStore +++
import { useSidebarResize } from '../composables/useSidebarResize'; // +++ Import useSidebarResize +++
import { storeToRefs } from 'pinia';
import { defineEmits } from 'vue';

// --- Props ---
const props = defineProps({
  layoutNode: {
    type: Object as PropType<LayoutNode>,
    required: true,
  },
  // 新增：标识是否为顶层渲染器
  isRootRenderer: {
    type: Boolean,
    default: false,
  },
  // 传递必要的上下文数据，避免在递归中重复获取
  activeSessionId: {
    type: String as PropType<string | null>,
    required: false, // 改为非必需
    default: null,   // 提供默认值 null
  },
  // *** 新增：接收编辑器相关 props ***
  editorTabs: {
    type: Array as PropType<any[]>, // 使用 any[] 简化，或导入具体类型
    default: () => [],
  },
  activeEditorTabId: {
    type: String as PropType<string | null>,
    default: null,
  },
  // +++ Add layoutLocked prop +++
  layoutLocked: {
    type: Boolean,
    default: false,
  },
  // Removed terminalManager prop definition
});

// --- Emits ---
// *** 新增：声明所有需要转发的事件 (使用对象语法) ***
const emit = defineEmits({
  'sendCommand': null, // (command: string) - No validation needed here for now
  'terminalInput': null, // (payload: { sessionId: string; data: string })
  'terminalResize': null, // (payload: { sessionId: string; dims: { cols: number; rows: number } })
  'closeEditorTab': null, // (tabId: string)
  'activateEditorTab': null, // (tabId: string)
  'updateEditorContent': null, // (payload: { tabId: string; content: string })
  'saveEditorTab': null, // (tabId: string)
  'connect-request': null, // (id: number)
  'open-new-session': null, // (id: number)
  'request-add-connection': null, // ()
  'request-edit-connection': null, // (conn: any)
  // *** 修正：更新 terminal-ready 事件的 payload 类型 ***
  'terminal-ready': (payload: { sessionId: string; terminal: any }) => // 使用 any 简化类型检查，或导入 Terminal
    typeof payload === 'object' && typeof payload.sessionId === 'string' && typeof payload.terminal === 'object',
  // *** 新增：声明搜索相关事件 ***
  'search': null, // (searchTerm: string)
  'find-next': null, // ()
  'find-previous': null, // ()
  'close-search': null, // ()
  'clear-terminal': null, // () +++ 添加 clear-terminal 事件 +++
  'change-encoding': null, // +++ 添加 change-encoding 事件 +++
  // +++ 添加文件编辑器标签页关闭事件 +++
  'close-other-tabs': null, // (tabId: string)
  'close-tabs-to-right': null, // (tabId: string)
  'close-tabs-to-left': null, // (tabId: string)
  // --- 移除 RDP 事件 ---
});

// --- Setup ---
const layoutStore = useLayoutStore();
const sessionStore = useSessionStore();
const fileEditorStore = useFileEditorStore(); // <-- Initialize FileEditorStore
const settingsStore = useSettingsStore(); // +++ Initialize SettingsStore +++
const { t } = useI18n(); // <-- Get translation function
const { activeSession } = storeToRefs(sessionStore);
const { workspaceSidebarPersistentBoolean, getSidebarPaneWidth } = storeToRefs(settingsStore); // +++ Get sidebar setting and width getter +++
const { sidebarPanes } = storeToRefs(layoutStore);
const { orderedTabs: editorTabsFromStore, activeTabId: activeEditorTabIdFromStore } = storeToRefs(fileEditorStore); // <-- Get editor state

// --- Sidebar State ---
const activeLeftSidebarPane = ref<PaneName | null>(null);
const activeRightSidebarPane = ref<PaneName | null>(null);
const leftSidebarPanelRef = ref<HTMLElement | null>(null); // +++ Ref for left panel +++
const rightSidebarPanelRef = ref<HTMLElement | null>(null); // +++ Ref for right panel +++
const leftResizeHandleRef = ref<HTMLElement | null>(null); // +++ Ref for left handle +++
const rightResizeHandleRef = ref<HTMLElement | null>(null); // +++ Ref for right handle +++

// --- Component Mapping ---
// 使用 defineAsyncComponent 优化加载，并映射 PaneName 到实际组件
const componentMap: Record<PaneName, Component> = {
  connections: defineAsyncComponent(() => import('./WorkspaceConnectionList.vue')),
  terminal: defineAsyncComponent(() => import('./Terminal.vue')),
  commandBar: defineAsyncComponent(() => import('./CommandInputBar.vue')),
  fileManager: defineAsyncComponent(() => import('./FileManager.vue')),
  editor: defineAsyncComponent(() => import('./FileEditorContainer.vue')),
  statusMonitor: defineAsyncComponent(() => import('./StatusMonitor.vue')),
  commandHistory: defineAsyncComponent(() => import('../views/CommandHistoryView.vue')),
  quickCommands: defineAsyncComponent(() => import('../views/QuickCommandsView.vue')),
  dockerManager: defineAsyncComponent(() => import('./DockerManager.vue')), // <--- 添加 dockerManager 映射
};

// --- Computed ---
// 获取当前节点对应的组件实例 (用于主布局)
const currentMainComponent = computed(() => {
  if (props.layoutNode.type === 'pane' && props.layoutNode.component) {
    return componentMap[props.layoutNode.component] || null;
  }
  return null;
});

// 获取当前激活的左侧侧栏组件实例
const currentLeftSidebarComponent = computed(() => {
  return activeLeftSidebarPane.value ? componentMap[activeLeftSidebarPane.value] : null;
});

// 获取当前激活的右侧侧栏组件实例
const currentRightSidebarComponent = computed(() => {
  return activeRightSidebarPane.value ? componentMap[activeRightSidebarPane.value] : null;
});

// 面板标签 (Similar to LayoutConfigurator)
const paneLabels = computed(() => ({
  connections: t('layout.pane.connections', '连接列表'),
  terminal: t('layout.pane.terminal', '终端'),
  commandBar: t('layout.pane.commandBar', '命令栏'),
  fileManager: t('layout.pane.fileManager', '文件管理器'),
  editor: t('layout.pane.editor', '编辑器'),
  statusMonitor: t('layout.pane.statusMonitor', '状态监视器'),
  commandHistory: t('layout.pane.commandHistory', '命令历史'),
  quickCommands: t('layout.pane.quickCommands', '快捷指令'),
  dockerManager: t('layout.pane.dockerManager', 'Docker 管理器'),
}));


// 为特定组件计算需要传递的 Props (主布局)
// 注意：这是一个简化示例，实际可能需要更复杂的逻辑来传递正确的 props
const componentProps = computed(() => {
  const componentName = props.layoutNode.component;
  const currentActiveSession = activeSession.value; // 获取当前活动会话

  if (!componentName) return {};

  switch (componentName) {
    // --- 为需要转发事件的组件添加事件绑定 ---
    case 'terminal':
      // Terminal 需要 sessionId, isActive, 并转发 ready, data, resize 事件
      // 确保 sessionId 始终为字符串
      return {
        sessionId: props.activeSessionId ?? '', // 如果 activeSessionId 为 null，则传递空字符串
        isActive: true,
        // *** 添加日志并修正事件处理 ***
        onReady: (payload: { sessionId: string; terminal: any }) => {
          console.log(`[LayoutRenderer ${props.activeSessionId}] 收到内部 Terminal 的 'ready' 事件:`, payload); // 添加日志
          emit('terminal-ready', payload); // 直接转发收到的 payload
        },
        onData: (data: string) => emit('terminalInput', { sessionId: props.activeSessionId ?? '', data }), // 包装成 payload，确保 sessionId 不为 null
        onResize: (dims: { cols: number; rows: number }) => emit('terminalResize', { sessionId: props.activeSessionId ?? '', dims }), // 包装成 payload，确保 sessionId 不为 null
      };
      // --- 添加日志：确认 onReady 是否在 props 中 ---
      console.log(`[LayoutRenderer ${props.activeSessionId}] Terminal componentProps 计算完成，包含 onReady。`);
      // -----------------------------------------
    case 'fileManager':
      // 仅当有活动会话时才返回实际 props，否则返回空对象
      if (!currentActiveSession) return {};
      // 传递 instanceId (使用布局节点的 ID), sessionId, dbConnectionId
      // 移除 sftpManager 和 wsDeps
      // +++ 提供 instanceId 的备用值 +++
      const instanceId = props.layoutNode.id || `fm-main-${props.activeSessionId ?? 'unknown'}`;
      return {
         sessionId: props.activeSessionId ?? '', // 确保 sessionId 不为 null
         instanceId: instanceId, // 使用计算出的 instanceId (包含备用值)
         dbConnectionId: currentActiveSession.connectionId,
         // sftpManager: currentActiveSession.sftpManager, // 移除 sftpManager，因为它现在由 FileManager 内部管理
         wsDeps: { // 恢复 wsDeps
           sendMessage: currentActiveSession.wsManager.sendMessage,
           onMessage: currentActiveSession.wsManager.onMessage,
           isConnected: currentActiveSession.wsManager.isConnected, // 恢复 isConnected
           isSftpReady: currentActiveSession.wsManager.isSftpReady // 恢复 isSftpReady
         },
         class: 'pane-content', // class 可以保留，或者在模板中处理
         // FileManager 可能也需要转发事件，例如文件操作相关的，暂时省略
      };
    case 'statusMonitor':
       // 仅当有活动会话时才返回实际 props，否则返回空对象
       if (!currentActiveSession) return {};
       return {
         sessionId: props.activeSessionId ?? '', // 确保 sessionId 不为 null
         serverStatus: currentActiveSession.statusMonitorManager.serverStatus.value, // 此时 currentActiveSession 必不为 null
         statusError: currentActiveSession.statusMonitorManager.statusError.value, // 此时 currentActiveSession 必不为 null
         class: 'pane-content',
       };
    case 'editor':
      // FileEditorContainer 需要 tabs, activeTabId, sessionId, 并转发事件
      return {
        tabs: props.editorTabs, // 从 WorkspaceView 传入
        activeTabId: props.activeEditorTabId, // 从 WorkspaceView 传入
        sessionId: props.activeSessionId,
        class: 'pane-content',
        // 绑定内部处理器以转发事件 (恢复正确的编辑器事件)
        onCloseTab: (tabId: string) => emit('closeEditorTab', tabId),
        onActivateTab: (tabId: string) => emit('activateEditorTab', tabId),
        'onUpdate:content': (payload: { tabId: string; content: string }) => emit('updateEditorContent', payload), // 注意事件名
        onRequestSave: (tabId: string) => emit('saveEditorTab', tabId),
        // +++ 添加：转发 change-encoding 事件 +++
        onChangeEncoding: (payload: { tabId: string; encoding: string }) => emit('change-encoding', payload),
        // +++ 添加：转发其他关闭事件 +++
        onCloseOtherTabs: (tabId: string) => emit('close-other-tabs', tabId),
        onCloseTabsToRight: (tabId: string) => emit('close-tabs-to-right', tabId),
        onCloseTabsToLeft: (tabId: string) => emit('close-tabs-to-left', tabId),
      };
    case 'commandBar':
       // CommandInputBar 需要转发 send-command 事件
       // searchResultCount 和 currentSearchResultIndex 将在模板中直接从 terminalManager 绑定
       return {
         class: 'pane-content',
         onSendCommand: (command: string) => emit('sendCommand', command),
         // 转发搜索事件
         onSearch: (term: string) => emit('search', term),
         onFindNext: () => emit('find-next'),
         onFindPrevious: () => emit('find-previous'),
         onCloseSearch: () => emit('close-search'),
         onClearTerminal: () => emit('clear-terminal'), // --- 移除日志 ---
       };
    case 'connections':
       // WorkspaceConnectionList 需要转发 connect-request 等事件
       return {
         class: 'pane-content',
         // 绑定内部处理器以转发事件 (除了 request-add-connection)
         onConnectRequest: (id: number) => emit('connect-request', id),
         onOpenNewSession: (id: number) => emit('open-new-session', id),
         // onRequestAddConnection: () => { ... }, // 移除，将在模板中处理
         onRequestEditConnection: (conn: any) => emit('request-edit-connection', conn),
       };
     case 'commandHistory':
    case 'quickCommands':
       // 这两个视图需要转发 execute-command 事件
       return {
         class: 'flex flex-col flex-grow h-full overflow-auto', // 移除 pane-content，保留填充类
         onExecuteCommand: (command: string) => emit('sendCommand', command), // 复用 sendCommand 事件
       };
   case 'dockerManager':
     // DockerManager 可能不需要 session 信息，但需要转发事件
     return {
       class: 'flex-grow h-full overflow-hidden', // <-- 修改：添加 flex-grow 和 h-full，并保留 overflow-hidden
       // 假设 DockerManager 会发出 'docker-command' 事件
       // onDockerCommand: (payload: { containerId: string; command: 'up' | 'down' | 'restart' | 'stop' }) => emit('dockerCommand', payload),
       // 暂时不添加事件转发，等组件实现后再确定
     };
   default:
     return { class: 'pane-content' };
 }
});

// --- New computed property for sidebar component props and events ---
// 修改以接收 side 参数，用于确定 instanceId
const sidebarProps = computed(() => (paneName: PaneName | null, side: 'left' | 'right') => {
 if (!paneName) return {};

 const baseProps = { class: 'sidebar-pane-content' }; // Base props for all sidebar components

 switch (paneName) {
   case 'editor':
     return {
       ...baseProps,
       tabs: editorTabsFromStore.value, // Access .value for refs from storeToRefs
       activeTabId: activeEditorTabIdFromStore.value, // Access .value
       sessionId: props.activeSessionId,
       // Event forwarding
       onCloseTab: (tabId: string) => emit('closeEditorTab', tabId),
       onActivateTab: (tabId: string) => emit('activateEditorTab', tabId),
       'onUpdate:content': (payload: { tabId: string; content: string }) => emit('updateEditorContent', payload),
       onRequestSave: (tabId: string) => emit('saveEditorTab', tabId),
     };
   case 'connections':
     return {
       ...baseProps,
       // Event forwarding
       onConnectRequest: (id: number) => emit('connect-request', id),
       onOpenNewSession: (id: number) => {
          console.log(`[LayoutRenderer Sidebar] Forwarding 'open-new-session' for ID: ${id}`);
          emit('open-new-session', id);
       },
       onRequestEditConnection: (conn: any) => {
          console.log(`[LayoutRenderer Sidebar] Forwarding 'request-edit-connection'`);
          emit('request-edit-connection', conn);
       },
       // Forward 'request-add-connection' from sidebar context
       onRequestAddConnection: () => {
           console.log(`[LayoutRenderer Sidebar] Forwarding 'request-add-connection'`);
           emit('request-add-connection');
       },
     };
   case 'fileManager':
     // Only provide props if there's an active session
     if (activeSession.value) {
       // 传递 instanceId (根据 side), sessionId, dbConnectionId
       // 移除 sftpManager 和 wsDeps
       const instanceId = side === 'left' ? 'sidebar-left' : 'sidebar-right';
       return {
         ...baseProps,
         sessionId: activeSession.value.sessionId,
         instanceId: instanceId, // 使用 'sidebar-left' 或 'sidebar-right'
         dbConnectionId: activeSession.value.connectionId,
         // sftpManager: activeSession.value.sftpManager, // 移除 sftpManager
         wsDeps: { // 恢复 wsDeps
           sendMessage: activeSession.value.wsManager.sendMessage,
           onMessage: activeSession.value.wsManager.onMessage,
           isConnected: activeSession.value.wsManager.isConnected, // 直接传递 ref
           isSftpReady: activeSession.value.wsManager.isSftpReady  // 直接传递 ref
         },
       };
     } else {
       return baseProps; // Return only base props if no active session
     }
   case 'statusMonitor':
     // Only provide props if there's an active session
     if (activeSession.value) {
       return {
         ...baseProps,
         sessionId: activeSession.value.sessionId, // Pass session ID
         serverStatus: activeSession.value.statusMonitorManager.serverStatus.value,
         statusError: activeSession.value.statusMonitorManager.statusError.value,
       };
     } else {
       return baseProps; // Return only base props if no active session
     }
    // Add cases for other components if they need specific props or event forwarding in the sidebar
    // case 'commandHistory': return { ...baseProps, onExecuteCommand: (cmd: string) => emit('sendCommand', cmd) };
    // case 'quickCommands': return { ...baseProps, onExecuteCommand: (cmd: string) => emit('sendCommand', cmd) };
    default:
      return baseProps; // Return only base props for other components
  }
});


// --- Methods ---
// 处理 Splitpanes 大小调整事件
const handlePaneResize = (eventData: { panes: Array<{ size: number; [key: string]: any }> }) => {
  // +++ 添加更详细的日志 +++
  // +++ Log the entire layoutNode object if ID is undefined +++
  if (props.layoutNode && typeof props.layoutNode.id === 'undefined') {
    console.warn(`[LayoutRenderer DEBUG] handlePaneResize triggered but props.layoutNode.id is undefined. Full layoutNode prop:`, JSON.parse(JSON.stringify(props.layoutNode)));
  }
  // console.log(`[LayoutRenderer DEBUG] handlePaneResize triggered for node ID: ${props.layoutNode?.id}, direction: ${props.layoutNode?.direction ?? 'N/A'}`); // Use optional chaining for safety
  // console.log('[LayoutRenderer DEBUG] Splitpanes resized event object:', eventData);
  const paneSizes = eventData.panes; // 从事件对象中提取 panes 数组

  // console.log('[LayoutRenderer DEBUG] Extracted paneSizes:', paneSizes); // 打印提取出的数组

  // +++ Use optional chaining for safety +++
  if (props.layoutNode?.type === 'container' && props.layoutNode?.children) {
    // 确保 paneSizes 是一个数组
    if (!Array.isArray(paneSizes)) {
      console.error('[LayoutRenderer] handlePaneResize: 从事件对象提取的 panes 不是数组:', paneSizes);
      return;
    }
    // 构建传递给 store action 的数据结构
    const childrenSizes = paneSizes.map((paneInfo, index) => ({
        index: index,
        size: paneInfo.size
    }));

    // +++ 添加调用 store action 前的日志 +++
    // console.log(`[LayoutRenderer DEBUG] Calling layoutStore.updateNodeSizes for node ID: ${props.layoutNode.id} with sizes:`, JSON.parse(JSON.stringify(childrenSizes)));
    // 调用 store action 来更新节点大小
    layoutStore.updateNodeSizes(props.layoutNode.id, childrenSizes);
  } else {
    // console.log(`[LayoutRenderer DEBUG] handlePaneResize ignored for node ID: ${props.layoutNode.id} (type: ${props.layoutNode.type})`);
  }
};

// 打开/切换侧栏面板
const toggleSidebarPane = (side: 'left' | 'right', paneName: PaneName) => {
  if (side === 'left') {
    activeLeftSidebarPane.value = activeLeftSidebarPane.value === paneName ? null : paneName;
    if (activeLeftSidebarPane.value) activeRightSidebarPane.value = null; // Close other side
  } else {
    activeRightSidebarPane.value = activeRightSidebarPane.value === paneName ? null : paneName;
    if (activeRightSidebarPane.value) activeLeftSidebarPane.value = null; // Close other side
  }
};

// 关闭所有侧栏
const closeSidebars = () => {
  activeLeftSidebarPane.value = null;
  activeRightSidebarPane.value = null;
};

// 监听 activeSessionId 的变化，如果会话切换，则关闭侧栏 (可选行为)
watch(() => props.activeSessionId, () => {
    // closeSidebars(); // 取消注释以在切换会话时关闭侧栏
});

// +++ 新方法：处理主内容区域点击，用于非固定模式下关闭侧边栏 +++
const handleMainAreaClick = () => {
  // 仅当侧边栏激活且不处于固定模式时才关闭
  if ((activeLeftSidebarPane.value || activeRightSidebarPane.value) && !workspaceSidebarPersistentBoolean.value) {
    closeSidebars();
  }
};

// --- Debug Watcher for sidebarPanes from store ---
watch(sidebarPanes, (newVal) => {
  // console.log('[LayoutRenderer] Received updated sidebarPanes from store:', JSON.parse(JSON.stringify(newVal)));
}, { deep: true, immediate: true }); // Immediate to log initial value

// --- Icon Helper ---
const getIconClasses = (paneName: PaneName): string[] => {
  switch (paneName) {
    case 'connections': return ['fas', 'fa-network-wired'];
    case 'fileManager': return ['fas', 'fa-folder-open'];
    case 'commandHistory': return ['fas', 'fa-history'];
    case 'quickCommands': return ['fas', 'fa-bolt'];
    case 'dockerManager': return ['fab', 'fa-docker']; // Use 'fab' for Docker
    case 'editor': return ['fas', 'fa-file-alt'];
    case 'statusMonitor': return ['fas', 'fa-tachometer-alt'];
    // Add other specific icons here if needed
    default: return ['fas', 'fa-question-circle']; // Default icon
  }
};


// --- Sidebar Resize Logic ---
onMounted(() => {


  // Left Sidebar Resize
  useSidebarResize({
    sidebarRef: leftSidebarPanelRef,
    handleRef: leftResizeHandleRef,
    side: 'left',
    onResizeEnd: (newWidth) => {
      console.log(`Left sidebar resize ended. New width: ${newWidth}px`);
      // +++ Update specific pane width +++
      if (activeLeftSidebarPane.value) {
        settingsStore.updateSidebarPaneWidth(activeLeftSidebarPane.value, `${newWidth}px`);
      }
    },
  });

  // Right Sidebar Resize
  useSidebarResize({
    sidebarRef: rightSidebarPanelRef,
    handleRef: rightResizeHandleRef,
    side: 'right',
    onResizeEnd: (newWidth) => {
      console.log(`Right sidebar resize ended. New width: ${newWidth}px`);
      // +++ Update specific pane width +++
      if (activeRightSidebarPane.value) {
        settingsStore.updateSidebarPaneWidth(activeRightSidebarPane.value, `${newWidth}px`);
      }
    },
  });
});

</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden">
    <!-- Left Sidebar Buttons -->
    <div class="flex flex-col bg-sidebar py-1 z-10 flex-shrink-0 border-r border-border" v-if="isRootRenderer && sidebarPanes.left.length > 0">
        <button
            v-for="pane in sidebarPanes.left"
            :key="`left-${pane}`"
            @click="toggleSidebarPane('left', pane)"
            :class="['flex items-center justify-center w-10 h-10 mb-1 text-text-secondary hover:bg-hover hover:text-foreground transition-colors duration-150 cursor-pointer text-lg',
                     { 'bg-primary text-white hover:bg-primary-dark': activeLeftSidebarPane === pane }]"
            :title="paneLabels[pane] || pane"
        >
            <i :class="getIconClasses(pane)"></i>
        </button>
    </div>

    <!-- Main Layout Area -->
    <div class="relative flex-grow h-full overflow-hidden" @click="handleMainAreaClick">
        <div class="flex flex-col h-full w-full overflow-hidden" :data-node-id="layoutNode.id">
            <!-- Container Node -->
            <template v-if="layoutNode.type === 'container' && layoutNode.children && layoutNode.children.length > 0">
              <splitpanes
                  :horizontal="layoutNode.direction === 'vertical'"
                  :class="['default-theme flex-grow', { 'layout-locked': props.layoutLocked }]"
                  @resized="handlePaneResize"
                  :push-other-panes="false"
                  :dbl-click-splitter="!props.layoutLocked"
              >
                  <pane
                    v-for="childNode in layoutNode.children"
                    :key="childNode.id"
                    :size="childNode.size ?? (100 / layoutNode.children.length)"
                    :min-size="5"
                    class="flex flex-col overflow-hidden bg-background"
                  >
                    <LayoutRenderer
                        :layout-node="childNode"
                        :is-root-renderer="false"
                        :active-session-id="activeSessionId"
                        :editor-tabs="editorTabs"
                        :active-editor-tab-id="activeEditorTabId"
                        @send-command="emit('sendCommand', $event)"
                        @terminal-input="emit('terminalInput', $event)"
                        @terminal-resize="emit('terminalResize', $event)"
                        @terminal-ready="emit('terminal-ready', $event)"
                        @close-editor-tab="emit('closeEditorTab', $event)"
                        @activate-editor-tab="emit('activateEditorTab', $event)"
                        @update-editor-content="emit('updateEditorContent', $event)"
                        @save-editor-tab="emit('saveEditorTab', $event)"
                        @connect-request="emit('connect-request', $event)"
                        @open-new-session="emit('open-new-session', $event)"
                        @request-add-connection="() => emit('request-add-connection')"
                        @request-edit-connection="emit('request-edit-connection', $event)"
                        @search="emit('search', $event)"
                        @find-next="emit('find-next')"
                        @find-previous="emit('find-previous')"
                        @close-search="emit('close-search')"
                        @clear-terminal="() => emit('clear-terminal')"
                        @change-encoding="emit('change-encoding', $event)"
                        @close-other-tabs="emit('close-other-tabs', $event)"
                        @close-tabs-to-right="emit('close-tabs-to-right', $event)"
                        @close-tabs-to-left="emit('close-tabs-to-left', $event)"
                        class="flex-grow overflow-auto"
                    />
                  </pane>
              </splitpanes>
            </template>

            <!-- Pane Node -->
            <template v-else-if="layoutNode.type === 'pane'">
                <!-- Terminal -->
                <template v-if="layoutNode.component === 'terminal'">
                    <keep-alive>
                        <component
                          v-if="activeSession"
                          :is="currentMainComponent"
                          :key="activeSessionId"
                          v-bind="componentProps"
                          class="flex-grow overflow-auto"
                        />
                    </keep-alive>
                    <div v-if="!activeSession" class="flex-grow flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4">
                      <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium text-text-secondary mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs text-text-secondary mt-2">{{ t('layout.noActiveSession.message') }}</div>
                      </div>
                    </div>
                </template>
                <!-- FileManager -->
                <template v-else-if="layoutNode.component === 'fileManager'">
                    <template v-if="activeSession">
                        <component
                          :is="currentMainComponent"
                          :key="layoutNode.id"
                          v-bind="componentProps"
                          class="flex-grow overflow-auto">
                        </component>
                    </template>
                    <div v-if="!activeSession" class="flex-grow flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4">
                      <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium text-text-secondary mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs text-text-secondary mt-2">{{ t('layout.noActiveSession.message') }}</div>
                      </div>
                    </div>
                </template>
                <!-- StatusMonitor -->
                <template v-else-if="layoutNode.component === 'statusMonitor'">
                     <component
                       v-if="activeSession"
                       :is="currentMainComponent"
                       :key="activeSessionId"
                       v-bind="componentProps"
                       class="flex-grow overflow-auto"
                     />
                     <div v-else class="flex-grow flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4">
                      <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium text-text-secondary mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs text-text-secondary mt-2">{{ t('layout.noActiveSession.message') }}</div>
                      </div>
                    </div>
                </template>
                <!-- Other Panes -->
                <template v-else-if="currentMainComponent">
                    <component
                      v-if="layoutNode.component === 'connections'"
                      :is="currentMainComponent"
                      v-bind="componentProps"
                      @request-add-connection="() => emit('request-add-connection')"
                      class="flex-grow overflow-auto"
                    />
                    <component
                      v-else-if="layoutNode.component === 'commandBar'"
                      :is="currentMainComponent"
                      v-bind="componentProps"
                      class="flex-grow overflow-auto"
                    />
                    <component
                      v-else
                      :is="currentMainComponent"
                      v-bind="componentProps"
                    />
                </template>
                <!-- Invalid Pane Component -->
                <div v-else class="flex-grow flex justify-center items-center text-center text-red-600 bg-red-100 text-sm p-4">
                    无效面板组件: {{ layoutNode.component || '未指定' }} (ID: {{ layoutNode.id }})
                </div>
            </template>

             <!-- Invalid Node Type -->
             <template v-else>
               <div class="flex-grow flex justify-center items-center text-center text-red-600 bg-red-100 text-sm p-4">
                 无效布局节点 (ID: {{ layoutNode.id }})
               </div>
             </template>
        </div>
    </div>

    <!-- Sidebar Overlay -->
    <div
        :class="['fixed inset-0 bg-transparent pointer-events-none z-[100] transition-opacity duration-300 ease-in-out',
                 {'opacity-100 visible': activeLeftSidebarPane || activeRightSidebarPane, 'opacity-0 invisible': !(activeLeftSidebarPane || activeRightSidebarPane)}]"
    ></div>

    <!-- Left Sidebar Panel -->
    <div ref="leftSidebarPanelRef"
         :class="['fixed top-0 bottom-0 left-0 max-w-[80vw] bg-background z-[110] transition-transform duration-300 ease-in-out flex flex-col overflow-hidden border-r border-border',
                  {'translate-x-0': !!activeLeftSidebarPane, '-translate-x-full': !activeLeftSidebarPane}]"
         :style="{ width: getSidebarPaneWidth(activeLeftSidebarPane) }">
        <div ref="leftResizeHandleRef" class="absolute top-0 bottom-0 w-2 cursor-col-resize z-[120] bg-transparent transition-colors duration-200 ease-in-out hover:bg-primary-light right-[-4px]"></div>
        <button class="absolute top-1 right-2 p-1 text-text-secondary hover:text-foreground cursor-pointer text-2xl leading-none z-10" @click="closeSidebars" title="Close Sidebar">&times;</button>
        <KeepAlive>
            <div :key="`left-sidebar-content-${activeLeftSidebarPane ?? 'none'}`" class="relative flex flex-col flex-grow overflow-hidden pt-10"> <!-- Added pt-10 -->
                <component
                    v-if="currentLeftSidebarComponent && activeLeftSidebarPane && (!['fileManager', 'statusMonitor'].includes(activeLeftSidebarPane) || activeSession)"
                    :is="currentLeftSidebarComponent"
                    :key="`left-comp-${activeLeftSidebarPane}`"
                    v-bind="sidebarProps(activeLeftSidebarPane, 'left')"
                    class="flex flex-col flex-grow">
                </component>
                <div v-else-if="activeLeftSidebarPane === 'fileManager' && !activeSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                  <div class="flex flex-col items-center justify-center p-8">
                    <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                    <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                    <div class="text-xs mt-2">{{ t('layout.noActiveSession.fileManagerSidebar') }}</div>
                  </div>
                </div>
                <div v-else-if="activeLeftSidebarPane === 'statusMonitor' && !activeSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                  <div class="flex flex-col items-center justify-center p-8">
                    <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                    <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                    <div class="text-xs mt-2">{{ t('layout.noActiveSession.statusMonitorSidebar') }}</div>
                  </div>
                </div>
                 <div v-else class="flex flex-col flex-grow">
                 </div>
            </div>
        </KeepAlive>
    </div>

    <!-- Right Sidebar Panel -->
     <div ref="rightSidebarPanelRef"
          :class="['fixed top-0 bottom-0 right-0 max-w-[80vw] bg-background z-[110] transition-transform duration-300 ease-in-out flex flex-col overflow-hidden border-l border-border',
                   {'translate-x-0': !!activeRightSidebarPane, 'translate-x-full': !activeRightSidebarPane}]"
          :style="{ width: getSidebarPaneWidth(activeRightSidebarPane) }">
        <div ref="rightResizeHandleRef" class="absolute top-0 bottom-0 w-2 cursor-col-resize z-[120] bg-transparent transition-colors duration-200 ease-in-out hover:bg-primary-light left-[-4px]"></div>
        <button class="absolute top-1 right-2 p-1 text-text-secondary hover:text-foreground cursor-pointer text-2xl leading-none z-10" @click="closeSidebars" title="Close Sidebar">&times;</button>
        <KeepAlive>
            <div :key="`right-sidebar-content-${activeRightSidebarPane ?? 'none'}`" class="relative flex flex-col flex-grow overflow-hidden pt-10"> <!-- Added pt-10 -->
                <component
                    v-if="currentRightSidebarComponent && activeRightSidebarPane && (!['fileManager', 'statusMonitor'].includes(activeRightSidebarPane) || activeSession)"
                    :is="currentRightSidebarComponent"
                    :key="`right-comp-${activeRightSidebarPane}`"
                    v-bind="sidebarProps(activeRightSidebarPane, 'right')"
                    class="flex flex-col flex-grow">
                </component>
                <div v-else-if="activeRightSidebarPane === 'fileManager' && !activeSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                  <div class="flex flex-col items-center justify-center p-8">
                    <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                    <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                    <div class="text-xs mt-2">{{ t('layout.noActiveSession.fileManagerSidebar') }}</div>
                  </div>
                </div>
                <div v-else-if="activeRightSidebarPane === 'statusMonitor' && !activeSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                  <div class="flex flex-col items-center justify-center p-8">
                    <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                    <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                    <div class="text-xs mt-2">{{ t('layout.noActiveSession.statusMonitorSidebar') }}</div>
                  </div>
                </div>
                 <div v-else class="flex flex-col flex-grow">
                 </div>
            </div>
        </KeepAlive>
    </div>

     <!-- Right Sidebar Buttons -->
    <div class="flex flex-col bg-sidebar py-1 z-10 flex-shrink-0 border-l border-border" v-if="isRootRenderer && sidebarPanes.right.length > 0">
         <button
             v-for="pane in sidebarPanes.right"
            :key="`right-${pane}`"
            @click="toggleSidebarPane('right', pane)"
            :class="['flex items-center justify-center w-10 h-10 mb-1 text-text-secondary hover:bg-hover hover:text-foreground transition-colors duration-150 cursor-pointer text-lg',
                     { 'bg-primary text-white hover:bg-primary-dark': activeRightSidebarPane === pane }]"
            :title="paneLabels[pane] || pane"
        >
             <i :class="getIconClasses(pane)"></i>
        </button>
    </div>

  </div>
</template>



<style>
/* Override splitpanes default theme for VSCode-like dividers */
/* .splitpanes.default-theme .splitpanes__splitter::before,
.splitpanes.default-theme .splitpanes__splitter::after { */
  /* Ensure handle lines remain hidden */
  /* background-color: transparent !important; */
/* } */
.splitpanes.default-theme .splitpanes__splitter:hover { /* Apply hover style to the pseudo-element */
  background-color: var(--primary-color-light); /* Highlight on hover */
    border: none !important; /* Ensure no extra borders */
  /* Ensure it still occupies space and has cursor */
  position: relative;
  box-sizing: border-box;
  transition: background-color 0.1s ease-in-out;
}

.splitpanes__splitter:before {
  /* Use background color as the visible line */
  background-color: var(--border-color); /* Set background to border color */
  border: none !important; /* Ensure no extra borders */
  /* Ensure it still occupies space and has cursor */
  position: relative;
  box-sizing: border-box;
  transition: background-color 0.1s ease-in-out;
}
/* Vertical splitter width */
.splitpanes--vertical > .splitpanes__splitter {
  border-color: var(--border-color) !important;
  width: 1px !important;
}
/* Horizontal splitter height */
.splitpanes--horizontal > .splitpanes__splitter {
  border-color: var(--border-color) !important;
  height: 1px !important;
}

/* --- Styles for Locked Layout --- */
.splitpanes.layout-locked .splitpanes__splitter {
  pointer-events: none !important; /* Disable dragging */
  cursor: default !important; /* Change cursor */
  background-color: var(--border-color) !important; /* Ensure no hover effect */
}

.splitpanes.layout-locked .splitpanes__splitter:hover {
  background-color: var(--border-color) !important; /* Override hover effect */
}

</style>

