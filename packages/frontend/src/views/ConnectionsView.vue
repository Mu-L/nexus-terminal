<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import AddConnectionForm from '../components/AddConnectionForm.vue';
import BatchEditConnectionForm from '../components/BatchEditConnectionForm.vue';
import { useConnectionsStore } from '../stores/connections.store';
import { useSessionStore } from '../stores/session.store';
import { useTagsStore } from '../stores/tags.store';
import type { TagInfo } from '../stores/tags.store';
import type { SortField, SortOrder } from '../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { ConnectionInfo } from '../stores/connections.store';
import { storeToRefs } from 'pinia';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS, ja } from 'date-fns/locale';
import type { Locale } from 'date-fns';

const { t, locale } = useI18n();
const router = useRouter();
const connectionsStore = useConnectionsStore();
const sessionStore = useSessionStore();
const tagsStore = useTagsStore();

const { connections, isLoading: isLoadingConnections } = storeToRefs(connectionsStore);
const { tags, isLoading: isLoadingTags } = storeToRefs(tagsStore);

const LS_SORT_BY_KEY = 'connections_view_sort_by';
const LS_SORT_ORDER_KEY = 'connections_view_sort_order';
const LS_FILTER_TAG_KEY = 'connections_view_filter_tag';

const localSortBy = ref<SortField>(localStorage.getItem(LS_SORT_BY_KEY) as SortField || 'last_connected_at');
const localSortOrder = ref<SortOrder>(localStorage.getItem(LS_SORT_ORDER_KEY) as SortOrder || 'desc');

const getInitialSelectedTagId = (): number | null => {
  const storedValue = localStorage.getItem(LS_FILTER_TAG_KEY);
  return storedValue && storedValue !== 'null' ? parseInt(storedValue, 10) : null;
};
const selectedTagId = ref<number | null>(getInitialSelectedTagId());
const searchQuery = ref('');

const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);

// Batch Edit Mode
const isBatchEditMode = ref(false);
const selectedConnectionIdsForBatch = ref<Set<number>>(new Set());
const showBatchEditForm = ref(false);

const sortOptions: { value: SortField; labelKey: string }[] = [
  { value: 'last_connected_at', labelKey: 'dashboard.sortOptions.lastConnected' },
  { value: 'name', labelKey: 'dashboard.sortOptions.name' },
  { value: 'type', labelKey: 'dashboard.sortOptions.type' },
  { value: 'updated_at', labelKey: 'dashboard.sortOptions.updated' },
  { value: 'created_at', labelKey: 'dashboard.sortOptions.created' },
];

const filteredAndSortedConnections = computed(() => {
  const sortBy = localSortBy.value;
  const sortOrderVal = localSortOrder.value;
  const factor = sortOrderVal === 'desc' ? -1 : 1;
  const filterTagId = selectedTagId.value;
  const query = searchQuery.value.toLowerCase().trim();

  let filteredByTag = filterTagId === null
    ? [...connections.value]
    : connections.value.filter(conn => conn.tag_ids?.includes(filterTagId));

  let searchedConnections = filteredByTag;
  if (query) {
    searchedConnections = filteredByTag.filter(conn => {
      const nameMatch = conn.name?.toLowerCase().includes(query);
      const usernameMatch = conn.username?.toLowerCase().includes(query);
      const hostMatch = conn.host?.toLowerCase().includes(query);
      const portMatch = conn.port?.toString().includes(query);
      return nameMatch || usernameMatch || hostMatch || portMatch;
    });
  }

  return searchedConnections.sort((a, b) => {
    let valA: any;
    let valB: any;

    switch (sortBy) {
      case 'name':
        valA = a.name || '';
        valB = b.name || '';
        return valA.localeCompare(valB) * factor;
      case 'type':
        valA = a.type || '';
        valB = b.type || '';
        return valA.localeCompare(valB) * factor;
      case 'created_at':
        valA = a.created_at ?? 0;
        valB = b.created_at ?? 0;
        return (valA - valB) * factor;
      case 'updated_at':
        valA = a.updated_at ?? 0;
        valB = b.updated_at ?? 0;
        return (valA - valB) * factor;
      case 'last_connected_at':
        valA = a.last_connected_at ?? (sortOrderVal === 'desc' ? -Infinity : Infinity);
        valB = b.last_connected_at ?? (sortOrderVal === 'desc' ? -Infinity : Infinity);
        if (valA === valB) return 0;
        if (valA < valB) return -1 * factor;
        return 1 * factor;
      default:
        return 0;
    }
  });
});

onMounted(async () => {
  if (connections.value.length === 0) {
    try {
      await connectionsStore.fetchConnections();
    } catch (error) {
      console.error("加载连接列表失败:", error);
    }
  }
  try {
    await tagsStore.fetchTags();
  } catch (error) {
    console.error("加载标签列表失败:", error);
  }
});

const connectTo = (connection: ConnectionInfo) => {
  sessionStore.handleConnectRequest(connection);
};

const toggleSortOrder = () => {
  localSortOrder.value = localSortOrder.value === 'asc' ? 'desc' : 'asc';
};

const isAscending = computed(() => localSortOrder.value === 'asc');

watch(localSortBy, (newValue) => {
  localStorage.setItem(LS_SORT_BY_KEY, newValue);
});

watch(localSortOrder, (newValue) => {
  localStorage.setItem(LS_SORT_ORDER_KEY, newValue);
});

watch(selectedTagId, (newValue) => {
  localStorage.setItem(LS_FILTER_TAG_KEY, newValue === null ? 'null' : String(newValue));
});

const dateFnsLocales: Record<string, Locale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ja-JP': ja,
  'en': enUS,
  'zh': zhCN,
  'ja': ja,
};

const formatRelativeTime = (timestampInSeconds: number | null | undefined): string => {
  if (!timestampInSeconds) return t('connections.status.never');
  try {
    const timestampInMs = timestampInSeconds * 1000;
    if (isNaN(timestampInMs)) {
        console.warn(`[ConnectionsView] Invalid timestamp received: ${timestampInSeconds}`);
        return String(timestampInSeconds);
    }
    const date = new Date(timestampInMs);
    const currentI18nLocale = locale.value;
    const langPart = currentI18nLocale.split('-')[0];
    let targetDateFnsLocale = dateFnsLocales[currentI18nLocale] || dateFnsLocales[langPart] || enUS;
    return formatDistanceToNow(date, { addSuffix: true, locale: targetDateFnsLocale });
  } catch (e) {
    console.error("格式化日期失败:", e);
    return String(timestampInSeconds);
  }
};

const getTagNames = (tagIds: number[] | undefined): string[] => {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }
  const allTags = tags.value as TagInfo[];
  return tagIds
    .map(id => allTags.find(tag => tag.id === id)?.name)
    .filter((name): name is string => !!name);
};

const openAddConnectionForm = () => {
  connectionToEdit.value = null;
  showAddEditConnectionForm.value = true;
};

const openEditConnectionForm = (conn: ConnectionInfo) => {
  connectionToEdit.value = conn;
  showAddEditConnectionForm.value = true;
};

const handleFormClose = () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
};

const handleConnectionModified = async () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
  await connectionsStore.fetchConnections();
};

// --- Batch Edit Functions ---
const toggleBatchEditMode = () => {
  isBatchEditMode.value = !isBatchEditMode.value;
  if (!isBatchEditMode.value) {
    selectedConnectionIdsForBatch.value.clear(); // Clear selection when exiting batch mode
  }
};

const handleConnectionClick = (connId: number) => {
  if (!isBatchEditMode.value) return;
  if (selectedConnectionIdsForBatch.value.has(connId)) {
    selectedConnectionIdsForBatch.value.delete(connId);
  } else {
    selectedConnectionIdsForBatch.value.add(connId);
  }
};

const isConnectionSelectedForBatch = (connId: number): boolean => {
  return selectedConnectionIdsForBatch.value.has(connId);
};

const selectAllConnections = () => {
  if (!isBatchEditMode.value) return;
  filteredAndSortedConnections.value.forEach(conn => selectedConnectionIdsForBatch.value.add(conn.id));
};

const deselectAllConnections = () => {
  if (!isBatchEditMode.value) return;
  selectedConnectionIdsForBatch.value.clear();
};

const invertSelection = () => {
  if (!isBatchEditMode.value) return;
  const allVisibleIds = new Set(filteredAndSortedConnections.value.map(conn => conn.id));
  allVisibleIds.forEach(id => {
    if (selectedConnectionIdsForBatch.value.has(id)) {
      selectedConnectionIdsForBatch.value.delete(id);
    } else {
      selectedConnectionIdsForBatch.value.add(id);
    }
  });
};

const openBatchEditModal = () => {
  if (selectedConnectionIdsForBatch.value.size === 0) {
    // Optionally, show a notification from uiNotificationsStore using your project's method
    alert(t('connections.batchEdit.noSelectionForEdit', '请至少选择一个连接进行编辑。')); // Placeholder
    return;
  }
  showBatchEditForm.value = true;
};

const handleBatchEditSaved = async () => {
  showBatchEditForm.value = false;
  selectedConnectionIdsForBatch.value.clear();
  // isBatchEditMode.value = false; // Optionally exit batch mode after saving
  await connectionsStore.fetchConnections(); // Refresh the list
};

const handleBatchEditFormClose = () => {
  showBatchEditForm.value = false;
};
// --- End Batch Edit Functions ---

</script>

<template>
  <div class="p-4 md:p-6 lg:p-8 bg-background text-foreground">
    <h1 class="text-2xl font-semibold mb-6">{{ t('nav.connections', '连接管理') }}</h1>

    <div class="bg-card text-card-foreground shadow rounded-lg overflow-hidden border border-border min-h-[400px]">
      <div class="px-4 py-3 border-b border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h2 class="text-lg font-medium flex-shrink-0">{{ t('dashboard.connectionList', '连接列表') }} ({{ filteredAndSortedConnections.length }})</h2>
        <div class="w-full sm:w-auto flex flex-wrap sm:flex-nowrap items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
          <!-- Batch Edit Toggle -->
          <div class="flex items-center mr-3">
            <label for="batch-edit-toggle" class="mr-2 text-sm font-medium text-text-secondary">{{ t('connections.batchEdit.toggleLabel', '批量修改') }}</label>
            <button
              id="batch-edit-toggle"
              @click="toggleBatchEditMode"
              :class="[
                'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
                isBatchEditMode ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
              ]"
              role="switch"
              :aria-checked="isBatchEditMode"
            >
              <span
                aria-hidden="true"
                :class="[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
                  isBatchEditMode ? 'translate-x-5' : 'translate-x-0'
                ]"
              ></span>
            </button>
          </div>

          <input
            type="text"
            v-model="searchQuery"
            :placeholder="t('dashboard.searchConnectionsPlaceholder', '搜索连接...')"
            class="h-8 px-3 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-48"
          />
          <div class="flex items-center space-x-2">
           <select
              v-model="selectedTagId"
              class="h-8 px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none bg-no-repeat bg-right pr-8"
              style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.5rem center; background-size: 16px 12px;"
              aria-label="Filter connections by tag"
              :disabled="isLoadingTags"
            >
              <option :value="null">{{ t('dashboard.filterTags.all', '所有标签') }}</option>
              <option v-if="isLoadingTags" disabled>{{ t('common.loading') }}</option>
              <option v-for="tag in (tags as TagInfo[])" :key="tag.id" :value="tag.id">
                {{ tag.name }}
              </option>
            </select>

           <select
              v-model="localSortBy"
              class="h-8 px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none bg-no-repeat bg-right pr-8"
              style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.5rem center; background-size: 16px 12px;"
              aria-label="Sort connections by"
            >
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ t(option.labelKey, option.value.replace('_', ' ')) }}
              </option>
            </select>

            <button
              @click="toggleSortOrder"
              class="h-8 px-1.5 py-1 border border-border rounded hover:bg-muted focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-center"
              :aria-label="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
              :title="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
            >
              <i :class="['fas', isAscending ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'w-4 h-4']"></i>
            </button>
          </div>
          <button @click="openAddConnectionForm" title="Add Connection" class="h-8 w-8 bg-button rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out flex items-center justify-center flex-shrink-0 ml-2 sm:ml-0">
            <i class="fas fa-plus" style="color: white;"></i>
          </button>
        </div>
      </div>

      <!-- Batch Action Buttons -->
      <div v-if="isBatchEditMode" class="px-4 py-2 border-b border-border bg-card flex flex-wrap items-center gap-2">
        <button
          @click="selectAllConnections"
          class="px-3 py-1.5 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
        >
          {{ t('connections.batchEdit.selectAll', '全选') }} ({{ selectedConnectionIdsForBatch.size }})
        </button>
        <button
          @click="deselectAllConnections"
          class="px-3 py-1.5 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
        >
          {{ t('connections.batchEdit.deselectAll', '取消全选') }}
        </button>
        <button
          @click="invertSelection"
          class="px-3 py-1.5 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
        >
          {{ t('connections.batchEdit.invertSelection', '反选') }}
        </button>
        <button
          @click="openBatchEditModal"
          :disabled="selectedConnectionIdsForBatch.size === 0"
          class="px-4 py-1.5 text-sm bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i class="fas fa-edit mr-1"></i>
          {{ t('connections.batchEdit.editSelected', '编辑选中') }}
        </button>
      </div>

      <div class="p-4">
        <div v-if="isLoadingConnections && filteredAndSortedConnections.length === 0" class="text-center text-text-secondary">{{ t('common.loading') }}</div>
        <ul v-else-if="filteredAndSortedConnections.length > 0" class="space-y-3">
          <li
            v-for="conn in filteredAndSortedConnections"
            :key="conn.id"
            @click="handleConnectionClick(conn.id)"
            :class="[
              'flex items-center justify-between p-3 bg-header/50 border border-border/50 rounded transition duration-150 ease-in-out',
              { 'ring-2 ring-primary ring-offset-1 ring-offset-background': isBatchEditMode && isConnectionSelectedForBatch(conn.id) },
              { 'cursor-pointer hover:bg-border/70': isBatchEditMode },
              { 'hover:bg-border/30': !isBatchEditMode }
            ]"
          >
            <div class="flex-grow mr-4 overflow-hidden">
              <span class="font-medium block truncate flex items-center" :title="conn.name || ''">
                <i :class="['fas', conn.type === 'VNC' ? 'fa-plug' : (conn.type === 'RDP' ? 'fa-desktop' : 'fa-server'), 'mr-2 w-4 text-center text-text-secondary']"></i>
                <span>{{ conn.name || t('connections.unnamed') }}</span>
              </span>
              <span class="text-sm text-text-secondary block truncate" :title="`${conn.username}@${conn.host}:${conn.port}`">
                {{ conn.username }}@{{ conn.host }}:{{ conn.port }}
              </span>
              <span class="text-xs text-text-alt block mb-1">
                {{ t('dashboard.lastConnected', '上次连接:') }} {{ formatRelativeTime(conn.last_connected_at) }}
              </span>
              <div v-if="getTagNames(conn.tag_ids).length > 0" class="flex flex-wrap gap-1 mt-1">
                <span
                  v-for="tagName in getTagNames(conn.tag_ids)"
                  :key="tagName"
                  class="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground border border-border"
                >
                  {{ tagName }}
                </span>
              </div>
            </div>
            <div class="flex space-x-2 flex-shrink-0">
              <button
                @click.stop="openEditConnectionForm(conn)"
                class="px-3 py-1.5 bg-transparent text-foreground border border-border rounded-md shadow-sm hover:bg-border focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
                :disabled="isBatchEditMode"
                :class="{ 'opacity-50 cursor-not-allowed': isBatchEditMode }"
                :title="isBatchEditMode ? t('connections.batchEdit.disabledInBatchMode', '批量模式下禁用') : t('connections.actions.edit', '编辑')"
              >
                <i class="fas fa-pencil-alt"></i>
              </button>
              <button
                @click.stop="connectTo(conn)"
                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
                :disabled="isBatchEditMode"
                :class="{ 'opacity-50 cursor-not-allowed': isBatchEditMode }"
                :title="isBatchEditMode ? t('connections.batchEdit.disabledInBatchMode', '批量模式下禁用') : t('connections.actions.connect', '连接')"
              >
                {{ t('connections.actions.connect') }}
              </button>
            </div>
          </li>
        </ul>
        <div v-else-if="!isLoadingConnections && searchQuery && filteredAndSortedConnections.length === 0" class="text-center text-text-secondary">{{ t('dashboard.noConnectionsMatchSearch', '没有连接匹配搜索条件') }}</div>
        <div v-else-if="!isLoadingConnections && selectedTagId !== null && filteredAndSortedConnections.length === 0" class="text-center text-text-secondary">{{ t('dashboard.noConnectionsWithTag', '该标签下没有连接记录') }}</div>
        <div v-else class="text-center text-text-secondary">{{ t('dashboard.noConnections', '没有连接记录') }}</div>
      </div>
    </div>

    <AddConnectionForm
      v-if="showAddEditConnectionForm"
      :connectionToEdit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionModified"
      @connection-updated="handleConnectionModified"
    />

    <BatchEditConnectionForm
      v-if="showBatchEditForm"
      :visible="showBatchEditForm"
      :connection-ids="Array.from(selectedConnectionIdsForBatch)"
      @update:visible="handleBatchEditFormClose"
      @saved="handleBatchEditSaved"
    />
  </div>
</template>