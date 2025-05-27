<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { storeToRefs } from 'pinia';

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const notificationsStore = useUiNotificationsStore();
const {
  terminalBackgroundImage,
  isTerminalBackgroundEnabled,
  currentTerminalBackgroundOverlayOpacity,
  terminalCustomHTML, 
} = storeToRefs(appearanceStore);

const localTerminalBackgroundEnabled = ref(true);
const editableTerminalBackgroundOverlayOpacity = ref(0.5);
const localTerminalCustomHTML = ref(''); 

const terminalBgFileInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);

const initializeEditableState = () => {
  localTerminalBackgroundEnabled.value = isTerminalBackgroundEnabled.value;
  editableTerminalBackgroundOverlayOpacity.value = currentTerminalBackgroundOverlayOpacity.value;
  localTerminalCustomHTML.value = terminalCustomHTML.value || ''; 
  uploadError.value = null;
};

onMounted(initializeEditableState);

watch(isTerminalBackgroundEnabled, (newValue) => {
  if (localTerminalBackgroundEnabled.value !== newValue) {
    localTerminalBackgroundEnabled.value = newValue;
  }
});

watch(currentTerminalBackgroundOverlayOpacity, (newValue) => {
  if (editableTerminalBackgroundOverlayOpacity.value !== newValue) {
    editableTerminalBackgroundOverlayOpacity.value = newValue;
  }
});


watch(terminalCustomHTML, (newValue) => {
  if (localTerminalCustomHTML.value !== (newValue || '')) {
    localTerminalCustomHTML.value = newValue || '';
  }
});

const handleTriggerTerminalBgUpload = () => {
    uploadError.value = null;
    terminalBgFileInput.value?.click();
};


const handleTerminalBgUpload = async (event: Event) => {
     const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
            await appearanceStore.uploadTerminalBackground(file);
            notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.terminalBgUploadSuccess') });
            input.value = '';
        } catch (error: any) {
            const determinedErrorMessage = error.message || t('styleCustomizer.uploadFailed');
            uploadError.value = determinedErrorMessage;
            notificationsStore.addNotification({ type: 'error', message: determinedErrorMessage }); // 显示错误通知
            input.value = '';
        }
    }
};

const handleRemoveTerminalBg = async () => {
    try {
        await appearanceStore.removeTerminalBackground();
        notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.terminalBgRemoved') });
    } catch (error: any) {
         console.error("移除终端背景失败:", error);
         notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.removeBgFailed', { message: error.message }) });
    }
};

// 处理终端背景启用/禁用切换
const handleToggleTerminalBackground = async () => {
    const newValue = !localTerminalBackgroundEnabled.value; // 先计算新值
    localTerminalBackgroundEnabled.value = newValue; // 立即更新本地 UI
    try {
        await appearanceStore.setTerminalBackgroundEnabled(newValue);
        // 成功后不需要提示，UI 已更新
    } catch (error: any) {
        console.error("更新终端背景启用状态失败:", error);
        // 失败时回滚本地状态
        localTerminalBackgroundEnabled.value = !newValue;
        notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.errorToggleTerminalBg', { message: error.message }) });
    }
};

// 保存终端背景蒙版透明度
const handleSaveTerminalBackgroundOverlayOpacity = async () => {
  try {
    const opacity = Number(editableTerminalBackgroundOverlayOpacity.value);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
      notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.errorInvalidOpacityValue') });
      return;
    }
    await appearanceStore.setTerminalBackgroundOverlayOpacity(opacity);
    notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.terminalBgOverlayOpacitySaved') });
  } catch (error: any) {
    console.error("保存终端背景蒙版透明度失败:", error);
    notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.terminalBgOverlayOpacitySaveFailed', { message: error.message }) });
  }
};


const handleSaveCustomHTML = async () => {
  try {
    await appearanceStore.setTerminalCustomHTML(localTerminalCustomHTML.value);
    notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.customTerminalHTMLSaved') });
  } catch (error: any) {
    console.error("保存自定义终端 HTML 失败:", error);
    notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.customTerminalHTMLSaveFailed', { message: error.message }) });
  }
};

</script>

<template>
  <section>
    <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.backgroundSettings') }}</h3>


    <hr class="my-4 md:my-8 border-border">

    <!-- 终端背景 -->
    <div class="flex items-center justify-between mb-3">
      <h4 class="m-0 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalBackground') }}</h4>
      
      <button
        type="button"
        @click="handleToggleTerminalBackground"
        :class="[
          'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
          localTerminalBackgroundEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
        ]"
        role="switch"
        :aria-checked="localTerminalBackgroundEnabled"
      >
        <span
          aria-hidden="true"
          :class="[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
            localTerminalBackgroundEnabled ? 'translate-x-5' : 'translate-x-0'
          ]"
        ></span>
      </button>
    </div>

     
     <div v-if="localTerminalBackgroundEnabled">
       <div class="w-full h-[100px] md:h-[150px] border border-dashed border-border mb-2 flex justify-center items-center text-text-secondary bg-cover bg-center bg-no-repeat rounded bg-header relative overflow-hidden" :style="{ backgroundImage: terminalBackgroundImage ? `url(${terminalBackgroundImage})` : 'none' }">
           <!-- 实时预览蒙版 -->
           <div
             v-if="terminalBackgroundImage"
             class="absolute inset-0"
             :style="{ backgroundColor: `rgba(0, 0, 0, ${editableTerminalBackgroundOverlayOpacity})` }"
           ></div>
           <span v-if="!terminalBackgroundImage" class="bg-white/80 px-3 py-1.5 rounded text-sm font-medium text-foreground shadow-sm relative z-10">{{ t('styleCustomizer.noBackground') }}</span>
       </div>
     <div class="flex gap-2 mb-4 flex-wrap items-center">
        <button @click="handleTriggerTerminalBgUpload" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.uploadTerminalBg') }}</button>
        <button @click="handleRemoveTerminalBg" :disabled="!terminalBackgroundImage" class="px-3 py-1.5 text-sm border rounded transition duration-200 ease-in-out whitespace-nowrap bg-error/10 text-error border-error/30 hover:bg-error/20 disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.removeTerminalBg') }}</button>
        <input type="file" ref="terminalBgFileInput" @change="handleTerminalBgUpload" accept="image/*" class="hidden" />
     </div>

     <!-- 终端背景蒙版透明度控制 -->
     <div class="mt-4 pt-4 border-t border-border/50">
        <label for="terminalBgOverlayOpacity" class="block text-sm font-medium text-foreground mb-1">{{ t('styleCustomizer.terminalBgOverlayOpacity', '终端背景蒙版透明度:') }}</label>
        <div class="flex items-center gap-3">
            <input
              type="range"
              id="terminalBgOverlayOpacity"
              v-model.number="editableTerminalBackgroundOverlayOpacity"
              min="0"
              max="1"
              step="0.01"
              class="w-full cursor-pointer accent-primary"
            />
            <span class="text-sm text-foreground min-w-[3em] text-right">{{ editableTerminalBackgroundOverlayOpacity.toFixed(2) }}</span>
            <button @click="handleSaveTerminalBackgroundOverlayOpacity" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap">{{ t('common.save') }}</button>
        </div>
     </div>

     <!-- 自定义终端背景 HTML -->
     <div class="mt-4 pt-4 border-t border-border/50">
        <label for="terminalCustomHTML" class="block text-sm font-medium text-foreground mb-1">{{ t('styleCustomizer.customTerminalHTML', '自定义终端背景 HTML') }}</label>
        <textarea
          id="terminalCustomHTML"
          v-model="localTerminalCustomHTML"
          rows="10"
          class="w-full p-2 border border-border rounded bg-input text-foreground focus:ring-primary focus:border-primary"
          :placeholder="t('styleCustomizer.customTerminalHTMLPlaceholder', '例如：<h1>Hello</h1>')"
        ></textarea>
        <div class="mt-2 flex justify-end">
          <button
            @click="handleSaveCustomHTML"
            class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="p-4 text-center text-text-secondary italic border border-dashed border-border/50 rounded-md">
      {{ t('styleCustomizer.terminalBgDisabled', '终端背景功能已禁用。') }}
    </div>
  </section>
</template>