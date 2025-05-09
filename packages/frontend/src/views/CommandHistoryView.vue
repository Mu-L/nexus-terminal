<template>
  <div class="flex flex-col h-full overflow-hidden bg-background">
    <!-- Container for controls and list -->
    <div class="flex flex-col flex-grow overflow-hidden bg-background">
      <!-- Controls Area -->
      <div class="flex items-center p-2 flex-shrink-0 gap-2 bg-background"> <!-- Reduced padding p-3 to p-2 -->
        <input
          type="text"
          :placeholder="$t('commandHistory.searchPlaceholder', '搜索历史记录...')"
          :value="searchTerm"
          data-focus-id="commandHistorySearch"
          @input="updateSearchTerm($event)"
          @keydown="handleSearchInputKeydown"
          @blur="handleSearchInputBlur"
          ref="searchInputRef"
          class="flex-grow min-w-0 px-4 py-1.5 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out"
        />
        <!-- Clear Button -->
        <button @click="confirmClearAll" class="w-8 h-8 border border-border/50 rounded-lg text-text-secondary hover:bg-error/10 hover:text-error hover:border-error/50 transition-colors duration-150 flex-shrink-0 flex items-center justify-center" :title="$t('commandHistory.clear', '清空')"> <!-- Use w-8 h-8 -->
          <i class="fas fa-trash-alt text-base"></i>
        </button>
      </div>
      <!-- List Area -->
      <div class="flex-grow overflow-y-auto p-2">
<!-- Loading State (Only show if loading AND no history is displayed yet) -->
        <div v-if="isLoading && filteredHistory.length === 0" class="p-6 text-center text-text-secondary text-sm flex flex-col items-center justify-center h-full">
          <i class="fas fa-spinner fa-spin text-xl mb-2"></i>
          <p>{{ $t('commandHistory.loading', '加载中...') }}</p>
        </div>
        <!-- Empty State -->
        <div v-else-if="filteredHistory.length === 0" class="p-6 text-center text-text-secondary text-sm flex flex-col items-center justify-center h-full">
          <i class="fas fa-history text-xl mb-2"></i>
          <p>{{ $t('commandHistory.empty', '没有历史记录') }}</p>
        </div>
        <!-- History List -->
        <ul ref="historyListRef" v-else class="list-none p-0 m-0">
          <li
            v-for="(entry, index) in filteredHistory"
            :key="entry.id"
            class="group flex justify-between items-center px-3 py-2.5 mb-1 cursor-pointer rounded-md hover:bg-primary/10 transition-colors duration-150"
            :class="{ 'bg-primary/20 font-medium': index === storeSelectedIndex }"
            @click="executeCommand(entry.command)"
            :title="entry.command"
          >
            <!-- Command Text -->
            <span class="truncate mr-2 flex-grow font-mono text-sm text-foreground">{{ entry.command }}</span>
            <!-- Actions (Show on Hover) -->
            <div class="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
              <!-- Copy Button -->
              <button @click.stop="copyCommand(entry.command)" class="p-1.5 rounded hover:bg-black/10 transition-colors duration-150 text-text-secondary hover:text-primary" :title="$t('commandHistory.copy', '复制')">
                <i class="fas fa-copy text-sm"></i>
              </button>
              <!-- Delete Button -->
              <button @click.stop="deleteSingleCommand(entry.id)" class="ml-1 p-1.5 rounded hover:bg-black/10 transition-colors duration-150 text-text-secondary hover:text-error" :title="$t('commandHistory.delete', '删除')">
                <i class="fas fa-times text-sm"></i>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick, defineExpose, watch } from 'vue'; // Import watch
import { storeToRefs } from 'pinia'; // Import storeToRefs
import { useCommandHistoryStore, CommandHistoryEntryFE } from '../stores/commandHistory.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useI18n } from 'vue-i18n';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store'; // +++ 导入焦点切换 Store +++
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents'; // +++ 新增导入 +++

const commandHistoryStore = useCommandHistoryStore();
const uiNotificationsStore = useUiNotificationsStore();
const { t } = useI18n();
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const hoveredItemId = ref<number | null>(null);
// const selectedIndex = ref<number>(-1); // REMOVED: Use store's selectedIndex
const historyListRef = ref<HTMLUListElement | null>(null); // Ref for the history list UL
const searchInputRef = ref<HTMLInputElement | null>(null); // +++ Ref for the search input +++
let unregisterFocus: (() => void) | null = null; // +++ 保存注销函数 +++

// --- 从 Store 获取状态和 Getter ---
const searchTerm = computed(() => commandHistoryStore.searchTerm);
// 使用 store 的 filteredHistory getter
const filteredHistory = computed(() => commandHistoryStore.filteredHistory);
const isLoading = computed(() => commandHistoryStore.isLoading);
const { selectedIndex: storeSelectedIndex } = storeToRefs(commandHistoryStore); // Get selectedIndex reactively


// --- 生命周期钩子 ---
onMounted(() => {
  // 视图挂载时获取历史记录 (如果 store 中还没有的话)
  if (commandHistoryStore.historyList.length === 0) {
      commandHistoryStore.fetchHistory();
  }
});

// +++ 注册/注销自定义聚焦动作 +++
onMounted(() => {
  // +++ 保存返回的注销函数 +++
  unregisterFocus = focusSwitcherStore.registerFocusAction('commandHistorySearch', focusSearchInput);
});
onBeforeUnmount(() => {
  // +++ 调用保存的注销函数 +++
  if (unregisterFocus) {
    unregisterFocus();
  }
});

// --- 事件处理 ---

// 更新搜索词
const updateSearchTerm = (event: Event) => {
  const target = event.target as HTMLInputElement;
  commandHistoryStore.setSearchTerm(target.value);
  // selectedIndex.value = -1; // REMOVED: Store handles resetting index
};

// 滚动到选中的项目
const scrollToSelected = async (index: number) => { // Accept index as argument
  await nextTick(); // 等待 DOM 更新
  if (index < 0 || !historyListRef.value) return;

  const listElement = historyListRef.value;
  const selectedItem = listElement.children[index] as HTMLLIElement;

  if (selectedItem) {
    // 使用 scrollIntoView 使元素可见，滚动最小距离
    selectedItem.scrollIntoView({
      behavior: 'smooth', // 可以使用 'auto' 来实现即时滚动
      block: 'nearest',
    });
  }
};

// Watch for changes in the store's selectedIndex and scroll
watch(storeSelectedIndex, (newIndex) => {
  scrollToSelected(newIndex);
});

// Renamed function to avoid conflict if needed, and added logic
const handleSearchInputKeydown = (event: KeyboardEvent) => {
  const history = filteredHistory.value;
  if (!history.length) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      commandHistoryStore.selectNextCommand(); // Use store action
      // scrollToSelected is handled by watcher
      break;
    case 'ArrowUp':
      event.preventDefault();
      commandHistoryStore.selectPreviousCommand(); // Use store action
      // scrollToSelected is handled by watcher
      break;
    case 'Enter':
      event.preventDefault();
      if (storeSelectedIndex.value >= 0 && storeSelectedIndex.value < history.length) {
        executeCommand(history[storeSelectedIndex.value].command);
      }
      break;
  }
};

// 处理搜索框失焦事件
const handleSearchInputBlur = () => {
  // 延迟执行，以允许点击列表项事件先触发
  setTimeout(() => {
    // 检查焦点是否还在组件内部的其他可聚焦元素上（例如按钮）
    // 如果焦点移出整个组件区域，则重置选择
    if (document.activeElement !== searchInputRef.value && !historyListRef.value?.contains(document.activeElement)) {
       commandHistoryStore.resetSelection();
    }
  }, 100); // 短暂延迟
};

// 确认清空所有历史记录
const confirmClearAll = () => {
  if (window.confirm(t('commandHistory.confirmClear', '确定要清空所有历史记录吗？'))) {
    commandHistoryStore.clearAllHistory();
  }
};

// 复制命令到剪贴板
const copyCommand = async (command: string) => {
  try {
    await navigator.clipboard.writeText(command);
    uiNotificationsStore.showSuccess(t('commandHistory.copied', '已复制到剪贴板'));
  } catch (err) {
    console.error('复制命令失败:', err);
    uiNotificationsStore.showError(t('commandHistory.copyFailed', '复制失败'));
  }
};

// 删除单条历史记录
const deleteSingleCommand = (id: number) => {
  commandHistoryStore.deleteCommand(id);
};

// 新增：执行命令 (发出事件)
const executeCommand = (command: string) => {
  emitWorkspaceEvent('terminal:sendCommand', { command });
  // Optionally reset selection after execution
  // selectedIndex.value = -1; // REMOVED: Store handles index
};

// +++ 新增：聚焦搜索框的方法 +++
const focusSearchInput = (): boolean => {
  if (searchInputRef.value) {
    searchInputRef.value.focus();
    return true;
  }
  return false;
};
defineExpose({ focusSearchInput });

</script>

