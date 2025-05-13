<script setup lang="ts">
import { ref, type PropType } from 'vue';
import type { ContextMenuItem } from '../composables/file-manager/useFileManagerContextMenu'; // 导入菜单项类型
import { onUnmounted } from 'vue';
import { useDeviceDetection } from '../composables/useDeviceDetection';

defineProps({
  isVisible: {
    type: Boolean,
    required: true,
  },
  position: {
    type: Object as PropType<{ x: number; y: number }>,
    required: true,
  },
  items: {
    type: Array as PropType<ContextMenuItem[]>,
    required: true,
  },
});

const { isMobile } = useDeviceDetection();

// 隐藏菜单的逻辑由 useFileManagerContextMenu 中的全局点击监听器处理
// 但我们仍然需要触发菜单项的 action，并通知父组件关闭菜单
const emit = defineEmits(['item-click', 'close-request']); // 添加 close-request

const handleItemClick = (item: ContextMenuItem) => {
  if (!item.disabled && item.action) {
    item.action(); // 只有当 action 存在时才执行
    emit('close-request'); // <-- 发出关闭请求
  }
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
  <div
    v-if="isVisible"
    class="fixed bg-background border border-border shadow-lg rounded-md z-[1002] min-w-[150px]"
    :style="{ top: `${position.y}px`, left: `${position.x}px` }"
    @click.stop
  >
    <ul class="list-none p-1 m-0">
      <template v-for="(menuItem, index) in items" :key="index">
        <li v-if="menuItem.separator" class="border-t border-border/50 my-1 mx-1"></li>
        <!-- 如果是移动设备且有子菜单，则平铺子菜单 -->
        <template v-else-if="isMobile && menuItem.submenu && menuItem.submenu.length > 0">
          <li
            v-for="(subItem, subIndex) in menuItem.submenu"
            :key="`${index}-${subIndex}`"
            @click.stop="handleItemClick(subItem)"
            :class="[
              'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
              subItem.disabled
                ? 'text-text-secondary cursor-not-allowed opacity-60'
                : 'hover:bg-primary/10 hover:text-primary'
            ]"
          >
            {{ subItem.label }}
          </li>
        </template>
        <!-- 否则，按原有逻辑渲染一级菜单或带子菜单的一级菜单 -->
        <li
          v-else-if="!menuItem.submenu"
          @click.stop="handleItemClick(menuItem)"
          :class="[
            'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1',
            menuItem.disabled
              ? 'text-text-secondary cursor-not-allowed opacity-60'
              : 'hover:bg-primary/10 hover:text-primary'
          ]"
        >
          {{ menuItem.label }}
        </li>
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
                subItem.disabled
                  ? 'text-text-secondary cursor-not-allowed opacity-60'
                  : 'hover:bg-primary/10 hover:text-primary'
              ]"
            >
              {{ subItem.label }}
            </li>
          </ul>
        </li>
      </template>
    </ul>
  </div>
</template>
