<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, nextTick, Teleport } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import apiClient from '../utils/apiClient';
import { useConnectionsStore, ConnectionInfo } from '../stores/connections.store';
import { useProxiesStore } from '../stores/proxies.store';
import { useTagsStore } from '../stores/tags.store';
import { useSshKeysStore } from '../stores/sshKeys.store'; // +++ Import SSH Key store +++
import { useUiNotificationsStore } from '../stores/uiNotifications.store'; // +++ Import UI Notifications store +++
import TagInput from './TagInput.vue';
import SshKeySelector from './SshKeySelector.vue'; // +++ Import SSH Key Selector +++

// 定义组件发出的事件
const emit = defineEmits(['close', 'connection-added', 'connection-updated', 'connection-deleted']);

// 定义 Props
const props = defineProps<{
  connectionToEdit: ConnectionInfo | null; // 接收要编辑的连接对象
}>();

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const proxiesStore = useProxiesStore(); // 获取代理 store 实例
const tagsStore = useTagsStore(); // 获取标签 store 实例
const uiNotificationsStore = useUiNotificationsStore(); // +++ Get UI Notifications store instance +++
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

// Tooltip state and refs
const showHostTooltip = ref(false);
const hostTooltipStyle = ref({});
const hostIconRef = ref<HTMLElement | null>(null);
const hostTooltipContentRef = ref<HTMLElement | null>(null);

// Script Mode State
const isScriptModeActive = ref(false);
const scriptInputText = ref('');

// 计算属性判断是否为编辑模式
const isEditMode = computed(() => !!props.connectionToEdit);

// When switching to edit mode, disable script mode
watch(isEditMode, (editing) => {
  if (editing) {
    isScriptModeActive.value = false;
  }
});

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

// Helper function to parse IP range
// Placed inside script setup to access 't'
const parseIpRange = (ipRangeStr: string): string[] | { error: string } => {
    if (!ipRangeStr.includes('~')) {
        return { error: 'not_a_range' }; // Not an error for the function, indicates not a range
    }
    const parts = ipRangeStr.split('~');
    if (parts.length !== 2) {
        return { error: t('connections.form.errorInvalidIpRangeFormat', 'IP 范围格式应为 start_ip~end_ip') };
    }

    const [startIpStr, endIpStr] = parts.map(p => p.trim());

    const ipRegex = /^((\d{1,3}\.){3})\d{1,3}$/;
    if (!ipRegex.test(startIpStr) || !ipRegex.test(endIpStr)) {
        return { error: t('connections.form.errorInvalidIpFormat', '起始或结束 IP 地址格式无效') };
    }

    const startIpParts = startIpStr.split('.');
    const endIpParts = endIpStr.split('.');

    if (startIpParts.slice(0, 3).join('.') !== endIpParts.slice(0, 3).join('.')) {
        return { error: t('connections.form.errorIpRangeNotSameSubnet', 'IP 范围必须在同一个C段子网中 (例如 1.2.3.x ~ 1.2.3.y)') };
    }

    const startSuffix = parseInt(startIpParts[3], 10);
    const endSuffix = parseInt(endIpParts[3], 10);

    if (isNaN(startSuffix) || isNaN(endSuffix) || startSuffix < 0 || startSuffix > 255 || endSuffix < 0 || endSuffix > 255) {
        return { error: t('connections.form.errorInvalidIpSuffix', 'IP 地址最后一段必须是 0-255 之间的数字') };
    }

    if (startSuffix > endSuffix) {
        return { error: t('connections.form.errorIpRangeStartAfterEnd', 'IP 范围的起始 IP 不能大于结束 IP') };
    }

    const numIps = endSuffix - startSuffix + 1;
    if (numIps <= 0) {
         return { error: t('connections.form.errorIpRangeEmpty', 'IP 范围不能为空。') };
    }
    // Removed maxRange check

    const baseIp = startIpParts.slice(0, 3).join('.');
    const ips: string[] = [];
    for (let i = startSuffix; i <= endSuffix; i++) {
        ips.push(`${baseIp}.${i}`);
    }
    return ips;
};

// Helper function to parse a single script line
const parseScriptLine = (line: string): { type: 'SSH' | 'RDP' | 'VNC' | null, userHostPort: string, name: string | null, password: string | null, keyName: string | null, tags: string[], note: string | null, error?: string } => {
  // 首先提取 user@host:port 部分
  const firstSpaceIndex = line.indexOf(' ');
  let userHostPortPart = '';
  let remainingLine = line;
  
  if (firstSpaceIndex !== -1) {
    userHostPortPart = line.substring(0, firstSpaceIndex);
    remainingLine = line.substring(firstSpaceIndex + 1).trim();
  } else {
    userHostPortPart = line;
    remainingLine = '';
  }
  
  if (!userHostPortPart) return { type: null, userHostPort: '', name: null, password: null, keyName: null, tags: [], note: null, error: t('connections.form.scriptErrorMissingHost', '缺少 user@host:port 部分') };

  let type: 'SSH' | 'RDP' | 'VNC' | null = 'SSH'; // Default to SSH
  let name: string | null = null;
  let password: string | null = null;
  let keyName: string | null = null;
  const tags: string[] = [];
  let note: string | null = null;
  let currentArg: string | null = null;
  let noteParts: string[] = [];

  // 使用正则表达式来匹配参数和值，支持带引号的值
  const argRegex = /(-[^=\s]+)(?:\s+("(?:\\"|[^"])*"|[^-\s][^\s]*))?/g;
  let match;
  let lastIndex = 0;
  
  while ((match = argRegex.exec(remainingLine)) !== null) {
    const arg = match[1];
    let value = match[2] || '';
    
    // 清理引号
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    
    // 处理上一个参数的收尾工作
    if (noteParts.length > 0 && currentArg === '-note') {
      note = noteParts.join(' ');
      noteParts = [];
    }
    
    currentArg = arg;
    
    if (arg === '-tags') {
      // 标签将在后续处理
    } else if (arg === '-note') {
      // 备注将在后续处理
    }
    
    if (value) {
      switch (arg) {
        case '-type':
          const upperType = value.toUpperCase();
          if (upperType === 'SSH' || upperType === 'RDP' || upperType === 'VNC') {
            type = upperType as 'SSH' | 'RDP' | 'VNC';
          } else {
            return { type: null, userHostPort: userHostPortPart, name, password, keyName, tags, note, error: t('connections.form.scriptErrorInvalidType', { type: value }) };
          }
          currentArg = null;
          break;
        case '-name':
          name = value;
          currentArg = null;
          break;
        case '-p':
          password = value;
          currentArg = null;
          break;
        case '-k':
          keyName = value;
          currentArg = null;
          break;
        case '-tags':
          tags.push(value);
          break;
        case '-note':
          noteParts.push(value);
          break;
        default:
          if (currentArg === '-note') {
            noteParts.push(value);
          } else {
            return { type, userHostPort: userHostPortPart, name, password, keyName, tags, note, error: t('connections.form.scriptErrorUnknownArg', { arg: currentArg }) };
          }
      }
    }
    lastIndex = argRegex.lastIndex;
  }
  
  // 处理剩余的部分（可能是标签或备注）
  const remainingPart = remainingLine.substring(lastIndex).trim();
  if (remainingPart) {
    if (currentArg === '-tags') {
      // 按空格分割剩余部分为多个标签，支持引号
      const tagRegex = /("(?:\\"|[^"])*"|[^\s"]+)/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(remainingPart)) !== null) {
        let tag = tagMatch[1];
        if (tag.startsWith('"') && tag.endsWith('"')) {
          tag = tag.slice(1, -1).replace(/\\"/g, '"');
        }
        tags.push(tag);
      }
    } else if (currentArg === '-note') {
      noteParts.push(remainingPart);
    } else {
      return { type, userHostPort: userHostPortPart, name, password, keyName, tags, note, error: t('connections.form.scriptErrorUnexpectedToken', { token: remainingPart }) };
    }
  }

  if (noteParts.length > 0 && currentArg === '-note') {
    note = noteParts.join(' ');
  }

  // Basic validation for userHostPort
  const userHostPortRegex = /^[^@]+@[^:]+(:[0-9]+)?$/;
  if (!userHostPortRegex.test(userHostPortPart)) {
    return { type, userHostPort: userHostPortPart, name, password, keyName, tags, note, error: t('connections.form.scriptErrorInvalidUserHostPort', { part: userHostPortPart })};
  }

  return { type, userHostPort: userHostPortPart, name, password, keyName, tags, note };
};

// 处理表单提交
const handleScriptModeSubmit = async () => {
  const lines = scriptInputText.value.split('\n').filter(line => line.trim() !== '');

  if (lines.length === 0) {
    uiNotificationsStore.showError(t('connections.form.scriptModeEmpty', '脚本输入不能为空。'));
    return;
  }

  let allConnectionsValid = true;
  const connectionsToAdd = [];

  for (const line of lines) {
    const parsed = parseScriptLine(line);
    if (parsed.error) {
      uiNotificationsStore.showError(t('connections.form.scriptErrorInLine', { line, error: parsed.error }));
      allConnectionsValid = false;
      break; // Stop on first error for now, or collect all errors
    }

    if (!parsed.type) { // Should be caught by parsed.error, but as a safeguard
        uiNotificationsStore.showError(t('connections.form.scriptErrorMissingType', { line }));
        allConnectionsValid = false;
        break;
    }

    const [userHost, portStr] = parsed.userHostPort.split(':');
    const [username, host] = userHost.split('@');
    const port = portStr ? parseInt(portStr, 10) : (parsed.type === 'RDP' ? 3389 : (parsed.type === 'VNC' ? 5900 : 22));

    if (!username || !host) {
        uiNotificationsStore.showError(t('connections.form.scriptErrorInvalidUserHostFormat', { line }));
        allConnectionsValid = false;
        break;
    }
    if (isNaN(port) || port <= 0 || port > 65535) {
        uiNotificationsStore.showError(t('connections.form.scriptErrorInvalidPort', { line, port: portStr || (parsed.type === 'RDP' ? '3389' : (parsed.type === 'VNC' ? '5900' : '22')) }));
        allConnectionsValid = false;
        break;
    }

    const connectionData: any = {
      type: parsed.type,
      name: parsed.name || `${username}@${host}`,
      host,
      port,
      username,
      notes: parsed.note || '',
      // tag_ids will be resolved later if tags are provided
      tag_names: parsed.tags, // Store tag names for now, resolve to IDs before API call
    };

    if (parsed.type === 'SSH') {
      connectionData.auth_method = parsed.keyName ? 'key' : 'password';
      if (connectionData.auth_method === 'password') {
        if (!parsed.password) {
          uiNotificationsStore.showError(t('connections.form.scriptErrorMissingPasswordForSsh', { line }));
          allConnectionsValid = false;
          break;
        }
        connectionData.password = parsed.password;
      } else { // key auth
        if (!parsed.keyName) { // Should not happen if auth_method is 'key'
          uiNotificationsStore.showError(t('connections.form.scriptErrorMissingKeyNameForSsh', { line }));
          allConnectionsValid = false;
          break;
        }
        // We'll need to find ssh_key_id from keyName later
        connectionData.ssh_key_name = parsed.keyName;
      }
    } else if (parsed.type === 'RDP' || parsed.type === 'VNC') {
      if (!parsed.password) {
        uiNotificationsStore.showError(t('connections.form.scriptErrorMissingPasswordForType', { line, type: parsed.type }));
        allConnectionsValid = false;
        break;
      }
      connectionData.password = parsed.password;
    }
    connectionsToAdd.push(connectionData);
  }

  if (!allConnectionsValid || connectionsToAdd.length === 0) {
    if (connectionsToAdd.length > 0 && !allConnectionsValid) {
        // Errors were already shown
    } else if (lines.length > 0 && connectionsToAdd.length === 0 && allConnectionsValid) {
        // This case should ideally not be reached if parsing is correct
        uiNotificationsStore.showError(t('connections.form.scriptErrorInternal', '内部解析错误。'));
    }
    return;
  }

  console.log('Parsed connections to add (pre-resolution):', connectionsToAdd);

  const fullyProcessedConnections = [];
  let resolutionErrorOccurred = false;

  // Resolve tag names and SSH key names to IDs
  for (const connData of connectionsToAdd) {
    // Resolve Tag IDs
    if (connData.tag_names && connData.tag_names.length > 0) {
      const tagIds = [];
      for (const tagName of connData.tag_names) {
        const foundTag = tags.value.find(t => t.name === tagName);
        if (foundTag) {
          tagIds.push(foundTag.id);
        } else {
          // Option: Create tag if not found, or show error. For now, error.
          uiNotificationsStore.showError(t('connections.form.scriptErrorTagNotFound', { tagName }));
          resolutionErrorOccurred = true;
          break;
        }
      }
      if (resolutionErrorOccurred) break;
      connData.tag_ids = tagIds;
    } else {
      connData.tag_ids = [];
    }
    delete connData.tag_names; // Remove temporary field

    // Resolve SSH Key ID
    if (connData.type === 'SSH' && connData.auth_method === 'key' && connData.ssh_key_name) {
      const foundKey = sshKeysStore.sshKeys.find(k => k.name === connData.ssh_key_name);
      if (foundKey) {
        connData.ssh_key_id = foundKey.id;
      } else {
        uiNotificationsStore.showError(t('connections.form.scriptErrorSshKeyNotFound', { keyName: connData.ssh_key_name }));
        resolutionErrorOccurred = true;
        break;
      }
      delete connData.ssh_key_name; // Remove temporary field
    }
    
    // Clean up unnecessary fields based on type and auth_method, similar to single add
    if (connData.type !== 'SSH' || connData.auth_method !== 'key') delete connData.ssh_key_id;
    if (connData.type === 'SSH' && connData.auth_method === 'key') delete connData.password; // No password if key auth
    if (connData.type !== 'SSH') delete connData.auth_method; // RDP/VNC don't have auth_method in backend

    fullyProcessedConnections.push(connData);
  }

  if (resolutionErrorOccurred || (fullyProcessedConnections.length === 0 && lines.length > 0)) {
    // Errors shown by resolver, or if no connections were processed but there were lines
    if (!resolutionErrorOccurred && lines.length > 0 && fullyProcessedConnections.length === 0) {
         uiNotificationsStore.showError(t('connections.form.scriptErrorNothingToProcess', '没有可处理的有效连接数据。'));
    }
    return;
  }
  
  if (fullyProcessedConnections.length === 0) { // Should be caught by earlier checks
    return;
  }

  console.log('Fully processed connections:', fullyProcessedConnections);

  let successCount = 0;
  let errorCount = 0;
  let firstErrorEncountered: string | null = null;

  uiNotificationsStore.showInfo(t('connections.form.scriptModeAddingConnections', { count: fullyProcessedConnections.length }));

  for (const finalConnectionData of fullyProcessedConnections) {
    const success = await connectionsStore.addConnection(finalConnectionData);
    if (success) {
      successCount++;
    } else {
      errorCount++;
      if (!firstErrorEncountered) {
        firstErrorEncountered = connectionsStore.error || t('errors.unknown', '未知错误');
      }
      // Optionally, log which connection failed
      console.error(`Failed to add connection: ${finalConnectionData.name}`, connectionsStore.error);
    }
  }

  if (errorCount > 0) {
    const message = t('connections.form.errorBatchAddResult', { successCount, errorCount, firstErrorEncountered: firstErrorEncountered || t('errors.unknown', '未知错误') });
    if (successCount > 0) {
      uiNotificationsStore.showWarning(message);
    } else {
      uiNotificationsStore.showError(message);
    }
  }
  
  if (successCount > 0) {
    if (errorCount === 0) { // All successful
        uiNotificationsStore.showSuccess(t('connections.form.successBatchAddResult', { successCount }));
    }
    emit('connection-added'); // Emit even if there were partial successes
    if (errorCount === 0) { // Clear input only if all were successful
        scriptInputText.value = '';
        // emit('close'); // Optionally close form on full success
    }
  }
  
  // If successCount is 0 and errorCount is 0 but there were lines, it means something went wrong before this loop.
  // That case should be handled by the `fullyProcessedConnections.length === 0` check earlier.
};

const handleSubmit = async () => {
  if (isScriptModeActive.value) {
    await handleScriptModeSubmit();
    return;
  }

  formError.value = null;
  connectionsStore.error = null;
  proxiesStore.error = null; // 同时清除代理 store 的错误

  // Filter formData.tag_ids to ensure all IDs are valid before proceeding
  const availableTagIds = tags.value.map(t => t.id);
  const currentSelectedValidTagIds = formData.tag_ids.filter(id => availableTagIds.includes(id));

  // 基础前端验证 (移除名称验证)
  if (!formData.host || !formData.username) { // 移除 !formData.name
    uiNotificationsStore.showError(t('connections.form.errorRequiredFields'));
    return;
  }
  if (formData.port <= 0 || formData.port > 65535) {
      uiNotificationsStore.showError(t('connections.form.errorPort'));
      return;
  }

  // --- 更新后的验证逻辑 (区分 SSH 和 RDP) ---
  // Note: This validation block is for single add/edit. Batch add has its own pre-checks.
  if (formData.type === 'SSH') {
      if (!isEditMode.value) { // Add mode specific checks
          if (formData.auth_method === 'password' && !formData.password && !formData.host.includes('~')) { // Password required if not batch and password auth
              uiNotificationsStore.showError(t('connections.form.errorPasswordRequired'));
              return;
          }
          if (formData.auth_method === 'key' && !formData.selected_ssh_key_id && !formData.host.includes('~')) { // Key required if not batch and key auth
              uiNotificationsStore.showError(t('connections.form.errorSshKeyRequired'));
              return;
          }
      } else { // Edit mode specific checks
          if (formData.auth_method === 'password' && !formData.password && props.connectionToEdit?.auth_method !== 'password') {
              uiNotificationsStore.showError(t('connections.form.errorPasswordRequiredOnSwitch'));
              return;
          }
          if (formData.auth_method === 'key' && !formData.selected_ssh_key_id && props.connectionToEdit?.auth_method !== 'key') {
               uiNotificationsStore.showError(t('connections.form.errorSshKeyRequiredOnSwitch'));
               return;
           }
      }
  } else if (formData.type === 'RDP') {
      if (!isEditMode.value && !formData.password && !formData.host.includes('~')) {
          uiNotificationsStore.showError(t('connections.form.errorPasswordRequired'));
          return;
      }
  } else if (formData.type === 'VNC') {
      if (!isEditMode.value && !formData.vncPassword && !formData.host.includes('~')) {
          uiNotificationsStore.showError(t('connections.form.errorVncPasswordRequired', 'VNC 密码是必填项。'));
          return;
      }
  }
  // --- 验证逻辑结束 ---

  // --- 处理连续 IP ---
  if (!isEditMode.value && formData.host.includes('~')) {
      const parsedIpsResult = parseIpRange(formData.host); // Removed maxRange argument

      if (Array.isArray(parsedIpsResult)) {
          const ips = parsedIpsResult;
          // Pre-flight checks for batch add using UI notifications for errors
          if (formData.type === 'SSH' && formData.auth_method === 'key' && !formData.selected_ssh_key_id) {
              uiNotificationsStore.showError(t('connections.form.errorSshKeyRequiredForBatch', '批量添加 SSH (密钥认证) 连接时，必须选择一个 SSH 密钥。'));
              return;
          }
          if (formData.type === 'SSH' && formData.auth_method === 'password' && !formData.password) {
              uiNotificationsStore.showError(t('connections.form.errorPasswordRequiredForBatchSSH', '批量添加 SSH (密码认证) 连接时，必须提供密码。'));
              return;
          }
          if (formData.type === 'RDP' && !formData.password) {
              uiNotificationsStore.showError(t('connections.form.errorPasswordRequiredForBatchRDP', '批量添加 RDP 连接时，必须提供密码。'));
              return;
          }
          if (formData.type === 'VNC' && !formData.vncPassword) {
              uiNotificationsStore.showError(t('connections.form.errorPasswordRequiredForBatchVNC', '批量添加 VNC 连接时，必须提供 VNC 密码。'));
              return;
          }

          let successCount = 0;
          let errorCount = 0;
          let firstErrorEncountered: string | null = null;

          for (let i = 0; i < ips.length; i++) {
              const currentIp = ips[i];
              const ipSuffix = currentIp.split('.').pop() || `${i + 1}`;
              
              const dataForThisIp: any = {
                  type: formData.type,
                  name: formData.name ? `${formData.name}-${ipSuffix}` : currentIp,
                  host: currentIp,
                  port: formData.port,
                  username: formData.username,
                  notes: formData.notes,
                  proxy_id: formData.proxy_id || null,
                  tag_ids: currentSelectedValidTagIds, // Use filtered list
              };

              if (formData.type === 'SSH') {
                  dataForThisIp.auth_method = formData.auth_method;
                  if (formData.auth_method === 'password') {
                      dataForThisIp.password = formData.password;
                  } else if (formData.auth_method === 'key') {
                      dataForThisIp.ssh_key_id = formData.selected_ssh_key_id;
                  }
              } else if (formData.type === 'RDP') {
                  dataForThisIp.password = formData.password;
                  delete dataForThisIp.auth_method;
              } else if (formData.type === 'VNC') {
                  dataForThisIp.password = formData.vncPassword;
                  delete dataForThisIp.auth_method;
              }
              
              if (dataForThisIp.type !== 'SSH' || dataForThisIp.auth_method !== 'key') delete dataForThisIp.ssh_key_id;
              if (dataForThisIp.type === 'SSH' && dataForThisIp.auth_method === 'key') delete dataForThisIp.password;
              if (dataForThisIp.type !== 'SSH') delete dataForThisIp.auth_method;

              const success = await connectionsStore.addConnection(dataForThisIp);
              if (success) {
                  successCount++;
              } else {
                  errorCount++;
                  if (!firstErrorEncountered) {
                      firstErrorEncountered = connectionsStore.error || t('errors.unknown', '未知错误');
                  }
              }
          }

          if (errorCount > 0) {
              const message = t('connections.form.errorBatchAddResult', { successCount, errorCount, firstErrorEncountered: firstErrorEncountered || t('errors.unknown', '未知错误') });
              if (successCount > 0) {
                uiNotificationsStore.showWarning(message);
              } else {
                uiNotificationsStore.showError(message);
              }
          } else if (successCount > 0) {
              uiNotificationsStore.showSuccess(t('connections.form.successBatchAddResult', { successCount }));
              emit('connection-added');
          }
          // Clear formError if it was set by single validation before batch
          // formError.value = null; // No longer using formError for this
          return; // Batch processing complete
      } else if (parsedIpsResult.error && parsedIpsResult.error !== 'not_a_range') {
          uiNotificationsStore.showError(parsedIpsResult.error);
          return;
      }
      // If 'not_a_range', fall through to single connection logic
  }
  
  if (isEditMode.value && formData.host.includes('~')) {
      uiNotificationsStore.showError(t('connections.form.errorIpRangeNotAllowedInEditMode', '编辑模式下不支持 IP 范围。请使用单个 IP 地址。'));
      return;
  }

  // --- Default single connection add/edit logic ---
  const dataToSend: any = {
      type: formData.type,
      name: formData.name,
      host: formData.host,
      port: formData.port,
      notes: formData.notes,
      username: formData.username,
      proxy_id: formData.proxy_id || null,
      tag_ids: currentSelectedValidTagIds, // Use filtered list
  };

  if (formData.type === 'SSH') {
      dataToSend.auth_method = formData.auth_method;
      if (formData.auth_method === 'password') {
          if (formData.password) dataToSend.password = formData.password;
          // For edit mode, not sending password means "do not change"
      } else if (formData.auth_method === 'key') {
          if (formData.selected_ssh_key_id) {
              dataToSend.ssh_key_id = formData.selected_ssh_key_id;
          }
          // For edit mode, if selected_ssh_key_id is null but original was key,
          // it might mean "remove key association" or "do not change", depending on backend.
          // Current validation handles "must select if switching to key"
      }
  } else if (formData.type === 'RDP') {
      if (formData.password) dataToSend.password = formData.password;
      delete dataToSend.auth_method;
  } else if (formData.type === 'VNC') {
      if (formData.vncPassword) dataToSend.password = formData.vncPassword;
      delete dataToSend.auth_method;
  }
  
  // Clean up fields not relevant to the current connection type / auth method for single add/edit
  if (dataToSend.type !== 'SSH' || dataToSend.auth_method !== 'key') delete dataToSend.ssh_key_id;
  if (dataToSend.type === 'SSH' && dataToSend.auth_method === 'key') delete dataToSend.password;
  if (dataToSend.type !== 'SSH') delete dataToSend.auth_method;


  let success = false;
  if (isEditMode.value && props.connectionToEdit) {
      success = await connectionsStore.updateConnection(props.connectionToEdit.id, dataToSend);
      if (success) {
          emit('connection-updated');
      } else {
          uiNotificationsStore.showError(t('connections.form.errorUpdate', { error: connectionsStore.error || '未知错误' }));
      }
  } else {
      success = await connectionsStore.addConnection(dataToSend);
      if (success) {
          emit('connection-added');
      } else {
          uiNotificationsStore.showError(t('connections.form.errorAdd', { error: connectionsStore.error || '未知错误' }));
      }
  }
};

// 处理删除连接
const handleDeleteConnection = async () => {
  if (!isEditMode.value || !props.connectionToEdit) return;

  // 添加一个确认对话框
  // 使用模板字符串和 t 函数的默认值功能
  const connectionName = props.connectionToEdit.name || `ID: ${props.connectionToEdit.id}`;
  if (!confirm(t('connections.prompts.confirmDelete', { name: connectionName }))) {
      return;
  }

  formError.value = null;
  connectionsStore.error = null; // 清除之前的错误

  const success = await connectionsStore.deleteConnection(props.connectionToEdit.id);
  if (success) {
    emit('connection-deleted'); // 发出删除成功事件
    emit('close'); // 删除成功后关闭表单
  } else {
    uiNotificationsStore.showError(t('connections.form.errorDelete', { error: connectionsStore.error || t('errors.unknown', '未知错误') }));
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
      const errorMessage = response.data.message || t('connections.test.errorUnknown');
      testResult.value = errorMessage; // Still set for internal logic if needed, but UI will use notification
      uiNotificationsStore.showError(errorMessage);
    }

  } catch (error: any) {
    // --- 统一处理错误 (前端验证错误或 API 调用错误) ---
    console.error('测试连接失败:', error);
    testStatus.value = 'error';
    let errorMessageToShow: string;
    if (error.response && error.response.data && error.response.data.message) {
      // API 返回的错误信息
      errorMessageToShow = error.response.data.message;
    } else {
      // 前端验证错误 (error.message) 或 网络/其他错误
      errorMessageToShow = error.message || t('connections.test.errorNetwork');
    }
    testResult.value = errorMessageToShow; // Still set for internal logic
    uiNotificationsStore.showError(errorMessageToShow);
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

const handleHostIconMouseEnter = async () => {
  showHostTooltip.value = true;
  await nextTick(); // Wait for DOM update

  if (hostIconRef.value && hostTooltipContentRef.value) {
    const iconRect = hostIconRef.value.getBoundingClientRect();
    const tooltipRect = hostTooltipContentRef.value.getBoundingClientRect();

    let top = iconRect.top - tooltipRect.height - 8; // 8px offset
    let left = iconRect.left + (iconRect.width / 2) - (tooltipRect.width / 2);

    // Boundary checks (simple version)
    if (top < 0) { // If not enough space on top, show below
      top = iconRect.bottom + 8;
    }
    if (left < 0) {
      left = 0;
    }
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width;
    }

    hostTooltipStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
    };
  }
};

const handleHostIconMouseLeave = () => {
  showHostTooltip.value = false;
};

</script>

<template>
  <Teleport to="body">
    <div
      v-if="showHostTooltip"
      ref="hostTooltipContentRef"
      :style="hostTooltipStyle"
      class="fixed w-max max-w-xs p-2 text-xs text-white bg-gray-800 rounded shadow-lg z-[1000] whitespace-pre-wrap pointer-events-none"
      role="tooltip"
    >
      {{ t('connections.form.hostTooltip', '支持 IP 范围, 例如 192.168.1.10~192.168.1.15 (仅限添加模式)') }}
    </div>
  </Teleport>
  <div class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"> <!-- Overlay -->
    <div class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"> <!-- Form Panel -->
      <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">{{ formTitle }}</h3> <!-- Title -->
      <form @submit.prevent="handleSubmit" class="flex-grow overflow-y-auto pr-2 space-y-6"> <!-- Form with scroll and spacing -->

        <!-- Regular Form Sections (conditionally rendered) -->
        <template v-if="!isScriptModeActive">
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
              <label for="conn-host" class="block text-sm font-medium text-text-secondary mb-1">
                {{ t('connections.form.host') }}
                <span class="relative ml-1" @mouseenter="handleHostIconMouseEnter" @mouseleave="handleHostIconMouseLeave">
                  <i ref="hostIconRef" class="fas fa-exclamation-circle text-text-secondary cursor-help"></i>
                  <!-- Tooltip is now handled by Teleport -->
                </span>
              </label>
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
       </template> <!-- End of v-if="!isScriptModeActive" -->
       
       <!-- Script Mode Section Toggle -->
       <div v-if="!isEditMode" class="space-y-4 p-4 border border-border rounded-md bg-header/30 mt-6">
         <div class="flex justify-between items-center">
           <h4 class="text-base font-semibold">{{ t('connections.form.sectionScriptMode', '脚本模式') }}</h4>
           <button
             type="button"
             @click="isScriptModeActive = !isScriptModeActive"
             :class="[
               'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
               isScriptModeActive ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
             ]"
             role="switch"
             :aria-checked="isScriptModeActive"
           >
             <span
               aria-hidden="true"
               :class="[
                 'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
                 isScriptModeActive ? 'translate-x-5' : 'translate-x-0'
               ]"
             ></span>
           </button>
         </div>
         <div v-if="isScriptModeActive" class="mt-4">
           <label for="conn-script-input" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.scriptModeInputLabel', '连接脚本 (每行一个)') }}</label>
           <textarea
             id="conn-script-input"
             v-model="scriptInputText"
             rows="10"
             wrap="off"
             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
             :placeholder="t('connections.form.scriptModePlaceholder')"
           ></textarea>
           <p class="mt-1 text-xs text-text-secondary">
             {{ t('connections.form.scriptModeFormatInfo', '格式: user@host:port [-type TYPE] [-name NAME] [-p PASSWORD] [-k KEY_NAME] [-tags TAG1 TAG2...] [-note NOTE_TEXT]') }}
           </p>
         </div>
       </div>

       <!-- Error message DIV removed -->

       </form> <!-- End Form -->

       <!-- Form Actions -->
      <div class="flex justify-between items-center pt-5 mt-6 flex-shrink-0">
         <!-- Test Area (Only show for SSH and when script mode is NOT active) -->
         <div v-if="formData.type === 'SSH' && !isScriptModeActive" class="flex flex-col items-start gap-1">
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
                   <!-- Error message is now shown via uiNotificationsStore -->
                   <!-- Display a generic message or icon here if needed, or leave empty -->
                    {{ t('connections.test.errorPrefix', '错误:') }} {{ testResult }} <!-- Or simply 'Error' -->
                 </div>
             </div>
         </div>
         <!-- Placeholder for alignment when test button is hidden or script mode is active -->
         <div v-else-if="!isScriptModeActive" class="flex-1"></div>
         <div v-else class="flex-1"></div> <!-- Also take up space if script mode is active, pushing buttons right -->
         <div class="flex space-x-3"> <!-- Main Actions -->
             <button v-if="isEditMode && !isScriptModeActive" type="button" @click="handleDeleteConnection" :disabled="isLoading || (formData.type === 'SSH' && testStatus === 'testing')"
                     class="px-4 py-2 bg-transparent text-red-600 border border-red-500 rounded-md shadow-sm hover:bg-red-500/10 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out">
               {{ t('connections.actions.delete') }}
             </button>
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
