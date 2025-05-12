<template>
  <div class="status-charts grid grid-cols-1 gap-4 mt-4">
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">CPU 使用率</h5>
        <span class="text-xs text-text-tertiary ml-2">
          {{ cpuChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1) }}%
        </span>
      </div>
      <div class="chart-wrapper h-40">
        <Line :data="cpuChartData" :options="percentageChartOptions" :key="cpuChartKey" />
      </div>
    </div>
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">{{ memoryChartTitle }}</h5>
        <span class="text-xs text-text-tertiary ml-2">
          {{ memoryChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1) }} {{ memoryUnitIsGB ? 'GB' : 'MB' }}
        </span>
      </div>
      <div class="chart-wrapper h-40">
        <Line :data="memoryChartData" :options="memoryChartOptions" :key="memoryChartKey" />
      </div>
    </div>
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">{{ networkChartTitle }}</h5>
        <span class="text-xs text-text-tertiary ml-2">
          ↓ {{ networkChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1) }}
          ↑ {{ networkChartData.datasets[1].data[MAX_DATA_POINTS - 1]?.toFixed(1) }}
          {{ networkRateUnitIsMB ? 'MB/s' : 'KB/s' }}
        </span>
      </div>
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

// Define a more specific type for serverStatus if possible, or use as is if memUsed/memTotal are reliably present.
// For now, assuming props.serverStatus will have memUsed and memTotal in MB.
interface ServerStatusData {
  cpuPercent?: number;
  memPercent?: number; // Will be ignored for chart data, but kept for other potential uses
  memUsed?: number;    // in MB
  memTotal?: number;   // in MB
  netRxRate?: number;  // in Bytes/sec
  netTxRate?: number;  // in Bytes/sec
  // ... other properties if needed
}

const props = defineProps<{
  serverStatus: ServerStatusData | null;
}>();

const MAX_DATA_POINTS = 60;
const KB_TO_MB_THRESHOLD = 1024; // For network
const MB_TO_GB_THRESHOLD = 1024; // For memory

const cpuChartKey = ref(0);
const memoryChartKey = ref(0);
const networkChartKey = ref(0);

const networkRateUnitIsMB = ref(false);
const networkChartTitle = ref('网络速度 (KB/s)');

const memoryUnitIsGB = ref(false);
const memoryChartTitle = ref('内存使用情况 (MB)');


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
      label: '内存使用 (MB)', // Initial label
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

const percentageChartOptions = ref<ChartOptions<'line'>>({ // For CPU
  ...baseChartOptions,
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      max: 100,
      ticks: { color: '#9CA3AF', callback: value => `${value}%` },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});

const memoryChartOptions = ref<ChartOptions<'line'>>({
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins?.tooltip,
      callbacks: {
        label: (context: TooltipItem<'line'>) => {
          let label = context.dataset.label || '';
          if (label) {
            label = label.substring(0, label.lastIndexOf('(') -1); // Remove old unit from label
            label += ': ';
          }
          if (context.parsed.y !== null) {
            const value = parseFloat(context.parsed.y.toFixed(1));
            label += `${value} ${memoryUnitIsGB.value ? 'GB' : 'MB'}`;
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
      // max will be set dynamically based on memTotal
      ticks: {
        color: '#9CA3AF',
        callback: function(value) {
          return `${parseFloat(Number(value).toFixed(1))}`; // Unit will be implicit from title or tooltip
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
            label = label.substring(0, label.lastIndexOf('(') -1); // Remove old unit from label
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


const updateCharts = (newStatus: ServerStatusData | null) => {
  if (!newStatus) return;

  // Update CPU Chart
  if (typeof newStatus.cpuPercent === 'number') {
    const newCpuData = [...cpuChartData.value.datasets[0].data];
    newCpuData.shift();
    newCpuData.push(parseFloat(newStatus.cpuPercent.toFixed(1)));
    cpuChartData.value = { ...cpuChartData.value, datasets: [{ ...cpuChartData.value.datasets[0], data: newCpuData }] };
  }

  // Update Memory Chart
  if (typeof newStatus.memUsed === 'number' && typeof newStatus.memTotal === 'number') {
    let currentMemUsed = newStatus.memUsed; // MB
    const memTotal = newStatus.memTotal;   // MB
    let currentData = [...memoryChartData.value.datasets[0].data];

    if (!memoryUnitIsGB.value && (memTotal >= MB_TO_GB_THRESHOLD || currentMemUsed >= MB_TO_GB_THRESHOLD)) {
      memoryUnitIsGB.value = true;
      memoryChartTitle.value = '内存使用情况 (GB)';
      memoryChartData.value.datasets[0].label = '内存使用 (GB)';
      currentData = currentData.map(d => parseFloat((d / MB_TO_GB_THRESHOLD).toFixed(1)));
      memoryChartKey.value++; // Force re-render
    } else if (memoryUnitIsGB.value && memTotal < MB_TO_GB_THRESHOLD && currentMemUsed < MB_TO_GB_THRESHOLD) {
      // This case is less likely if total is large, but handles potential fluctuations or incorrect initial state
      memoryUnitIsGB.value = false;
      memoryChartTitle.value = '内存使用情况 (MB)';
      memoryChartData.value.datasets[0].label = '内存使用 (MB)';
      currentData = currentData.map(d => parseFloat((d * MB_TO_GB_THRESHOLD).toFixed(1)));
      memoryChartKey.value++;
    }
    
    let newMemValue;
    if (memoryUnitIsGB.value) {
      newMemValue = parseFloat((currentMemUsed / MB_TO_GB_THRESHOLD).toFixed(1));
    } else {
      newMemValue = parseFloat(currentMemUsed.toFixed(1));
    }

    currentData.shift();
    currentData.push(newMemValue);
    memoryChartData.value = { ...memoryChartData.value, datasets: [{ ...memoryChartData.value.datasets[0], data: currentData }] };

    if (memoryChartOptions.value.scales?.y && typeof memTotal === 'number') {
      let yAxisTopValue = memoryUnitIsGB.value
        ? parseFloat((memTotal / MB_TO_GB_THRESHOLD).toFixed(1))
        : parseFloat(memTotal.toFixed(1));

      // Ensure the yAxisTopValue is at least slightly larger than the max data point if data exceeds total.
      // Also, handle cases where memTotal might be 0 or very small.
      const currentMaxDataPoint = Math.max(...currentData, 0);
      // The y-axis max should primarily be driven by memTotal.
      // If current data somehow exceeds memTotal (which shouldn't happen for 'used' vs 'total'),
      // then the axis should expand. Otherwise, stick to memTotal.
      yAxisTopValue = Math.max(yAxisTopValue, currentMaxDataPoint);
      
      // If memTotal is 0 (and thus yAxisTopValue is 0 after parseFloat), set a small default max.
      if (yAxisTopValue === 0) {
        yAxisTopValue = memoryUnitIsGB.value ? 1 : 100; // Default small max if total is 0
      } else {
        // Add a very tiny buffer if yAxisTopValue is not 0, to ensure the top line is visible if data hits the max.
        // This helps if Chart.js clips data exactly at the 'max'.
        // For example, if max is 8.0GB, a data point of 8.0GB might be at the very edge.
        // A small increment ensures it's clearly within the chart area.
        const epsilon = memoryUnitIsGB.value ? 0.01 : 1;
        yAxisTopValue += epsilon;
        // Re-round after adding epsilon to maintain clean ticks if possible
        if (memoryUnitIsGB.value) {
            yAxisTopValue = Math.ceil(yAxisTopValue * 100) / 100; // Round to 2 decimal places for GB after epsilon
        } else {
            yAxisTopValue = Math.ceil(yAxisTopValue); // Round to next integer for MB after epsilon
        }
      }
      memoryChartOptions.value.scales.y.max = yAxisTopValue;
    }
  }


  // Update Network Chart
  let currentNetRxRateKB = (newStatus.netRxRate || 0) / 1024;
  let currentNetTxRateKB = (newStatus.netTxRate || 0) / 1024;
  let newNetRxData = [...networkChartData.value.datasets[0].data];
  let newNetTxData = [...networkChartData.value.datasets[1].data];

  if (!networkRateUnitIsMB.value && (currentNetRxRateKB >= KB_TO_MB_THRESHOLD || currentNetTxRateKB >= KB_TO_MB_THRESHOLD)) {
    networkRateUnitIsMB.value = true;
    networkChartTitle.value = '网络速度 (MB/s)';
    networkChartData.value.datasets[0].label = '下载 (MB/s)';
    networkChartData.value.datasets[1].label = '上传 (MB/s)';
    newNetRxData = newNetRxData.map(d => parseFloat((d / KB_TO_MB_THRESHOLD).toFixed(1)));
    newNetTxData = newNetTxData.map(d => parseFloat((d / KB_TO_MB_THRESHOLD).toFixed(1)));
    networkChartKey.value++; 
  }
  
  let newRxValue, newTxValue;
  if (networkRateUnitIsMB.value) {
    newRxValue = parseFloat((currentNetRxRateKB / KB_TO_MB_THRESHOLD).toFixed(1));
    newTxValue = parseFloat((currentNetTxRateKB / KB_TO_MB_THRESHOLD).toFixed(1));
  } else {
    newRxValue = parseFloat(currentNetRxRateKB.toFixed(1));
    newTxValue = parseFloat(currentNetTxRateKB.toFixed(1));
  }

  newNetRxData.shift();
  newNetRxData.push(newRxValue);
  newNetTxData.shift();
  newNetTxData.push(newTxValue);
  
  networkChartData.value = {
    ...networkChartData.value,
    datasets: [
      { ...networkChartData.value.datasets[0], data: newNetRxData },
      { ...networkChartData.value.datasets[1], data: newNetTxData },
    ],
  };

  if (networkChartOptions.value.scales?.y) {
    const allNetworkData = [...newNetRxData, ...newNetTxData];
    const minMax = networkRateUnitIsMB.value ? 1 : 10;
    const maxNetworkRate = Math.max(...allNetworkData, minMax); 
    const roundingFactor = networkRateUnitIsMB.value ? 1 : 10;
    const buffer = networkRateUnitIsMB.value ? 1 : 10;
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