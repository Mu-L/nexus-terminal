<template>
  <div class="suspended-ssh-sessions-view p-2 flex flex-col h-full">
    <div class="view-header mb-2">
      <div class="relative w-full">
        <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <i class="fas fa-search text-text-secondary"></i>
        </span>
        <input
          type="text"
          v-model="searchTerm"
          :placeholder="$t('suspendedSshSessions.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-2 border border-border rounded-md bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          @input="filterSessions"
        />
      </div>
      <!-- 可选：显示挂起会话总数 -->
      <!-- <div class="text-sm text-gray-500 mt-1">
        当前挂起会话总数: {{ filteredSessions.length }} / {{ allSuspendedSshSessions.length }}
      </div> -->
    </div>

    <div class="session-list-container flex-grow overflow-y-auto">
      <div v-if="isLoading" class="text-center p-4">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>{{ $t('suspendedSshSessions.loading') }}</p>
      </div>
      <div v-else-if="filteredSessions.length === 0 && !isLoading" class="text-center p-4">
        <p>{{ $t('suspendedSshSessions.noResults') }}</p>
      </div>
      <ul v-else class="list-none p-0 m-0">
        <li
          v-for="session in filteredSessions"
          :key="session.suspendSessionId"
          class="session-item p-3 mb-2 border rounded-md bg-surface-ground"
          :class="{ 'opacity-60': session.backendSshStatus === 'disconnected_by_backend' }"
        >
          <div class="flex justify-between items-center">
            <div class="session-info flex-grow mr-2">
              <div class="font-bold text-lg">
                <span
                  v-if="!session.isEditingName"
                  class="cursor-pointer hover:text-primary"
                  :title="$t('suspendedSshSessions.tooltip.editName')"
                  @click="startEditingName(session)"
                >
                  {{ session.customSuspendName || session.connectionName }}
                </span>
                <input
                  v-else
                  v-model="session.editingNameValue"
                  type="text"
                  class="text-lg font-bold w-full px-1 py-0.5 border border-primary rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  autofocus
                  @blur="finishEditingName(session)"
                  @keydown.enter.prevent="finishEditingName(session)"
                  @keydown.esc.prevent="cancelEditingName(session)"
                />
              </div>
              <div class="text-sm text-muted-color">
                {{ $t('suspendedSshSessions.label.originalConnection') }}: {{ session.connectionName }}
              </div>
              <div class="text-xs text-muted-color mt-1">
                {{ $t('suspendedSshSessions.label.suspendedAt') }}: {{ formatDateTime(session.suspendStartTime) }}
              </div>
              <div
                v-if="session.backendSshStatus === 'disconnected_by_backend' && session.disconnectionTimestamp"
                class="text-xs text-orange-500 mt-1"
              >
                {{ $t('suspendedSshSessions.disconnectedAt', { time: formatDateTime(session.disconnectionTimestamp) }) }}
              </div>
            </div>

            <div class="session-status-actions flex flex-col items-end space-y-2">
              <span
                :class="[
                  'px-2 py-1 text-xs font-semibold rounded-full',
                  session.backendSshStatus === 'hanging' ? 'bg-green-100 text-green-700 dark:bg-green-700 dark:text-green-100' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700 dark:text-yellow-100'
                ]"
              >
                {{ session.backendSshStatus === 'hanging' ? $t('suspendedSshSessions.status.hanging') : $t('suspendedSshSessions.status.disconnected') }}
              </span>
              <div class="actions flex space-x-2">
                <button
                  v-if="session.backendSshStatus === 'hanging'"
                  @click="resumeSession(session)"
                  :title="$t('suspendedSshSessions.action.resume')"
                  class="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-150 inline-flex items-center"
                >
                  <i class="fas fa-play mr-1.5"></i>
                  {{ $t('suspendedSshSessions.action.resume') }}
                </button>
                <button
                  @click="removeSession(session)"
                  :title="$t('suspendedSshSessions.action.remove')"
                  class="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-150 inline-flex items-center"
                >
                  <i class="fas fa-trash-alt mr-1.5"></i>
                  {{ $t('suspendedSshSessions.action.remove') }}
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia'; // +++ 导入 storeToRefs +++
// PrimeVue components (InputText, Button, Tag) are assumed to be globally registered
// based on the structure of other views like QuickCommandsView.vue
// and the nature of the 'Cannot find module' errors which might indicate
// they are not meant to be imported directly here if globally available.

// 假设 sessionStore 存在并且有以下类型和方法
import { useSessionStore } from '../stores/session.store'; // 使用真实的 store
import type { SuspendedSshSession } from '../types/ssh-suspend.types'; // 确保 SuspendedSshSession 类型从正确的位置导入

const { t } = useI18n();
// 模拟类型，实际应从 ssh-suspend.types.ts 导入 (保持这个类型扩展)
interface SuspendedSshSessionUIData extends SuspendedSshSession {
  isEditingName?: boolean;
  editingNameValue?: string;
}


// // 模拟 sessionStore (注释掉)
// const mockSessionStore = {
//   suspendedSshSessions: ref<SuspendedSshSessionUIData[]>([
//     // ... mock data ...
//   ]),
//   fetchSuspendedSshSessions: async () => {
//     console.log('[SuspendedSshSessionsView] Requesting suspended SSH sessions...');
//     // 模拟 API 调用延迟
//     return new Promise(resolve => setTimeout(() => {
//        mockSessionStore.suspendedSshSessions.value = [
//         // ... mock data ...
//       ];
//       isLoading.value = false;
//       console.log('[SuspendedSshSessionsView] Mock sessions loaded:', mockSessionStore.suspendedSshSessions.value);
//       resolve(true);
//     }, 1500));
//   },
//   resumeSshSession: async (suspendSessionId: string, newFrontendSessionId: string) => {
//     console.log(`[SuspendedSshSessionsView] Action: resumeSshSession(${suspendSessionId}, ${newFrontendSessionId})`);
//     alert(`模拟恢复会话: ${suspendSessionId}`);
//   },
//   terminateAndRemoveSshSession: async (suspendSessionId: string) => {
//     console.log(`[SuspendedSshSessionsView] Action: terminateAndRemoveSshSession(${suspendSessionId})`);
//     mockSessionStore.suspendedSshSessions.value = mockSessionStore.suspendedSshSessions.value.filter(s => s.suspendSessionId !== suspendSessionId);
//     alert(`模拟终止并移除会话: ${suspendSessionId}`);
//   },
//   removeSshSessionEntry: async (suspendSessionId: string) => {
//     console.log(`[SuspendedSshSessionsView] Action: removeSshSessionEntry(${suspendSessionId})`);
//     mockSessionStore.suspendedSshSessions.value = mockSessionStore.suspendedSshSessions.value.filter(s => s.suspendSessionId !== suspendSessionId);
//     alert(`模拟移除已断开会话条目: ${suspendSessionId}`);
//   },
//   editSshSessionName: async (suspendSessionId: string, newName: string) => {
//     console.log(`[SuspendedSshSessionsView] Action: editSshSessionName(${suspendSessionId}, ${newName})`);
//     const session = mockSessionStore.suspendedSshSessions.value.find(s => s.suspendSessionId === suspendSessionId);
//     if (session) {
//       session.customSuspendName = newName;
//     }
//     alert(`模拟编辑名称: ${suspendSessionId} -> ${newName}`);
//   },
// };
const sessionStore = useSessionStore(); // 使用真实的 store
// const sessionStore = mockSessionStore; // 使用模拟 store (注释掉)

// +++ 使用 storeToRefs 获取响应式状态，并将 isLoadingSuspendedSessions 重命名为 isLoading +++
const { suspendedSshSessions: storeSuspendedSshSessions, isLoadingSuspendedSessions: isLoading } = storeToRefs(sessionStore);

const searchTerm = ref('');
// const isLoading = ref(true); // 现在从 store 的 isLoading 获取

const allSuspendedSshSessions = computed(() => storeSuspendedSshSessions.value.map((s: SuspendedSshSession) => ({ // 显式为 s 添加类型
  ...(s as SuspendedSshSessionUIData), // 断言为包含 UI 状态的类型
  isEditingName: (s as SuspendedSshSessionUIData).isEditingName ?? false,
  editingNameValue: (s as SuspendedSshSessionUIData).editingNameValue ?? s.customSuspendName ?? s.connectionName,
})));

const filteredSessions = computed(() => {
  if (!searchTerm.value.trim()) {
    return allSuspendedSshSessions.value; // allSuspendedSshSessions 已经是 .value 之后的结果
  }
  const lowerSearchTerm = searchTerm.value.toLowerCase();
  return allSuspendedSshSessions.value.filter((session: SuspendedSshSessionUIData) => // 为 session 添加类型
    (session.customSuspendName?.toLowerCase() || '').includes(lowerSearchTerm) ||
    session.connectionName.toLowerCase().includes(lowerSearchTerm)
  );
});

const filterSessions = () => {
  // 计算属性会自动处理过滤
};

const formatDateTime = (isoString?: string) => {
  if (!isoString) return t('time.unknown');
  try {
    return new Date(isoString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return t('time.invalidDate');
  }
};

const startEditingName = (session: SuspendedSshSessionUIData) => {
  // 确保同一时间只有一个会话处于编辑状态（可选优化）
  allSuspendedSshSessions.value.forEach((s: SuspendedSshSessionUIData) => s.isEditingName = false); // 为 s 添加类型
  session.isEditingName = true;
  session.editingNameValue = session.customSuspendName || session.connectionName;
};

const finishEditingName = (session: SuspendedSshSessionUIData) => {
  if (!session.isEditingName) return;
  session.isEditingName = false;
  const newName = session.editingNameValue?.trim();
  // 仅当名称有变化且不为空时才提交
  if (newName && newName !== (session.customSuspendName || session.connectionName)) {
    sessionStore.editSshSessionName(session.suspendSessionId, newName);
  } else {
    // 如果名称未变或变为空，则恢复显示原始值或之前的自定义名
     session.editingNameValue = session.customSuspendName || session.connectionName;
  }
};

const cancelEditingName = (session: SuspendedSshSessionUIData) => {
  session.isEditingName = false;
  session.editingNameValue = session.customSuspendName || session.connectionName; // 恢复原值
};


const resumeSession = (session: SuspendedSshSessionUIData) => {
  // 实际应用中，newFrontendSessionId 可能需要由 sessionStore 或其他服务生成
  // const newFrontendSessionId = `new-session-${Date.now()}`; // newFrontendSessionId 由 action 内部生成
  sessionStore.resumeSshSession(session.suspendSessionId); // +++ 只传递 suspendSessionId +++
};

const removeSession = (session: SuspendedSshSessionUIData) => {
  if (session.backendSshStatus === 'hanging') {
    sessionStore.terminateAndRemoveSshSession(session.suspendSessionId);
  } else if (session.backendSshStatus === 'disconnected_by_backend') {
    sessionStore.removeSshSessionEntry(session.suspendSessionId);
  }
};

onMounted(async () => {
  // isLoading.value = true; // storeIsLoading 会自动更新
  await sessionStore.fetchSuspendedSshSessions();
  // isLoading.value = false; // fetchSuspendedSshSessions 内部应更新 storeIsLoading
});

</script>

<style scoped>
.suspended-ssh-sessions-view {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
}

.session-item {
  transition: background-color 0.2s ease-in-out;
}
.session-item:hover {
  background-color: var(--surface-hover); /* PrimeVue hover color */
}

/* 保持与 QuickCommandsView 类似的简洁风格 */
.p-inputtext-sm {
  padding: 0.375rem 0.5rem; /* 调整输入框大小 */
  font-size: 0.875rem;
}
</style>