<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store';
// @ts-ignore - guacamole-common-js 缺少官方类型定义
import Guacamole from 'guacamole-common-js';
import type { ConnectionInfo } from '../stores/connections.store';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = defineProps<{
  connection: ConnectionInfo | null;
}>();

const emit = defineEmits(['close']);

let saveWidthTimeout: ReturnType<typeof setTimeout> | null = null;
let saveHeightTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY = 500; // ms

const vncDisplayRef = ref<HTMLDivElement | null>(null);
const vncContainerRef = ref<HTMLDivElement | null>(null);
const guacClient = ref<any | null>(null);
const connectionStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
const statusMessage = ref('');
const keyboard = ref<any | null>(null);
const mouse = ref<any | null>(null);
const desiredModalWidth = ref(1024);
const desiredModalHeight = ref(768);
const isKeyboardDisabledForInput = ref(false);

const MIN_MODAL_WIDTH = 800;
const MIN_MODAL_HEIGHT = 600;

let vncWsBaseUrl: string;
const VNC_WS_PORT_FROM_ENV = import.meta.env.VITE_VNC_WS_PORT || '8082';

if (window.location.hostname === 'localhost') {
  vncWsBaseUrl = `ws://localhost:${VNC_WS_PORT_FROM_ENV}`;
  console.log(`[VncModal] Using localhost VNC WebSocket base URL: ${vncWsBaseUrl}`);
} else {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  vncWsBaseUrl = `${wsProtocol}//${window.location.hostname}:${VNC_WS_PORT_FROM_ENV}`;
  console.log(`[VncModal] Using production VNC WebSocket base URL: ${vncWsBaseUrl}`);
}

const handleConnection = async () => {
  if (!props.connection || !vncDisplayRef.value) {
    statusMessage.value = t('remoteDesktopModal.errors.missingInfo');
    connectionStatus.value = 'error';
    return;
  }

  while (vncDisplayRef.value.firstChild) {
    vncDisplayRef.value.removeChild(vncDisplayRef.value.firstChild);
  }
  disconnectGuacamole();

  connectionStatus.value = 'connecting';
  statusMessage.value = t('remoteDesktopModal.status.fetchingToken');

  try {
    const connectionsStore = useConnectionsStore();
    const token = await connectionsStore.getVncSessionToken(props.connection.id);
    if (!token) {
      throw new Error('VNC Token not found from store action');
    }
    statusMessage.value = t('remoteDesktopModal.status.connectingWs');
    const tunnelUrl = `${vncWsBaseUrl}?token=${encodeURIComponent(token)}`;
    console.log(`[VncModal] Connecting to VNC tunnel: ${tunnelUrl}`);

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

    vncDisplayRef.value.appendChild(guacClient.value.getDisplay().getElement());

    guacClient.value.onstatechange = (state: number) => {
      let currentStatus = '';
      let i18nKeyPart = 'unknownState';

      switch (state) {
        case 0: i18nKeyPart = 'idle'; currentStatus = 'disconnected'; break;
        case 1: i18nKeyPart = 'connectingVnc'; currentStatus = 'connecting'; break;
        case 2: i18nKeyPart = 'waiting'; currentStatus = 'connecting'; break;
        case 3:
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          setupInputListeners();
          nextTick(() => {
            const displayEl = guacClient.value?.getDisplay()?.getElement();
            if (displayEl && typeof displayEl.focus === 'function') {
              displayEl.focus();
            }
          });
          setTimeout(() => {
            nextTick(() => {
              if (vncDisplayRef.value && guacClient.value) {
                const canvases = vncDisplayRef.value.querySelectorAll('canvas');
                canvases.forEach((canvas) => { canvas.style.zIndex = '999'; });
              }
            });
          }, 100);
          break;
        case 4: i18nKeyPart = 'disconnecting'; currentStatus = 'disconnected'; break;
        case 5: i18nKeyPart = 'disconnected'; currentStatus = 'disconnected'; break;
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
    if (!guacClient.value || !vncDisplayRef.value) return;
    try {
        const displayEl = guacClient.value.getDisplay().getElement() as HTMLElement;
        displayEl.tabIndex = 0;

        const handleVncDisplayClick = () => {
          const activeElement = document.activeElement as HTMLElement;
          if (activeElement && (activeElement.id === 'modal-width' || activeElement.id === 'modal-height')) {
            activeElement.blur();
          }
          // Ensure the VNC display element gets focus when clicked
          if (displayEl && typeof displayEl.focus === 'function') {
            displayEl.focus();
          }
        };
        displayEl.addEventListener('click', handleVncDisplayClick);

        const handleMouseEnter = () => { if (displayEl) displayEl.style.cursor = 'none'; };
        const handleMouseLeave = () => { if (displayEl) displayEl.style.cursor = 'default'; };
        displayEl.addEventListener('mouseenter', handleMouseEnter);
        displayEl.addEventListener('mouseleave', handleMouseLeave);

        // @ts-ignore
        mouse.value = new Guacamole.Mouse(displayEl);
        const display = guacClient.value.getDisplay();
        display.showCursor(true);

        const cursorLayer = display.getCursorLayer();
        if (cursorLayer) {
          const cursorElement = cursorLayer.getElement();
          if (cursorElement) {
             cursorElement.style.zIndex = '1000';
          }
        }

        // @ts-ignore
        mouse.value.onmousedown = mouse.value.onmouseup = mouse.value.onmousemove = (mouseState: any) => {
            if (guacClient.value) {
                guacClient.value.sendMouseState(mouseState);
            }
        };

        // @ts-ignore
        keyboard.value = new Guacamole.Keyboard(displayEl);

        keyboard.value.onkeydown = (keysym: number) => {
            if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(1, keysym);
            }
        };
        keyboard.value.onkeyup = (keysym: number) => {
             if (guacClient.value && !isKeyboardDisabledForInput.value) {
                guacClient.value.sendKeyEvent(0, keysym);
             }
        };

    } catch (inputError) {
        console.error("Error setting up VNC input listeners:", inputError);
        statusMessage.value = t('remoteDesktopModal.errors.inputError');
    }
};

const removeInputListeners = () => {
    if (guacClient.value) {
        try {
            const displayEl = guacClient.value.getDisplay()?.getElement();
            if (displayEl) {
                displayEl.style.cursor = 'default';
            }
        } catch (e) {
             console.warn("Could not reset cursor on VNC display element:", e);
        }
    }
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

const disableVncKeyboard = () => {
  isKeyboardDisabledForInput.value = true;
};

const enableVncKeyboard = () => {
  isKeyboardDisabledForInput.value = false;
  nextTick(() => {
    const displayEl = guacClient.value?.getDisplay()?.getElement();
    if (displayEl && typeof displayEl.focus === 'function') {
      displayEl.focus();
    }
  });
};

const disconnectGuacamole = () => {
  removeInputListeners();
  isKeyboardDisabledForInput.value = false;
  if (guacClient.value) {
    guacClient.value.disconnect();
    guacClient.value = null;
  }
  if (vncDisplayRef.value) {
      while (vncDisplayRef.value.firstChild) {
          vncDisplayRef.value.removeChild(vncDisplayRef.value.firstChild);
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

watch(desiredModalWidth, (newWidth, oldWidth) => {
  if (newWidth === oldWidth) return;
  const validatedWidth = Math.max(MIN_MODAL_WIDTH, Number(newWidth) || MIN_MODAL_WIDTH);
  if (saveWidthTimeout) clearTimeout(saveWidthTimeout);
  saveWidthTimeout = setTimeout(() => {
    if (String(validatedWidth) !== settingsStore.settings.vncModalWidth) {
         settingsStore.updateSetting('vncModalWidth', String(validatedWidth));
    }
  }, DEBOUNCE_DELAY);
});

watch(desiredModalHeight, (newHeight, oldHeight) => {
   if (newHeight === oldHeight) return;
  const validatedHeight = Math.max(MIN_MODAL_HEIGHT, Number(newHeight) || MIN_MODAL_HEIGHT);
  if (saveHeightTimeout) clearTimeout(saveHeightTimeout);
  saveHeightTimeout = setTimeout(() => {
    if (String(validatedHeight) !== settingsStore.settings.vncModalHeight) {
        settingsStore.updateSetting('vncModalHeight', String(validatedHeight));
    }
  }, DEBOUNCE_DELAY);
});

watchEffect(() => {
  const storeWidth = settingsStore.settings.vncModalWidth;
  const storeHeight = settingsStore.settings.vncModalHeight;
  console.log(`[VncModal] From store - Width: ${storeWidth}, Height: ${storeHeight}`);

  const initialWidth = storeWidth ? parseInt(storeWidth, 10) : desiredModalWidth.value;
  const initialHeight = storeHeight ? parseInt(storeHeight, 10) : desiredModalHeight.value;

  const finalWidth = Math.max(MIN_MODAL_WIDTH, isNaN(initialWidth) ? MIN_MODAL_WIDTH : initialWidth);
  const finalHeight = Math.max(MIN_MODAL_HEIGHT, isNaN(initialHeight) ? MIN_MODAL_HEIGHT : initialHeight);
  console.log(`[VncModal] Applied - Width: ${finalWidth}, Height: ${finalHeight}`);
  desiredModalWidth.value = finalWidth;
  desiredModalHeight.value = finalHeight;
 });

onMounted(() => {
  if (props.connection) {
    nextTick(async () => {
        await handleConnection();
    });
  } else {
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

onUnmounted(() => {
  disconnectGuacamole();
});

watch(() => props.connection, (newConnection, oldConnection) => {
  if (newConnection && newConnection.id !== oldConnection?.id) {
     nextTick(async () => {
        await handleConnection();
     });
  } else if (!newConnection) {
      disconnectGuacamole();
      statusMessage.value = t('remoteDesktopModal.errors.noConnection');
      connectionStatus.value = 'error';
  }
});

const computedModalStyle = computed(() => {
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
          {{ t('vncModal.title') }} - {{ props.connection?.name || props.connection?.host || t('remoteDesktopModal.titlePlaceholder') }}
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

      <div ref="vncContainerRef" class="relative bg-black overflow-hidden flex-1">
        <div ref="vncDisplayRef" class="vnc-display-container w-full h-full">
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
              @focus="disableVncKeyboard"
              @blur="enableVncKeyboard"
            />
            <label for="modal-height" class="text-xs">{{ t('common.height') }}:</label>
            <input
              id="modal-height"
              type="number"
              v-model.number="desiredModalHeight"
              step="10"
              class="w-16 px-1 py-0.5 text-xs border border-border rounded bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              @focus="disableVncKeyboard"
              @blur="enableVncKeyboard"
            />
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
.vnc-display-container {
  overflow: hidden;
  position: relative;
}

.vnc-display-container :deep(div) {
}

.vnc-display-container :deep(canvas) {
  z-index: 999;
}
</style>