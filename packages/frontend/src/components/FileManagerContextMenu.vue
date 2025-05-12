<script setup lang="ts">
import { type PropType } from 'vue';
import type { ContextMenuItem } from '../composables/file-manager/useFileManagerContextMenu'; // 导入菜单项类型

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

// 隐藏菜单的逻辑由 useFileManagerContextMenu 中的全局点击监听器处理
// 但我们仍然需要触发菜单项的 action，并通知父组件关闭菜单
const emit = defineEmits(['item-click', 'close-request']); // 添加 close-request

const handleItemClick = (item: ContextMenuItem) => {
  if (!item.disabled) {
    item.action(); // 直接执行 action
    emit('close-request'); // <-- 发出关闭请求
    // 不需要 emit('item-click', item) 了
  }
};
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
        <li
          v-else
          @click.stop="handleItemClick(menuItem)"
          :class="[
            'px-4 py-1.5 cursor-pointer text-foreground text-sm flex items-center transition-colors duration-150 rounded mx-1', // Added mx-1 for consistency
            menuItem.disabled
              ? 'text-text-secondary cursor-not-allowed opacity-60' // Removed bg-background for disabled
              : 'hover:bg-primary/10 hover:text-primary' // Use primary hover like TabBarContextMenu
          ]"
        >
          {{ menuItem.label }}
        </li>
      </template>
    </ul>
  </div>
</template>
