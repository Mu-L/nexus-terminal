<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed, watchEffect } from 'vue'; 
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store'; // +++ Import connections store +++
// @ts-ignore - guacamole-common-js 缺少官方类型定义
import Guacamole from 'guacamole-common-js';
import apiClient from '../utils/apiClient';
import { ConnectionInfo } from '../stores/connections.store';

const { t } = useI18n();
const settingsStore = useSettingsStore(); 

const props = defineProps<{
  connection: ConnectionInfo | null;
}>();

const emit = defineEmits(['close']);

let saveWidthTimeout: ReturnType<typeof setTimeout> | null = null;
let saveHeightTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY = 500; // ms

const rdpDisplayRef = ref<HTMLDivElement | null>(null);
const rdpContainerRef = ref<HTMLDivElement | null>(null);
const guacClient = ref<any | null>(null);
const connectionStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
const statusMessage = ref('');
const keyboard = ref<any | null>(null);
const mouse = ref<any | null>(null);
const desiredModalWidth = ref(1064);
const desiredModalHeight = ref(858);
const isKeyboardDisabledForInput = ref(false); // 标记键盘是否因输入框聚焦而禁用

const MIN_MODAL_WIDTH = 1024;
const MIN_MODAL_HEIGHT = 768;

// Dynamically construct WebSocket URL based on environment
let backendBaseUrl: string;
const LOCAL_BACKEND_URL = 'ws://localhost:3001'; // For RDP proxy via main backend

// Determine WebSocket URL based on hostname for RDP
if (window.location.hostname === 'localhost') {
  backendBaseUrl = LOCAL_BACKEND_URL;
  console.log(`[RemoteDesktopModal] Using localhost RDP WebSocket base URL: ${backendBaseUrl}`);
} else {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHostAndPort = window.location.host;
  backendBaseUrl = `${wsProtocol}//${wsHostAndPort}/ws`; // Assuming RDP proxy is at /ws path
  console.log(`[RemoteDesktopModal] Using production RDP WebSocket base URL (from window.location): ${backendBaseUrl}`);
}

// NEW: VNC WebSocket URL determination
let vncWsBaseUrl: string;
const VNC_WS_PORT_FROM_ENV = import.meta.env.VITE_VNC_WS_PORT || '8082'; // Get from env or default

if (window.location.hostname === 'localhost') {
  vncWsBaseUrl = `ws://localhost:${VNC_WS_PORT_FROM_ENV}`;
  console.log(`[RemoteDesktopModal] Using localhost VNC WebSocket base URL: ${vncWsBaseUrl}`);
} else {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Assuming VNC proxy runs on the same host but different port (or path if configured)
  vncWsBaseUrl = `${wsProtocol}//${window.location.hostname}:${VNC_WS_PORT_FROM_ENV}`;
  console.log(`[RemoteDesktopModal] Using production VNC WebSocket base URL: ${vncWsBaseUrl}`);
}

const handleConnection = async () => {
  if (!props.connection || !rdpDisplayRef.value) {
    statusMessage.value = t('remoteDesktopModal.errors.missingInfo');
    connectionStatus.value = 'error';
    return;
  }

  // Clear previous display and disconnect
  while (rdpDisplayRef.value.firstChild) {
    rdpDisplayRef.value.removeChild(rdpDisplayRef.value.firstChild);
  }
  disconnectGuacamole(); // Renamed from disconnectRdp

  connectionStatus.value = 'connecting';
  statusMessage.value = t('remoteDesktopModal.status.fetchingToken');

  try {
    let token: string | null = null;
    let tunnelUrl: string = '';
    const connectionsStore = useConnectionsStore();

    if (props.connection.type === 'RDP') {
      const apiUrl = `connections/${props.connection.id}/rdp-session`;
      const response = await apiClient.post<{ token: string }>(apiUrl);
      token = response.data?.token;
      if (!token) {
        throw new Error('RDP Token not found in API response');
      }
      statusMessage.value = t('remoteDesktopModal.status.connectingWs');

      await nextTick();
      let widthToSend = 800;
      let heightToSend = 600;
      const dpiToSend = 96;

      if (rdpContainerRef.value) {
        widthToSend = rdpContainerRef.value.clientWidth;
        heightToSend = rdpContainerRef.value.clientHeight - 1;
        widthToSend = Math.max(100, widthToSend);
        heightToSend = Math.max(100, heightToSend);
      }
      tunnelUrl = `${backendBaseUrl}/rdp-proxy?token=${encodeURIComponent(token)}&width=${widthToSend}&height=${heightToSend}&dpi=${dpiToSend}`;
      console.log(`[RemoteDesktopModal] Connecting to RDP tunnel: ${tunnelUrl}`);

    } else if (props.connection.type === 'VNC') {
      token = await connectionsStore.getVncSessionToken(props.connection.id);
      if (!token) {
        throw new Error('VNC Token not found from store action');
      }
      statusMessage.value = t('remoteDesktopModal.status.connectingWs'); // Generic message
      tunnelUrl = `${vncWsBaseUrl}?token=${encodeURIComponent(token)}`;
      // Optional: Add width/height if VNC proxy needs them, though Guacamole usually handles this post-connection.
      // await nextTick();
      // let widthToSend = 800;
      // let heightToSend = 600;
      // if (rdpContainerRef.value) {
      //   widthToSend = rdpContainerRef.value.clientWidth;
      //   heightToSend = rdpContainerRef.value.clientHeight - 1;
      //   widthToSend = Math.max(100, widthToSend);
      //   heightToSend = Math.max(100, heightToSend);
      //   tunnelUrl += `&width=${widthToSend}&height=${heightToSend}`;
      // }
      console.log(`[RemoteDesktopModal] Connecting to VNC tunnel: ${tunnelUrl}`);
    } else {
      throw new Error(`Unsupported connection type: ${props.connection.type}`);
    }

    // @ts-ignore
    const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);

    tunnel.onerror = (status: any) => {
      const errorMessage = status.message || 'Unknown tunnel error';
      const errorCode = status.code || 'N/A';
      statusMessage.value = `${t('remoteDesktopModal.errors.tunnelError')} (${errorCode}): ${errorMessage}`;
      connectionStatus.value = 'error';
      disconnectGuacamole();
    };

    // @ts-ignore
    guacClient.value = new Guacamole.Client(tunnel);
    guacClient.value.keepAliveFrequency = 3000;

    rdpDisplayRef.value.appendChild(guacClient.value.getDisplay().getElement());

    guacClient.value.onstatechange = (state: number) => {
      let currentStatus = '';
      let i18nKeyPart = 'unknownState';

      switch (state) {
        case 0: // IDLE
          i18nKeyPart = 'idle';
          currentStatus = 'disconnected';
          break;
        case 1: // CONNECTING
          i18nKeyPart = props.connection?.type === 'VNC' ? 'connectingVnc' : 'connectingRdp';
          currentStatus = 'connecting';
          break;
        case 2: // WAITING
          i18nKeyPart = 'waiting';
          currentStatus = 'connecting';
          break;
        case 3: // CONNECTED
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          setupInputListeners();
          nextTick(() => {
            const displayEl = guacClient.value?.getDisplay()?.getElement();
            if (displayEl && typeof displayEl.focus === 'function') {
              displayEl.focus();
            }
          });
          setTimeout(() => { // z-index fix for canvas
            nextTick(() => {
              if (rdpDisplayRef.value && guacClient.value) {
                const canvases = rdpDisplayRef.value.querySelectorAll('canvas');
                canvases.forEach((canvas) => { canvas.style.zIndex = '999'; });
              }
            });
          }, 100);
          break;
        case 4: // DISCONNECTING
          i18nKeyPart = 'disconnecting';
          currentStatus = 'disconnected'; // Or 'disconnecting'
          break;
        case 5: // DISCONNECTED
          i18nKeyPart = 'disconnected';
          currentStatus = 'disconnected';
          break;
      }
      statusMessage.value = t(`remoteDesktopModal.status.${i18nKeyPart}`, { state });
      if (currentStatus) connectionStatus.value = currentStatus as 'disconnected' | 'connecting' | 'connected' | 'error';
    };

    guacClient.value.onerror = (status: any) => {
      const errorMessage = status.message || 'Unknown client error';
      statusMessage.value = `${t('remoteDesktopModal.errors.clientError')}: ${errorMessage}`;
      connectionStatus.value = 'error';
      disconnectGuacamole();
    };

    guacClient.value.connect('');

  } catch (error: any) {
    statusMessage.value = `${t('remoteDesktopModal.errors.connectionFailed')}: ${error.response?.data?.message || error.message || String(error)}`;
    connectionStatus.value = 'error';
    disconnectGuacamole();
  }
};

const setupInputListeners = () => {
    if (!guacClient.value || !rdpDisplayRef.value) return;
    try {
        const displayEl = guacClient.value.getDisplay().getElement() as HTMLElement;
        displayEl.tabIndex = 0; // 使 RDP 显示区域可聚焦

        // 添加点击事件监听器以处理失焦逻辑
        const handleRdpDisplayClick = () => {
          const activeElement = document.activeElement as HTMLElement;
          // 检查活动元素是否是宽度或高度输入框
          if (activeElement && (activeElement.id === 'modal-width' || activeElement.id === 'modal-height')) {
            activeElement.blur();
            console.log('[RDP Modal] Blurred input field on RDP display click.');
          }
        };
        displayEl.addEventListener('click', handleRdpDisplayClick);


        // 鼠标进入 RDP 区域时隐藏本地光标
        const handleMouseEnter = () => {
          if (displayEl) displayEl.style.cursor = 'none';
        };
        // 鼠标离开 RDP 区域时恢复本地光标
        const handleMouseLeave = () => {
          if (displayEl) displayEl.style.cursor = 'default';
        };
        displayEl.addEventListener('mouseenter', handleMouseEnter);
        displayEl.addEventListener('mouseleave', handleMouseLeave);



        // @ts-ignore
        mouse.value = new Guacamole.Mouse(displayEl);

        const display = guacClient.value.getDisplay();
        // 启用 Guacamole 的内置光标渲染
        display.showCursor(true);


        // 提高 Guacamole 光标图层的 z-index
        const cursorLayer = display.getCursorLayer(); // 获取光标图层
        if (cursorLayer) {
          const cursorElement = cursorLayer.getElement(); // 获取光标图层的 DOM 元素
          if (cursorElement) {
             cursorElement.style.zIndex = '1000'; // 设置 DOM 元素的 z-index
             console.log('[RDP Modal] Set cursor layer element z-index to 1000.');
          } else {
             console.warn('[RDP Modal] Could not get cursor layer element to set z-index.');
          }
        } else {
          console.warn('[RDP Modal] Could not get cursor layer to set z-index.');
        }



        // @ts-ignore
        mouse.value.onmousedown = mouse.value.onmouseup = mouse.value.onmousemove = (mouseState: any) => {
            if (guacClient.value) {
                guacClient.value.sendMouseState(mouseState);
            }
        };

        // @ts-ignore
        keyboard.value = new Guacamole.Keyboard(displayEl); // 将监听器附加到 RDP 显示元素

        keyboard.value.onkeydown = (keysym: number) => {
            // 仅当输入框未聚焦时发送按键事件
            if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(1, keysym);
            }
        };
        keyboard.value.onkeyup = (keysym: number) => {
             // 仅当输入框未聚焦时发送按键事件
             if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(0, keysym);
             }
        };

    } catch (inputError) {
        console.error("Error setting up input listeners:", inputError); // 添加错误日志
        statusMessage.value = t('remoteDesktopModal.errors.inputError');
    }
};

const removeInputListeners = () => {
    // 恢复光标并尝试移除监听器
    if (guacClient.value) {
        try {
            const displayEl = guacClient.value.getDisplay()?.getElement();
            if (displayEl) {
                // 恢复默认光标样式
                displayEl.style.cursor = 'default';
            }
        } catch (e) {
             console.warn("Could not reset cursor or remove listeners on display element during listener removal:", e);
        }
    }

    // 清理 Guacamole 的键盘和鼠标对象
    if (keyboard.value) {
        keyboard.value.onkeydown = null;
        keyboard.value.onkeyup = null;
        keyboard.value = null;
    }
     if (mouse.value) {
        mouse.value.onmousedown = null;
        mouse.value.onmouseup = null;
        mouse.value.onmousemove = null;
        mouse.value = null;
    }
};

const disableRdpKeyboard = () => {
  isKeyboardDisabledForInput.value = true;
  console.log('[RDP Modal] Keyboard disabled for input focus.');
};

const enableRdpKeyboard = () => {
  isKeyboardDisabledForInput.value = false;
  console.log('[RDP Modal] Keyboard enabled after input blur.');
  // 尝试将焦点移回 RDP 显示区域
  nextTick(() => {
    const displayEl = guacClient.value?.getDisplay()?.getElement();
    if (displayEl && typeof displayEl.focus === 'function') {
      displayEl.focus();
    }
  });
};

const disconnectGuacamole = () => {
  removeInputListeners();
  isKeyboardDisabledForInput.value = false; // 确保状态重置
  if (guacClient.value) {
    guacClient.value.disconnect();
    guacClient.value = null;
  }
  if (rdpDisplayRef.value) {
      while (rdpDisplayRef.value.firstChild) {
          rdpDisplayRef.value.removeChild(rdpDisplayRef.value.firstChild);
      }
  }
  if (connectionStatus.value !== 'error') {
      connectionStatus.value = 'disconnected';
      statusMessage.value = t('remoteDesktopModal.status.disconnected');
  }
};


const closeModal = () => {
  disconnectGuacamole();
  emit('close');
};


// 监听本地 ref 并将验证后的尺寸保存到设置存储
watch(desiredModalWidth, (newWidth, oldWidth) => {
  // 只有当值真正改变时才处理
  if (newWidth === oldWidth) {
      console.log(`[RDP 模态框] 宽度监听触发，但值 (${newWidth}) 未改变。跳过保存。`);
      return;
  }
  console.log(`[RDP 模态框] 监听 desiredModalWidth 触发: ${oldWidth} -> ${newWidth}`); // 添加日志
  // 保存前验证新宽度
  const validatedWidth = Math.max(MIN_MODAL_WIDTH, Number(newWidth) || MIN_MODAL_WIDTH);
  // 防抖保存 *验证后* 的宽度
  if (saveWidthTimeout) clearTimeout(saveWidthTimeout);
  saveWidthTimeout = setTimeout(() => {
    // 只保存验证后的宽度，不要在此处更改输入值
    console.log(`[RDP 模态框] 防抖保存 - 保存宽度: ${validatedWidth} (输入值: ${newWidth})`);
    // 再次检查，确保在延迟期间值没有变回原来的 store 值
    if (String(validatedWidth) !== settingsStore.settings.rdpModalWidth) {
         settingsStore.updateSetting('rdpModalWidth', String(validatedWidth));
    } else {
         console.log(`[RDP 模态框] 防抖保存 - 宽度 ${validatedWidth} 与存储值匹配。跳过冗余保存。`);
    }
  }, DEBOUNCE_DELAY);
});

watch(desiredModalHeight, (newHeight, oldHeight) => {
   // 只有当值真正改变时才处理
   if (newHeight === oldHeight) {
       console.log(`[RDP 模态框] 高度监听触发，但值 (${newHeight}) 未改变。跳过保存。`);
       return;
   }
   console.log(`[RDP 模态框] 监听 desiredModalHeight 触发: ${oldHeight} -> ${newHeight}`);
  // 保存前验证新高度
  const validatedHeight = Math.max(MIN_MODAL_HEIGHT, Number(newHeight) || MIN_MODAL_HEIGHT);
  // 防抖保存 *验证后* 的高度
  if (saveHeightTimeout) clearTimeout(saveHeightTimeout);
  saveHeightTimeout = setTimeout(() => {
    // 只保存验证后的高度，不要在此处更改输入值
    console.log(`[RDP 模态框] 防抖保存 - 保存高度: ${validatedHeight} (输入值: ${newHeight})`);
    // 再次检查
    if (String(validatedHeight) !== settingsStore.settings.rdpModalHeight) {
        settingsStore.updateSetting('rdpModalHeight', String(validatedHeight));
    } else {
        console.log(`[RDP 模态框] 防抖保存 - 高度 ${validatedHeight} 与存储值匹配。跳过冗余保存。`);
    }
  }, DEBOUNCE_DELAY);
});

// 组件挂载或设置更改时从设置存储加载初始尺寸
watchEffect(() => {
  const storeWidth = settingsStore.settings.rdpModalWidth;
  const storeHeight = settingsStore.settings.rdpModalHeight;
  console.log(`[RDP 模态框] 从存储加载尺寸 - 宽度: ${storeWidth}, 高度: ${storeHeight}`);
 
  // 如果存储中有默认值则使用，否则使用组件默认值
  const initialWidth = storeWidth ? parseInt(storeWidth, 10) : desiredModalWidth.value; // 使用当前 ref 值作为备用默认值
  const initialHeight = storeHeight ? parseInt(storeHeight, 10) : desiredModalHeight.value; // 使用当前 ref 值作为备用默认值

  // 根据最小值进行验证
  const finalWidth = Math.max(MIN_MODAL_WIDTH, isNaN(initialWidth) ? MIN_MODAL_WIDTH : initialWidth);
  const finalHeight = Math.max(MIN_MODAL_HEIGHT, isNaN(initialHeight) ? MIN_MODAL_HEIGHT : initialHeight);
  console.log(`[RDP 模态框] 应用验证后的尺寸 - 宽度: ${finalWidth}, 高度: ${finalHeight}`);
  desiredModalWidth.value = finalWidth;
  desiredModalHeight.value = finalHeight;
 });
 

onMounted(() => {
  // 初始尺寸加载现在由 watchEffect 处理

  if (props.connection) {
    nextTick(async () => {
        await handleConnection(); // 使用初始尺寸连接
        // 不再需要设置 observer
    });
  } else {
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

onUnmounted(() => {
  disconnectGuacamole(); // 这里已经调用了 removeInputListeners
});

watch(() => props.connection, (newConnection, oldConnection) => {
  if (newConnection && newConnection.id !== oldConnection?.id) {
     nextTick(async () => {
        await handleConnection(); // 使用初始尺寸连接
        // 不再需要设置 observer
     });
  } else if (!newConnection) {
      disconnectGuacamole();
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

// 直接使用所需的模态框尺寸作为样式
const computedModalStyle = computed(() => {

  // 在此处为实际模态框样式应用最小约束
  const actualWidth = Math.max(MIN_MODAL_WIDTH, desiredModalWidth.value);
  const actualHeight = Math.max(MIN_MODAL_HEIGHT, desiredModalHeight.value);
  return {
    width: `${actualWidth}px`,
    height: `${actualHeight}px`,
  };
});

</script>
<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
     <div
        :style="computedModalStyle"
        class="bg-background text-foreground rounded-lg shadow-xl flex flex-col overflow-hidden border border-border"
     >
      <div class="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <h3 class="text-base font-semibold truncate">
          <i class="fas fa-desktop mr-2 text-text-secondary"></i>
          {{ t('remoteDesktopModal.title') }} - {{ props.connection?.name || props.connection?.host || t('remoteDesktopModal.titlePlaceholder') }}
        </h3>
        <div class="flex items-center space-x-2">
            <span class="text-xs px-2 py-0.5 rounded"
                  :class="{
                    'bg-yellow-200 text-yellow-800': connectionStatus === 'connecting',
                    'bg-green-200 text-green-800': connectionStatus === 'connected',
                    'bg-red-200 text-red-800': connectionStatus === 'error',
                    'bg-gray-200 text-gray-800': connectionStatus === 'disconnected'
                  }">
              {{ t('remoteDesktopModal.status.' + connectionStatus) }}
            </span>
             <button
                @click="closeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.close')"
             >
                <i class="fas fa-times fa-lg"></i>
             </button>
        </div>
      </div>

      <div ref="rdpContainerRef" class="relative bg-black overflow-hidden flex-1">
        <div ref="rdpDisplayRef" class="rdp-display-container w-full h-full">
        </div>
         <div v-if="connectionStatus === 'connecting' || connectionStatus === 'error'"
              class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 text-white p-4 z-10">
            <div class="text-center">
              <i v-if="connectionStatus === 'connecting'" class="fas fa-spinner fa-spin fa-2x mb-3"></i>
              <i v-else class="fas fa-exclamation-triangle fa-2x mb-3 text-red-400"></i>
              <p class="text-sm">{{ statusMessage }}</p>
               <button v-if="connectionStatus === 'error'"
                       @click="() => handleConnection()"
                       class="mt-4 px-3 py-1 bg-primary text-white rounded text-xs hover:bg-primary-dark">
                 {{ t('common.retry') }}
               </button>
            </div>
         </div>
      </div>

       <div class="p-2 border-t border-border flex-shrink-0 text-xs text-text-secondary bg-header flex items-center justify-end">
         <div class="flex items-center space-x-2 flex-wrap gap-y-1">
            <label for="modal-width" class="text-xs ml-2">{{ t('common.width') }}:</label>
            <input
              id="modal-width"
              type="number"
              v-model.number="desiredModalWidth"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableRdpKeyboard"
              @blur="enableRdpKeyboard"
            />
            <label for="modal-height" class="text-xs">{{ t('common.height') }}:</label>
            <input
              id="modal-height"
              type="number"
              v-model.number="desiredModalHeight"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableRdpKeyboard"
              @blur="enableRdpKeyboard"
            />
             <!-- 添加重新连接按钮 -->
             <button
               @click="handleConnection"
               :disabled="connectionStatus === 'connecting'"
               class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
               :title="t('remoteDesktopModal.reconnectTooltip')"
             >
               {{ t('common.reconnect') }}
             </button>
         </div>
       </div>
    </div>
  </div>
</template>
<style scoped>
.rdp-display-container {
  overflow: hidden;
  position: relative;
}

.rdp-display-container :deep(div) {
}

.rdp-display-container :deep(canvas) {
  z-index: 999;
}
</style>
