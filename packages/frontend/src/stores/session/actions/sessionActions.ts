// packages/frontend/src/stores/session/actions/sessionActions.ts

import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useConnectionsStore, type ConnectionInfo } from '../../connections.store'; // 路径: packages/frontend/src/stores/connections.store.ts
import { sessions, activeSessionId } from '../state';
import { generateSessionId } from '../utils';
import type { SessionState, SshTerminalInstance, StatusMonitorInstance, DockerManagerInstance, SftpManagerInstance } from '../types';

// Composables for manager creation - 路径相对于此文件
import { createWebSocketConnectionManager } from '../../../composables/useWebSocketConnection';
import { createSshTerminalManager, type SshTerminalDependencies } from '../../../composables/useSshTerminal';
import { createStatusMonitorManager, type StatusMonitorDependencies } from '../../../composables/useStatusMonitor';
import { createDockerManager, type DockerManagerDependencies } from '../../../composables/useDockerManager';
// getOrCreateSftpManager 将在 sftpManagerActions.ts 中定义，并在主 store 中协调

// --- 辅助函数 (特定于此模块的 actions) ---
const findConnectionInfo = (connectionId: number | string, connectionsStore: ReturnType<typeof useConnectionsStore>): ConnectionInfo | undefined => {
  return connectionsStore.connections.find(c => c.id === Number(connectionId));
};

// --- Actions ---
export const openNewSession = (
    connectionId: number | string,
    dependencies: {
        connectionsStore: ReturnType<typeof useConnectionsStore>;
        t: ReturnType<typeof useI18n>['t'];
    }
) => {
  const { connectionsStore, t } = dependencies;
  console.log(`[SessionActions] 请求打开新会话: ${connectionId}`);
  const connInfo = findConnectionInfo(connectionId, connectionsStore);
  if (!connInfo) {
    console.error(`[SessionActions] 无法打开新会话：找不到 ID 为 ${connectionId} 的连接信息。`);
    // TODO: 向用户显示错误
    return;
  }

  const newSessionId = generateSessionId();
  const dbConnId = String(connInfo.id);

  // 1. 创建管理器实例
  const wsManager = createWebSocketConnectionManager(newSessionId, dbConnId, t);
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
  const dockerManagerDeps: DockerManagerDependencies = {
      sendMessage: wsManager.sendMessage,
      onMessage: wsManager.onMessage,
      isConnected: wsManager.isConnected,
  };
  const dockerManager = createDockerManager(newSessionId, dockerManagerDeps, { t });

  // 2. 创建 SessionState 对象
  const newSession: SessionState = {
      sessionId: newSessionId,
      connectionId: dbConnId,
      connectionName: connInfo.name || connInfo.host,
      wsManager: wsManager,
      sftpManagers: new Map<string, SftpManagerInstance>(), // 初始化 Map
      terminalManager: terminalManager,
      statusMonitorManager: statusMonitorManager,
      dockerManager: dockerManager,
      editorTabs: ref([]),
      activeEditorTabId: ref(null),
      commandInputContent: ref(''),
  };

  // 3. 添加到 Map 并激活
  const newSessionsMap = new Map(sessions.value);
  newSessionsMap.set(newSessionId, newSession);
  sessions.value = newSessionsMap;
  activeSessionId.value = newSessionId;
  console.log(`[SessionActions] 已创建新会话实例: ${newSessionId} for connection ${dbConnId}`);

  // 4. 启动 WebSocket 连接
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHostAndPort = window.location.host;
  const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
  console.log(`[SessionActions] Generated WebSocket URL: ${wsUrl}`);
  wsManager.connect(wsUrl);
  console.log(`[SessionActions] 已为会话 ${newSessionId} 启动 WebSocket 连接。`);
};

export const activateSession = (sessionId: string) => {
  if (sessions.value.has(sessionId)) {
    if (activeSessionId.value !== sessionId) {
      activeSessionId.value = sessionId;
      console.log(`[SessionActions] 已激活会话: ${sessionId}`);
    } else {
      console.log(`[SessionActions] 会话 ${sessionId} 已经是活动状态。`);
    }
  } else {
    console.warn(`[SessionActions] 尝试激活不存在的会话 ID: ${sessionId}`);
  }
};

export const closeSession = (sessionId: string) => {
  console.log(`[SessionActions] 请求关闭会话 ID: ${sessionId}`);
  const sessionToClose = sessions.value.get(sessionId);
  if (!sessionToClose) {
    console.warn(`[SessionActions] 尝试关闭不存在的会话 ID: ${sessionId}`);
    return;
  }

  // 1. 调用实例上的清理和断开方法
  sessionToClose.wsManager.disconnect();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 wsManager.disconnect()`);
  sessionToClose.sftpManagers.forEach((manager, instanceId) => {
      manager.cleanup();
      console.log(`[SessionActions] 已为会话 ${sessionId} 的 sftpManager (实例 ${instanceId}) 调用 cleanup()`);
  });
  sessionToClose.sftpManagers.clear();
  sessionToClose.terminalManager.cleanup();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 terminalManager.cleanup()`);
  sessionToClose.statusMonitorManager.cleanup();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 statusMonitorManager.cleanup()`);
  sessionToClose.dockerManager.cleanup();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 dockerManager.cleanup()`);

  // 2. 从 Map 中移除会话
  const newSessionsMap = new Map(sessions.value);
  newSessionsMap.delete(sessionId);
  sessions.value = newSessionsMap;
  console.log(`[SessionActions] 已从 Map 中移除会话: ${sessionId}`);

  // 3. 切换活动标签页
  if (activeSessionId.value === sessionId) {
    const remainingSessions = Array.from(sessions.value.keys());
    const nextActiveId = remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1] : null;
    activeSessionId.value = nextActiveId;
    console.log(`[SessionActions] 关闭活动会话后，切换到: ${nextActiveId}`);
  }
};

export const handleConnectRequest = (
    connection: ConnectionInfo,
    dependencies: {
        connectionsStore: ReturnType<typeof useConnectionsStore>;
        router: ReturnType<typeof useRouter>;
        openRdpModalAction: (connection: ConnectionInfo) => void; // 来自 modalActions
        openVncModalAction: (connection: ConnectionInfo) => void; // 来自 modalActions
        t: ReturnType<typeof useI18n>['t'];
    }
) => {
  const { connectionsStore, router, openRdpModalAction, openVncModalAction, t } = dependencies;

  if (connection.type === 'RDP') {
    openRdpModalAction(connection);
  } else if (connection.type === 'VNC') {
    openVncModalAction(connection);
  } else {
    const connIdStr = String(connection.id);
    let activeAndDisconnected = false;

    if (activeSessionId.value) {
      const currentActiveSession = sessions.value.get(activeSessionId.value);
      if (currentActiveSession && currentActiveSession.connectionId === connIdStr) {
        const currentStatus = currentActiveSession.wsManager.connectionStatus.value;
        console.log(`[SessionActions] 点击的是当前活动会话 ${activeSessionId.value}，状态: ${currentStatus}`);
        if (currentStatus === 'disconnected' || currentStatus === 'error') {
          activeAndDisconnected = true;
          console.log(`[SessionActions] 活动会话 ${activeSessionId.value} 已断开或出错，尝试重连...`);
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsHostAndPort = window.location.host;
          const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
          console.log(`[SessionActions handleConnectRequest] Generated WebSocket URL for reconnect: ${wsUrl}`);
          currentActiveSession.wsManager.connect(wsUrl);
          activateSession(activeSessionId.value);
          router.push({ name: 'Workspace' });
        }
      }
    }

    if (!activeAndDisconnected) {
      console.log(`[SessionActions] 不满足重连条件或点击了其他连接，将打开新会话 for ID: ${connIdStr}`);
      openNewSession(connIdStr, { connectionsStore, t });
      router.push({ name: 'Workspace' });
    }
  }
};

export const handleOpenNewSession = (
    connectionId: number | string,
    dependencies: {
        connectionsStore: ReturnType<typeof useConnectionsStore>;
        t: ReturnType<typeof useI18n>['t'];
    }
) => {
  console.log(`[SessionActions] handleOpenNewSession called for ID: ${connectionId}`);
  openNewSession(connectionId, dependencies);
};

export const cleanupAllSessions = () => {
  console.log('[SessionActions] 清理所有会话...');
  sessions.value.forEach((_session, sessionId) => {
    closeSession(sessionId);
  });
  // sessions.value.clear(); // closeSession 内部会逐个删除，这里不需要重复clear，但确认Map为空
  if (sessions.value.size > 0) { // 以防万一
    const newSessionsMap = new Map(sessions.value);
    newSessionsMap.clear();
    sessions.value = newSessionsMap;
  }
  activeSessionId.value = null;
};