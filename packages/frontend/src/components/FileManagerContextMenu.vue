<script setup lang="ts">
import { ref, watch, nextTick, type PropType, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SendFilesModal from './SendFilesModal.vue';
import type { ContextMenuItem } from '../composables/file-manager/useFileManagerContextMenu';
import type { FileListItem } from '../types/sftp.types';
import { useDeviceDetection } from '../composables/useDeviceDetection';
import { useSessionStore } from '../stores/session.store';
import type { FileManagerContextMenuPayload } from '../composables/workspaceEvents'; // +++ Import payload type

const props = defineProps({
  payload: {
    type: Object as PropType<FileManagerContextMenuPayload | null>,
    default: null,
  },
});

const { isMobile } = useDeviceDetection();
const { t } = useI18n();
const sessionStore = useSessionStore();
const showSendFilesModal = ref(false);
const itemsToSendData = ref<{ name: string; path: string; type: 'file' | 'directory' }[]>([]);

const isVisible = computed(() => !!props.payload);
const position = computed(() => props.payload?.position || { x: 0, y: 0 });
const menuItems = computed(() => props.payload?.items || []);
const activeContextItem = computed(() => props.payload?.activeContextItem || null);
const selectedFileItems = computed(() => props.payload?.selectedFileItems || []);
const currentDirectoryPath = computed(() => props.payload?.currentDirectoryPath || '/');

const sourceConnectionId = computed(() => {
  const activeConnId = sessionStore.activeSession?.connectionId;
  if (activeConnId) {
    const parsedId = parseInt(activeConnId, 10);
    return isNaN(parsedId) ? null : parsedId;
  }
  return null;
});

const contextMenuRef = ref<HTMLDivElement | null>(null);
const computedRenderPosition = ref({ x: 0, y: 0 }); // Initialize with default

watch(
  [isVisible, position], // Watch computed properties derived from payload
  ([newIsVisible, newPosition]) => {
    if (newIsVisible) {
      computedRenderPosition.value = { ...newPosition }; // Set initial position

      nextTick(() => {
        if (contextMenuRef.value) {
          const menuElement = contextMenuRef.value;
          const menuRect = menuElement.getBoundingClientRect();

          if (menuRect.width === 0 && menuRect.height === 0) return;

          let finalX = newPosition.x;
          let finalY = newPosition.y;
          const menuWidth = menuRect.width;
          const menuHeight = menuRect.height;
          const margin = 10;

          if (finalX + menuWidth > window.innerWidth) {
            finalX = window.innerWidth - menuWidth - margin;
          }
          if (finalY + menuHeight > window.innerHeight) {
            finalY = window.innerHeight - menuHeight - margin;
          }
          finalX = Math.max(margin, finalX);
          finalY = Math.max(margin, finalY);
          computedRenderPosition.value = { x: finalX, y: finalY };
        }
      });
    }
  },
  { deep: true, immediate: true }
);

// Removed handleClickOutside and its associated watch and onUnmounted logic.
// Closing is now handled by WorkspaceView by setting payload to null.

const emit = defineEmits<{
  (e: 'close', originalPayload: FileManagerContextMenuPayload): void;
}>();

const handleItemClick = (item: ContextMenuItem) => {
  if (item.action) {
    item.action();
  }
  if (props.payload) { // Always emit close if payload exists
    emit('close', props.payload);
  }
};

const handleSendToClick = () => {
  const itemsToSendLocal: { name: string; path: string; type: 'file' | 'directory' }[] = [];

  if (selectedFileItems.value.length > 0) {
    selectedFileItems.value.forEach(item => {
      const type = item.attrs.isDirectory ? 'directory' : 'file';
      let fullPath = currentDirectoryPath.value;
      if (!fullPath.endsWith('/')) fullPath += '/';
      fullPath += item.filename;
      fullPath = fullPath.replace(/(?<!:)\/\//g, '/');
      itemsToSendLocal.push({ name: item.filename, path: fullPath, type });
    });
  } else if (activeContextItem.value) {
    const item = activeContextItem.value;
    const type = item.attrs.isDirectory ? 'directory' : 'file';
    let fullPath = currentDirectoryPath.value;
    if (!fullPath.endsWith('/')) fullPath += '/';
    fullPath += item.filename;
    fullPath = fullPath.replace(/(?<!:)\/\//g, '/');
    itemsToSendLocal.push({ name: item.filename, path: fullPath, type });
  }

  itemsToSendData.value = itemsToSendLocal;
  showSendFilesModal.value = true;
  if (props.payload) {
    emit('close', props.payload);
  }
};

const handleFilesSent = (payload: any) => {
  console.log('Files to send (from FileManagerContextMenu):', payload);
  // 实际发送逻辑可以后续添加或委派
};



// 管理二级菜单的展开状态
const expandedSubmenu = ref<string | null>(null);
let closeTimeout: NodeJS.Timeout | null = null;

const showSubmenu = (label: string) => {
  if (closeTimeout) {
    clearTimeout(closeTimeout);
    closeTimeout = null;
  }
  expandedSubmenu.value = label;
};

const hideSubmenu = () => {
  closeTimeout = setTimeout(() => {
    expandedSubmenu.value = null;
    closeTimeout = null;
  }, 300); // 延迟300ms关闭
};

onUnmounted(() => {
  if (closeTimeout) {
    clearTimeout(closeTimeout);
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="contextMenuRef"
      v-if="isVisible && payload"
      class="fixed bg-background border border-border shadow-lg rounded-md z-[1002] min-w-[150px]"
      :style="{ top: `${computedRenderPosition.y}px`, left: `${computedRenderPosition.x}px` }"
      @click.stop
      @mousedown.stop
    >
      <ul class="list-none p-1 m-0">
        <template v-for="(menuItem, index) in menuItems" :key="index"> <!-- Use computed menuItems -->
          <li v-if="menuItem.separator" class="border-t border-border/50 my-1 mx-1"></li>
          <template v-else-if="isMobile && menuItem.submenu && menuItem.submenu.length > 0">
            <li
              v-for="(subItem, subIndex) in menuItem.submenu"
              :key="`${index}-${subIndex}`"
              @click.stop="handleItemClick(subItem)"
              :class="[
                'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
                'hover:bg-primary/10 hover:text-primary'
              ]"
            >
              {{ subItem.label }}
            </li>
            <template v-if="menuItem.label === t('fileManager.contextMenu.compress')">
              <li
                @click.stop="handleSendToClick"
                :class="[
                  'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
                  'hover:bg-primary/10 hover:text-primary'
                ]"
              >
                {{ t('fileManager.contextMenu.sendTo', 'Send to...') }}
              </li>
            </template>
          </template>
          <li
            v-else-if="!menuItem.submenu"
            @click.stop="handleItemClick(menuItem)"
            :class="[
              'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
              'hover:bg-primary/10 hover:text-primary'
            ]"
          >
            {{ menuItem.label }}
          </li>
          <template v-if="!menuItem.submenu && menuItem.label === t('fileManager.contextMenu.compress')">
            <li
              @click.stop="handleSendToClick"
              :class="[
                'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
                'hover:bg-primary/10 hover:text-primary'
              ]"
            >
              {{ t('fileManager.contextMenu.sendTo', 'Send to...') }}
            </li>
          </template>
          <li
            v-if="menuItem.submenu && !isMobile"
            class="px-4 py-1.5 text-foreground text-sm flex items-center justify-between transition-colors duration-150 rounded mx-1 hover:bg-primary/10 hover:text-primary relative"
            @mouseenter="showSubmenu(menuItem.label)"
            @mouseleave="hideSubmenu()"
          >
            {{ menuItem.label }}
            <span class="ml-2">›</span>
            <ul
              v-if="expandedSubmenu === menuItem.label"
              class="absolute left-full top-0 mt-0 ml-1 bg-background border border-border shadow-lg rounded-md z-[1003] min-w-[150px] list-none p-1"
              @mouseenter="showSubmenu(menuItem.label)"
              @mouseleave="hideSubmenu()"
            >
              <li
                v-for="(subItem, subIndex) in menuItem.submenu"
                :key="subIndex"
                @click.stop="handleItemClick(subItem)"
                :class="[
                  'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
                  'hover:bg-primary/10 hover:text-primary'
                ]"
              >
                {{ subItem.label }}
              </li>
            </ul>
          </li>
          <template v-if="menuItem.submenu && !isMobile && menuItem.label === t('fileManager.contextMenu.compress')">
            <li
              @click.stop="handleSendToClick"
              :class="[
                'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
                'hover:bg-primary/10 hover:text-primary'
              ]"
            >
              {{ t('fileManager.contextMenu.sendTo', 'Send to...') }}
            </li>
          </template>
        </template>
      </ul>
    </div>
    <SendFilesModal
      v-model:visible="showSendFilesModal"
      :items-to-send="itemsToSendData"
      :source-connection-id="sourceConnectionId"
      @send="handleFilesSent"
    />
  </Teleport>
</template>
