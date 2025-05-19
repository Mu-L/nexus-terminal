<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import TagInput from './TagInput.vue'; // Assuming TagInput is used here
import type { ProxyInfo } from '../stores/proxies.store'; // Corrected Proxy to ProxyInfo
import type { TagInfo } from '../stores/tags.store';     // Corrected Tag to TagInfo

// Define Props.
const props = defineProps<{
  formData: {
    type: 'SSH' | 'RDP' | 'VNC'; // Needed to conditionally show proxy selector
    proxy_id: number | null;
    tag_ids: number[];
    notes: string;
  };
  proxies: ProxyInfo[]; // List of available proxies
  tags: TagInfo[];    // List of available tags
  isProxyLoading: boolean;
  proxyStoreError: string | null;
  isTagLoading: boolean;
  tagStoreError: string | null;
}>();

// Define Emits for tag creation and deletion
const emit = defineEmits<{
  (e: 'create-tag', tagName: string): void;
  (e: 'delete-tag', tagId: number): void;
}>();

const { t } = useI18n();

const handleCreateTagEvent = (tagName: string) => {
  emit('create-tag', tagName);
};

const handleDeleteTagEvent = (tagId: number) => {
  emit('delete-tag', tagId);
};
</script>

<template>
  <!-- Advanced Options Section -->
  <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
    <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">{{ t('connections.form.sectionAdvanced', '高级选项') }}</h4>
    
    <!-- Proxy Select - Show only for SSH -->
    <div v-if="props.formData.type === 'SSH'">
      <label for="conn-proxy" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.proxy') }} ({{ t('connections.form.optional') }})</label>
      <select id="conn-proxy" v-model="props.formData.proxy_id"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
              style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
        <option :value="null">{{ t('connections.form.noProxy') }}</option>
        <option v-for="proxy in props.proxies" :key="proxy.id" :value="proxy.id">
          {{ proxy.name }} ({{ proxy.type }} - {{ proxy.host }}:{{ proxy.port }})
        </option>
      </select>
      <div v-if="props.isProxyLoading" class="mt-1 text-xs text-text-secondary">{{ t('proxies.loading') }}</div>
      <div v-if="props.proxyStoreError" class="mt-1 text-xs text-error">{{ t('proxies.error', { error: props.proxyStoreError }) }}</div>
    </div>

    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.tags') }} ({{ t('connections.form.optional') }})</label>
      <TagInput
          v-model="props.formData.tag_ids"
          :available-tags="props.tags"
          :allow-create="true"
          :allow-delete="true"
          @create-tag="handleCreateTagEvent"
          @delete-tag="handleDeleteTagEvent"
          :placeholder="t('tags.inputPlaceholder', '添加或选择标签...')"
      />
      <div v-if="props.isTagLoading" class="mt-1 text-xs text-text-secondary">{{ t('tags.loading') }}</div>
      <div v-if="props.tagStoreError" class="mt-1 text-xs text-error">{{ t('tags.error', { error: props.tagStoreError }) }}</div>
    </div>
    
    <!-- Notes Section -->
    <div>
      <label for="conn-notes" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.notes', '备注') }}</label>
      <textarea id="conn-notes" v-model="props.formData.notes" rows="3"
                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                :placeholder="t('connections.form.notesPlaceholder', '输入连接备注...')"></textarea>
    </div>
  </div>
</template>