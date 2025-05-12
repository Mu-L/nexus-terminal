<template>
  <!-- 根元素，包含内边距、背景、边框和文本样式 -->
  <div class="status-monitor p-4 bg-background text-foreground h-full overflow-y-auto text-sm">
    <!-- 标题，包含外边距、边框、内边距、字体大小和颜色 -->
    <h4 class="mt-0 mb-4 border-b border-border pb-2 text-base font-medium">
      {{ t('statusMonitor.title') }}
    </h4>

    <!-- 错误状态 -->
    <div v-if="statusError" class="status-error flex flex-col items-center justify-center text-center text-red-500 mt-4 h-full">
       <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
       <span>{{ t('statusMonitor.errorPrefix') }} {{ statusError }}</span>
    </div>

    <!-- 加载状态 -->
    <div v-else-if="!serverStatus" class="loading-status flex flex-col items-center justify-center text-center text-text-secondary mt-4 h-full">
      <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
      <span>{{ t('statusMonitor.loading') }}</span>
    </div>

    <!-- 状态网格 -->
    <div v-else class="status-grid grid gap-3">
      <!-- CPU 型号 -->
      <div class="status-item grid grid-cols-[auto_1fr] items-center gap-3">
        <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.cpuModelLabel') }}</label>
        <span class="cpu-model-value truncate text-left" :title="displayCpuModel">{{ displayCpuModel }}</span>
      </div>

      <!-- 操作系统名称 -->
      <div class="status-item grid grid-cols-[auto_1fr] items-center gap-3">
        <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.osLabel') }}</label>
        <span class="os-name-value truncate text-left" :title="displayOsName">{{ displayOsName }}</span>
      </div>

      <!-- 资源使用率分组 -->
      <div class="resource-monitor-group grid gap-3 mb-3">
        <!-- CPU 使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.cpuLabel') }}</label>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-bar-container bg-header rounded h-3 overflow-hidden flex-grow"> <!-- 减小高度 -->
              <div class="progress-bar bg-blue-500 h-full transition-width duration-300 ease-in-out" :style="{ width: `${serverStatus.cpuPercent ?? 0}%` }"></div>
            </div>
            <!-- 移除 w-12 和 text-right 以实现左对齐 -->
            <span class="font-mono text-left text-xs">{{ serverStatus.cpuPercent?.toFixed(1) ?? t('statusMonitor.notAvailable') }}%</span>
          </div>
        </div>

        <!-- 内存使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.memoryLabel') }}</label>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-bar-container bg-header rounded h-3 overflow-hidden flex-grow">
              <div class="progress-bar bg-green-500 h-full transition-width duration-300 ease-in-out" :style="{ width: `${serverStatus.memPercent ?? 0}%` }"></div>
            </div>
            <span class="mem-disk-details font-mono text-xs whitespace-nowrap text-left">{{ memDisplay }}</span>
          </div>
        </div>

         <!-- swap -->
         <!-- 设置第一列固定宽度为 80px -->
         <div class="status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.swapLabel') }}</label>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-bar-container bg-header rounded h-3 overflow-hidden flex-grow">
              <!-- swap颜色 -->
              <div class="progress-bar h-full transition-width duration-300 ease-in-out"
                   :class="serverStatus?.swapPercent && serverStatus.swapPercent > 0 ? 'bg-yellow-500' : 'bg-gray-500'"
                   :style="{ width: `${serverStatus?.swapPercent ?? 0}%` }"></div>
            </div>
            <span class="mem-disk-details font-mono text-xs whitespace-nowrap text-left">{{ swapDisplay }}</span>
          </div>
        </div>

        <!-- 磁盘使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.diskLabel') }}</label>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-bar-container bg-header rounded h-3 overflow-hidden flex-grow">
              <div class="progress-bar bg-purple-500 h-full transition-width duration-300 ease-in-out" :style="{ width: `${serverStatus.diskPercent ?? 0}%` }"></div>
            </div>
            <span class="mem-disk-details font-mono text-xs whitespace-nowrap text-left">{{ diskDisplay }}</span>
          </div>
        </div>
      </div>

    </div>

     <!-- 网络速率 -->
     <div class="status-item grid grid-cols-[auto_1fr] items-center gap-3 mt-2">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.networkLabel') }} ({{ serverStatus?.netInterface || '...' }}):</label>
          <div class="network-values flex items-center justify-start gap-4"> <!-- 减小间距 -->
            <span class="rate down inline-flex items-center gap-1 text-green-500 text-xs whitespace-nowrap">
              <i class="fas fa-arrow-down w-3 text-center"></i> <!-- Font Awesome 图标 -->
              <span class="font-mono">{{ formatBytesPerSecond(serverStatus?.netRxRate) }}</span>
            </span>
            <span class="rate up inline-flex items-center gap-1 text-orange-500 text-xs whitespace-nowrap">
               <i class="fas fa-arrow-up w-3 text-center"></i> <!-- Font Awesome 图标 -->
               <span class="font-mono">{{ formatBytesPerSecond(serverStatus?.netTxRate) }}</span>
            </span>
          </div>

      </div>
<!-- 图表组件 -->
      <StatusCharts :server-status="serverStatus" />
  </div>
</template>


<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import StatusCharts from './StatusCharts.vue';

const { t } = useI18n();


interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  netRxRate?: number; // 字节/秒
  netTxRate?: number; // 字节/秒
  netInterface?: string;
  osName?: string;
}

const props = defineProps<{
  sessionId: string;
  serverStatus: ServerStatus | null;
  statusError?: string | null;
}>();

// --- 缓存逻辑保持不变 ---
const cachedCpuModel = ref<string | null>(null);
const cachedOsName = ref<string | null>(null);

watch(() => props.serverStatus, (newData) => {
  if (newData) {
    if (newData.cpuModel !== undefined && newData.cpuModel !== null && newData.cpuModel !== '') {
      cachedCpuModel.value = newData.cpuModel;
    }
    if (newData.osName !== undefined && newData.osName !== null && newData.osName !== '') {
      cachedOsName.value = newData.osName;
    }
  }
}, { immediate: true });

// --- 计算属性保持不变 ---
const displayCpuModel = computed(() => {
  return (props.serverStatus?.cpuModel ?? cachedCpuModel.value) || t('statusMonitor.notAvailable');
});

const displayOsName = computed(() => {
  return (props.serverStatus?.osName ?? cachedOsName.value) || t('statusMonitor.notAvailable');
});

const formatBytesPerSecond = (bytes?: number): string => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return t('statusMonitor.notAvailable');
    if (bytes < 1024) return `${bytes} ${t('statusMonitor.bytesPerSecond')}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('statusMonitor.kiloBytesPerSecond')}`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('statusMonitor.megaBytesPerSecond')}`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ${t('statusMonitor.gigaBytesPerSecond')}`;
};

const formatKbToGb = (kb?: number): string => {
    if (kb === undefined || kb === null) return t('statusMonitor.notAvailable');
    if (kb === 0) return `0.0 ${t('statusMonitor.gigaBytes')}`;
    const gb = kb / 1024 / 1024;
    return `${gb.toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
};

// 辅助函数，用于在需要时将 MB 格式化为 GB
const formatMemorySize = (mb?: number): string => {
    if (mb === undefined || mb === null || isNaN(mb)) return t('statusMonitor.notAvailable');
    if (mb < 1024) {
        const value = Number.isInteger(mb) ? mb : mb.toFixed(1);
        return `${value} ${t('statusMonitor.megaBytes')}`;
    } else {
        const gb = mb / 1024;
        return `${gb.toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
    }
};

const memDisplay = computed(() => {
    const data = props.serverStatus;
    if (!data || data.memUsed === undefined || data.memTotal === undefined) return t('statusMonitor.notAvailable');
    const percent = data.memPercent !== undefined ? `(${(data.memPercent).toFixed(1)}%)` : ''; // 百分比保留 1 位小数
    return `${formatMemorySize(data.memUsed)} / ${formatMemorySize(data.memTotal)} ${percent}`;
});

const diskDisplay = computed(() => {
    const data = props.serverStatus;
    if (!data || data.diskUsed === undefined || data.diskTotal === undefined) return t('statusMonitor.notAvailable');
    const percent = data.diskPercent !== undefined ? `(${(data.diskPercent).toFixed(1)}%)` : ''; // 百分比保留 1 位小数
    return `${formatKbToGb(data.diskUsed)} / ${formatKbToGb(data.diskTotal)} ${percent}`;
});

const swapDisplay = computed(() => {
    const data = props.serverStatus;
    const used = data?.swapUsed ?? 0;
    const total = data?.swapTotal ?? 0;
    const percentVal = data?.swapPercent ?? 0;

    // 仅当交换空间总量 > 0 时显示详细信息
    if (total === 0) {
        return t('statusMonitor.swapNotAvailable'); // 或更具体的消息
    }

    const percent = `(${(percentVal).toFixed(1)}%)`; // 百分比保留 1 位小数
    return `${formatMemorySize(used)} / ${formatMemorySize(total)} ${percent}`;
});

</script>

