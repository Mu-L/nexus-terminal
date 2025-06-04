<template>
  <div ref="editorRef" class="codemirror-mobile-editor-container" :style="{ fontSize: currentFontSize + 'px' }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror'; // Use basicSetup from the main 'codemirror' package

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext', // Default to plaintext if no language is specified
  },
});

const emit = defineEmits(['update:modelValue', 'request-save']);

const editorRef = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const languageCompartment = new Compartment(); // For dynamic language switching
// Pinch to zoom state and handlers
const currentFontSize = ref(16); // Initial font size in pixels
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 40;
let lastPinchDistance = 0;

const getDistance = (touches: TouchList): number => {
  if (touches.length < 2) return 0;
  const touch1 = touches[0];
  const touch2 = touches[1];
  return Math.sqrt(
    Math.pow(touch2.pageX - touch1.pageX, 2) +
    Math.pow(touch2.pageY - touch1.pageY, 2)
  );
};

const onTouchStart = (event: TouchEvent) => {
  if (editorRef.value && editorRef.value.contains(event.target as Node)) {
    if (event.touches.length === 2) {
      event.preventDefault();
      lastPinchDistance = getDistance(event.touches);
    }
  }
};

const onTouchMove = (event: TouchEvent) => {
  if (editorRef.value && editorRef.value.contains(event.target as Node)) {
    if (event.touches.length === 2) {
      event.preventDefault();
      const newPinchDistance = getDistance(event.touches);
      if (lastPinchDistance > 0 && newPinchDistance > 0) {
        const scale = newPinchDistance / lastPinchDistance;
        let newFontSize = currentFontSize.value * scale;
        newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newFontSize));
        
        if (Math.abs(currentFontSize.value - newFontSize) > 0.1) { // Only update if change is meaningful
             currentFontSize.value = newFontSize;
        }
      }
      if (newPinchDistance > 0) {
        lastPinchDistance = newPinchDistance;
      } else if (event.touches.length === 2) { // if newPinchDistance is 0 but still 2 touches, try to re-calculate
        lastPinchDistance = getDistance(event.touches);
      }
    }
  }
};

const onTouchEnd = (event: TouchEvent) => {
  if (event.touches.length < 2) {
    lastPinchDistance = 0;
  }
};

const createEditorState = (doc: string, languageExtension: any) => {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup, // Includes many common features like line numbers, history, default keymaps etc.
      keymap.of([
        { key: "Mod-s", run: () => { emit('request-save'); return true; } }
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
      languageCompartment.of(languageExtension), // Initial language
    ],
  });
};

const getLanguageExtension = async (lang: string) => {
  if (lang === 'javascript') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript();
  }
  if (lang === 'css') {
    const { css } = await import('@codemirror/lang-css');
    return css();
  }
  if (lang === 'html') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  return [];
};


onMounted(async () => {
  if (editorRef.value) {
    const langExt = await getLanguageExtension(props.language);
    const startState = createEditorState(props.modelValue, langExt);
    
    view.value = new EditorView({
      state: startState,
      parent: editorRef.value,
    });
    // Add touch event listeners for pinch-to-zoom
    editorRef.value.addEventListener('touchstart', onTouchStart, { passive: false });
    editorRef.value.addEventListener('touchmove', onTouchMove, { passive: false });
    editorRef.value.addEventListener('touchend', onTouchEnd, { passive: false });
  }
});

onBeforeUnmount(() => {
  if (view.value) {
    view.value.destroy();
    view.value = null;
  }
  // Remove touch event listeners
  if (editorRef.value) {
    editorRef.value.removeEventListener('touchstart', onTouchStart);
    editorRef.value.removeEventListener('touchmove', onTouchMove);
    editorRef.value.removeEventListener('touchend', onTouchEnd);
  }
});

watch(() => props.modelValue, (newValue) => {
  if (view.value && newValue !== view.value.state.doc.toString()) {
    view.value.dispatch({
      changes: { from: 0, to: view.value.state.doc.length, insert: newValue },
    });
  }
});

watch(() => props.language, async (newLanguage, oldLanguage) => {
  if (view.value && newLanguage !== oldLanguage) {
    console.log(`Language changing from ${oldLanguage} to: ${newLanguage}.`);
    const langExt = await getLanguageExtension(newLanguage);
    view.value.dispatch({
      effects: languageCompartment.reconfigure(langExt)
    });
  }
});

defineExpose({
  focus: () => view.value?.focus(),
});

</script>

<style scoped>
.codemirror-mobile-editor-container {
  width: 100%;
  height: 100%;
  min-height: 200px; /* Adjust as needed for mobile */
  text-align: left;
  overflow: auto; /* Enable both horizontal and vertical scrolling */
}

.codemirror-mobile-editor-container :deep(.cm-gutters) {
  background-color: #1E1E1E !important; /* Match typical dark editor background */
  color: #858585 !important; /* Ensure line numbers are visible */
  border-right: 1px solid var(--border-color, #cccccc) !important; /* Use theme border color */
}

.codemirror-mobile-editor-container :deep(.cm-selectionBackground) {
  background-color: #5264ac !important;
}
</style>
