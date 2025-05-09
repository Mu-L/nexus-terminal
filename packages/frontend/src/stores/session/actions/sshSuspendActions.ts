// packages/frontend/src/stores/session/actions/sshSuspendActions.ts
import { v4 as uuidv4 } from 'uuid';
import { sessions, suspendedSshSessions, isLoadingSuspendedSessions, activeSessionId } from '../state';
import type {
  MessagePayload, // 新增导入
  SshSuspendStartReqMessage,
  // SshSuspendListReqMessage, // 不再需要，因为 fetch 将通过 HTTP
  SshSuspendResumeReqMessage,
  SshSuspendTerminateReqMessage,
  SshSuspendRemoveEntryReqMessage,
  SshSuspendEditNameReqMessage,
  // S2C Payloads
  SshSuspendStartedRespPayload,
  SshSuspendListResponsePayload, // 仍然需要处理来自 WS 的列表更新推送（如果后端支持）
  SshSuspendResumedNotifPayload,
  SshOutputCachedChunkPayload,
  SshSuspendTerminatedRespPayload,
  SshSuspendEntryRemovedRespPayload,
  SshSuspendNameEditedRespPayload,
  SshSuspendAutoTerminatedNotifPayload,
} from '../../../types/websocket.types'; // 路径: packages/frontend/src/types/websocket.types.ts
import type { WsManagerInstance, SessionState } from '../types'; // 路径: packages/frontend/src/stores/session/types.ts
import { closeSession as closeSessionAction, activateSession as activateSessionAction, openNewSession } from './sessionActions'; // 使用 openNewSession
import { useConnectionsStore } from '../../connections.store'; // 用于获取连接信息
import { useUiNotificationsStore } from '../../uiNotifications.store'; // 用于显示通知
import type { SuspendedSshSession } from '../../../types/ssh-suspend.types'; // 路径: packages/frontend/src/types/ssh-suspend.types.ts
import i18n from '../../../i18n'; // 直接导入 i18n 实例
import type { ComposerTranslation } from 'vue-i18n'; // 导入 ComposerTranslation 类型
import apiClient from '../../../utils/apiClient'; // +++ 新增：导入 apiClient +++

const t: ComposerTranslation = i18n.global.t; // 从全局 i18n 实例获取 t 函数并显式注解类型

// 辅助函数：获取一个可用的 WebSocket 管理器
// 优先使用当前激活的会话，或者任意一个已连接的 SSH 会话
// 注意：此函数主要用于那些仍然需要 WebSocket 的操作 (如 resume, terminate)
const getActiveWsManager = (): WsManagerInstance | null => {
  console.log(`[getActiveWsManager] 尝试获取可用 WebSocket。当前 sessions 数量: ${sessions.value.size}`);
  sessions.value.forEach((session, sessionId) => {
    console.log(`[getActiveWsManager]   - 会话 ID: ${sessionId}, WS Manager 存在: ${!!session.wsManager}, WS 已连接: ${session.wsManager?.isConnected?.value}`);
  });

  const firstSessionKey = sessions.value.size > 0 ? sessions.value.keys().next().value : null;
  console.log(`[getActiveWsManager] 尝试使用第一个会话 Key (如果存在): ${firstSessionKey}`);

  if (firstSessionKey) {
    const session = sessions.value.get(firstSessionKey);
    console.log(`[getActiveWsManager]   第一个会话 (ID: ${firstSessionKey}): WS Manager 存在: ${!!session?.wsManager}, WS 已连接: ${session?.wsManager?.isConnected?.value}`);
    if (session && session.wsManager && session.wsManager.isConnected.value) {
      console.log(`[getActiveWsManager] 使用第一个会话 (ID: ${firstSessionKey}) 的 WebSocket。`);
      return session.wsManager;
    }
  }

  console.log('[getActiveWsManager] 第一个会话的 WebSocket 不可用或不存在，开始遍历所有会话...');
  for (const [sessionId, session] of sessions.value) {
    console.log(`[getActiveWsManager]   遍历中 - 检查会话 ID: ${sessionId}, WS Manager 存在: ${!!session.wsManager}, WS 已连接: ${session.wsManager?.isConnected?.value}`);
    if (session.wsManager && session.wsManager.isConnected.value) {
      console.log(`[getActiveWsManager]   遍历成功，使用会话 (ID: ${sessionId}) 的 WebSocket。`);
      return session.wsManager;
    }
  }

  console.warn('[getActiveWsManager] 遍历结束，仍未找到可用的 WebSocket 连接来发送 SSH 挂起相关请求。');
  return null;
};


/**
 * 请求启动 SSH 会话挂起
 * @param sessionId 要挂起的活动会话 ID
 */
export const requestStartSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      console.warn(`[${t('term.sshSuspend')}] WebSocket 未连接，无法启动挂起模式 (会话 ID: ${sessionId})。`);
      // 可选：通知用户
      return;
    }
    const message: SshSuspendStartReqMessage = {
      type: 'SSH_SUSPEND_START',
      payload: { sessionId },
    };
    session.wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已发送 SSH_SUSPEND_START_REQ (会话 ID: ${sessionId})`);
  } else {
    console.warn(`[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法启动挂起。`);
  }
};

/**
 * 获取挂起的 SSH 会话列表 (通过 HTTP API)
 */
export const fetchSuspendedSshSessions = async (): Promise<void> => {
  isLoadingSuspendedSessions.value = true;
  try {
    // 假设后端 API 端点为 /api/ssh/suspended-sessions
    // 并且它返回 SuspendedSshSession[] 类型的数据
    const response = await apiClient.get<SuspendedSshSession[]>('ssh-suspend/suspended-sessions');
    suspendedSshSessions.value = response.data;
    console.log(`[${t('term.sshSuspend')}] 已通过 HTTP 获取挂起列表，数量: ${response.data.length}`);
  } catch (error) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP 获取挂起列表失败:`, error);
    // 可选：通知用户错误
    const uiNotificationsStore = useUiNotificationsStore();
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.fetchListError', { error: String(error) }),
    });
    // 即使失败，也可能需要清空旧数据或保留旧数据，具体取决于产品需求
    // suspendedSshSessions.value = []; // 例如，失败时清空
  } finally {
    isLoadingSuspendedSessions.value = false;
  }
};

/**
 * 请求恢复指定的挂起 SSH 会话
 * @param suspendSessionId 要恢复的挂起会话的 ID
 */
export const resumeSshSession = (suspendSessionId: string): void => {
  const wsManager = getActiveWsManager();
  if (wsManager) {
    const newFrontendSessionId = uuidv4(); // 为恢复的会话生成新的前端 ID
    const message: SshSuspendResumeReqMessage = {
      type: 'SSH_SUSPEND_RESUME_REQUEST',
      payload: { suspendSessionId, newFrontendSessionId },
    };
    wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已发送 SSH_SUSPEND_RESUME_REQ (挂起 ID: ${suspendSessionId}, 新前端 ID: ${newFrontendSessionId})`);
  } else {
    console.warn(`[${t('term.sshSuspend')}] 恢复会话失败 (挂起 ID: ${suspendSessionId})：无可用 WebSocket 连接。`);
  }
};

/**
 * 请求终止并移除一个活跃的挂起 SSH 会话
 * @param suspendSessionId 要终止并移除的挂起会话 ID
 */
export const terminateAndRemoveSshSession = async (suspendSessionId: string): Promise<void> => {
  console.log(`[${t('term.sshSuspend')}] 请求通过 HTTP API 终止并移除挂起会话 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 返回成功时状态码为 200/204，失败时返回错误信息
    await apiClient.delete(`ssh-suspend/terminate/${suspendSessionId}`);
    console.log(`[${t('term.sshSuspend')}] HTTP API 终止并移除会话 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendTerminatedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 终止并移除会话 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求移除一个已断开的挂起 SSH 会话条目
 * @param suspendSessionId 要移除的挂起会话条目 ID
 */
export const removeSshSessionEntry = async (suspendSessionId: string): Promise<void> => {
  console.log(`[${t('term.sshSuspend')}] 请求通过 HTTP API 移除已断开的挂起条目 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    await apiClient.delete(`ssh-suspend/entry/${suspendSessionId}`);
    console.log(`[${t('term.sshSuspend')}] HTTP API 移除已断开条目 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendEntryRemovedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 移除已断开条目 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求编辑挂起 SSH 会话的自定义名称
 * @param suspendSessionId 要编辑的挂起会话 ID
 * @param customName 新的自定义名称
 */
export const editSshSessionName = (suspendSessionId: string, customName: string): void => {
  const wsManager = getActiveWsManager();
  if (wsManager) {
    const message: SshSuspendEditNameReqMessage = {
      type: 'SSH_SUSPEND_EDIT_NAME',
      payload: { suspendSessionId, customName },
    };
    wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已发送 SSH_SUSPEND_EDIT_NAME_REQ (挂起 ID: ${suspendSessionId}, 名称: "${customName}")`);
  } else {
     console.warn(`[${t('term.sshSuspend')}] 编辑挂起名称失败 (挂起 ID: ${suspendSessionId})：无可用 WebSocket 连接。`);
  }
};

// --- S2C Message Handlers ---

const handleSshSuspendStartedResp = (payload: SshSuspendStartedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_STARTED_RESP:`, payload);
  if (payload.success) {
    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.suspendStartedSuccess', { id: payload.suspendSessionId.slice(0, 8) }),
    });
    // 成功后关闭原会话标签页
    closeSessionAction(payload.frontendSessionId);
    // 刷新挂起列表 (可选，或者等待列表更新通知)
    fetchSuspendedSshSessions();
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.suspendStartedError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 挂起失败 (前端会话 ID: ${payload.frontendSessionId}): ${payload.error}`);
  }
};

const handleSshSuspendListResponse = (payload: SshSuspendListResponsePayload): void => {
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_LIST_RESPONSE，数量: ${payload.suspendSessions.length}`);
  suspendedSshSessions.value = payload.suspendSessions;
  isLoadingSuspendedSessions.value = false;
};

const handleSshSuspendResumedNotif = async (payload: SshSuspendResumedNotifPayload): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  const connectionsStore = useConnectionsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_RESUMED_NOTIF:`, payload);

  if (payload.success) {
    const suspendedSession = suspendedSshSessions.value.find(s => s.suspendSessionId === payload.suspendSessionId);
    if (!suspendedSession) {
      console.error(`[${t('term.sshSuspend')}] 找不到要恢复的挂起会话信息 (ID: ${payload.suspendSessionId})`);
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorInfoNotFound', { id: payload.suspendSessionId.slice(0, 8) }),
      });
      return;
    }

    // 从 connectionsStore 获取原始连接信息
    // 注意：这里假设 suspendedSession.originalConnectionInfo 存储了足够的信息，或者至少有 originalConnectionId
    const connectionToFindId = parseInt(suspendedSession.connectionId, 10);
    const connectionInfo = connectionsStore.connections.find(conn => conn.id === connectionToFindId);
    if (!connectionInfo) {
        console.error(`[${t('term.sshSuspend')}] 恢复会话失败：找不到原始连接配置 (ID: ${suspendedSession.connectionId})`);
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', { id: suspendedSession.connectionId }),
        });
        return;
    }

    try {
      // 使用 openNewSession 创建会话
      openNewSession(
        connectionInfo.id, // connectionId
        { connectionsStore, t }, // dependencies
        payload.newFrontendSessionId // existingSessionId
      );

      // 获取新创建的会话
      const newSession = sessions.value.get(payload.newFrontendSessionId) as SessionState | undefined;

      if (newSession && newSession.wsManager) {
        // 标记会话为正在恢复
        newSession.isResuming = true;
        // (可选) 如果需要存储原始挂起ID，可以在 SessionState 中添加 originalSuspendId 字段并在此设置
        // newSession.originalSuspendId = payload.suspendSessionId;

        console.log(`[${t('term.sshSuspend')}] 为恢复的会话 (新前端 ID: ${payload.newFrontendSessionId}) 创建/复用了新的会话实例。`);
        // 激活新标签页
        activateSessionAction(payload.newFrontendSessionId);
        uiNotificationsStore.addNotification({
          type: 'success',
          message: t('sshSuspend.notifications.resumeSuccess', { name: suspendedSession.customSuspendName || suspendedSession.connectionName }),
        });
        // 后端会开始发送 SSH_OUTPUT_CACHED_CHUNK
      } else {
        throw new Error('通过 openNewSession 创建或获取新会话实例失败，或 WebSocket 管理器未初始化。');
      }
    } catch (error) {
      console.error(`[${t('term.sshSuspend')}] 处理会话恢复通知时出错:`, error);
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', { error: String(error) }),
      });
    }
    // 成功恢复后，从挂起列表中移除 (或者等 SSH_SUSPEND_ENTRY_REMOVED_RESP)
    // fetchSuspendedSshSessions(); // 刷新列表
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.resumeErrorBackend', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 恢复会话失败 (挂起 ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

const handleSshOutputCachedChunk = (payload: SshOutputCachedChunkPayload): void => {
  const session = sessions.value.get(payload.frontendSessionId) as SessionState | undefined;
  if (session && session.terminalManager && session.terminalManager.terminalInstance.value) { // 检查 terminalInstance.value
    // console.debug(`[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) 接到 SSH_OUTPUT_CACHED_CHUNK, isLast: ${payload.isLastChunk}`);
    session.terminalManager.terminalInstance.value.write(payload.data); // 调用 terminalInstance.value.write
    if (payload.isLastChunk) {
      console.log(`[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) 已接收所有缓存输出。`);
      // 可选：在这里触发一个事件或状态，表明缓存输出已加载完毕
      // 例如，如果之前终端是只读/加载状态，现在可以解除
      if (session.isResuming === true) {
        session.isResuming = false;
         // 可能需要重新聚焦终端或进行其他 UI 更新
      }
    }
  } else {
    console.warn(`[${t('term.sshSuspend')}] 收到缓存数据块，但找不到对应会话、终端管理器或终端实例 (ID: ${payload.frontendSessionId})`);
  }
};

const handleSshSuspendTerminatedResp = (payload: SshSuspendTerminatedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_TERMINATED_RESP:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === payload.suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 终止挂起会话失败 (ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

const handleSshSuspendEntryRemovedResp = (payload: SshSuspendEntryRemovedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_ENTRY_REMOVED_RESP:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === payload.suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 移除挂起条目失败 (ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

const handleSshSuspendNameEditedResp = (payload: SshSuspendNameEditedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_NAME_EDITED_RESP:`, payload);
  if (payload.success && payload.customName !== undefined) {
    const session = suspendedSshSessions.value.find(s => s.suspendSessionId === payload.suspendSessionId);
    if (session) {
      session.customSuspendName = payload.customName;
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.nameEditedSuccess', { name: payload.customName }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.nameEditedError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 编辑挂起名称失败 (ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

const handleSshSuspendAutoTerminatedNotif = (payload: SshSuspendAutoTerminatedNotifPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_AUTO_TERMINATED_NOTIF:`, payload);
  const session = suspendedSshSessions.value.find(s => s.suspendSessionId === payload.suspendSessionId);
  if (session) {
    session.backendSshStatus = 'disconnected_by_backend'; // 使用正确的字段名
    session.disconnectionTimestamp = new Date().toISOString(); // 更新为 ISO 字符串
    // 可以在 SuspendedSshSession 类型中添加 disconnectionReason 字段
    // session.disconnectionReason = payload.reason;
    uiNotificationsStore.addNotification({
      type: 'warning',
      message: t('sshSuspend.notifications.autoTerminated', { name: session.customSuspendName || session.connectionName, reason: payload.reason }),
    });
  }
};

/**
 * 注册 SSH 挂起相关的 WebSocket 消息处理器。
 * 此函数应在 WebSocket 连接建立后，针对每个会话的 wsManager 实例调用。
 * @param wsManager 与特定 SSH 会话关联的 WebSocket 管理器实例
 */
export const registerSshSuspendHandlers = (wsManager: WsManagerInstance): void => {
  console.log(`[${t('term.sshSuspend')}] 尝试为 WebSocket 管理器注册 SSH 挂起处理器...`);

  if (!wsManager) {
    console.error(`[${t('term.sshSuspend')}] 注册处理器失败：wsManager 未定义。`);
    return;
  }

  // 注意：wsManager.onMessage 返回一个注销函数，如果需要，可以收集它们并在会话关闭时调用。
  // 但通常这些处理器会随 wsManager 实例的生命周期一起存在。
  wsManager.onMessage('SSH_SUSPEND_STARTED_RESP', (p: MessagePayload) => handleSshSuspendStartedResp(p as SshSuspendStartedRespPayload));
  wsManager.onMessage('SSH_SUSPEND_LIST_RESPONSE', (p: MessagePayload) => handleSshSuspendListResponse(p as SshSuspendListResponsePayload));
  wsManager.onMessage('SSH_SUSPEND_RESUMED_NOTIF', (p: MessagePayload) => handleSshSuspendResumedNotif(p as SshSuspendResumedNotifPayload));
  wsManager.onMessage('SSH_OUTPUT_CACHED_CHUNK', (p: MessagePayload) => handleSshOutputCachedChunk(p as SshOutputCachedChunkPayload));
  wsManager.onMessage('SSH_SUSPEND_TERMINATED_RESP', (p: MessagePayload) => handleSshSuspendTerminatedResp(p as SshSuspendTerminatedRespPayload));
  wsManager.onMessage('SSH_SUSPEND_ENTRY_REMOVED_RESP', (p: MessagePayload) => handleSshSuspendEntryRemovedResp(p as SshSuspendEntryRemovedRespPayload));
  wsManager.onMessage('SSH_SUSPEND_NAME_EDITED_RESP', (p: MessagePayload) => handleSshSuspendNameEditedResp(p as SshSuspendNameEditedRespPayload));
  wsManager.onMessage('SSH_SUSPEND_AUTO_TERMINATED_NOTIF', (p: MessagePayload) => handleSshSuspendAutoTerminatedNotif(p as SshSuspendAutoTerminatedNotifPayload));

  console.log(`[${t('term.sshSuspend')}] SSH 挂起模式的 WebSocket 消息处理器已注册。`);

  // 连接建立后，主动获取一次挂起列表
  // 考虑：是否应该在这里做，或者在应用启动时做一次？
  // 如果 wsManager 是针对某个具体会话的，那么每个会话连接时都获取列表可能不是最优。
  // 更好的地方可能是在 App.vue 或主会话 store 初始化时，通过一个“全局”的 wsManager (如果存在) 或其中一个 wsManager 获取。
  // 但如果挂起列表只通过当前连接的 ws 通道获取，那这里是合适的。
  // 假设 getActiveWsManager 能取到这个 wsManager 实例，那 actions.ts 里的 fetchSuspendedSshSessions() 会用它
  // 这里直接调用 fetchSuspendedSshSessions() 也可以
  fetchSuspendedSshSessions();
};