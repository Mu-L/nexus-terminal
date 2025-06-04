<template>
  <div ref="editorRef" class="codemirror-mobile-editor-container"></div>
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
  }
});

onBeforeUnmount(() => {
  if (view.value) {
    view.value.destroy();
    view.value = null;
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
