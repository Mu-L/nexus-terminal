import { ref, computed, shallowRef, type Ref } from 'vue'; // 导入 shallowRef
import { defineStore } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router'; // +++ 导入 useRouter +++
import { useConnectionsStore, type ConnectionInfo } from './connections.store';
// 导入文件编辑器相关的类型
import type { FileTab, FileInfo } from './fileEditor.store'; // 导入 FileTab 和 FileInfo (确保 FileTab 已在 fileEditor.store.ts 中简化)
import type { SftpReadFileSuccessPayload } from '../types/sftp.types'; // 导入更新后的类型
// --- 修复：添加 iconv-lite 和 buffer 导入 ---
import * as iconv from '@vscode/iconv-lite-umd';
import { Buffer } from 'buffer/';

// 导入管理器工厂函数 (用于创建实例)
// 导入 WsConnectionStatus 类型
import { createWebSocketConnectionManager, type WsConnectionStatus } from '../composables/useWebSocketConnection';
import { createSftpActionsManager, type WebSocketDependencies } from '../composables/useSftpActions';
import { createSshTerminalManager, type SshTerminalDependencies } from '../composables/useSshTerminal';
import { createStatusMonitorManager, type StatusMonitorDependencies } from '../composables/useStatusMonitor';
import { createDockerManager, type DockerManagerInstance, type DockerManagerDependencies } from '../composables/useDockerManager'; // +++ Import Docker Manager +++

// --- 辅助函数 ---
function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// 辅助函数：根据文件名获取语言 (从 fileEditor.store 迁移过来)
const getLanguageFromFilename = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'js': return 'javascript';
        case 'ts': return 'typescript';
        case 'json': return 'json';
        case 'html': return 'html';
        case 'css': return 'css';
        case 'scss': return 'scss';
        case 'less': return 'less';
        case 'py': return 'python';
        case 'java': return 'java';
        case 'c': return 'c';
        case 'cpp': return 'cpp';
        case 'cs': return 'csharp';
        case 'go': return 'go';
        case 'php': return 'php';
        case 'rb': return 'ruby';
        case 'rs': return 'rust';
        case 'sql': return 'sql';
        case 'sh': return 'shell';
        case 'yaml': case 'yml': return 'yaml';
        case 'md': return 'markdown';
        case 'xml': return 'xml';
        case 'ini': return 'ini';
        case 'bat': return 'bat';
        case 'dockerfile': return 'dockerfile';
        default: return 'plaintext';
    }
};

// --- 修复：添加 decodeRawContent 辅助函数 ---
const decodeRawContent = (rawContentBase64: string, encoding: string): string => {
    try {
        const buffer = Buffer.from(rawContentBase64, 'base64');
        const normalizedEncoding = encoding.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize encoding name

        // 优先使用 TextDecoder 处理标准编码
        if (['utf8', 'utf16le', 'utf16be'].includes(normalizedEncoding)) {
            const decoder = new TextDecoder(encoding); // Use original encoding name for TextDecoder
            return decoder.decode(buffer);
        }
        // 使用 iconv-lite 处理其他编码
        else if (iconv.encodingExists(normalizedEncoding)) {
            return iconv.decode(buffer, normalizedEncoding);
        }
        // 如果 iconv-lite 也不支持，回退到 UTF-8 并警告
        else {
            console.warn(`[SessionStore decodeRawContent] Unsupported encoding "${encoding}" requested. Falling back to UTF-8.`);
            const decoder = new TextDecoder('utf-8');
            return decoder.decode(buffer);
        }
    } catch (error: any) {
        console.error(`[SessionStore decodeRawContent] Error decoding content with encoding "${encoding}":`, error);
        return `// Error decoding content: ${error.message}`; // 返回错误信息
    }
};
// --- 结束修复 ---

// --- 类型定义 (导出以便其他模块使用) ---
export type WsManagerInstance = ReturnType<typeof createWebSocketConnectionManager>;
export type SftpManagerInstance = ReturnType<typeof createSftpActionsManager>;
export type SshTerminalInstance = ReturnType<typeof createSshTerminalManager>;
export type StatusMonitorInstance = ReturnType<typeof createStatusMonitorManager>;
// Removed conflicting local declaration of DockerManagerInstance, it's imported above.

export interface SessionState {
  sessionId: string;
  connectionId: string; // 数据库中的连接 ID
  connectionName: string; // 用于显示
  wsManager: WsManagerInstance;
  // sftpManager: SftpManagerInstance; // 移除单个实例
  sftpManagers: Map<string, SftpManagerInstance>; // 使用 Map 管理多个实例
  terminalManager: SshTerminalInstance;
  statusMonitorManager: StatusMonitorInstance;
  dockerManager: DockerManagerInstance; // +++ Add Docker Manager Instance +++
  // currentSftpPath: Ref<string>; // 移除，由每个 sftpManager 内部管理
  // --- 新增：独立编辑器状态 ---
  editorTabs: Ref<FileTab[]>; // 编辑器标签页列表
  activeEditorTabId: Ref<string | null>; // 当前活动的编辑器标签页 ID
  // --- 新增：命令输入框内容 ---
  commandInputContent: Ref<string>; // 当前会话的命令输入框内容
}

// 为标签栏定义包含状态的类型
export interface SessionTabInfoWithStatus {
  sessionId: string;
  connectionName: string;
  status: WsConnectionStatus; // 添加状态字段
}


export const useSessionStore = defineStore('session', () => {
  // --- 依赖 ---
  const { t } = useI18n();
  const connectionsStore = useConnectionsStore();
  const router = useRouter(); // +++ 获取 router 实例 +++

  // --- 移除 decodeBase64Content 辅助方法 ---


  // --- State ---
  // 使用 shallowRef 避免深度响应性问题，保留管理器实例内部的响应性
  const sessions = shallowRef<Map<string, SessionState>>(new Map());
  const activeSessionId = ref<string | null>(null);

  // --- RDP Modal State ---
  const isRdpModalOpen = ref(false);
  const rdpConnectionInfo = ref<ConnectionInfo | null>(null);

  // --- VNC Modal State ---
  const isVncModalOpen = ref(false);
  const vncConnectionInfo = ref<ConnectionInfo | null>(null);

  // --- Getters ---
  const sessionTabs = computed(() => {
    return Array.from(sessions.value.values()).map(session => ({
      sessionId: session.sessionId,
      connectionName: session.connectionName,
    }));
  });

  // 新增：包含状态的标签页信息
  const sessionTabsWithStatus = computed((): SessionTabInfoWithStatus[] => {
    return Array.from(sessions.value.values()).map(session => ({
      sessionId: session.sessionId,
      connectionName: session.connectionName,
      status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
    }));
  });


  const activeSession = computed((): SessionState | null => {
    if (!activeSessionId.value) return null;
    return sessions.value.get(activeSessionId.value) || null;
  });

  // --- Actions ---

  /**
   * 根据连接 ID 查找连接信息
   */
  const findConnectionInfo = (connectionId: number | string): ConnectionInfo | undefined => {
    return connectionsStore.connections.find(c => c.id === Number(connectionId));
  };

  /**
   * 打开一个新的会话标签页
   */
  const openNewSession = (connectionId: number | string) => {
    console.log(`[SessionStore] 请求打开新会话: ${connectionId}`);
    const connInfo = findConnectionInfo(connectionId);
    if (!connInfo) {
      console.error(`[SessionStore] 无法打开新会话：找不到 ID 为 ${connectionId} 的连接信息。`);
      // TODO: 向用户显示错误
      return;
    }

    const newSessionId = generateSessionId();
    const dbConnId = String(connInfo.id);

    // 1. 创建管理器实例 (从 WorkspaceView 迁移)
    const wsManager = createWebSocketConnectionManager(newSessionId, dbConnId, t);
    // const currentSftpPath = ref<string>('.'); // 移除单个 SFTP 路径状态
    // const wsDeps: WebSocketDependencies = { ... }; // wsDeps 将在 getOrCreateSftpManager 中创建
    // const sftpManager = createSftpActionsManager(newSessionId, currentSftpPath, wsDeps, t); // 移除单个 sftpManager 创建
    const sshTerminalDeps: SshTerminalDependencies = {
        sendMessage: wsManager.sendMessage,
        onMessage: wsManager.onMessage,
        isConnected: wsManager.isConnected,
    };
    const terminalManager = createSshTerminalManager(newSessionId, sshTerminalDeps, t);
    const statusMonitorDeps: StatusMonitorDependencies = {
        onMessage: wsManager.onMessage,
        isConnected: wsManager.isConnected,
    };
    const statusMonitorManager = createStatusMonitorManager(newSessionId, statusMonitorDeps);
    // +++ Create Docker Manager Dependencies +++
    const dockerManagerDeps: DockerManagerDependencies = {
        sendMessage: wsManager.sendMessage,
        onMessage: wsManager.onMessage,
        isConnected: wsManager.isConnected,
    };
    // +++ Create Docker Manager Instance +++
    const dockerManager = createDockerManager(newSessionId, dockerManagerDeps, { t });

    // 2. 创建 SessionState 对象
    const newSession: SessionState = {
        sessionId: newSessionId,
        connectionId: dbConnId,
        connectionName: connInfo.name || connInfo.host,
        wsManager: wsManager,
        // sftpManager: sftpManager, // 移除
        sftpManagers: new Map<string, SftpManagerInstance>(), // 初始化 Map
        terminalManager: terminalManager,
        statusMonitorManager: statusMonitorManager,
        dockerManager: dockerManager, // +++ Add Docker Manager to Session State +++
        // currentSftpPath: currentSftpPath, // 移除
        // --- 初始化编辑器状态 ---
        editorTabs: ref([]), // 初始化为空数组
        activeEditorTabId: ref(null), // 初始化为 null
        // --- 初始化命令输入框内容 ---
        commandInputContent: ref(''), // 初始化为空字符串
    };

    // 3. 添加到 Map 并激活 (需要创建 Map 的新实例以触发 shallowRef 更新)
    const newSessionsMap = new Map(sessions.value);
    newSessionsMap.set(newSessionId, newSession);
    sessions.value = newSessionsMap; // 触发 shallowRef 更新
    activeSessionId.value = newSessionId;
    console.log(`[SessionStore] 已创建新会话实例: ${newSessionId} for connection ${dbConnId}`);

    // 4. 启动 WebSocket 连接
    // 根据当前页面协议动态生成 WebSocket URL，并移除硬编码的端口
    // 假设 WebSocket 服务与 Web 服务在同一主机和端口上提供（通过反向代理）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 使用 window.location.host，它包含主机名和端口（如果非默认）
    const wsHostAndPort = window.location.host;
    // 假设 WebSocket 路径固定为 /ws/
    const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
    console.log(`[SessionStore] Generated WebSocket URL: ${wsUrl}`); // 添加日志记录生成的 URL
    wsManager.connect(wsUrl);
    console.log(`[SessionStore] 已为会话 ${newSessionId} 启动 WebSocket 连接。`);
  };

  /**
   * 激活指定 ID 的会话标签页
   */
  const activateSession = (sessionId: string) => {
    if (sessions.value.has(sessionId)) {
      if (activeSessionId.value !== sessionId) {
        activeSessionId.value = sessionId;
        console.log(`[SessionStore] 已激活会话: ${sessionId}`);
        // TODO: 可能需要 nextTick 来聚焦终端?
      } else {
        console.log(`[SessionStore] 会话 ${sessionId} 已经是活动状态。`);
      }
    } else {
      console.warn(`[SessionStore] 尝试激活不存在的会话 ID: ${sessionId}`);
    }
  };

  /**
   * 更新指定会话中编辑器标签页的内容
   */
  const updateFileContentInSession = (sessionId: string, tabId: string, newContent: string) => {
    const session = sessions.value.get(sessionId);
    if (!session) {
      console.error(`[SessionStore] 尝试在不存在的会话 ${sessionId} 中更新标签页 ${tabId} 内容`);
      return;
    }
    const tab = session.editorTabs.value.find(t => t.id === tabId);
    if (tab && !tab.isLoading) {
      tab.content = newContent;
      // 检查是否修改
      tab.isModified = tab.content !== tab.originalContent;
      // 当用户编辑时，重置保存状态
      if (tab.saveStatus === 'success' || tab.saveStatus === 'error') {
          tab.saveStatus = 'idle';
          tab.saveError = null;
      }
    } else if (tab) {
        console.warn(`[SessionStore] 尝试更新正在加载的标签页 ${tabId} 的内容`);
    } else {
        console.warn(`[SessionStore] 尝试更新会话 ${sessionId} 中不存在的标签页 ${tabId} 的内容`);
    }
  };

  /**
   * 保存指定会话中的编辑器标签页
   */
  const saveFileInSession = async (sessionId: string, tabId: string) => {
    const session = sessions.value.get(sessionId);
    if (!session) {
      console.error(`[SessionStore] 尝试在不存在的会话 ${sessionId} 中保存标签页 ${tabId}`);
      return;
    }
    const tab = session.editorTabs.value.find(t => t.id === tabId);
    if (!tab) {
      console.warn(`[SessionStore] 尝试保存在会话 ${sessionId} 中不存在的标签页 ${tabId}`);
      return;
    }

    if (tab.isSaving || tab.isLoading || tab.loadingError || !tab.isModified) {
      console.warn(`[SessionStore] 保存条件不满足 for ${tab.filePath} (会话 ${sessionId})，无法保存。`, { tab });
      return;
    }

    // 检查会话连接状态
    if (!session.wsManager.isConnected.value || !session.wsManager.isSftpReady.value) {
      console.error(`[SessionStore] 保存失败：会话 ${sessionId} 无效或未连接/SFTP 未就绪。`);
      tab.saveStatus = 'error';
      tab.saveError = t('fileManager.errors.sessionInvalidOrNotReady');
      setTimeout(() => { if (tab.saveStatus === 'error') { tab.saveStatus = 'idle'; tab.saveError = null; } }, 5000);
      return;
    }

    // 获取默认的 sftpManager 实例来执行保存操作
    const sftpManager = getOrCreateSftpManager(sessionId, 'primary');
    if (!sftpManager) {
        console.error(`[SessionStore] 保存失败：无法获取会话 ${sessionId} 的 primary sftpManager。`);
        tab.saveStatus = 'error';
        tab.saveError = t('fileManager.errors.sftpManagerNotFound');
        setTimeout(() => { if (tab.saveStatus === 'error') { tab.saveStatus = 'idle'; tab.saveError = null; } }, 5000);
        return;
    }

    console.log(`[SessionStore] 开始保存文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tab.id}) using primary sftpManager`);
    tab.isSaving = true;
    tab.saveStatus = 'saving';
    tab.saveError = null;

    const contentToSave = tab.content;
    const encodingToUse = tab.selectedEncoding; // 获取选定的编码

    try {
      // --- 修改：传递 selectedEncoding 给 writeFile ---
      await sftpManager.writeFile(tab.filePath, contentToSave, encodingToUse);
      console.log(`[SessionStore] 文件 ${tab.filePath} (会话 ${sessionId}) 使用编码 ${encodingToUse} 保存成功。`);
      tab.isSaving = false;
      tab.saveStatus = 'success';
      tab.saveError = null;
      tab.originalContent = contentToSave; // 更新原始内容
      tab.isModified = false; // 重置修改状态
      setTimeout(() => { if (tab.saveStatus === 'success') { tab.saveStatus = 'idle'; } }, 2000);
    } catch (err: any) {
      console.error(`[SessionStore] 保存文件 ${tab.filePath} (会话 ${sessionId}) 失败:`, err);
      tab.isSaving = false;
      tab.saveStatus = 'error';
      tab.saveError = `${t('fileManager.errors.saveFailed')}: ${err.message || err}`;
      setTimeout(() => { if (tab.saveStatus === 'error') { tab.saveStatus = 'idle'; tab.saveError = null; } }, 5000);
    }
  };


  /**
   * 关闭指定 ID 的会话标签页
   */
  const closeSession = (sessionId: string) => {
    console.log(`[SessionStore] 请求关闭会话 ID: ${sessionId}`);
    const sessionToClose = sessions.value.get(sessionId);
    if (!sessionToClose) {
      console.warn(`[SessionStore] 尝试关闭不存在的会话 ID: ${sessionId}`);
      return;
    }

    // 1. 调用实例上的清理和断开方法 (从 WorkspaceView 迁移)
    sessionToClose.wsManager.disconnect();
    console.log(`[SessionStore] 已为会话 ${sessionId} 调用 wsManager.disconnect()`);
    // 清理该会话下的所有 sftpManager 实例
    sessionToClose.sftpManagers.forEach((manager, instanceId) => {
        manager.cleanup();
        console.log(`[SessionStore] 已为会话 ${sessionId} 的 sftpManager (实例 ${instanceId}) 调用 cleanup()`);
    });
    sessionToClose.sftpManagers.clear();
    // sessionToClose.sftpManager.cleanup(); // 移除旧的调用
    // console.log(`[SessionStore] 已为会话 ${sessionId} 调用 sftpManager.cleanup()`); // 移除旧的日志
    sessionToClose.terminalManager.cleanup();
    console.log(`[SessionStore] 已为会话 ${sessionId} 调用 terminalManager.cleanup()`);
    sessionToClose.statusMonitorManager.cleanup();
    console.log(`[SessionStore] 已为会话 ${sessionId} 调用 statusMonitorManager.cleanup()`);
    sessionToClose.dockerManager.cleanup(); // +++ Call Docker Manager cleanup +++
    console.log(`[SessionStore] 已为会话 ${sessionId} 调用 dockerManager.cleanup()`); // +++ Add log +++
    // TODO: 清理编辑器相关资源？例如提示保存未保存的文件

    // 2. 从 Map 中移除会话 (需要创建 Map 的新实例以触发 shallowRef 更新)
    const newSessionsMap = new Map(sessions.value);
    newSessionsMap.delete(sessionId);
    sessions.value = newSessionsMap; // 触发 shallowRef 更新
    console.log(`[SessionStore] 已从 Map 中移除会话: ${sessionId}`);

    // 3. 切换活动标签页
    if (activeSessionId.value === sessionId) {
      const remainingSessions = Array.from(sessions.value.keys());
      const nextActiveId = remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1] : null;
      activeSessionId.value = nextActiveId;
      console.log(`[SessionStore] 关闭活动会话后，切换到: ${nextActiveId}`);
    }
  };

  /**
   * 处理连接列表的左键点击
   * 处理来自 UI 的连接请求（例如点击连接列表或仪表盘）。
   * - 如果是 RDP 连接，直接打开 RDP 模态框。
   * - 如果是非 RDP 连接：
   *   - 如果点击的是当前活动且断开的会话，则尝试重连。
   *   - 否则，打开一个新的会话标签页并导航到 Workspace。
   */
  const handleConnectRequest = (connection: ConnectionInfo) => {
    // console.log(`[SessionStore] handleConnectRequest called for connection: ${connection.name} (ID: ${connection.id}, Type: ${connection.type})`); // 保留原始日志或移除

    if (connection.type === 'RDP') {
      // RDP: 直接打开 RDP 模态框
      openRdpModal(connection);
    } else if (connection.type === 'VNC') {
      // VNC: 直接打开 VNC 模态框
      openVncModal(connection);
    } else {
      // 非 RDP (e.g., SSH): 处理会话和导航
      const connIdStr = String(connection.id);
      let activeAndDisconnected = false;

      // 检查是否点击了当前活动且断开的会话
      if (activeSessionId.value) {
        const currentActiveSession = sessions.value.get(activeSessionId.value);
        if (currentActiveSession && currentActiveSession.connectionId === connIdStr) {
          const currentStatus = currentActiveSession.wsManager.connectionStatus.value;
          console.log(`[SessionStore] 点击的是当前活动会话 ${activeSessionId.value}，状态: ${currentStatus}`);
          if (currentStatus === 'disconnected' || currentStatus === 'error') {
            activeAndDisconnected = true;
            // 满足最高优先级：重连当前活动会话
            console.log(`[SessionStore] 活动会话 ${activeSessionId.value} 已断开或出错，尝试重连...`);
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // 使用 window.location.host
            const wsHostAndPort = window.location.host;
            const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
            console.log(`[SessionStore handleConnectRequest] Generated WebSocket URL for reconnect: ${wsUrl}`);
            currentActiveSession.wsManager.connect(wsUrl);
            // 重连后，确保激活该会话（如果它不是活动会话）并导航
            activateSession(activeSessionId.value); // 确保激活
            router.push({ name: 'Workspace' });
          }
        }
      }

      // 如果不满足重连条件，则总是打开新会话并导航
      if (!activeAndDisconnected) {
        console.log(`[SessionStore] 不满足重连条件或点击了其他连接，将打开新会话 for ID: ${connIdStr}`);
        openNewSession(connIdStr); // openNewSession 会自动激活新会话
        // 导航到 Workspace，让 WorkspaceView 处理新激活的会话
        router.push({ name: 'Workspace' }); // +++ 添加跳转 +++
      }
    }
  };

  /**
   * 处理连接列表的中键点击（总是打开新会话）
   */
  const handleOpenNewSession = (connectionId: number | string) => {
    console.log(`[SessionStore] handleOpenNewSession called for ID: ${connectionId}`);
    openNewSession(connectionId);
  };

  /**
   * 清理所有会话（例如在应用卸载时）
   */
  const cleanupAllSessions = () => {
    console.log('[SessionStore] 清理所有会话...');
    sessions.value.forEach((session, sessionId) => {
      closeSession(sessionId); // 调用单个会话的关闭逻辑
    });
    sessions.value.clear();
    activeSessionId.value = null;
  };

  // --- 新增：编辑器相关 Actions ---

  /**
   * 在指定会话中打开文件
   */
  const openFileInSession = (sessionId: string, fileInfo: FileInfo) => {
    const session = sessions.value.get(sessionId);
    if (!session) {
      console.error(`[SessionStore] 尝试在不存在的会话 ${sessionId} 中打开文件`);
      return;
    }

    // 检查标签页是否已存在 (使用 filePath)
    const existingTab = session.editorTabs.value.find(tab => tab.filePath === fileInfo.fullPath);
    if (existingTab) {
      // 如果标签页已存在，则激活它
      session.activeEditorTabId.value = existingTab.id;
      console.log(`[SessionStore] 会话 ${sessionId} 中已存在文件 ${fileInfo.fullPath} 的标签页，已激活: ${existingTab.id}`);
    } else {
      // 创建新标签页
      // 创建新标签页 (使用简化后的 FileTab 接口)
      // --- 修复：初始化 rawContentBase64 ---
      const newTab: FileTab = {
        id: `${sessionId}:${fileInfo.fullPath}`, // <-- 修复：使用 sessionId:filePath 作为 ID
        sessionId: sessionId,
        filePath: fileInfo.fullPath,
        filename: fileInfo.name,
        content: '', // 将由后端填充
        originalContent: '', // 将由后端填充
        rawContentBase64: null, // 初始化为 null
        language: getLanguageFromFilename(fileInfo.name),
        selectedEncoding: 'utf-8', // 初始默认，将由后端更新
        isLoading: true,
        loadingError: null,
        isSaving: false,
        saveStatus: 'idle',
        saveError: null,
        isModified: false,
      };
      // session.editorTabs.value.push(newTab); // 移除重复的 push
      session.editorTabs.value.push(newTab);
      session.activeEditorTabId.value = newTab.id;
      console.log(`[SessionStore] 已在会话 ${sessionId} 中为文件 ${fileInfo.fullPath} 创建新标签页: ${newTab.id}`);

      // --- 新增：异步加载文件内容 ---
      // --- 修改：异步加载文件内容 (处理后端解码后的内容) ---
      const loadContent = async () => {
          const tabIndex = session.editorTabs.value.findIndex(t => t.id === newTab.id);
          if (tabIndex === -1) return; // Tab might have been closed quickly

          // 更新加载状态 (使用 splice 保证响应性)
          const loadingTab = { ...session.editorTabs.value[tabIndex], isLoading: true, loadingError: null };
          session.editorTabs.value.splice(tabIndex, 1, loadingTab);

          try {
            // 获取默认的 sftpManager 实例来执行读取操作
            const sftpManager = getOrCreateSftpManager(sessionId, 'primary');
            if (!sftpManager) {
                throw new Error(t('fileManager.errors.sftpManagerNotFound'));
            }
            console.log(`[SessionStore ${sessionId}] 使用 primary sftpManager 读取文件 ${fileInfo.fullPath}`);

            // 调用 sftpManager.readFile (不带编码参数，让后端自动检测)
            // 后端现在返回 { content: string, encodingUsed: string }
            const fileData: SftpReadFileSuccessPayload = await sftpManager.readFile(fileInfo.fullPath);
            console.log(`[SessionStore ${sessionId}] 文件 ${fileInfo.fullPath} 读取成功。后端使用编码: ${fileData.encodingUsed}`);

            // 更新标签页状态 (使用 splice 保证响应性)
            const currentTabState = session.editorTabs.value.find(t => t.id === newTab.id); // 获取最新状态
            if (!currentTabState) return; // 可能在请求期间关闭了

            // --- 修复：使用 decodeRawContent 解码并存储原始数据 ---
            const initialContent = decodeRawContent(fileData.rawContentBase64, fileData.encodingUsed);
            const updatedTab: FileTab = {
                ...currentTabState,
                content: initialContent,
                originalContent: initialContent, // 初始原始内容
                rawContentBase64: fileData.rawContentBase64, // 存储原始 Base64 数据
                selectedEncoding: fileData.encodingUsed, // 存储后端实际使用的编码
                isLoading: false,
                isModified: false,
                loadingError: null,
            };
            const finalTabIndex = session.editorTabs.value.findIndex(t => t.id === newTab.id); // 重新获取索引
            if (finalTabIndex !== -1) {
                session.editorTabs.value.splice(finalTabIndex, 1, updatedTab);
                console.log(`[SessionStore ${sessionId}] 文件 ${fileInfo.fullPath} 内容已加载并设置到标签页 ${newTab.id}。`);
            } else {
                 console.warn(`[SessionStore ${sessionId}] 尝试更新标签页 ${newTab.id} 时未找到索引。`);
            }

          } catch (err: any) {
              console.error(`[SessionStore ${sessionId}] 读取文件 ${fileInfo.fullPath} 失败:`, err);
              // 更新错误状态 (使用 splice 保证响应性)
              const errorTabIndex = session.editorTabs.value.findIndex(t => t.id === newTab.id);
              if (errorTabIndex !== -1) {
                  const errorTab = {
                      ...session.editorTabs.value[errorTabIndex],
                      isLoading: false,
                      loadingError: `${t('fileManager.errors.readFileFailed')}: ${err.message || err}`,
                      content: `// 加载错误: ${err.message || err}`
                  };
                  session.editorTabs.value.splice(errorTabIndex, 1, errorTab);
              }
          }
        };

      loadContent(); // 启动内容加载
    }
  };

  /**
   * 关闭指定会话中的编辑器标签页
   */
  const closeEditorTabInSession = (sessionId: string, tabId: string) => {
    const session = sessions.value.get(sessionId);
    if (!session) {
      console.error(`[SessionStore] 尝试在不存在的会话 ${sessionId} 中关闭标签页 ${tabId}`);
      return;
    }

    const tabIndex = session.editorTabs.value.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) {
      console.warn(`[SessionStore] 尝试关闭会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
      return;
    }

    // TODO: 检查 isDirty 状态，提示保存？

    session.editorTabs.value.splice(tabIndex, 1);
    console.log(`[SessionStore] 已从会话 ${sessionId} 中移除标签页: ${tabId}`);

    // 如果关闭的是当前活动标签页，则切换到前一个或 null
    if (session.activeEditorTabId.value === tabId) {
      const remainingTabs = session.editorTabs.value;
      const nextActiveTabId = remainingTabs.length > 0
        ? remainingTabs[Math.max(0, tabIndex - 1)].id // 尝试激活前一个，或第一个
        : null;
      session.activeEditorTabId.value = nextActiveTabId;
      console.log(`[SessionStore] 会话 ${sessionId} 关闭活动标签页后，切换到: ${nextActiveTabId}`);
    }
  };

  /**
   * 激活指定会话中的编辑器标签页
   */
  const setActiveEditorTabInSession = (sessionId: string, tabId: string) => {
    const session = sessions.value.get(sessionId);
    if (!session) {
      console.error(`[SessionStore] 尝试在不存在的会话 ${sessionId} 中激活标签页 ${tabId}`);
      return;
    }

    if (session.editorTabs.value.some(tab => tab.id === tabId)) {
      if (session.activeEditorTabId.value !== tabId) {
        session.activeEditorTabId.value = tabId;
        console.log(`[SessionStore] 已在会话 ${sessionId} 中激活标签页: ${tabId}`);
      }
    } else {
      console.warn(`[SessionStore] 尝试激活会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
    }
  };

  // +++ 新增：关闭指定会话中的其他编辑器标签页 +++
  const closeOtherTabsInSession = (sessionId: string, targetTabId: string) => {
    const session = sessions.value.get(sessionId);
    if (!session) return;
    const targetIndex = session.editorTabs.value.findIndex(tab => tab.id === targetTabId);
    if (targetIndex === -1) return;
    console.log(`[SessionStore ${sessionId}] 关闭除 ${targetTabId} 之外的所有标签页...`);
    const tabsToClose = session.editorTabs.value
        .filter(tab => tab.id !== targetTabId)
        .map(tab => tab.id);
    tabsToClose.forEach(id => closeEditorTabInSession(sessionId, id)); // 复用单个关闭逻辑
  };

  // +++ 新增：关闭指定会话中右侧的编辑器标签页 +++
  const closeTabsToTheRightInSession = (sessionId: string, targetTabId: string) => {
      const session = sessions.value.get(sessionId);
      if (!session) return;
      const targetIndex = session.editorTabs.value.findIndex(tab => tab.id === targetTabId);
      if (targetIndex === -1) return;
      console.log(`[SessionStore ${sessionId}] 关闭 ${targetTabId} 右侧的所有标签页...`);
      const tabsToClose = session.editorTabs.value
          .slice(targetIndex + 1)
          .map(tab => tab.id);
      tabsToClose.forEach(id => closeEditorTabInSession(sessionId, id));
  };

  // +++ 新增：关闭指定会话中左侧的编辑器标签页 +++
  const closeTabsToTheLeftInSession = (sessionId: string, targetTabId: string) => {
      const session = sessions.value.get(sessionId);
      if (!session) return;
      const targetIndex = session.editorTabs.value.findIndex(tab => tab.id === targetTabId);
      if (targetIndex === -1) return;
      console.log(`[SessionStore ${sessionId}] 关闭 ${targetTabId} 左侧的所有标签页...`);
      const tabsToClose = session.editorTabs.value
          .slice(0, targetIndex)
          .map(tab => tab.id);
      tabsToClose.forEach(id => closeEditorTabInSession(sessionId, id));
  };


  /**
   * 在指定会话中更改文件编码并重新解码
   */
  // --- 修改：更改文件编码（通过请求后端重新读取） ---
  const changeEncodingInSession = (sessionId: string, tabId: string, newEncoding: string) => {
      const session = sessions.value.get(sessionId);
      if (!session) {
          console.warn(`[SessionStore] 尝试更改不存在的会话 ${sessionId} 中标签页 ${tabId} 的编码。`);
          return;
      }
      const tabIndex = session.editorTabs.value.findIndex(t => t.id === tabId);
      if (tabIndex === -1) {
          console.warn(`[SessionStore] 尝试更改会话 ${sessionId} 中不存在的标签页 ${tabId} 的编码。`);
          return;
      }

      const tab = session.editorTabs.value[tabIndex];

      if (!tab.rawContentBase64) {
          console.error(`[SessionStore] 无法更改编码：会话 ${sessionId} 标签页 ${tabId} 没有原始文件数据。`);
          // 更新错误状态
          const errorTab = { ...tab, isLoading: false, loadingError: '缺少原始文件数据，无法更改编码' };
          session.editorTabs.value.splice(tabIndex, 1, errorTab);
          return;
      }
      if (tab.selectedEncoding === newEncoding) {
          console.log(`[SessionStore] 会话 ${sessionId} 标签页 ${tabId} 编码已经是 ${newEncoding}，无需更改。`);
          return;
      }

      console.log(`[SessionStore] 使用新编码 "${newEncoding}" 在前端重新解码文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tabId})`);

      try {
          // 使用新编码解码存储的原始数据
          const newContent = decodeRawContent(tab.rawContentBase64, newEncoding);

          // 更新标签页状态 (使用 splice 保证响应性)
          const updatedTab: FileTab = {
              ...tab,
              content: newContent,
              selectedEncoding: newEncoding, // 更新选择的编码
              isLoading: false, // 解码完成 (移除加载状态)
              loadingError: null,
              // isModified 状态保持不变
          };
          session.editorTabs.value.splice(tabIndex, 1, updatedTab);
          console.log(`[SessionStore] 文件 ${tab.filePath} (会话 ${sessionId}) 使用新编码 "${newEncoding}" 解码完成。`);

      } catch (err: any) { // catch 应该在 decodeRawContent 内部处理了，但以防万一
          console.error(`[SessionStore] 使用编码 "${newEncoding}" 在前端解码文件 ${tab.filePath} (会话 ${sessionId}) 失败:`, err);
          const errorMsg = `前端解码失败 (编码: ${newEncoding}): ${err.message || err}`;
          // 更新错误状态 (使用 splice)
          const errorTab: FileTab = {
              ...tab,
              isLoading: false,
              loadingError: errorMsg,
          };
          session.editorTabs.value.splice(tabIndex, 1, errorTab);
      }
  };


  /**
   * 获取或创建指定会话和实例 ID 的 SFTP 管理器。
   * @param sessionId 会话 ID
   * @param instanceId 文件管理器实例 ID (e.g., 'sidebar', 'panel-xyz')
   * @returns SftpManagerInstance 或 null (如果会话不存在)
   */
  const getOrCreateSftpManager = (sessionId: string, instanceId: string): SftpManagerInstance | null => {
      const session = sessions.value.get(sessionId);
      if (!session) {
          console.error(`[SessionStore] 尝试为不存在的会话 ${sessionId} 获取 SFTP 管理器`);
          return null;
      }

      let manager = session.sftpManagers.get(instanceId);
      if (!manager) {
          console.log(`[SessionStore] 为会话 ${sessionId} 创建新的 SFTP 管理器实例: ${instanceId}`);
          const currentSftpPath = ref<string>('.'); // 每个实例有自己的路径
          const wsDeps: WebSocketDependencies = {
              sendMessage: session.wsManager.sendMessage,
              onMessage: session.wsManager.onMessage,
              isConnected: session.wsManager.isConnected,
              isSftpReady: session.wsManager.isSftpReady,
          };
          manager = createSftpActionsManager(sessionId, currentSftpPath, wsDeps, t);
          session.sftpManagers.set(instanceId, manager);
      }
      return manager;
  };

  /**
   * 移除并清理指定会话和实例 ID 的 SFTP 管理器。
   * @param sessionId 会话 ID
   * @param instanceId 文件管理器实例 ID
   */
  const removeSftpManager = (sessionId: string, instanceId: string) => {
      const session = sessions.value.get(sessionId);
      if (session) {
          const manager = session.sftpManagers.get(instanceId);
          if (manager) {
              manager.cleanup();
              session.sftpManagers.delete(instanceId);
              console.log(`[SessionStore] 已移除并清理会话 ${sessionId} 的 SFTP 管理器实例: ${instanceId}`);
          }
      }
  };

  // --- RDP Modal Actions ---
  const openRdpModal = (connection: ConnectionInfo) => {
    // console.log(`[SessionStore] Opening RDP modal for connection: ${connection.name} (ID: ${connection.id})`); // 保留原始日志或移除
    rdpConnectionInfo.value = connection;
    isRdpModalOpen.value = true;
  };

  const closeRdpModal = () => {
    // console.log('[SessionStore] Closing RDP modal.'); // 保留原始日志或移除
    isRdpModalOpen.value = false;
    rdpConnectionInfo.value = null; // 清除连接信息
  };

  // --- VNC Modal Actions ---
  const openVncModal = (connection: ConnectionInfo) => {
    // console.log(`[SessionStore] Opening VNC modal for connection: ${connection.name} (ID: ${connection.id})`); // 保留原始日志或移除
    vncConnectionInfo.value = connection;
    isVncModalOpen.value = true;
  };

  const closeVncModal = () => {
    // console.log('[SessionStore] Closing VNC modal.'); // 保留原始日志或移除
    isVncModalOpen.value = false;
    vncConnectionInfo.value = null; // 清除连接信息
  };

  /**
   * 更新指定会话的命令输入框内容
   */
  const updateSessionCommandInput = (sessionId: string, content: string) => {
    const session = sessions.value.get(sessionId);
    if (session) {
      session.commandInputContent.value = content;
    } else {
      console.warn(`[SessionStore] 尝试更新不存在的会话 ${sessionId} 的命令输入内容`);
    }
  };


  return {
    // State
    sessions,
    activeSessionId,
    isRdpModalOpen,         // 导出 RDP 模态框状态
    rdpConnectionInfo,      // 导出 RDP 连接信息
    isVncModalOpen,         // 导出 VNC 模态框状态
    vncConnectionInfo,      // 导出 VNC 连接信息
    // Getters
    sessionTabs,
    sessionTabsWithStatus, // 导出新的 getter
    activeSession,
    // Actions
    openNewSession,
    activateSession,
    closeSession,
    handleConnectRequest,
    handleOpenNewSession,
    cleanupAllSessions,
    getOrCreateSftpManager, // 导出新的 Action
    removeSftpManager,      // 导出新的 Action
    // --- 新增：导出编辑器相关 Actions ---
    openFileInSession,
    closeEditorTabInSession,
    setActiveEditorTabInSession,
    updateFileContentInSession, // 导出更新内容 Action
    saveFileInSession,          // 导出保存文件 Action
    changeEncodingInSession,    // 导出更改编码 Action
    closeOtherTabsInSession,    // +++ 导出新 action +++
    closeTabsToTheRightInSession, // +++ 导出新 action +++
    closeTabsToTheLeftInSession,  // +++ 导出新 action +++
    // --- RDP Modal Actions ---
    openRdpModal,           // 导出打开 RDP 模态框 Action
    closeRdpModal,          // 导出关闭 RDP 模态框 Action
    openVncModal,           // 导出打开 VNC 模态框 Action
    closeVncModal,          // 导出关闭 VNC 模态框 Action
    // --- 命令输入框 Action ---
    updateSessionCommandInput, // 导出更新命令输入 Action
  };
});
