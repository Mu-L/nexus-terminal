
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '../utils/apiClient';

interface Props {
  visible: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['update:visible']);
const { t } = useI18n();

// --- 新增：文件传输相关 ---

// 数据结构参考
interface TransferSubTask {
  subTaskId: string;
  connectionId: number;
  sourceItemName: string;
  status: 'queued' | 'connecting' | 'transferring' | 'completed' | 'failed';
  progress?: number; // 0-100
  message?: string;
  transferMethodUsed?: 'rsync' | 'scp';
}

interface TransferTask {
  taskId: string;
  status: 'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed';
  createdAt: string | Date;
  updatedAt: string | Date;
  subTasks: TransferSubTask[];
  overallProgress?: number;
}

const transferTasks = ref<TransferTask[]>([]);
const isLoading = ref(false);
const errorLoading = ref<string | null>(null);
const pollingIntervalId = ref<number | null>(null);

const fetchTransferTasks = async () => {
  isLoading.value = true;
  errorLoading.value = null;
  try {
    // 假设后端API路径为 /api/v1/transfers/status，且返回数据结构为 { data: TransferTask[] }
    // 请根据实际API调整这里的类型和数据访问
    const response = await apiClient.get<{ data: TransferTask[] }>('/transfers/status');
    transferTasks.value = Array.isArray(response.data.data) ? response.data.data : (Array.isArray(response.data) ? response.data : []);
  } catch (error: any) {
    console.error("Failed to fetch transfer tasks:", error);
    errorLoading.value = error.response?.data?.message || error.message || t('transferProgressModal.error.unknown', '未知错误');
  } finally {
    isLoading.value = false;
  }
};

const getDisplayStatus = (status: string): string => {
  const statusKeyMap: Record<string, string> = {
    'queued': 'transferProgressModal.status.queued',
    'in-progress': 'transferProgressModal.status.inProgress',
    'completed': 'transferProgressModal.status.completed',
    'failed': 'transferProgressModal.status.failed',
    'partially-completed': 'transferProgressModal.status.partiallyCompleted',
    'connecting': 'transferProgressModal.status.connecting',
    'transferring': 'transferProgressModal.status.transferring',
  };
  // 提供一个默认的回退文本，以防i18n key缺失
  const defaultText = status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
  return t(statusKeyMap[status] || `status.${status}`, defaultText);
};

const formatDate = (dateInput: string | Date): string => {
  if (!dateInput) return '';
  try {
    return new Date(dateInput).toLocaleString(navigator.language, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) {
    return String(dateInput); // Fallback if date is invalid
  }
};

onMounted(() => {
  if (props.visible) {
    fetchTransferTasks();
    if (pollingIntervalId.value === null) {
       pollingIntervalId.value = window.setInterval(fetchTransferTasks, 5000);
    }
  }
});

onUnmounted(() => {
  if (pollingIntervalId.value !== null) {
    clearInterval(pollingIntervalId.value);
    pollingIntervalId.value = null;
  }
});

watch(() => props.visible, (newVisible) => {
  // internalVisible.value = newVisible; // 由下面的watch处理
  if (newVisible) {
    fetchTransferTasks(); // 模态框可见时立即获取一次数据
    if (pollingIntervalId.value === null) { // 只有在没有定时器时才启动
      pollingIntervalId.value = window.setInterval(fetchTransferTasks, 5000);
    }
  } else {
    if (pollingIntervalId.value !== null) {
      clearInterval(pollingIntervalId.value);
      pollingIntervalId.value = null;
    }
  }
}, { immediate: false }); // immediate: false 避免在组件初始化时立即执行，onMounted已处理首次加载

// --- 原有：模态框可见性控制 ---
const internalVisible = ref(props.visible);

// 监听 props.visible 的变化来更新 internalVisible
watch(() => props.visible, (newVisibleValue) => {
  internalVisible.value = newVisibleValue;
}, { immediate: true }); // 确保初始状态同步

// 监听 internalVisible 的变化来 emit update:visible
watch(internalVisible, (newVal) => {
  if (newVal !== props.visible) {
    emit('update:visible', newVal);
  }
});

const handleClose = () => {
  internalVisible.value = false;
};

</script>

<template>
  <div
    v-if="internalVisible"
    class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"
    @click.self="handleClose"
  >
    <div class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-3xl max-h-[85vh] flex flex-col">
      <!-- Header -->
      <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">
        {{ t('transferProgressModal.title', '文件传输进度') }}
      </h3>

      <!-- Content Area -->
      <div class="flex-grow overflow-y-auto mb-6 pr-2 space-y-4 custom-scrollbar">
        <div v-if="isLoading && transferTasks.length === 0" class="text-center text-text-secondary py-10">
          <svg class="animate-spin h-8 w-8 text-primary mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ t('transferProgressModal.loading', '正在加载传输任务...') }}
        </div>
        <div v-else-if="errorLoading" class="text-center text-red-500 bg-red-50 p-4 rounded-md">
          <p class="font-semibold">{{ t('transferProgressModal.errorLoadingTitle', '加载错误') }}</p>
          <p>{{ t('transferProgressModal.errorLoading', { error: errorLoading }) }}</p>
        </div>
        <div v-else-if="!isLoading && transferTasks.length === 0" class="text-center text-text-secondary py-10">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {{ t('transferProgressModal.noTasks', '当前没有活动的传输任务。') }}
        </div>
        <div v-else class="space-y-3">
          <div v-for="task in transferTasks" :key="task.taskId" class="bg-background-alt p-3 rounded-lg border border-border-alt shadow-sm hover:shadow-md transition-shadow">
            <div class="flex justify-between items-start mb-2">
              <div>
                <span class="font-semibold text-md block">{{ t('transferProgressModal.task.idLabel', '任务') }}: {{ task.taskId }}</span>
                <span class="text-xs text-text-muted">{{ t('transferProgressModal.task.createdAt', '创建于') }}: {{ formatDate(task.createdAt) }}</span>
              </div>
              <span :class="['px-2.5 py-1 text-xs font-semibold rounded-full',
                { 'bg-green-100 text-green-700': task.status === 'completed' },
                { 'bg-red-100 text-red-700': task.status === 'failed' },
                { 'bg-yellow-100 text-yellow-700': task.status === 'partially-completed' || task.status === 'queued' },
                { 'bg-blue-100 text-blue-700': task.status === 'in-progress' }
              ]">
                {{ getDisplayStatus(task.status) }}
              </span>
            </div>

            <div v-if="task.overallProgress !== undefined" class="mb-2">
              <div class="flex justify-between text-xs text-text-secondary mb-0.5">
                <span>{{ t('transferProgressModal.task.overallProgress', '整体进度') }}</span>
                <span>{{ task.overallProgress }}%</span>
              </div>
              <div class="w-full bg-border rounded-full h-1.5">
                <div class="bg-primary h-1.5 rounded-full" :style="{ width: task.overallProgress + '%' }"></div>
              </div>
            </div>

            <details v-if="task.subTasks && task.subTasks.length > 0" class="mt-2 group">
              <summary class="text-xs font-medium text-primary hover:underline cursor-pointer list-none">
                {{ t('transferProgressModal.subTasks.titleToggle', { count: task.subTasks.length }) }}
                <span class="group-open:hidden">+</span><span class="hidden group-open:inline">-</span>
              </summary>
              <ul class="mt-2 space-y-1.5 pl-3 border-l border-border-alt ml-1">
                <li v-for="subTask in task.subTasks" :key="subTask.subTaskId" class="text-xs p-1.5 rounded bg-background border border-border-alt/50">
                  <p><strong>{{ t('transferProgressModal.subTask.source', '源文件') }}:</strong> {{ subTask.sourceItemName }}</p>
                  <p><strong>{{ t('transferProgressModal.subTask.connectionId', '目标连接') }}:</strong> {{ subTask.connectionId }}</p>
                  <p><strong>{{ t('transferProgressModal.subTask.status', '状态') }}:</strong> {{ getDisplayStatus(subTask.status) }}
                    <span v-if="subTask.progress !== undefined"> ({{ subTask.progress }}%)</span>
                  </p>
                  <p v-if="subTask.transferMethodUsed"><strong>{{ t('transferProgressModal.subTask.method', '方法') }}:</strong> {{ subTask.transferMethodUsed }}</p>
                  <p v-if="subTask.status === 'failed' && subTask.message" class="text-red-600">
                    <strong>{{ t('transferProgressModal.subTask.error', '错误') }}:</strong> {{ subTask.message }}
                  </p>
                </li>
              </ul>
            </details>
            <div v-else-if="task.subTasks && task.subTasks.length === 0" class="mt-2 text-xs text-text-muted">
               {{ t('transferProgressModal.subTasks.noSubTasks', '没有子任务。') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end items-center pt-4 mt-auto flex-shrink-0 border-t border-border">
        <button
          @click="handleClose"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
        >
          {{ t('common.close', '关闭') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-overlay {
  background-color: rgba(0, 0, 0, 0.6); /* Slightly darker overlay */
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.3);
  border-radius: 10px;
  border: 2px solid transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(128, 128, 128, 0.5);
}

/* For Firefox */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
}
</style>
