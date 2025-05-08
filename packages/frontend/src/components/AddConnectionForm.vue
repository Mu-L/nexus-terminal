<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import apiClient from '../utils/apiClient'; 
import { useConnectionsStore, ConnectionInfo } from '../stores/connections.store';
import { useProxiesStore } from '../stores/proxies.store'; 
import { useTagsStore } from '../stores/tags.store';
import { useSshKeysStore } from '../stores/sshKeys.store'; // +++ Import SSH Key store +++
import TagInput from './TagInput.vue';
import SshKeySelector from './SshKeySelector.vue'; // +++ Import SSH Key Selector +++

// 定义组件发出的事件
const emit = defineEmits(['close', 'connection-added', 'connection-updated']);

// 定义 Props
const props = defineProps<{
  connectionToEdit: ConnectionInfo | null; // 接收要编辑的连接对象
}>();

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const proxiesStore = useProxiesStore(); // 获取代理 store 实例
const tagsStore = useTagsStore(); // 获取标签 store 实例
const { isLoading: isConnLoading, error: connStoreError } = storeToRefs(connectionsStore);
const { proxies, isLoading: isProxyLoading, error: proxyStoreError } = storeToRefs(proxiesStore); // 获取代理列表和状态
const { tags, isLoading: isTagLoading, error: tagStoreError } = storeToRefs(tagsStore); // 获取标签列表和状态
const sshKeysStore = useSshKeysStore(); // +++ Get SSH Key store instance +++
const { isLoading: isSshKeyLoading, error: sshKeyStoreError } = storeToRefs(sshKeysStore); // +++ Get SSH Key store state +++

// 表单数据模型
const initialFormData = {
  type: 'SSH' as 'SSH' | 'RDP' | 'VNC', // Use uppercase to match ConnectionInfo
  name: '',
  host: '',
  port: 22,
  username: '',
  auth_method: 'password' as 'password' | 'key', // SSH specific
  password: '',
  private_key: '', // SSH specific (for direct input)
  passphrase: '', // SSH specific (for direct input)
  selected_ssh_key_id: null as number | null, // +++ Add field for selected key ID +++
  proxy_id: null as number | null,
  tag_ids: [] as number[], // 新增 tag_ids 字段
  notes: '', // 新增备注字段
  vncPassword: '', // VNC specific password
  // Add RDP specific fields later if needed, e.g., domain
};
const formData = reactive({ ...initialFormData });

const formError = ref<string | null>(null); // 表单级别的错误信息
// 合并所有 store 的加载和错误状态
const isLoading = computed(() => isConnLoading.value || isProxyLoading.value || isTagLoading.value || isSshKeyLoading.value); // +++ Include SSH Key loading +++
const storeError = computed(() => connStoreError.value || proxyStoreError.value || tagStoreError.value || sshKeyStoreError.value); // +++ Include SSH Key error +++

// 测试连接状态
const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const testResult = ref<string | number | null>(null); // 存储延迟或错误信息
const testLatency = ref<number | null>(null); // 单独存储延迟用于颜色计算

// 计算属性判断是否为编辑模式
const isEditMode = computed(() => !!props.connectionToEdit);

// 计算属性动态设置表单标题
const formTitle = computed(() => {
    return isEditMode.value ? t('connections.form.titleEdit') : t('connections.form.title');
});

// 计算属性动态设置提交按钮文本
const submitButtonText = computed(() => {
    // 使用合并后的 isLoading
    if (isLoading.value) {
        return isEditMode.value ? t('connections.form.saving') : t('connections.form.adding');
    }
    return isEditMode.value ? t('connections.form.confirmEdit') : t('connections.form.confirm');
});

// 监听 prop 变化以填充或重置表单
watch(() => props.connectionToEdit, (newVal) => {
    formError.value = null; // 清除错误
    if (newVal) {
        // 编辑模式：填充表单，但不填充敏感信息
        formData.type = newVal.type as 'SSH' | 'RDP' | 'VNC'; // Correctly set the type for editing
        formData.name = newVal.name;
        formData.host = newVal.host;
        formData.port = newVal.port;
        formData.username = newVal.username;
        formData.auth_method = newVal.auth_method;
        formData.proxy_id = newVal.proxy_id ?? null;
formData.notes = newVal.notes ?? ''; // 填充备注
       formData.tag_ids = newVal.tag_ids ? [...newVal.tag_ids] : []; // 填充 tag_ids (深拷贝)

       // +++ 填充 selected_ssh_key_id (如果认证方式是 key) +++
       if (newVal.type === 'SSH' && newVal.auth_method === 'key') {
           formData.selected_ssh_key_id = newVal.ssh_key_id ?? null;
       } else {
           formData.selected_ssh_key_id = null; // 清空
       }

       // 清空敏感字段
       formData.password = ''; // For SSH/RDP
       formData.private_key = '';
       formData.passphrase = '';
       // formData.vncPassword is already handled by initialFormData or cleared if not VNC
       if (newVal.type !== 'VNC') {
            formData.vncPassword = '';
       } else {
           // If editing a VNC connection, we don't get vncPassword from backend directly.
           // User needs to re-enter if they want to change it.
           // For display, it's kept empty.
           formData.vncPassword = '';
       }


   } else {
       // 添加模式：重置表单
       Object.assign(formData, initialFormData);
       formData.tag_ids = []; // 确保 tag_ids 也被重置为空数组
       formData.selected_ssh_key_id = null; // 确保添加模式下也重置
       formData.notes = ''; // 重置备注
       formData.vncPassword = ''; // 重置VNC密码
    }
}, { immediate: true });

// 组件挂载时获取代理、标签和 SSH 密钥列表
onMounted(() => {
    proxiesStore.fetchProxies();
    tagsStore.fetchTags(); // 获取标签列表
    sshKeysStore.fetchSshKeys(); // +++ Fetch SSH keys +++
});

// 监听连接类型变化，动态调整默认端口
watch(() => formData.type, (newType) => {
    // Use uppercase for comparison
    if (newType === 'RDP') {
        if (formData.port === 22 || formData.port === 5900 || formData.port === 5901) formData.port = 3389; // RDP 默认端口
        formData.auth_method = 'password'; // RDP uses password
        formData.selected_ssh_key_id = null; // Clear SSH key selection
    } else if (newType === 'SSH') {
        if (formData.port === 3389 || formData.port === 5900 || formData.port === 5901) formData.port = 22; // SSH 默认端口
        // auth_method will be handled by its own select
    } else if (newType === 'VNC') {
        if (formData.port === 22 || formData.port === 3389) formData.port = 5900; // VNC 默认端口 (e.g., 5900 or 5901)
        formData.auth_method = 'password'; // VNC uses password, hide auth_method selector
        formData.selected_ssh_key_id = null; // Clear SSH key selection
    }
});

// 处理表单提交
const handleSubmit = async () => {
  formError.value = null;
  connectionsStore.error = null;
  proxiesStore.error = null; // 同时清除代理 store 的错误

  // 基础前端验证 (移除名称验证)
  if (!formData.host || !formData.username) { // 移除 !formData.name
    formError.value = t('connections.form.errorRequiredFields'); // 保持通用错误消息，或可以细化
    return;
  }
  if (formData.port <= 0 || formData.port > 65535) {
      formError.value = t('connections.form.errorPort');
      return;
  }

  // --- 更新后的验证逻辑 (区分 SSH 和 RDP) ---
  // Use uppercase for comparison
  if (formData.type === 'SSH') {
      // SSH Validation
      // 1. 添加模式下，密码/密钥是必填的
      if (!isEditMode.value) {
          if (formData.auth_method === 'password' && !formData.password) {
              formError.value = t('connections.form.errorPasswordRequired');
              return;
          }
          // 当认证方式为 key 时，必须选择一个已保存的密钥
          if (formData.auth_method === 'key' && !formData.selected_ssh_key_id) {
              formError.value = t('connections.form.errorSshKeyRequired'); // 需要添加新的翻译键
              return;
          }
      }
      // 2. 编辑模式下，如果切换到密码认证，则密码必填
      else if (isEditMode.value && formData.auth_method === 'password' && !formData.password) {
          // 检查原始连接的认证方式，如果原始不是密码，则切换时必须提供密码
          // 注意: props.connectionToEdit 可能没有 type 字段，需要后端配合或前端自行判断
          if (props.connectionToEdit?.auth_method !== 'password') {
              formError.value = t('connections.form.errorPasswordRequiredOnSwitch');
              return;
          }
          // 如果原始就是密码，编辑时密码可以不填（表示不修改）
      }
      // 3. 编辑模式下，如果切换到密钥认证，必须选择一个密钥
      else if (isEditMode.value && formData.auth_method === 'key' && !formData.selected_ssh_key_id) {
           // 检查原始连接的认证方式，如果原始不是密钥，则切换时必须选择一个密钥
           if (props.connectionToEdit?.auth_method !== 'key') {
               formError.value = t('connections.form.errorSshKeyRequiredOnSwitch'); // 需要添加新的翻译键
               return;
           }
           // 如果原始就是密钥，编辑时可以不选择新的密钥（表示不修改关联的密钥）
           // 但如果用户清除了选择，则需要提示
           // 注意：当前逻辑下，如果 selected_ssh_key_id 为 null，则会触发此验证
      }
  // Use uppercase for comparison
  } else if (formData.type === 'RDP') {
      // RDP Validation
      // 1. 添加模式下，密码是必填的
      if (!isEditMode.value && !formData.password) {
          formError.value = t('connections.form.errorPasswordRequired');
          return;
      }
      // 2. 编辑模式下，密码可以不填（表示不修改）
  } else if (formData.type === 'VNC') {
      // VNC Validation
      // 1. 添加模式下，VNC密码是必填的
      if (!isEditMode.value && !formData.vncPassword) {
          formError.value = t('connections.form.errorVncPasswordRequired', 'VNC 密码是必填项。'); // Add new translation key
          return;
      }
      // 2. 编辑模式下，VNC密码可以不填（表示不修改）
  }
  // --- 验证逻辑结束 ---


  // 构建要发送的数据 (区分添加和编辑)
  const dataToSend: any = {
      type: formData.type, // 发送连接类型
      name: formData.name,
      host: formData.host,
      port: formData.port,
notes: formData.notes, // 添加备注
      username: formData.username,
      proxy_id: formData.proxy_id || null,
      tag_ids: formData.tag_ids || [], // 发送 tag_ids
      // domain: formData.domain, // 如果添加了 domain 字段
  };

  // 处理认证相关字段 (根据类型)
  // Use uppercase for comparison
  if (formData.type === 'SSH') {
      dataToSend.auth_method = formData.auth_method;
      if (formData.auth_method === 'password') {
          // SSH 密码处理
          if (formData.password) {
              dataToSend.password = formData.password;
          } else if (isEditMode.value && formData.password === '') {
              // 编辑模式下，空密码字符串可能表示清空或不修改，取决于后端实现
              // 假设发送 null 表示清空 (如果后端支持)
              // dataToSend.password = null;
              // 或者不发送 password 字段表示不修改
          }
      } else if (formData.auth_method === 'key') {
          // +++ SSH 密钥处理 (只处理 selected_ssh_key_id) +++
          if (formData.selected_ssh_key_id) {
              // 如果选择了已保存的密钥，只发送 ID
              dataToSend.ssh_key_id = formData.selected_ssh_key_id;
          } else if (isEditMode.value && props.connectionToEdit?.auth_method === 'key') {
              // 编辑模式下，如果原始是密钥认证且未选择新密钥，则不发送 ssh_key_id (表示不更改)
              // 如果原始不是密钥认证，切换到密钥时必须选择一个 (已在验证逻辑中处理)
          } else {
               // 添加模式下，如果 auth_method 是 key 但没有选择 key，验证逻辑会阻止提交
               // 因此这里不需要特殊处理，可以安全地将 ssh_key_id 设为 null 或不设置
               dataToSend.ssh_key_id = null; // 或者 delete dataToSend.ssh_key_id;
          }
          // 确保不发送直接输入的密钥信息
          delete dataToSend.private_key;
          delete dataToSend.passphrase;
      }
  // Use uppercase for comparison
  } else if (formData.type === 'RDP') {
      // RDP 密码处理 (通常 RDP 没有 auth_method 选择)
      if (formData.password) {
          dataToSend.password = formData.password;
      } else if (isEditMode.value && formData.password === '') {
          // 编辑 RDP 时，空密码字符串处理逻辑同上
          // dataToSend.password = null;
      }
      // RDP 不发送 SSH 特有的字段
      delete dataToSend.auth_method;
      delete dataToSend.private_key;
      delete dataToSend.passphrase;
      delete dataToSend.vncPassword; // Ensure VNC password field for form doesn't go if RDP
  } else if (formData.type === 'VNC') {
     // VNC data population
     if (formData.vncPassword) {
         dataToSend.password = formData.vncPassword; // Backend expects VNC password in 'password' field
     } else if (isEditMode.value && formData.vncPassword === '') {
         // Editing VNC, empty password means don't change
     }
     // VNC does not use SSH specific fields
     delete dataToSend.auth_method;
     delete dataToSend.private_key;
     delete dataToSend.passphrase;
     delete dataToSend.ssh_key_id;
     // formData.vncPassword is used for the form, but backend might expect it as 'password'
     // So, we don't send 'vncPassword' itself to backend.
  }


  let success = false;
  if (isEditMode.value && props.connectionToEdit) {
      // 调用更新 action
      success = await connectionsStore.updateConnection(props.connectionToEdit.id, dataToSend);
      if (success) {
          emit('connection-updated'); // 发出更新成功事件
      } else {
          formError.value = t('connections.form.errorUpdate', { error: connectionsStore.error || '未知错误' });
      }
  } else {
      // 调用添加 action
      success = await connectionsStore.addConnection(dataToSend);
      if (success) {
          emit('connection-added'); // 发出添加成功事件
      } else {
          formError.value = t('connections.form.errorAdd', { error: connectionsStore.error || '未知错误' });
      }
  }
};

// --- Tag Creation/Deletion Handling ---
const handleCreateTag = async (tagName: string) => {
    console.log(`[ConnForm] Received create-tag event for: ${tagName}`); // +++ 添加日志 +++
    if (!tagName || tagName.trim().length === 0) return;
    console.log(`[ConnForm] Calling tagsStore.addTag...`); // +++ 添加日志 +++
    const newTag = await tagsStore.addTag(tagName.trim()); // Use the correct store
    if (newTag && !formData.tag_ids.includes(newTag.id)) {
        console.log(`[ConnForm] New tag created (ID: ${newTag.id}), adding to selection.`); // +++ 添加日志 +++
        // Add the new tag's ID to the selected list
        formData.tag_ids.push(newTag.id);
    }
};

const handleDeleteTag = async (tagId: number) => {
    const tagToDelete = tags.value.find(t => t.id === tagId);
    if (!tagToDelete) return;

    if (confirm(t('tags.prompts.confirmDelete', { name: tagToDelete.name }))) {
        const success = await tagsStore.deleteTag(tagId); // Use the correct store
        if (success) {
            // TagInput's modelValue will update automatically via watch
            // No need to manually remove from formData.tag_ids here
        } else {
            // Optional: Show error notification if deletion fails
            alert(t('tags.errorDelete', { error: tagsStore.error || '未知错误' }));
        }
    }
};

// 处理测试连接
const handleTestConnection = async () => {
  testStatus.value = 'testing';
  testResult.value = null;
  testLatency.value = null;

  try {
    let response;
    if (isEditMode.value && props.connectionToEdit) {
      // --- 编辑模式: 测试已保存的连接 ---
      console.log(`Testing saved connection ID: ${props.connectionToEdit.id}`);
      // 调用测试已保存连接的 API
      response = await apiClient.post(`/connections/${props.connectionToEdit.id}/test`);
    } else {
      // --- 添加模式: 测试未保存的连接 ---
      console.log("Testing unsaved connection data");
      // 准备要发送的数据
      const dataToSend = {
          host: formData.host,
          port: formData.port,
          username: formData.username,
          auth_method: formData.auth_method,
          password: formData.auth_method === 'password' ? formData.password : undefined,
          // private_key: formData.auth_method === 'key' ? formData.private_key : undefined, // Removed
          // passphrase: formData.auth_method === 'key' ? formData.passphrase : undefined, // Removed
          proxy_id: formData.proxy_id || null,
          // +++ Add ssh_key_id for testing +++
          ssh_key_id: formData.auth_method === 'key' ? formData.selected_ssh_key_id : undefined,
      };

      // 仅在添加模式下进行前端凭证验证
      if (!dataToSend.host || !dataToSend.port || !dataToSend.username || !dataToSend.auth_method) {
        // 使用 Error 抛出，由下面的 catch 块统一处理显示
        throw new Error(t('connections.test.errorMissingFields'));
      }
      // 在添加模式下，密码或密钥必须提供
      if (dataToSend.auth_method === 'password' && !formData.password) { // 检查 formData 而不是 dataToSend.password
         throw new Error(t('connections.form.errorPasswordRequired')); // 复用表单提交的翻译键
     }
     // +++ Check selected key for testing +++
     if (dataToSend.auth_method === 'key' && !dataToSend.ssh_key_id) {
        throw new Error(t('connections.form.errorSshKeyRequired')); // 使用新的翻译键
     }

      // 调用测试未保存连接的 API
      response = await apiClient.post('/connections/test-unsaved', dataToSend);
    }

    // --- 处理 API 响应 (对两种模式通用) ---
    if (response.data.success) {
      testStatus.value = 'success';
      testLatency.value = response.data.latency; // 两个测试 API 现在都返回 latency
      testResult.value = `${response.data.latency} ms`;
    } else {
      // 如果后端 API 返回 success: false (理论上不应发生，但作为保险)
      testStatus.value = 'error';
      testResult.value = response.data.message || t('connections.test.errorUnknown');
    }

  } catch (error: any) {
    // --- 统一处理错误 (前端验证错误或 API 调用错误) ---
    console.error('测试连接失败:', error);
    testStatus.value = 'error';
    if (error.response && error.response.data && error.response.data.message) {
      // API 返回的错误信息
      testResult.value = error.response.data.message;
    } else {
      // 前端验证错误 (error.message) 或 网络/其他错误
      testResult.value = error.message || t('connections.test.errorNetwork');
    }
  }
};

// 计算延迟颜色
const latencyColor = computed(() => {
  if (testStatus.value !== 'success' || testLatency.value === null) {
    return 'inherit'; // 默认颜色
  }
  const latency = testLatency.value;
  if (latency < 100) return 'var(--color-success, #28a745)'; // 绿色
  if (latency < 500) return 'var(--color-warning, #ffc107)'; // 黄色
  return 'var(--color-danger, #dc3545)'; // 红色
});

// 计算测试按钮文本
const testButtonText = computed(() => {
    if (testStatus.value === 'testing') {
        return t('connections.form.testing'); // 新增翻译键
    }
    return t('connections.form.testConnection'); // 新增翻译键
});

</script>

<template>
  <div class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"> <!-- Overlay -->
    <div class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"> <!-- Form Panel -->
      <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">{{ formTitle }}</h3> <!-- Title -->
      <form @submit.prevent="handleSubmit" class="flex-grow overflow-y-auto pr-2 space-y-6"> <!-- Form with scroll and spacing -->

        <!-- Basic Info Section -->
        <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
          <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">{{ t('connections.form.sectionBasic', '基本信息') }}</h4>
          <div>
            <label for="conn-name" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.name') }} ({{ t('connections.form.optional') }})</label>
            <input type="text" id="conn-name" v-model="formData.name"
                   class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
          </div>
          <!-- Connection Type -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.connectionType', '连接类型') }}</label>
            <div class="flex rounded-md shadow-sm">
              <button type="button"
                      @click="formData.type = 'SSH'"
                      :class="['flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none',
                               formData.type === 'SSH' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                               'rounded-l-md']">
                {{ t('connections.form.typeSsh', 'SSH') }}
              </button>
              <button type="button"
                      @click="formData.type = 'RDP'"
                      :class="['flex-1 px-3 py-2 border-t border-b border-r border-border text-sm font-medium focus:outline-none -ml-px',
                               formData.type === 'RDP' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border']">
                {{ t('connections.form.typeRdp', 'RDP') }}
              </button>
              <button type="button"
                      @click="formData.type = 'VNC'"
                      :class="['flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none -ml-px',
                               formData.type === 'VNC' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                               'rounded-r-md']">
                {{ t('connections.form.typeVnc', 'VNC') }}
              </button>
            </div>
          </div>
          <!-- Host and Port Row -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="md:col-span-2">
              <label for="conn-host" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.host') }}</label>
              <input type="text" id="conn-host" v-model="formData.host" required
                     class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            <div>
              <label for="conn-port" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.port') }}</label>
              <input type="number" id="conn-port" v-model.number="formData.port" required min="1" max="65535"
                     class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
          </div>
        </div>

        <!-- Authentication Section -->
        <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
           <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">{{ t('connections.form.sectionAuth', '认证信息') }}</h4>
           <div>
             <label for="conn-username" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.username') }}</label>
             <input type="text" id="conn-username" v-model="formData.username" required
                    class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
          </div>

          <!-- SSH Specific Auth -->
          <!-- Use uppercase for comparison -->
          <template v-if="formData.type === 'SSH'">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.authMethod') }}</label>
              <div class="flex rounded-md shadow-sm">
                <button type="button"
                        @click="formData.auth_method = 'password'"
                        :class="['flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none',
                                 formData.auth_method === 'password' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                                 'rounded-l-md']">
                  {{ t('connections.form.authMethodPassword') }}
                </button>
                <button type="button"
                        @click="formData.auth_method = 'key'"
                        :class="['flex-1 px-3 py-2 border-t border-b border-r border-border text-sm font-medium focus:outline-none -ml-px',
                                 formData.auth_method === 'key' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                                 'rounded-r-md']">
                  {{ t('connections.form.authMethodKey') }}
                </button>
              </div>
            </div>

            <div v-if="formData.auth_method === 'password'">
              <label for="conn-password" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.password') }}</label>
              <input type="password" id="conn-password" v-model="formData.password" :required="formData.auth_method === 'password' && !isEditMode" autocomplete="new-password"
                     class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>

            <div v-if="formData.auth_method === 'key'" class="space-y-4">
              <!-- +++ SSH Key Selector +++ -->
              <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.sshKey') }}</label>
                  <SshKeySelector v-model="formData.selected_ssh_key_id" />
              </div>

              <!-- Direct Key Input Removed -->
               <!-- Note for selected key -->
               <!-- <div v-if="isEditMode && formData.auth_method === 'key' && formData.selected_ssh_key_id">
                    <small class="block text-xs text-text-secondary">{{ t('connections.form.keyUpdateNoteSelected') }}</small>
               </div> -->
            </div>
          </template>

          <!-- RDP Specific Auth (Password only for now) -->
          <!-- Use uppercase for comparison -->
          <template v-if="formData.type === 'RDP'">
             <div>
               <label for="conn-password-rdp" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.password') }}</label>
               <input type="password" id="conn-password-rdp" v-model="formData.password" :required="!isEditMode" autocomplete="new-password"
                      class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
               <!-- Add domain field if needed -->
               <!--
               <label for="conn-domain" class="block text-sm font-medium text-text-secondary mb-1 mt-4">{{ t('connections.form.domain', '域') }} ({{ t('connections.form.optional') }})</label>
               <input type="text" id="conn-domain" v-model="formData.domain"
                      class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
               -->
             </div>
           </template>

          <!-- VNC Specific Auth (Password only) -->
          <template v-if="formData.type === 'VNC'">
            <div>
              <label for="conn-password-vnc" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.vncPassword', 'VNC 密码') }}</label>
              <input type="password" id="conn-password-vnc" v-model="formData.vncPassword" :required="!isEditMode" autocomplete="new-password"
                     class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
          </template>
        </div>

        <!-- Advanced Options Section -->
        <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
           <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">{{ t('connections.form.sectionAdvanced', '高级选项') }}</h4>
           <div v-if="formData.type === 'SSH'"> <!-- Proxy Select - Show only for SSH -->
             <label for="conn-proxy" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.proxy') }} ({{ t('connections.form.optional') }})</label>
             <select id="conn-proxy" v-model="formData.proxy_id"
                     class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                     style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
               <option :value="null">{{ t('connections.form.noProxy') }}</option>
               <option v-for="proxy in proxies" :key="proxy.id" :value="proxy.id">
                 {{ proxy.name }} ({{ proxy.type }} - {{ proxy.host }}:{{ proxy.port }})
               </option>
             </select>
             <div v-if="isProxyLoading" class="mt-1 text-xs text-text-secondary">{{ t('proxies.loading') }}</div>
             <div v-if="proxyStoreError" class="mt-1 text-xs text-error">{{ t('proxies.error', { error: proxyStoreError }) }}</div>
           </div>

           <div>
             <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.tags') }} ({{ t('connections.form.optional') }})</label>
             <TagInput
                 v-model="formData.tag_ids"
                 :available-tags="tags"
                 :allow-create="true"
                 :allow-delete="true"
                 @create-tag="handleCreateTag"
                 @delete-tag="handleDeleteTag"
                 :placeholder="t('tags.inputPlaceholder', '添加或选择标签...')"
             />
             <div v-if="isTagLoading" class="mt-1 text-xs text-text-secondary">{{ t('tags.loading') }}</div>
             <div v-if="tagStoreError" class="mt-1 text-xs text-error">{{ t('tags.error', { error: tagStoreError }) }}</div>
           </div>
           <!-- Notes Section -->
           <div>
             <label for="conn-notes" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.notes', '备注') }}</label>
             <textarea id="conn-notes" v-model="formData.notes" rows="3"
                       class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                       :placeholder="t('connections.form.notesPlaceholder', '输入连接备注...')"></textarea>
           </div>
         </div>

        <!-- Error message -->
        <div v-if="formError || storeError" class="text-error bg-error/10 border border-error/30 rounded-md p-3 text-sm text-center font-medium">
          {{ formError || storeError }}
        </div>

      </form> <!-- End Form -->

      <!-- Form Actions -->
      <div class="flex justify-between items-center pt-5 mt-6 flex-shrink-0">
         <!-- Test Area (Only show for SSH) -->
         <div v-if="formData.type === 'SSH'" class="flex flex-col items-start gap-1">
             <div class="flex items-center gap-2"> <!-- Button and Icon -->
                 <button type="button" @click="handleTestConnection" :disabled="isLoading || testStatus === 'testing'"
                         class="px-3 py-1.5 border border-border rounded-md text-sm font-medium text-text-secondary bg-background hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center transition-colors duration-150">
                     <svg v-if="testStatus === 'testing'" class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-text-secondary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                       <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                       <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                     </svg>
                     {{ testButtonText }}
                 </button>
                 <div class="relative group"> <!-- Tooltip Container -->
                     <i class="fas fa-info-circle text-text-secondary cursor-help"></i>
                     <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-max max-w-xs p-2 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10 whitespace-pre-wrap">
                         {{ t('connections.test.latencyTooltip') }}
                     </span>
                 </div>
             </div>
             <!-- Test Result -->
             <div class="min-h-[1.2em] pl-1 text-xs">
                 <div v-if="testStatus === 'testing'" class="text-text-secondary animate-pulse">
                   {{ t('connections.test.testingInProgress', '测试中...') }}
                 </div>
                 <div v-else-if="testStatus === 'success'" class="font-medium" :style="{ color: latencyColor }">
                   {{ testResult }}
                 </div>
                 <div v-else-if="testStatus === 'error'" class="text-error font-medium">
                   {{ t('connections.test.errorPrefix', '错误:') }} {{ testResult }}
                 </div>
             </div>
         </div>
         <!-- Placeholder for alignment when test button is hidden -->
         <div v-else class="flex-1"></div> <!-- This div ensures the main action buttons are pushed to the right when test area is hidden -->
         <div class="flex space-x-3"> <!-- Main Actions -->
             <button type="submit" @click="handleSubmit" :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
                     class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out">
               {{ submitButtonText }}
             </button>
             <button type="button" @click="emit('close')" :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
                     class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out">
               {{ t('connections.form.cancel') }}
             </button>
         </div>
      </div> <!-- End Form Actions -->

    </div> <!-- End Form Panel -->
  </div> <!-- End Overlay -->
</template>

<!-- Scoped styles removed, now using Tailwind utility classes -->
