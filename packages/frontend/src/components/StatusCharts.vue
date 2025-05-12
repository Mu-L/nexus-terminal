<template>
  <div class="status-charts grid grid-cols-1 gap-4 mt-4">
    <div class="chart-container bg-header rounded p-3">
      <h5 class="text-sm font-medium mb-2 text-text-secondary">CPU 使用率</h5>
      <div class="chart-wrapper h-40">
        <Line :data="cpuChartData" :options="percentageChartOptions" :key="cpuChartKey" />
      </div>
    </div>
    <div class="chart-container bg-header rounded p-3">
      <h5 class="text-sm font-medium mb-2 text-text-secondary">内存使用率</h5>
      <div class="chart-wrapper h-40">
        <Line :data="memoryChartData" :options="percentageChartOptions" :key="memoryChartKey" />
      </div>
    </div>
    <div class="chart-container bg-header rounded p-3">
      <h5 class="text-sm font-medium mb-2 text-text-secondary">{{ networkChartTitle }}</h5>
      <div class="chart-wrapper h-40">
        <Line :data="networkChartData" :options="networkChartOptions" :key="networkChartKey" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  ChartOptions,
  TooltipItem,
} from 'chart.js';

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale
);

const props = defineProps<{
  serverStatus: any;
}>();

const MAX_DATA_POINTS = 60;
const KB_TO_MB_THRESHOLD = 1024;

const cpuChartKey = ref(0);
const memoryChartKey = ref(0);
const networkChartKey = ref(0);
const networkRateUnitIsMB = ref(false);
const networkChartTitle = ref('网络速度 (KB/s)');

const initialLabels = Array.from({ length: MAX_DATA_POINTS }, (_, i) => `-${(MAX_DATA_POINTS - 1 - i)}s`);

const cpuChartData = ref({
  labels: [...initialLabels],
  datasets: [
    {
      label: 'CPU 使用率 (%)',
      backgroundColor: 'rgba(54, 162, 235, 0.2)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 1,
      data: Array(MAX_DATA_POINTS).fill(0),
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
  ],
});

const memoryChartData = ref({
  labels: [...initialLabels],
  datasets: [
    {
      label: '内存使用率 (%)',
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      borderColor: 'rgba(255, 99, 132, 1)',
      borderWidth: 1,
      data: Array(MAX_DATA_POINTS).fill(0),
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
  ],
});

const networkChartData = ref({
  labels: [...initialLabels],
  datasets: [
    {
      label: '下载 (KB/s)',
      backgroundColor: 'rgba(75, 192, 192, 0.2)',
      borderColor: 'rgba(75, 192, 192, 1)',
      borderWidth: 1,
      data: Array(MAX_DATA_POINTS).fill(0),
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
    {
      label: '上传 (KB/s)',
      backgroundColor: 'rgba(255, 159, 64, 0.2)',
      borderColor: 'rgba(255, 159, 64, 1)',
      borderWidth: 1,
      data: Array(MAX_DATA_POINTS).fill(0),
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
  ],
});

const baseChartOptions: Omit<ChartOptions<'line'>, 'scales'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { labels: { color: '#9CA3AF' } },
    tooltip: { enabled: true, mode: 'index', intersect: false },
  },
  interaction: { mode: 'index', intersect: false },
};

const percentageChartOptions = ref<ChartOptions<'line'>>({
  ...baseChartOptions,
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      max: 100,
      ticks: { color: '#9CA3AF' },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});

const networkChartOptions = ref<ChartOptions<'line'>>({
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins?.tooltip,
      callbacks: {
        label: (context: TooltipItem<'line'>) => {
          let label = context.dataset.label || '';
          if (label) {
            label += ': ';
          }
          if (context.parsed.y !== null) {
            const value = parseFloat(context.parsed.y.toFixed(1));
            label += `${value} ${networkRateUnitIsMB.value ? 'MB/s' : 'KB/s'}`;
          }
          return label;
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      // max will be set dynamically
      ticks: {
        color: '#9CA3AF',
        callback: function(value) {
          return `${parseFloat(Number(value).toFixed(1))}`;
        }
      },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});


const updateCharts = (newStatus: any) => {
  if (!newStatus) return;

  // Update CPU Chart
  if (typeof newStatus.cpuPercent === 'number') {
    const newCpuData = [...cpuChartData.value.datasets[0].data];
    newCpuData.shift();
    newCpuData.push(parseFloat(newStatus.cpuPercent.toFixed(1)));
    cpuChartData.value = { ...cpuChartData.value, datasets: [{ ...cpuChartData.value.datasets[0], data: newCpuData }] };
  }

  // Update Memory Chart
  if (typeof newStatus.memPercent === 'number') {
    const newMemData = [...memoryChartData.value.datasets[0].data];
    newMemData.shift();
    newMemData.push(parseFloat(newStatus.memPercent.toFixed(1)));
    memoryChartData.value = { ...memoryChartData.value, datasets: [{ ...memoryChartData.value.datasets[0], data: newMemData }] };
  }

  // Update Network Chart
  let currentNetRxRateKB = (newStatus.netRxRate || 0) / 1024;
  let currentNetTxRateKB = (newStatus.netTxRate || 0) / 1024;

  const newNetRxData = [...networkChartData.value.datasets[0].data];
  const newNetTxData = [...networkChartData.value.datasets[1].data];

  // Check if unit needs to be switched to MB/s
  if (!networkRateUnitIsMB.value && (currentNetRxRateKB >= KB_TO_MB_THRESHOLD || currentNetTxRateKB >= KB_TO_MB_THRESHOLD)) {
    networkRateUnitIsMB.value = true;
    networkChartTitle.value = '网络速度 (MB/s)';

    // Convert existing data to MB/s
    networkChartData.value.datasets[0].data = newNetRxData.map(d => parseFloat((d / KB_TO_MB_THRESHOLD).toFixed(1)));
    networkChartData.value.datasets[1].data = newNetTxData.map(d => parseFloat((d / KB_TO_MB_THRESHOLD).toFixed(1)));
    
    // Update dataset labels
    networkChartData.value.datasets[0].label = '下载 (MB/s)';
    networkChartData.value.datasets[1].label = '上传 (MB/s)';
    
    // Force chart re-render for label and unit changes
    networkChartKey.value++; 
  }
  
  // Prepare new data points based on current unit
  let newRxValue, newTxValue;
  if (networkRateUnitIsMB.value) {
    newRxValue = parseFloat((currentNetRxRateKB / KB_TO_MB_THRESHOLD).toFixed(1));
    newTxValue = parseFloat((currentNetTxRateKB / KB_TO_MB_THRESHOLD).toFixed(1));
  } else {
    newRxValue = parseFloat(currentNetRxRateKB.toFixed(1));
    newTxValue = parseFloat(currentNetTxRateKB.toFixed(1));
  }

  const finalNewNetRxData = [...networkChartData.value.datasets[0].data];
  finalNewNetRxData.shift();
  finalNewNetRxData.push(newRxValue);

  const finalNewNetTxData = [...networkChartData.value.datasets[1].data];
  finalNewNetTxData.shift();
  finalNewNetTxData.push(newTxValue);
  
  networkChartData.value = {
    ...networkChartData.value,
    datasets: [
      { ...networkChartData.value.datasets[0], data: finalNewNetRxData },
      { ...networkChartData.value.datasets[1], data: finalNewNetTxData },
    ],
  };

  // Dynamically adjust Y-axis for network chart
  const allNetworkData = [...finalNewNetRxData, ...finalNewNetTxData];
  const minMax = networkRateUnitIsMB.value ? 1 : 10; // Min max for MB/s or KB/s
  const maxNetworkRate = Math.max(...allNetworkData, minMax); 
  
  if (networkChartOptions.value.scales?.y) {
    const roundingFactor = networkRateUnitIsMB.value ? 1 : 10; // Round to next 1 or 10
    const buffer = networkRateUnitIsMB.value ? 1 : 10; // Buffer for MB/s or KB/s
    networkChartOptions.value.scales.y.max = Math.ceil(maxNetworkRate / roundingFactor) * roundingFactor + buffer;
  }
};

watch(() => props.serverStatus, (newStatus) => {
  updateCharts(newStatus);
}, { deep: true, immediate: true });

onMounted(() => {
  // Initial setup handled by watch immediate
});

</script>