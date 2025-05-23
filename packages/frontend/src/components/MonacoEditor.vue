<template>
  <div ref="editorContainer" class="monaco-editor-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue';
import * as monaco from 'monaco-editor';

const localFontSize = ref(14); // 本地字体大小状态，默认 14

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext',
  },
  theme: {
    type: String,
    default: 'vs-dark',
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
  initialScrollTop: { // 新增 prop
    type: Number,
    default: 0,
  },
  initialScrollLeft: { // 新增 prop
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(['update:modelValue', 'request-save', 'update:scrollPosition']); // 新增 emit

const editorContainer = ref<HTMLElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;



onMounted(() => {
  if (editorContainer.value) {
    editorInstance = monaco.editor.create(editorContainer.value, {
      value: props.modelValue,
      language: props.language,
      theme: props.theme,
      fontSize: localFontSize.value, 
      automaticLayout: true,
      readOnly: props.readOnly,
      minimap: { enabled: true },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
    });


    editorInstance.onDidChangeModelContent(() => {
      if (editorInstance) {
        const currentValue = editorInstance.getValue();
        if (currentValue !== props.modelValue) {
          emit('update:modelValue', currentValue);
        }
      }
    });

    // Ctrl+S / Cmd+S
    editorInstance.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      ],
      precondition: undefined, 
      keybindingContext: undefined, 
      contextMenuGroupId: 'navigation', 
      contextMenuOrder: 1.5,
      run: () => {
        console.log('[MonacoEditor] Save action triggered (Ctrl+S / Cmd+S)');
        emit('request-save');
      },
    });
    
    // 应用初始滚动位置
    if (props.initialScrollTop > 0 || props.initialScrollLeft > 0) {
      editorInstance.setScrollPosition({
        scrollTop: props.initialScrollTop,
        scrollLeft: props.initialScrollLeft,
      });
    }

    // 监听滚动事件
    editorInstance.onDidScrollChange((e) => {
      if (editorInstance) {
        // 只有当滚动是由用户操作或实际视口变化引起时才发出
        // setScrollPosition 也会触发此事件，需要避免循环
        // 一个简单的检查是，如果事件中的滚动值与 props 中的初始值不同，则认为是有效滚动
        // 但更好的方式是父组件在设置初始值后才开始监听此事件，或此组件内部处理
        // 为简单起见，我们直接 emit
        emit('update:scrollPosition', {
          scrollTop: editorInstance.getScrollTop(),
          scrollLeft: editorInstance.getScrollLeft(),
        });
      }
    });
 
   
    editorInstance.onDidChangeModelContent(() => {
      if (editorInstance) {
        const currentValue = editorInstance.getValue();
        if (currentValue !== props.modelValue) {
          emit('update:modelValue', currentValue);
        }
      }
    });

    //Ctrl+S / Cmd+S
    editorInstance.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      ],
      precondition: undefined, 
      keybindingContext: undefined, 
      contextMenuGroupId: 'navigation', 
      contextMenuOrder: 1.5, 
      run: () => {
        console.log('[MonacoEditor] Save action triggered (Ctrl+S / Cmd+S)');
        emit('request-save');
      },
    });

    // --- 添加带防抖的鼠标滚轮缩放功能 ---
    const editorDomNode = editorInstance?.getDomNode();
    if (editorDomNode) {
        console.log('[MonacoEditor] Adding wheel event listener with debounce.');
        editorDomNode.addEventListener('wheel', (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault();

                
                const currentSize = localFontSize.value; // 使用本地状态
                let newSize: number;
                if (event.deltaY < 0) {
                    newSize = Math.min(currentSize + 1, 40);
                } else {
                    newSize = Math.max(currentSize - 1, 8);
                }

                // Update visual font size and local state immediately
                if (editorInstance && newSize !== currentSize) {
                    console.log(`[MonacoEditor] Updating local font size to: ${newSize}`);
                    localFontSize.value = newSize; // 更新本地状态
                    editorInstance.updateOptions({ fontSize: newSize }); // 更新编辑器视觉效果

                    // --- 移除触发防抖保存的逻辑 ---
                    // debouncedSetEditorFontSize(newSize);
                }
            }
        }, { passive: false }); 
    } else {
        console.error('[MonacoEditor] editorDomNode is null, cannot add wheel listener.');
    }


    // --- 移除鼠标滚轮缩放功能 ---
    // const editorDomNode = editorInstance?.getDomNode();
    // if (editorDomNode) {
    //   editorDomNode.addEventListener('wheel', (event: WheelEvent) => {
    //     if (event.ctrlKey) {
    //       event.preventDefault();
    //       // ... (移除字体大小调整逻辑) ...
    //       // if (editorInstance) {
    //       //   editorInstance.updateOptions({ fontSize: fontSize.value }); // 使用本地 fontSize
    //       // }
    //     }
    //   }, { passive: false });
    // }

  }
});


watch(() => props.modelValue, (newValue) => {
  if (editorInstance && editorInstance.getValue() !== newValue) {
    editorInstance.setValue(newValue);
  }
});


watch(() => props.language, (newLanguage) => {
  if (editorInstance && editorInstance.getModel()) {
    monaco.editor.setModelLanguage(editorInstance.getModel()!, newLanguage);
  }
});


watch(() => props.theme, (newTheme) => {
  if (editorInstance) {
    monaco.editor.setTheme(newTheme);
  }
});


watch(() => props.readOnly, (newReadOnly) => {
  if (editorInstance) {
    editorInstance.updateOptions({ readOnly: newReadOnly });
  }
});


// --- 移除对全局字体大小的监听 ---
onBeforeUnmount(() => {
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
});

defineExpose({
  focus: () => editorInstance?.focus()
});

</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  height: 100%; 
  min-height: 300px;
  text-align: left; 
}
</style>
