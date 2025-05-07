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
// Initialize desiredModalWidth and desiredModalHeight from store or defaults
const initialStoreWidth = settingsStore.settings.vncModalWidth
   ? parseInt(settingsStore.settings.vncModalWidth, 10)
   : 1024;
const initialStoreHeight = settingsStore.settings.vncModalHeight
   ? parseInt(settingsStore.settings.vncModalHeight, 10)
   : 768;

const MIN_MODAL_WIDTH = 800;
const MIN_MODAL_HEIGHT = 600;

const desiredModalWidth = ref(Math.max(MIN_MODAL_WIDTH, isNaN(initialStoreWidth) ? MIN_MODAL_WIDTH : initialStoreWidth));
const desiredModalHeight = ref(Math.max(MIN_MODAL_HEIGHT, isNaN(initialStoreHeight) ? MIN_MODAL_HEIGHT : initialStoreHeight));
const isKeyboardDisabledForInput = ref(false);
const isMinimized = ref(false);
const restoreButtonRef = ref<HTMLButtonElement | null>(null);
const isDraggingRestoreButton = ref(false);
const restoreButtonPosition = ref({ x: 16, y: window.innerHeight / 2 - 25 }); // 16px from left, vertically centered (25 is half of button height 50px)
let dragOffsetX = 0;
let dragOffsetY = 0;
let hasDragged = false;

let vncWsBaseUrl: string;
const VNC_WS_PORT_FROM_ENV = import.meta.env.VITE_VNC_WS_PORT || '8082';

if (window.location.hostname === 'localhost') {
  vncWsBaseUrl = `ws://localhost:${VNC_WS_PORT_FROM_ENV}`;
} else {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  vncWsBaseUrl = `${wsProtocol}//${window.location.hostname}:${VNC_WS_PORT_FROM_ENV}`;
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
    const token = await connectionsStore.getVncSessionToken(props.connection.id, desiredModalWidth.value, desiredModalHeight.value);
    if (!token) {
      throw new Error('VNC Token not found from store action');
    }
    statusMessage.value = t('remoteDesktopModal.status.connectingWs');
    const tunnelUrl = `${vncWsBaseUrl}?token=${encodeURIComponent(token)}`;
  

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
            // Sync size on connect
            if (vncDisplayRef.value && guacClient.value) {
              const displayWidth = vncDisplayRef.value.offsetWidth;
              const displayHeight = vncDisplayRef.value.offsetHeight;
              if (displayWidth > 0 && displayHeight > 0) {
                console.log(`[VncModal] Initial resize on connect: ${displayWidth}x${displayHeight}`);
                guacClient.value.sendSize(displayWidth, displayHeight);
              }
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

const trySyncClipboardOnDisplayFocus = async () => {
  if (!guacClient.value) {
    return;
  }
  try {
    const currentClipboardText = await navigator.clipboard.readText();
    if (currentClipboardText && guacClient.value) {
      // @ts-ignore
      const stream = guacClient.value.createClipboardStream('text/plain');
      // @ts-ignore
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(currentClipboardText);
      writer.sendEnd();
      console.log('[VncModal] Sent clipboard to VNC on display focus:', currentClipboardText.substring(0, 50) + (currentClipboardText.length > 50 ? '...' : ''));
    }
  } catch (err) {
    // This error is expected if the document/tab is not focused when the VNC display element gets focus.
    // Or if clipboard permissions are not granted.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // console.log('[VncModal] Clipboard read on display focus skipped: Document not focused or permission denied.');
    } else {
      console.warn('[VncModal] Could not read clipboard on display focus, or other error:', err);
    }
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

        // Listen for host copy events to send to VNC
        // document.addEventListener('copy', handleHostCopy); // Removed this
        // displayEl.addEventListener('mouseenter', trySyncClipboardOnMouseEnter); // Changed to focus event
        displayEl.addEventListener('focus', trySyncClipboardOnDisplayFocus);

    } catch (inputError) {
        console.error("Error setting up VNC input listeners:", inputError);
        statusMessage.value = t('remoteDesktopModal.errors.inputError');
    }
};

const removeInputListeners = () => {
    // Remove host copy event listener
    // document.removeEventListener('copy', handleHostCopy); // Removed this
    if (guacClient.value) {
        const displayEl = guacClient.value.getDisplay()?.getElement();
        if (displayEl) {
            // displayEl.removeEventListener('mouseenter', trySyncClipboardOnMouseEnter); // Changed to focus event
            displayEl.removeEventListener('focus', trySyncClipboardOnDisplayFocus);
            try {
              if (displayEl) {
                  displayEl.style.cursor = 'default';
              }
            } catch (e) {
                console.warn("Could not reset cursor on VNC display element:", e);
            }
        }
    }
    // The rest of the cleanup for keyboard and mouse can remain outside the guacClient.value check
    // as they are independent refs.
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

const minimizeModal = () => {
  isMinimized.value = true;
};

const restoreModal = () => {
  isMinimized.value = false;
};

const onRestoreButtonMouseDown = (event: MouseEvent) => {
  if (!restoreButtonRef.value) return;
  hasDragged = false; // Reset drag flag
  isDraggingRestoreButton.value = true;
  dragOffsetX = event.clientX - restoreButtonRef.value.getBoundingClientRect().left;
  dragOffsetY = event.clientY - restoreButtonRef.value.getBoundingClientRect().top;
  // Prevent text selection while dragging
  event.preventDefault();
  document.addEventListener('mousemove', onRestoreButtonMouseMove);
  document.addEventListener('mouseup', onRestoreButtonMouseUp);
};

const onRestoreButtonMouseMove = (event: MouseEvent) => {
  if (!isDraggingRestoreButton.value) return;
  hasDragged = true; // Set drag flag if mouse moves
  let newX = event.clientX - dragOffsetX;
  let newY = event.clientY - dragOffsetY;

  // Constrain movement within viewport
  const buttonWidth = 50; // As defined in style
  const buttonHeight = 50; // As defined in style
  newX = Math.max(0, Math.min(newX, window.innerWidth - buttonWidth));
  newY = Math.max(0, Math.min(newY, window.innerHeight - buttonHeight));

  restoreButtonPosition.value = { x: newX, y: newY };
};

const onRestoreButtonMouseUp = () => {
  isDraggingRestoreButton.value = false;
  document.removeEventListener('mousemove', onRestoreButtonMouseMove);
  document.removeEventListener('mouseup', onRestoreButtonMouseUp);
  // Click event will fire after mouseup. If we dragged, we don't want click to restore.
  // The handleClickRestoreButton will check hasDragged.
};

const handleClickRestoreButton = () => {
  if (!hasDragged) {
    restoreModal();
  }
  // Reset for next interaction
  hasDragged = false;
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
  if (newWidth === oldWidth && typeof newWidth === 'number' && typeof oldWidth === 'number') {
      return;
  }

  
  const validatedWidth = Math.max(MIN_MODAL_WIDTH, Number(newWidth) || MIN_MODAL_WIDTH);

  if (validatedWidth !== Number(newWidth)) {
    nextTick(() => {
      desiredModalWidth.value = validatedWidth;
    });
  }

  if (saveWidthTimeout) clearTimeout(saveWidthTimeout);
  saveWidthTimeout = setTimeout(() => {
    if (String(validatedWidth) !== settingsStore.settings.vncModalWidth) {
         settingsStore.updateSetting('vncModalWidth', String(validatedWidth));
    } else {
        // console.log(`[VncModal] 防抖保存 - 宽度 ${validatedWidth} 与存储值匹配。跳过冗余保存。`);
    }
  }, DEBOUNCE_DELAY);
});

watch(desiredModalHeight, (newHeight, oldHeight) => {
   if (newHeight === oldHeight && typeof newHeight === 'number' && typeof oldHeight === 'number') {
       // console.log(`[VncModal] 高度监听触发，但值 (${newHeight}) 未改变。跳过。`);
       return;
   }
   // console.log(`[VncModal] 监听 desiredModalHeight 触发: ${oldHeight} -> ${newHeight}`);
  
  const validatedHeight = Math.max(MIN_MODAL_HEIGHT, Number(newHeight) || MIN_MODAL_HEIGHT);

  if (validatedHeight !== Number(newHeight)) {
    nextTick(() => {
      desiredModalHeight.value = validatedHeight;
    });
  }

  if (saveHeightTimeout) clearTimeout(saveHeightTimeout);
  saveHeightTimeout = setTimeout(() => {
    // console.log(`[VncModal] 防抖保存 - 保存高度: ${validatedHeight}`);
    if (String(validatedHeight) !== settingsStore.settings.vncModalHeight) {
        settingsStore.updateSetting('vncModalHeight', String(validatedHeight));
    } else {
        // console.log(`[VncModal] 防抖保存 - 高度 ${validatedHeight} 与存储值匹配。跳过冗余保存。`);
    }
  }, DEBOUNCE_DELAY);
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
  document.removeEventListener('mousemove', onRestoreButtonMouseMove);
  document.removeEventListener('mouseup', onRestoreButtonMouseUp);
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
watchEffect(() => {
  // 依赖 computedModalStyle，当其变化时此 effect 会重新运行
  const currentStyle = computedModalStyle.value;

  if (guacClient.value && connectionStatus.value === 'connected' && vncDisplayRef.value) {
    // 使用 nextTick 确保 DOM 更新完毕，vncDisplayRef 的尺寸已根据 currentStyle 刷新
    nextTick(() => {
      if (vncDisplayRef.value && guacClient.value) { // 再次检查，因为 nextTick 是异步的
        const displayWidth = vncDisplayRef.value.offsetWidth;
        const displayHeight = vncDisplayRef.value.offsetHeight;

        if (displayWidth > 0 && displayHeight > 0) {
          console.log(`[VncModal] Resizing VNC display to: ${displayWidth}x${displayHeight} due to style change.`);
          guacClient.value.sendSize(displayWidth, displayHeight);
        }
      }
    });
  }
});

</script>
<template>
  <div
    :class="[
      'fixed inset-0 z-50 flex items-center justify-center p-4',
      isMinimized ? '' : 'bg-overlay',
      isMinimized ? 'pointer-events-none' : '' // 允许恢复按钮接收事件
    ]"
  >
     <button
        ref="restoreButtonRef"
        v-if="isMinimized"
        @mousedown="onRestoreButtonMouseDown"
        @click="handleClickRestoreButton"
        :style="{ left: `${restoreButtonPosition.x}px`, top: `${restoreButtonPosition.y}px`, width: '50px', height: '50px' }"
        class="fixed z-[100] flex items-center justify-center bg-primary text-white rounded-full shadow-lg hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 pointer-events-auto cursor-grab active:cursor-grabbing"
        :title="t('common.restore')"
      >
        <i class="fas fa-window-restore fa-lg"></i>
      </button>
     <div
        v-show="!isMinimized"
        :style="computedModalStyle"
        class="bg-background text-foreground rounded-lg shadow-xl flex flex-col overflow-hidden border border-border pointer-events-auto"
     >
      <div class="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
        <h3 class="text-base font-semibold truncate">
          <i class="fas fa-desktop mr-2 text-text-secondary"></i>
          {{ t('vncModal.title') }} - {{ props.connection?.name || props.connection?.host || t('remoteDesktopModal.titlePlaceholder') }}
        </h3>
        <div class="flex items-center space-x-1">
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
                @click="minimizeModal"
                class="text-text-secondary hover:text-foreground transition-colors duration-150 p-1 rounded hover:bg-hover"
                :title="t('common.minimize')"
            >
                <i class="fas fa-window-minimize fa-sm"></i>
            </button>
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