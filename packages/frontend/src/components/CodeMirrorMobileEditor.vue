<template>
  <div ref="editorRef" class="codemirror-mobile-editor-container" :style="{ fontSize: currentFontSize + 'px', fontFamily: editorFontFamily }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef, computed } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { useAppearanceStore } from '../stores/appearance.store';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, dropCursor } from '@codemirror/view'; 
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'; 
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'; 
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search'; 

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext', 
  },
});

const emit = defineEmits(['update:modelValue', 'request-save']);

const appearanceStore = useAppearanceStore();
const editorRef = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const languageCompartment = new Compartment();
const currentFontSize = ref(appearanceStore.currentMobileEditorFontSize);
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 40;
let lastPinchDistance = 0;
const debounceTimeout = ref<number | null>(null);
const DEBOUNCE_DELAY = 500; // 500ms 防抖延迟

const editorFontFamily = computed(() => appearanceStore.currentEditorFontFamily);

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

const debouncedSetMobileEditorFontSize = (size: number) => {
  if (debounceTimeout.value !== null) {
    clearTimeout(debounceTimeout.value);
  }
  debounceTimeout.value = window.setTimeout(() => {
    appearanceStore.setMobileEditorFontSize(size);
  }, DEBOUNCE_DELAY);
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
            debouncedSetMobileEditorFontSize(newFontSize);
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
      // Minimal set of extensions for testing highlighting
      languageCompartment.of(languageExtension), // Crucial: applies the CSS language pack
      // oneDark, // REMOVING oneDark theme
      vscodeDark, // Use the pre-built vscodeDark theme
      lineNumbers(), // RE-ADDING lineNumbers
      history(), // RE-ADDING history
      highlightActiveLineGutter(), // RE-ADDING highlightActiveLineGutter
      foldGutter(), // RE-ADDING foldGutter
      drawSelection(), // RE-ADDING drawSelection
      dropCursor(), // RE-ADDING dropCursor
      EditorState.allowMultipleSelections.of(true), // RE-ADDING allowMultipleSelections
      indentOnInput(), // RE-ADDING indentOnInput
      bracketMatching(), // RE-ADDING bracketMatching
      highlightActiveLine(), // RE-ADDING highlightActiveLine
      closeBrackets(), // RE-ADDING closeBrackets
      autocompletion(), // RE-ADDING autocompletion
      highlightSelectionMatches(), // RE-ADDING highlightSelectionMatches
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
      keymap.of([
        ...closeBracketsKeymap, // RE-ADDING closeBracketsKeymap
        ...defaultKeymap, // RE-ADDING defaultKeymap
        ...historyKeymap, // RE-ADDING historyKeymap
        ...foldKeymap, // RE-ADDING foldKeymap
        { key: "Mod-s", run: () => { emit('request-save'); return true; } } // Optional: keep for testing save
      ]),
    ],
  });
};

const getLanguageExtension = async (lang: string) => {
  if (lang === 'javascript') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript();
  }
  if (lang === 'css') {
    try {
      console.log('[CodeMirrorMobileEditor DEBUG] Attempting to import @codemirror/lang-css for language:', lang);
      const cssModule = await import('@codemirror/lang-css');
      console.log('[CodeMirrorMobileEditor DEBUG] @codemirror/lang-css imported:', cssModule);
      if (cssModule && typeof cssModule.css === 'function') {
        const cssExtension = cssModule.css();
        console.log('[CodeMirrorMobileEditor DEBUG] CSS extension object created:', cssExtension);
        return cssExtension;
      } else {
        console.error('[CodeMirrorMobileEditor DEBUG] @codemirror/lang-css module or css function is invalid. Module:', cssModule);
        return [];
      }
    } catch (error) {
      console.error('[CodeMirrorMobileEditor DEBUG] Error loading/initializing CSS language support:', error);
      return [];
    }
  }
  if (lang === 'html') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  return [];
};


onMounted(async () => {
  // Initialize font size from store
  currentFontSize.value = appearanceStore.currentMobileEditorFontSize;

  if (editorRef.value) {
    const langExt = await getLanguageExtension(props.language);
    console.log('[CodeMirrorMobileEditor DEBUG] onMounted - Initial language:', props.language, 'Fetched langExt:', langExt);
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
  // Clear debounce timeout if it exists
  if (debounceTimeout.value !== null) {
    clearTimeout(debounceTimeout.value);
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
    console.log(`[CodeMirrorMobileEditor DEBUG] watch props.language - New language: ${newLanguage}, Fetched langExt:`, langExt);
    view.value.dispatch({
      effects: languageCompartment.reconfigure(langExt)
    });
  }
});

// Watch for changes from the store (e.g., if changed in settings panel)
watch(() => appearanceStore.currentMobileEditorFontSize, (newSize) => {
  if (newSize !== currentFontSize.value) {
    currentFontSize.value = newSize;
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
