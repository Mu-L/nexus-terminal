// packages/frontend/src/stores/session/getters.ts

import { computed } from 'vue';
import { sessions, activeSessionId } from './state';
import type { SessionState, SessionTabInfoWithStatus } from './types';

export const sessionTabs = computed(() => {
  return Array.from(sessions.value.values()).map(session => ({
    sessionId: session.sessionId,
    connectionName: session.connectionName,
  }));
});

// 包含状态的标签页信息
export const sessionTabsWithStatus = computed((): SessionTabInfoWithStatus[] => {
  return Array.from(sessions.value.values()).map(session => ({
    sessionId: session.sessionId,
    connectionName: session.connectionName,
    status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
    isMarkedForSuspend: session.isMarkedForSuspend, 
  }));
});

export const activeSession = computed((): SessionState | null => {
  if (!activeSessionId.value) return null;
  return sessions.value.get(activeSessionId.value) || null;
});