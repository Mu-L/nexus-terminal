<script setup lang="ts">
import { ref, computed, watch, type PropType, nextTick, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types';
import type { FileManagerActionPayload } from '../composables/workspaceEvents'; // +++ Import payload type

const props = defineProps({
  // isVisible is now controlled by the parent component (WorkspaceView)
  payload: {
    type: Object as PropType<FileManagerActionPayload | null>,
    default: null,
  },
});

const emit = defineEmits<{
  (e: 'close', originalPayload: FileManagerActionPayload): void;
  (e: 'confirm', originalPayload: FileManagerActionPayload, value?: string): void;
}>();

const { t } = useI18n();
const inputValue = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const isVisible = ref(false); // Internal visibility state, controlled by payload presence

// Define handleGlobalKeydown before the watch statement that uses it
const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (!isVisible.value) return; // Only act if modal is logically visible

  if (event.key === 'Escape') {
    closeModal();
  } else if (event.key === 'Enter') {
    if (showInput.value) {
      if (!isConfirmDisabled.value) {
        confirmAction();
      }
    } else { // For delete confirmation
      confirmAction();
    }
  }
};

watch(() => props.payload, (newPayload) => {
  isVisible.value = !!newPayload;
  if (newPayload) {
    inputValue.value = newPayload.initialValue || '';
    nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
    document.addEventListener('keydown', handleGlobalKeydown);
  } else {
    document.removeEventListener('keydown', handleGlobalKeydown);
  }
}, { immediate: true });


const actionType = computed(() => props.payload?.actionType);
const item = computed(() => props.payload?.item);
const items = computed(() => props.payload?.items || []);
// initialValue is directly used from props.payload.initialValue if needed, or from inputValue.value

const modalTitle = computed(() => {
  if (!props.payload) return '';
  switch (props.payload.actionType) {
    case 'delete':
      if (items.value.length > 1) {
        return t('fileManager.modals.titles.deleteMultiple', { count: items.value.length });
      } else if (items.value.length === 1) {
        return t('fileManager.modals.titles.delete', { name: items.value[0]?.filename || '' });
      } else {
        return t('fileManager.modals.titles.delete', { name: '' });
      }
    case 'rename':
      return t('fileManager.modals.titles.rename', { name: item.value?.filename || '' });
    case 'chmod':
      return t('fileManager.modals.titles.chmod', { name: item.value?.filename || '' });
    case 'newFile':
      return t('fileManager.modals.titles.newFile', 'Create New File');
    case 'newFolder':
      return t('fileManager.modals.titles.newFolder', 'Create New Folder');
    default:
      return '';
  }
});

const confirmButtonText = computed(() => {
  if (!props.payload) return t('fileManager.modals.buttons.confirm', 'Confirm');
  switch (props.payload.actionType) {
    case 'delete':
      return t('fileManager.modals.buttons.delete', 'Delete');
    case 'rename':
      return t('fileManager.modals.buttons.rename', 'Rename');
    case 'chmod':
      return t('fileManager.modals.buttons.changePermissions', 'Set Permissions');
    case 'newFile':
    case 'newFolder':
      return t('fileManager.modals.buttons.create', 'Create');
    default:
      return t('fileManager.modals.buttons.confirm', 'Confirm');
  }
});

const messageText = computed(() => {
  if (!props.payload || props.payload.actionType !== 'delete') return '';
  if (items.value.length > 1) {
    const names = items.value.map(i => i.filename).join(', ');
    return t('fileManager.modals.messages.confirmDeleteMultiple', { count: items.value.length, names: names });
  } else if (items.value.length === 1 && items.value[0]) {
    const singleItem = items.value[0];
    const type = singleItem.attrs.isDirectory
      ? t('fileManager.modals.labels.folder', 'folder')
      : t('fileManager.modals.labels.file', 'file');
    return t('fileManager.modals.messages.confirmDelete', { type: type, name: singleItem.filename });
  }
  return '';
});

const showInput = computed(() => {
  if (!props.payload) return false;
  return ['rename', 'chmod', 'newFile', 'newFolder'].includes(props.payload.actionType || '');
});

const inputLabel = computed(() => {
  if (!props.payload) return '';
  switch (props.payload.actionType) {
    case 'rename':
      return t('fileManager.modals.labels.newName', 'New name:');
    case 'chmod':
      return t('fileManager.modals.labels.newPermissions', 'New permissions (octal):');
    case 'newFile':
      return t('fileManager.modals.labels.fileName', 'File name:');
    case 'newFolder':
      return t('fileManager.modals.labels.folderName', 'Folder name:');
    default:
      return '';
  }
});

const inputPlaceholder = computed(() => {
  if (!props.payload) return '';
  switch (props.payload.actionType) {
    case 'rename':
      return item.value?.filename || t('fileManager.modals.placeholders.newName', 'Enter new name');
    case 'chmod':
      return props.payload.initialValue || '0755';
    case 'newFile':
      return t('fileManager.modals.placeholders.newFile', 'Enter file name');
    case 'newFolder':
      return t('fileManager.modals.placeholders.newFolder', 'Enter folder name');
    default:
      return '';
  }
});

const isConfirmDisabled = computed(() => {
  if (!props.payload) return true;
  if (!showInput.value) return false; // For delete, button is never disabled by input
  if (!inputValue.value.trim()) return true; // Disable if input is empty
  if (props.payload.actionType === 'rename' && inputValue.value.trim() === item.value?.filename) return true; // Disable if name is unchanged
  if (props.payload.actionType === 'chmod' && !/^[0-7]{3,4}$/.test(inputValue.value.trim())) return true; // Disable for invalid chmod format
  return false;
});


const closeModal = () => {
  if (props.payload) {
    emit('close', props.payload);
  }
  // isVisible will be set to false by parent via payload prop
};

const confirmAction = () => {
  if (!props.payload) return;
  if (isConfirmDisabled.value && showInput.value) return;

  if (props.payload.actionType === 'chmod' && inputValue.value.trim() && !/^[0-7]{3,4}$/.test(inputValue.value.trim())) {
    console.warn('Invalid chmod format submitted');
    return;
  }
  emit('confirm', props.payload, inputValue.value.trim());
  // isVisible will be set to false by parent via payload prop
};

// handleGlobalKeydown is now defined before the watch statement

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
});

</script>

<template>
  <Teleport to="body">
    <div v-if="isVisible && payload" class="fixed inset-0 bg-overlay flex justify-center items-center z-[100] p-4" @click.self="closeModal">
      <div class="bg-background text-foreground p-5 rounded-lg shadow-xl border border-border w-full max-w-md flex flex-col relative">
        <!-- Close Button -->
        <button class="absolute top-3 right-3 p-1 text-text-secondary hover:text-foreground z-10" @click="closeModal" :title="t('fileManager.modals.buttons.close', 'Close')">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
           </svg>
        </button>

        <!-- Title -->
        <h3 class="text-xl font-semibold text-center mb-4 flex-shrink-0">{{ modalTitle }}</h3>

        <!-- Content -->
        <div class="flex-grow mb-6 text-sm">
          <p v-if="actionType === 'delete'" class="text-center whitespace-pre-wrap">
            {{ messageText }}
          </p>

          <div v-if="showInput">
            <label :for="`fileManagerActionInput-${actionType}`" class="block text-sm font-medium text-text-secondary mb-1">
              {{ inputLabel }}
            </label>
            <input
              :id="`fileManagerActionInput-${actionType}`"
              ref="inputRef"
              type="text"
              v-model="inputValue"
              :placeholder="inputPlaceholder"
              class="w-full px-3 py-2 bg-input border border-border rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm text-foreground"
            />
            <p v-if="actionType === 'chmod' && inputValue.trim() && !/^[0-7]{3,4}$/.test(inputValue.trim())" class="mt-1 text-xs text-red-500">
              {{ t('fileManager.errors.invalidPermissionsFormat', 'Invalid octal format (e.g., 755 or 0755).') }}
            </p>
             <p v-else-if="actionType === 'chmod'" class="mt-1 text-xs text-text-tertiary">
              {{ t('fileManager.modals.chmodHelp', 'Enter permissions in octal format (e.g., 755 or 0755).') }}
            </p>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-3 flex-shrink-0">
          <button
            @click="closeModal"
            type="button"
            class="px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-background-dark text-sm font-medium transition-colors duration-150 bg-background border border-border/50 text-text-secondary hover:bg-border hover:text-foreground"
          >
            {{ t('fileManager.modals.buttons.cancel', 'Cancel') }}
          </button>
          <button
            @click="confirmAction"
            type="button"
            :disabled="isConfirmDisabled"
            class="px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-background-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :class="{
              'bg-red-600 hover:bg-red-700 focus:ring-red-500': actionType === 'delete',
              'bg-primary hover:bg-primary-hover focus:ring-primary': actionType !== 'delete'
            }"
          >
            {{ confirmButtonText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Styles can be further refined or rely on global Tailwind utility classes */
</style>