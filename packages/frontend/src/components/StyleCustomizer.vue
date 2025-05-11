<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore } from '../stores/appearance.store'; 
import { storeToRefs } from 'pinia';
import type { ITheme } from 'xterm';
import type { TerminalTheme } from '../types/terminal-theme.types'; 
import { defaultXtermTheme } from '../features/appearance/config/default-themes'; 

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const {
  appearanceSettings, 
  currentUiTheme,
  
  activeTerminalThemeId, 
  allTerminalThemes, 
  currentTerminalFontFamily,
  currentTerminalFontSize,
  currentEditorFontSize, 
  pageBackgroundImage,
  
  terminalBackgroundImage,
  
  isTerminalBackgroundEnabled, 
} = storeToRefs(appearanceStore);
 

const editableUiTheme = ref<Record<string, string>>({});
const editableTerminalFontFamily = ref('');
const editableTerminalFontSize = ref(14);
const editableEditorFontSize = ref(14); 


const editableUiThemeString = ref(''); 
const themeParseError = ref<string | null>(null); 
const localTerminalBackgroundEnabled = ref(true); 
 
// 终端主题管理相关状态
const isEditingTheme = ref(false); // 是否正在编辑某个主题
const themeSearchTerm = ref(''); // 主题搜索词
// 使用 reactive 确保嵌套对象 themeData 的响应性
// 修正：editingTheme 应该是一个 ref 包含 TerminalTheme 或 null
const editingTheme = ref<TerminalTheme | null>(null); // 正在编辑的主题数据副本 (完整结构)
const newThemeName = ref(''); // 新建主题的名称 (不再需要，直接编辑 editingTheme.value.name)

// 文件上传相关
const pageBgFileInput = ref<HTMLInputElement | null>(null);
const terminalBgFileInput = ref<HTMLInputElement | null>(null);
const themeImportInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);
const importError = ref<string | null>(null);
const saveThemeError = ref<string | null>(null); // 用于显示保存主题时的错误
const editableTerminalThemeString = ref(''); // 用于终端主题 textarea 绑定
const terminalThemeParseError = ref<string | null>(null); // 用于显示终端主题 JSON 解析错误
const terminalThemePlaceholder = `background: #000000
foreground: #ffffff
cursor: #ffffff
selectionBackground: #555555
black: #000000
red: #ff0000
green: #00ff00
yellow: #ffff00
blue: #0000ff
magenta: #ff00ff
cyan: #00ffff
white: #ffffff
brightBlack: #555555
brightRed: #ff5555
brightGreen: #55ff55
brightYellow: #ffff55
brightBlue: #5555ff
brightMagenta: #ff55ff
brightCyan: #55ffff
brightWhite: #ffffff`; // 终端主题编辑器的 placeholder (key: value 格式)

// 初始化本地编辑状态
import { defaultUiTheme } from '../features/appearance/config/default-themes'; // 确保导入默认主题
import { safeJsonParse } from '../stores/appearance.store'; // 导入辅助函数

const initializeEditableState = () => {
  // 获取用户保存的主题或空对象
  // 注意：直接从 store 的 appearanceSettings 获取原始字符串，避免依赖 currentUiTheme 计算属性可能带来的延迟或缓存问题
  const userThemeJson = appearanceSettings.value.customUiTheme;
  const userTheme = safeJsonParse(userThemeJson, {});

  // 合并默认主题和用户主题，确保所有默认键存在，并优先使用用户值
  const mergedTheme = { ...defaultUiTheme, ...userTheme }; // 用户值覆盖默认值

  // 深拷贝合并后的主题到 editableUiTheme
  editableUiTheme.value = JSON.parse(JSON.stringify(mergedTheme));

  // --- 其他初始化保持不变 ---
  editableTerminalFontFamily.value = currentTerminalFontFamily.value;
  editableTerminalFontSize.value = currentTerminalFontSize.value;
  editableEditorFontSize.value = currentEditorFontSize.value; // <-- 新增
  localTerminalBackgroundEnabled.value = isTerminalBackgroundEnabled.value; // <-- 重新添加：在此处初始化
  console.log(`[StyleCustomizer initializeEditableState] Initializing localTerminalBackgroundEnabled to: ${localTerminalBackgroundEnabled.value} (from store: ${isTerminalBackgroundEnabled.value})`); // 添加日志
  uploadError.value = null;
  importError.value = null;
  saveThemeError.value = null;
  themeParseError.value = null; // 初始化解析错误

  // 初始化 textarea 内容 (基于合并后的主题)
  try {
      const themeObject = editableUiTheme.value; // 使用合并后的主题
      if (themeObject && typeof themeObject === 'object' && Object.keys(themeObject).length > 0) {
          const lines = Object.entries(themeObject).map(([key, value]) => `${key}: ${value}`);
          editableUiThemeString.value = lines.join('\n');
      } else {
          editableUiThemeString.value = '';
      }
  } catch (e) {
      console.error("初始化 UI 主题字符串失败:", e);
      editableUiThemeString.value = ''; // Fallback to empty
  }
};

onMounted(initializeEditableState);

// 监听 store 变化以更新本地状态 (例如重置或外部更改)
// 只监听不需要编辑的状态或用于初始化的状态
// 监听 store 中可能影响初始化状态的值
// 主要监听 appearanceSettings (包含 customUiTheme) 和 activeTerminalThemeId
// 不再直接监听 currentUiTheme 计算属性，因为 initializeEditableState 现在直接处理合并逻辑
watch([
    () => appearanceStore.appearanceSettings, // 监听整个设置对象的变化
    activeTerminalThemeId
], (newVals, oldVals) => {
    // newVals[0] 是新的 appearanceSettings 对象
    // newVals[1] 是新的 activeTerminalThemeId
    const newSettings = newVals[0];
    const oldSettings = oldVals ? oldVals[0] : {}; // 可能没有旧值
    const newActiveThemeId = newVals[1];
    const oldActiveThemeId = oldVals ? oldVals[1] : null;

    // 仅当非编辑状态时，或活动终端主题ID变化时，或 UI 主题/终端背景启用状态设置本身发生变化时 (例如重置或外部更改)，才重新初始化
    const settingsChanged = newSettings?.customUiTheme !== oldSettings?.customUiTheme || newSettings?.terminalBackgroundEnabled !== oldSettings?.terminalBackgroundEnabled; // 检查相关设置是否变化
    if (!isEditingTheme.value || newActiveThemeId !== oldActiveThemeId || settingsChanged) {
        console.log(`[StyleCustomizer Watch] Triggering re-initialization. isEditing: ${isEditingTheme.value}, themeIdChanged: ${newActiveThemeId !== oldActiveThemeId}, settingsChanged: ${settingsChanged}`); // 添加日志
        initializeEditableState(); // 调用修改后的初始化函数
    } else {
        // 如果正在编辑，只更新非编辑相关的部分 (不包括 UI 主题和终端背景开关，因为它们由 initializeEditableState 处理)
        console.log('[StyleCustomizer] Watch triggered partial update (editing).');
        // editableUiTheme.value = JSON.parse(JSON.stringify(newVals[0] || {})); // 移除或注释掉，避免覆盖编辑状态
        // 确保从正确的 newVals 索引获取值，现在 watch 的依赖项变了
        // 假设 appearanceSettings 是第一个依赖，activeTerminalThemeId 是第二个
        // 字体等信息需要从 newSettings 中获取
        editableTerminalFontFamily.value = newSettings?.terminalFontFamily || '';
        editableTerminalFontSize.value = newSettings?.terminalFontSize || 14;
        editableEditorFontSize.value = newSettings?.editorFontSize || 14; // <-- 新增同步
        // localTerminalBackgroundEnabled.value = newSettings?.terminalBackgroundEnabled ?? true; // <-- 移除此行，避免冲突
    }
}, { deep: true });
 
// 监听 store 中 isTerminalBackgroundEnabled 的变化，以同步本地状态
watch(isTerminalBackgroundEnabled, (newValue) => {
  // 只有当本地状态与 store 状态不一致时才更新本地状态
  // 这避免了 handleToggleTerminalBackground 触发的不必要更新
  if (localTerminalBackgroundEnabled.value !== newValue) {
    console.log(`[StyleCustomizer Watch isTerminalBackgroundEnabled] Store changed to ${newValue}, updating local state.`); // 添加日志
    localTerminalBackgroundEnabled.value = newValue;
  } else {
     console.log(`[StyleCustomizer Watch isTerminalBackgroundEnabled] Store changed to ${newValue}, but local state already matches. No update needed.`); // 添加日志
  }
});
// 移除单独监听 isTerminalBackgroundEnabled 的 watcher
 
const emit = defineEmits(['close']);
 
 
const closeCustomizer = () => {
  // 如果正在编辑主题，直接关闭并重置状态
  if (isEditingTheme.value) {
      isEditingTheme.value = false; // 退出编辑状态
      editingTheme.value = null;
      saveThemeError.value = null; // 同时清除可能存在的保存错误
  }
  emit('close'); // 总是触发关闭事件
};

// 当前活动的标签页
const currentTab = ref<'ui' | 'terminal' | 'background' | 'other'>('ui'); // <-- 添加 'other'

// --- 处理函数 ---

// 保存 UI 主题更改
const handleSaveUiTheme = async () => {
  try {
    await appearanceStore.saveCustomUiTheme(editableUiTheme.value);
  } catch (error: any) {
    console.error("保存 UI 主题失败:", error);
    alert(t('styleCustomizer.uiThemeSaveFailed', { message: error.message }));
  }
};

// 重置 UI 主题
const handleResetUiTheme = async () => {
    try {
        await appearanceStore.resetCustomUiTheme();
    } catch (error: any) {
        console.error("重置 UI 主题失败:", error);
         alert(t('styleCustomizer.uiThemeResetFailed', { message: error.message }));
    }
};

// 定义黑暗模式主题变量
const darkModeTheme = {
  '--app-bg-color': '#212529',
  '--text-color': '#e9ecef',
  '--text-color-secondary': '#adb5bd',
  '--border-color': '#495057',
  '--link-color': '#BB86FC', // 现代紫色 - 亮 (Material Design Purple 200)
  '--link-hover-color': '#D1A9FF', // 现代紫色 - 悬停 (更亮)
  '--link-active-color': '#A06CD5', // 现代紫色 - 激活 (与默认主题一致)
  '--link-active-bg-color': 'rgba(160, 108, 213, 0.2)', /* 现代紫色 - 激活背景 (暗模式) */
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#343a40',
  '--footer-bg-color': '#343a40',
  '--button-bg-color': 'var(--link-active-color)', // 自动更新
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8E44AD', // 现代紫色 - 悬停 (与默认主题一致)
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)', // 自动更新
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-focus-border-color': 'var(--link-active-color)', // 自动更新
  '--input-focus-glow': 'var(--link-active-color)', // 自动更新
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.8)',
  '--color-success': '#5cb85c',
  '--color-error': '#d9534f',
  '--color-warning': '#f0ad4e',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem'
};

// 应用黑暗模式
const applyDarkMode = async () => {
  try {
    // 深拷贝覆盖当前编辑的主题
    editableUiTheme.value = JSON.parse(JSON.stringify(darkModeTheme));
    await appearanceStore.saveCustomUiTheme(editableUiTheme.value);
  } catch (error: any) {
    console.error("应用黑暗模式失败:", error);
    // TODO: 添加 i18n 翻译 'styleCustomizer.darkModeApplyFailed'
    alert(t('styleCustomizer.darkModeApplyFailed', { message: error.message || '未知错误' }));
  }
};

// --- Textarea 和 Color Picker 同步 ---

// 计算属性：将本地编辑的 UI 主题对象格式化为内部键值对字符串（无大括号，无行尾逗号）
const formattedEditableUiThemeJson = computed(() => {
    try {
        const themeObject = editableUiTheme.value;
        if (!themeObject || typeof themeObject !== 'object' || Object.keys(themeObject).length === 0) {
            return ''; // Return empty string if no theme or empty
        }
        // Generate key-value pairs, indented, one per line
        // Generate key-value pairs, indented, one per line, without quotes for easier editing
        const lines = Object.entries(themeObject).map(([key, value]) => {
            // Output key and value directly without leading spaces
            return `${key}: ${value}`;
        });
        // Join with newline
        return lines.join('\n');
    } catch (e) {
        console.error("序列化可编辑 UI 主题键值对失败:", e);
        return ''; // 回退为空字符串
    }
});

// 监听计算属性的变化（通常由颜色选择器引起），更新 textarea 的内容
watch(formattedEditableUiThemeJson, (newJson) => {
    // 只有在 textarea 没有聚焦时才更新，避免覆盖用户输入
    // 或者，如果解析错误存在，也允许更新以显示正确格式
    if (document.activeElement?.id !== 'uiThemeTextarea' || themeParseError.value) {
        editableUiThemeString.value = newJson;
        if (themeParseError.value && document.activeElement?.id !== 'uiThemeTextarea') {
             themeParseError.value = null; // 如果外部更改修复了错误，清除错误提示
        }
    }
});

// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
// 处理 textarea 内容变化（失去焦点时）
const handleUiThemeStringChange = () => {
    themeParseError.value = null; // 清除之前的错误
    let inputText = editableUiThemeString.value.trim();

    // 如果内容为空，则视为空对象
    if (!inputText) {
        editableUiTheme.value = {};
        return;
    }

    // 准备构建 JSON 字符串
    let jsonStringToParse = inputText
        .split('\n') // 按行分割
        .map(line => line.trim()) // 去除每行首尾空格
        .filter(line => line && line.includes(':')) // 过滤空行和不包含冒号的行
        .map(line => {
            // 尝试为 key 和 value 添加引号（如果缺少）
            const parts = line.split(/:(.*)/s); // 按第一个冒号分割，保留后面的所有内容
            if (parts.length < 2) return null; // 无效行

            let key = parts[0].trim();
            let value = parts[1].trim();

            // 为 key 添加引号（如果需要）
            // 移除 key 可能存在的引号再用 stringify 包裹
            if (key.startsWith('"') && key.endsWith('"')) {
                key = key.slice(1, -1);
            }
             if (key.startsWith("'") && key.endsWith("'")) {
                key = key.slice(1, -1);
            }
            key = JSON.stringify(key); // 使用 JSON.stringify 保证正确转义

            // 为 value 添加引号（如果需要，且不是数字/布尔值/null）
            // 移除可能的尾随逗号
            if (value.endsWith(',')) {
                value = value.slice(0, -1).trim();
            }
            // 移除 value 可能存在的引号再判断
            let originalValue = value;
             if (value.startsWith('"') && value.endsWith('"')) {
                originalValue = value.slice(1, -1);
            } else if (value.startsWith("'") && value.endsWith("'")) {
                 originalValue = value.slice(1, -1);
            }

            // 判断是否需要加引号
            if (isNaN(Number(originalValue)) && originalValue !== 'true' && originalValue !== 'false' && originalValue !== 'null') {
                 value = JSON.stringify(originalValue); // 使用原始未加引号的值进行 stringify
            } else {
                // 对于数字、布尔值、null，不需要加引号
                value = originalValue;
            }


            return `  ${key}: ${value}`; // 返回带缩进的键值对
        })
        .filter(line => line !== null) // 过滤掉处理失败的行
        .join(',\n'); // 用逗号和换行符连接

    // 添加外层大括号
    const fullJsonString = `{\n${jsonStringToParse}\n}`;

    try {
        const parsedTheme = JSON.parse(fullJsonString);
        // 基础验证：确保是对象
        if (typeof parsedTheme !== 'object' || parsedTheme === null || Array.isArray(parsedTheme)) {
            throw new Error(t('styleCustomizer.errorInvalidJsonObject'));
        }
        // 更新本地的 editableUiTheme ref，这将触发颜色选择器的更新
        editableUiTheme.value = parsedTheme;
        // 注意：此时尚未保存到后端，用户需要点击“保存 UI 主题”按钮
    } catch (error: any) {
        console.error('解析 UI 主题配置失败:', error);
        // 尝试提供更具体的错误信息
        let errorMessage = error.message || t('styleCustomizer.errorInvalidJsonConfig');
        if (error instanceof SyntaxError) {
            errorMessage = `${t('styleCustomizer.errorJsonSyntax')}: ${error.message}`; // 需要添加翻译
        }
        themeParseError.value = errorMessage;
    }
};


// 保存终端字体
const handleSaveTerminalFont = async () => {
    try {
        await appearanceStore.setTerminalFontFamily(editableTerminalFontFamily.value);
        alert(t('styleCustomizer.terminalFontSaved'));
    } catch (error: any) {
        console.error("保存终端字体失败:", error);
        alert(t('styleCustomizer.terminalFontSaveFailed', { message: error.message }));
    }
};

// 保存终端字体大小
const handleSaveTerminalFontSize = async () => {
    try {
        const size = Number(editableTerminalFontSize.value);
        if (isNaN(size) || size <= 0) {
            alert(t('styleCustomizer.errorInvalidFontSize')); // 需要添加翻译
            return;
        }
        await appearanceStore.setTerminalFontSize(size);
        alert(t('styleCustomizer.terminalFontSizeSaved')); // 需要添加翻译
    } catch (error: any) {
        console.error("保存终端字体大小失败:", error);
        alert(t('styleCustomizer.terminalFontSizeSaveFailed', { message: error.message })); // 需要添加翻译
    }
};

// 保存编辑器字体大小
const handleSaveEditorFontSize = async () => {
    try {
        const size = Number(editableEditorFontSize.value);
        if (isNaN(size) || size <= 0) {
            alert(t('styleCustomizer.errorInvalidEditorFontSize')); // 需要添加翻译
            return;
        }
        await appearanceStore.setEditorFontSize(size);
        alert(t('styleCustomizer.editorFontSizeSaved')); // 需要添加翻译
    } catch (error: any) {
        console.error("保存编辑器字体大小失败:", error);
        alert(t('styleCustomizer.editorFontSizeSaveFailed', { message: error.message })); // 需要添加翻译
    }
};

// 应用选定的终端主题
const handleApplyTheme = async (theme: TerminalTheme) => {
    // theme._id 是字符串 ID
    if (!theme._id) return; // 防御性检查

    // 将字符串 ID 转换为数字进行比较
    const themeIdNum = parseInt(theme._id, 10);
    if (isNaN(themeIdNum)) {
        console.error(`无效的主题 ID 格式: ${theme._id}`);
        return;
    }

    // activeTerminalThemeId.value 是 number | null
    if (themeIdNum === activeTerminalThemeId.value) return; // 如果已经是激活的，则不操作

    try {
        // setActiveTerminalTheme action 现在需要字符串 ID
        await appearanceStore.setActiveTerminalTheme(theme._id);
        // 成功后 activeTerminalThemeId 会自动更新
    } catch (error: any) {
        console.error("应用终端主题失败:", error);
        alert(t('styleCustomizer.setActiveThemeFailed', { message: error.message }));
    }
};

// --- 终端主题管理 ---
// 开始新建主题
const handleAddNewTheme = () => {
    saveThemeError.value = null; // 清除旧错误
    terminalThemeParseError.value = null; // 清除旧错误
    // 创建一个全新的默认主题结构用于编辑
    editingTheme.value = {
        _id: undefined, // 清除 ID 表示是新建
        name: t('styleCustomizer.newThemeDefaultName'),
        themeData: JSON.parse(JSON.stringify(defaultXtermTheme)), // 使用默认 xterm 主题作为基础
        isPreset: false, // 明确不是预设
    };
    // 初始化 textarea (key: value 格式)
    try {
        const themeObject = editingTheme.value.themeData;
        if (themeObject && typeof themeObject === 'object' && Object.keys(themeObject).length > 0) {
            const lines = Object.entries(themeObject).map(([key, value]) => `${key}: ${value}`);
            editableTerminalThemeString.value = lines.join('\n');
        } else {
            editableTerminalThemeString.value = '';
        }
    } catch (e) {
        console.error("格式化新终端主题字符串失败:", e);
        editableTerminalThemeString.value = ''; // Fallback
    }
    isEditingTheme.value = true;
};


// 开始编辑主题 (用户主题或基于预设创建副本) - 改为异步加载数据
const handleEditTheme = async (theme: TerminalTheme) => {
    saveThemeError.value = null; // 清除旧错误
    terminalThemeParseError.value = null; // 清除旧错误

    // 检查 theme._id 是否存在
    if (!theme._id) {
        console.error("尝试编辑没有 ID 的主题:", theme);
        alert(t('styleCustomizer.errorEditThemeNoId')); // 需要添加翻译: "无法编辑没有 ID 的主题"
        return;
    }

    let themeDataToEdit: ITheme | null = null;
    let themeNameToEdit = theme.name;
    let themeIdToEdit: string | undefined = theme._id; // 保留原始 ID 用于更新，如果是预设副本则为 undefined

    try {
        // 1. 加载主题数据
        themeDataToEdit = await appearanceStore.loadTerminalThemeData(theme._id);
        if (!themeDataToEdit) {
            throw new Error(t('styleCustomizer.errorLoadThemeDataFailed')); // 需要添加翻译: "加载主题数据失败"
        }

        // 2. 如果是预设主题，准备创建副本
        if (theme.isPreset) {
            themeNameToEdit = `${theme.name} (Copy)`;
            themeIdToEdit = undefined; // 清除 ID，表示是新建
            console.log('基于预设主题加载数据并创建副本进行编辑:', themeNameToEdit);
        } else {
            console.log('加载用户主题数据进行编辑:', themeNameToEdit);
        }

        // 3. 设置编辑状态
        editingTheme.value = {
            _id: themeIdToEdit, // 可能是 undefined (新建副本) 或原始 ID (编辑现有)
            name: themeNameToEdit,
            themeData: JSON.parse(JSON.stringify(themeDataToEdit)), // 深拷贝加载的数据
            isPreset: false, // 编辑状态下总是不是预设
        };

        // 4. 初始化 textarea (key: value 格式)
        try {
            const themeObject = editingTheme.value.themeData;
            if (themeObject && typeof themeObject === 'object' && Object.keys(themeObject).length > 0) {
                const lines = Object.entries(themeObject).map(([key, value]) => `${key}: ${value}`);
                editableTerminalThemeString.value = lines.join('\n');
            } else {
                editableTerminalThemeString.value = '';
            }
        } catch (e) {
            console.error("格式化编辑终端主题字符串失败:", e);
            editableTerminalThemeString.value = ''; // Fallback
        }

        isEditingTheme.value = true; // 进入编辑模式

    } catch (error: any) {
        console.error("编辑主题失败 (加载数据时):", error);
        saveThemeError.value = error.message || t('styleCustomizer.errorEditThemeFailed'); // 需要添加翻译: "编辑主题失败"
        // 不进入编辑模式
        isEditingTheme.value = false;
        editingTheme.value = null;
    }
};

// 保存主题编辑 (新建或更新)
const handleSaveEditingTheme = async () => {
    if (!editingTheme.value || !editingTheme.value.name) {
        saveThemeError.value = t('styleCustomizer.errorThemeNameRequired');
        return;
    }
    // 在保存前，确保 themeData 是最新的（以防 textarea 未失去焦点）
    handleTerminalThemeStringChange(); // 先尝试解析 textarea
    if (terminalThemeParseError.value) {
        saveThemeError.value = t('styleCustomizer.errorFixJsonBeforeSave'); // 需要添加翻译: "请先修复 JSON 格式错误再保存"
        return;
    }

    saveThemeError.value = null; // 清除错误
    try {
        // 确保 themeData 是最新的（以防万一解析没触发 watch 更新）
        if (!editingTheme.value) return; // 防御
        // 直接使用已经由 handleTerminalThemeStringChange 解析好的 themeData 对象
        const currentThemeData = editingTheme.value.themeData;

        if (editingTheme.value._id) { // 更新
            // 确保传递的是 UpdateTerminalThemeDto 兼容的格式
            const updateDto = { name: editingTheme.value.name, themeData: currentThemeData }; // 使用解析后的数据
            await appearanceStore.updateTerminalTheme(
                editingTheme.value._id,
                updateDto.name,
                updateDto.themeData
            );
             alert(t('styleCustomizer.themeUpdatedSuccess'));
        } else { // 新建
             // 确保传递的是 CreateTerminalThemeDto 兼容的格式
            const createDto = { name: editingTheme.value.name, themeData: currentThemeData }; // 使用解析后的数据
            await appearanceStore.createTerminalTheme(
                createDto.name,
                createDto.themeData
            );
             alert(t('styleCustomizer.themeCreatedSuccess'));
        }
        isEditingTheme.value = false; // 关闭编辑
        editingTheme.value = null;
        editableTerminalThemeString.value = ''; // 清理
        terminalThemeParseError.value = null; // 清理
    } catch (error: any) {
        console.error("保存终端主题失败:", error);
        saveThemeError.value = error.message || t('styleCustomizer.themeSaveFailed');
    }
};

// 取消编辑
const handleCancelEditingTheme = () => {
    isEditingTheme.value = false;
    editingTheme.value = null;
    saveThemeError.value = null;
    terminalThemeParseError.value = null; // 清理
    editableTerminalThemeString.value = ''; // 清理
};

// --- 处理终端主题 Textarea (解析 key: value 格式) ---
const handleTerminalThemeStringChange = () => {
    terminalThemeParseError.value = null; // 清除之前的错误
    if (!editingTheme.value) return; // 防御性检查

    let inputText = editableTerminalThemeString.value.trim();

    // 如果内容为空，则视为空对象
    if (!inputText) {
        editingTheme.value.themeData = {};
        return;
    }

    // 准备构建 JSON 字符串 (参考 handleUiThemeStringChange)
    let jsonStringToParse = inputText
        .split('\n') // 按行分割
        .map(line => line.trim()) // 去除每行首尾空格
        .filter(line => line && line.includes(':')) // 过滤空行和不包含冒号的行
        .map(line => {
            const parts = line.split(/:(.*)/s); // 按第一个冒号分割
            if (parts.length < 2) return null;

            let key = parts[0].trim();
            let value = parts[1].trim();

            // 为 key 添加引号
            if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
            if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
            key = JSON.stringify(key);

            // 为 value 添加引号（如果需要）
            if (value.endsWith(',')) value = value.slice(0, -1).trim();
            let originalValue = value;
            if (value.startsWith('"') && value.endsWith('"')) originalValue = value.slice(1, -1);
            else if (value.startsWith("'") && value.endsWith("'")) originalValue = value.slice(1, -1);

            if (isNaN(Number(originalValue)) && originalValue !== 'true' && originalValue !== 'false' && originalValue !== 'null') {
                 value = JSON.stringify(originalValue);
            } else {
                value = originalValue; // 数字、布尔值、null 不需要引号
            }

            return `  ${key}: ${value}`;
        })
        .filter(line => line !== null)
        .join(',\n');

    const fullJsonString = `{\n${jsonStringToParse}\n}`;

    try {
        const parsedThemeData = JSON.parse(fullJsonString);
        // 基础验证：确保是对象且不是数组
        if (typeof parsedThemeData !== 'object' || parsedThemeData === null || Array.isArray(parsedThemeData)) {
            throw new Error(t('styleCustomizer.errorInvalidJsonObject'));
        }
        // 更新 editingTheme.value.themeData
        editingTheme.value.themeData = parsedThemeData;
    } catch (error: any) {
        console.error('解析终端主题配置失败:', error);
        let errorMessage = error.message || t('styleCustomizer.errorInvalidJsonConfig');
        if (error instanceof SyntaxError) {
            errorMessage = `${t('styleCustomizer.errorJsonSyntax')}: ${error.message}`;
        }
        terminalThemeParseError.value = errorMessage;
    }
};

// 删除主题
const handleDeleteTheme = async (theme: TerminalTheme) => {
    if (theme.isPreset) return;
    try {
        await appearanceStore.deleteTerminalTheme(theme._id!);
         alert(t('styleCustomizer.themeDeletedSuccess'));
    } catch (error: any) {
        console.error("删除终端主题失败:", error);
         alert(t('styleCustomizer.themeDeleteFailed', { message: error.message }));
    }
};

// 触发主题导入文件选择
const handleTriggerImport = () => {
    importError.value = null;
    themeImportInput.value?.click();
};

// 处理主题导入
const handleImportThemeFile = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
            // 可以选择在前端解析文件名作为默认名称传递给后端
            const defaultName = file.name.endsWith('.json') ? file.name.slice(0, -5) : file.name;
            await appearanceStore.importTerminalTheme(file, defaultName); // 传递文件名作为备选名称
            alert(t('styleCustomizer.importSuccess'));
            input.value = ''; // 清空文件输入，以便再次选择相同文件
        } catch (error: any) {
            console.error("导入主题失败:", error);
            importError.value = error.message || t('styleCustomizer.importFailed');
             input.value = '';
        }
    }
};

// 处理主题导出 (导出当前激活的主题)
const handleExportActiveTheme = async () => {
    const currentIdNum = activeTerminalThemeId.value; // 现在是 number | null | undefined
    // 必须同时检查 null 和 undefined
    if (currentIdNum !== null && currentIdNum !== undefined) {
        try {
            // exportTerminalTheme action 需要字符串 ID
            await appearanceStore.exportTerminalTheme(currentIdNum.toString());
        } catch (error: any) {
            console.error("导出主题失败:", error);
             alert(t('styleCustomizer.exportFailed', { message: error.message }));
        }
    } else {
        console.warn("尝试导出主题，但 activeTerminalThemeId 为 null 或 undefined");
        alert(t('styleCustomizer.noActiveThemeToExport'));
    }
};


// --- 背景处理 ---
const handleTriggerPageBgUpload = () => {
    uploadError.value = null;
    pageBgFileInput.value?.click();
};
const handleTriggerTerminalBgUpload = () => {
    uploadError.value = null;
    terminalBgFileInput.value?.click();
};

const handlePageBgUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
            await appearanceStore.uploadPageBackground(file);
            alert(t('styleCustomizer.pageBgUploadSuccess'));
            input.value = ''; // 清空以便再次选择
        } catch (error: any) {
            uploadError.value = error.message || t('styleCustomizer.uploadFailed');
            input.value = '';
        }
    }
};

const handleTerminalBgUpload = async (event: Event) => {
     const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
            await appearanceStore.uploadTerminalBackground(file);
             alert(t('styleCustomizer.terminalBgUploadSuccess'));
            input.value = '';
        } catch (error: any) {
            uploadError.value = error.message || t('styleCustomizer.uploadFailed');
            input.value = '';
        }
    }
};

const handleRemovePageBg = async () => {
    try {
        await appearanceStore.removePageBackground();
         alert(t('styleCustomizer.pageBgRemoved'));
    } catch (error: any) {
         console.error("移除页面背景失败:", error);
         alert(t('styleCustomizer.removeBgFailed', { message: error.message }));
    }
};

const handleRemoveTerminalBg = async () => {
    try {
        await appearanceStore.removeTerminalBackground();
         alert(t('styleCustomizer.terminalBgRemoved'));
    } catch (error: any) {
         console.error("移除终端背景失败:", error);
         alert(t('styleCustomizer.removeBgFailed', { message: error.message }));
    }
};
 
// 处理终端背景启用/禁用切换
const handleToggleTerminalBackground = async () => {
    const newValue = !localTerminalBackgroundEnabled.value; // 先计算新值
    localTerminalBackgroundEnabled.value = newValue; // 立即更新本地 UI
    try {
        await appearanceStore.setTerminalBackgroundEnabled(newValue);
        // 成功后不需要提示，UI 已更新
    } catch (error: any) {
        console.error("更新终端背景启用状态失败:", error);
        // 失败时回滚本地状态
        localTerminalBackgroundEnabled.value = !newValue;
        alert(t('styleCustomizer.errorToggleTerminalBg', { message: error.message })); // 需要添加翻译
    }
};
 
// Removed handlePageOpacityChange and handleTerminalOpacityChange functions
 
// --- 辅助函数 ---
// 格式化 UI 主题标签
const formatLabel = (key: string): string => {
  // 简单的转换逻辑，可以根据需要优化
  return key
    .replace(/^--/, '') // 移除前缀 '--'
    .replace(/-/g, ' ') // 替换 '-' 为空格
    .replace(/([A-Z])/g, ' $1') // 在大写字母前加空格
    .replace(/^./, (str) => str.toUpperCase()); // 首字母大写
};

// 格式化 xterm 主题属性标签
const formatXtermLabel = (key: keyof ITheme): string => {
  // 简单的转换逻辑
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
};

// --- 计算属性 ---

// 获取当前激活主题的名称
const activeThemeName = computed(() => {
  const currentIdNum = activeTerminalThemeId.value; // number | null | undefined
  // 同时检查 null 和 undefined
  if (currentIdNum === null || currentIdNum === undefined) {
      return '未选择主题'; // 或者返回默认主题名称？
  }
  // 在 allTerminalThemes 中查找
  // 将数字 ID 转为字符串进行比较
  const theme = allTerminalThemes.value.find((t: TerminalTheme) => t._id === currentIdNum.toString());
  return theme ? theme.name : '未知主题';
});

// 过滤和排序主题列表 (使用 allTerminalThemes)
const filteredAndSortedThemes = computed(() => {
  const searchTerm = themeSearchTerm.value.toLowerCase().trim();
  // 使用 allTerminalThemes
  let themes = [...allTerminalThemes.value];

  // 过滤
  if (searchTerm) {
    // 显式指定 theme 类型
    themes = themes.filter((theme: TerminalTheme) => theme.name.toLowerCase().includes(searchTerm));
  }

  // 按名称升序排序
  themes.sort((a: TerminalTheme, b: TerminalTheme) => a.name.localeCompare(b.name));

  return themes;
});

// 排序切换函数已移除
// --- 监听 themeData 变化以更新 textarea (格式化为 key: value) ---
watch(() => editingTheme.value?.themeData, (newThemeData) => {
    // 只有在 textarea 没有聚焦时才更新，避免覆盖用户输入
    // 或者，如果解析错误存在，也允许更新以显示正确格式
    if (newThemeData && (document.activeElement?.id !== 'terminalThemeTextarea' || terminalThemeParseError.value)) {
        try {
            // 格式化为 key: value 字符串
            let newStringValue = '';
            if (typeof newThemeData === 'object' && Object.keys(newThemeData).length > 0) {
                const lines = Object.entries(newThemeData).map(([key, value]) => `${key}: ${value}`);
                newStringValue = lines.join('\n');
            }

            // 只有当字符串实际不同时才更新
            if (newStringValue !== editableTerminalThemeString.value) {
                 editableTerminalThemeString.value = newStringValue;
            }
            // 如果外部更改（如颜色选择器）修复了错误，清除错误提示
            if (terminalThemeParseError.value && document.activeElement?.id !== 'terminalThemeTextarea') {
                 terminalThemeParseError.value = null;
            }
        } catch (e) {
            console.error("格式化终端主题字符串失败:", e);
        }
    }
}, { deep: true }); // 需要 deep watch 来监听 themeData 内部的变化

// Helper function to safely select text in an input on focus
const handleFocusAndSelect = (event: FocusEvent) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    target.select();
  }
};

</script>


<template>
  <!-- 添加 md: 前缀以应用到中等及以上屏幕，小屏幕默认全屏 -->
  <div class="fixed inset-0 bg-black/60 flex justify-center items-center z-[1000] p-2 md:p-4" @click.self="closeCustomizer">
    <!-- 小屏幕默认 w-full h-full，md 及以上恢复原状 -->
    <div class="bg-background text-foreground rounded-lg shadow-lg w-full h-full md:w-[90%] md:max-w-[800px] md:h-[85vh] md:max-h-[700px] flex flex-col overflow-hidden">
      <header class="flex justify-between items-center px-4 py-3 border-b border-border bg-header flex-shrink-0">
        <h2 class="m-0 text-lg md:text-xl text-foreground">{{ t('styleCustomizer.title') }}</h2>
        <button @click="closeCustomizer" class="bg-transparent border-none text-2xl md:text-3xl leading-none cursor-pointer text-text-secondary px-2 py-1 rounded hover:text-foreground hover:bg-black/10">&times;</button>
      </header>
      <div class="flex flex-grow overflow-hidden flex-col md:flex-row"> 
        
        <nav class="w-full md:w-[180px] border-b md:border-b-0 md:border-r border-border p-2 md:p-4 bg-header flex-shrink-0 overflow-y-auto flex flex-row md:flex-col flex-wrap md:flex-nowrap justify-center md:justify-start"> 
          <button
            @click="currentTab = 'ui'"
            :class="[
              'block w-auto md:w-full px-3 py-2 md:py-[0.7rem] mb-0 md:mb-2 mx-1 md:mx-0 text-center md:text-left bg-transparent border border-transparent rounded cursor-pointer text-foreground text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-secondary',
              { '!bg-button !text-button-text !font-bold': currentTab === 'ui' } /* Added !important */
            ]"
          >
            {{ t('styleCustomizer.uiStyles') }}
          </button>
          <button
            @click="currentTab = 'terminal'"
            :class="[
              'block w-auto md:w-full px-3 py-2 md:py-[0.7rem] mb-0 md:mb-2 mx-1 md:mx-0 text-center md:text-left bg-transparent border border-transparent rounded cursor-pointer text-foreground text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-secondary',
              { '!bg-button !text-button-text !font-bold': currentTab === 'terminal' && !isEditingTheme } /* Added !important */
            ]"
            :disabled="isEditingTheme"
          >
            {{ t('styleCustomizer.terminalStyles') }}
          </button>
           <button
            @click="currentTab = 'background'"
            :class="[
              'block w-auto md:w-full px-3 py-2 md:py-[0.7rem] mb-0 md:mb-2 mx-1 md:mx-0 text-center md:text-left bg-transparent border border-transparent rounded cursor-pointer text-foreground text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-secondary',
              { '!bg-button !text-button-text !font-bold': currentTab === 'background' } /* Added !important */
            ]"
            :disabled="isEditingTheme"
          >
            {{ t('styleCustomizer.backgroundSettings') }}
          </button>
          <button
            @click="currentTab = 'other'"
            :class="[
              'block w-auto md:w-full px-3 py-2 md:py-[0.7rem] mb-0 md:mb-2 mx-1 md:mx-0 text-center md:text-left bg-transparent border border-transparent rounded cursor-pointer text-foreground text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-secondary',
              { '!bg-button !text-button-text !font-bold': currentTab === 'other' } /* Added !important */
            ]"
            :disabled="isEditingTheme"
          >
            {{ t('styleCustomizer.otherSettings') }} <!-- 需要添加翻译 -->
          </button>
        </nav>
        
        <main class="flex-grow p-3 md:p-4 md:px-6 overflow-y-auto min-h-0">
          <section v-if="currentTab === 'ui'">
            <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.uiStyles') }}</h3>
            <!-- 主题模式选择 - 小屏幕堆叠 -->
            <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-2 md:gap-3 mb-6">
                <label class="text-left text-foreground text-sm font-medium mb-1 md:mb-0">{{ t('styleCustomizer.themeModeLabel', '主题模式:') }}</label> <!-- TODO: 添加翻译 -->
                <div class="flex gap-2 justify-start flex-wrap"> 
                    <button @click="handleResetUiTheme" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap">{{ t('styleCustomizer.defaultMode', '默认模式') }}</button> <!-- TODO: 添加翻译 -->
                    <button @click="applyDarkMode" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap">{{ t('styleCustomizer.darkMode', '黑暗模式') }}</button> <!-- TODO: 添加翻译 -->
                </div>
            </div>
            <p class="text-text-secondary text-sm leading-relaxed mb-3">{{ t('styleCustomizer.uiDescription') }}</p>
            <!-- 动态生成 UI 样式编辑控件 - 小屏幕堆叠 -->
            <div v-for="(value, key) in editableUiTheme" :key="key" class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-x-3 gap-y-1 mb-3">
              <label :for="`ui-${key}`" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ formatLabel(key) }}:</label>
              <!-- Container for color picker and text display -->
              <div class="flex items-center gap-2 w-full">
                <!-- Color Picker -->
                <input
                  v-if="typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl'))"
                  type="color"
                  :id="`ui-${key}`"
                  v-model="editableUiTheme[key]"
                  class="p-0.5 h-[34px] min-w-[40px] max-w-[50px] rounded border border-border flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
                <!-- Readonly text input to display and copy color value -->
                <input
                  v-if="typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl'))"
                  type="text"
                  :value="editableUiTheme[key]"
                  class="flex-grow min-w-[80px] bg-background cursor-text border border-border px-[0.7rem] py-2 rounded text-sm text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  @focus="handleFocusAndSelect"
                  @input="editableUiTheme[key] = ($event.target as HTMLInputElement).value"
                />
                <!-- Fallback for non-color values -->
                <input
                  v-else
                  type="text"
                  :id="`ui-${key}`"
                  v-model="editableUiTheme[key]"
                  class="col-span-full border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <!-- UI Theme Textarea -->
            <hr style="margin-top: calc(var(--base-padding) * 2); margin-bottom: calc(var(--base-padding) * 2);">
            <h4 class="mt-6 mb-2 text-base font-semibold text-foreground">{{ t('styleCustomizer.uiThemeJsonEditorTitle') }}</h4> <!-- TODO: Add translation -->
            <p class="text-text-secondary text-sm leading-relaxed mb-3">{{ t('styleCustomizer.uiThemeJsonEditorDesc') }}</p> <!-- TODO: Add translation -->
            <div class="mt-4"> <!-- Removed form-group, added margin -->
               <label for="uiThemeTextarea" class="sr-only">{{ t('styleCustomizer.uiThemeJsonEditorTitle') }}</label> <!-- Screen reader only label -->
               <textarea
                 id="uiThemeTextarea"
                 v-model="editableUiThemeString"
                 @blur="handleUiThemeStringChange"
                 rows="15"
                 :placeholder="'--app-bg-color: #ffffff\n--text-color: #333333\n...'"
                 spellcheck="false"
                 class="w-full font-mono text-sm leading-snug border border-border rounded p-3 bg-background text-foreground resize-y min-h-[200px] box-border whitespace-pre-wrap break-words transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
               ></textarea>
            </div>
             <p v-if="themeParseError" class="text-error-text bg-error/10 border border-error/30 px-3 py-2 rounded text-sm mt-2">{{ themeParseError }}</p> <!-- Adjusted error styles -->
         </section>
          <section v-if="currentTab === 'terminal' && !isEditingTheme">
            <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.terminalStyles') }}</h3>
            
            <div class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-start md:items-center gap-2 md:gap-3 mb-3">
                <label for="terminalFontFamily" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ t('styleCustomizer.terminalFontFamily') }}:</label>
                <input type="text" id="terminalFontFamily" v-model="editableTerminalFontFamily" class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" :placeholder="t('styleCustomizer.terminalFontPlaceholder')"/>
                <button @click="handleSaveTerminalFont" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap justify-self-start mt-1 md:mt-0">{{ t('common.save') }}</button>
            </div>
            <p class="text-xs text-text-secondary -mt-1 mb-2">{{ t('styleCustomizer.terminalFontDescription') }}</p>

            
            <div class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-start md:items-center gap-2 md:gap-3 mb-3">
                <label for="terminalFontSize" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ t('styleCustomizer.terminalFontSize') }}:</label>
                <input type="number" id="terminalFontSize" v-model.number="editableTerminalFontSize" class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground max-w-[100px] justify-self-start box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" min="1" />
                <button @click="handleSaveTerminalFontSize" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap justify-self-start mt-1 md:mt-0">{{ t('common.save') }}</button>
            </div>

            <hr class="my-4 md:my-6"> 

            
            <h4 class="mt-6 mb-2 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalThemeSelection') }}</h4>
             
             <div class="mb-4 py-2 text-sm md:text-[0.95rem] flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-3"> 
                 <span class="text-text-secondary">{{ t('styleCustomizer.activeTheme') }}:</span>
                 <strong class="text-foreground font-semibold">{{ activeThemeName }}</strong>
             </div>

             
             <div class="mt-4 mb-6 flex gap-2 flex-wrap items-center pb-4 border-b border-dashed border-border">
                 <button @click="handleAddNewTheme" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.addNewTheme') }}</button>
                 <button @click="handleTriggerImport" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.importTheme') }}</button>
                 <input type="file" ref="themeImportInput" @change="handleImportThemeFile" accept=".json" class="hidden" />
                 <p v-if="importError" class="text-error-text bg-error/10 border border-error/30 px-3 py-2 rounded text-sm w-full flex-grow m-0 text-left">{{ importError }}</p>
             </div>


             
             <div class="mb-4">
                  <input
                      type="text"
                      v-model="themeSearchTerm"
                      :placeholder="t('styleCustomizer.searchThemePlaceholder', '搜索主题名称...')"
                      class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
             </div>

             
             <ul class="list-none p-0 mt-4 max-h-[200px] md:max-h-[280px] overflow-y-auto border border-border rounded bg-background"> 
                 <li v-if="filteredAndSortedThemes.length === 0" class="text-center text-text-secondary p-4 italic">
                     {{ t('styleCustomizer.noThemesFound', 'No matching themes found') }}
                 </li>
                 <li v-else v-for="(theme, index) in filteredAndSortedThemes" :key="theme._id"
                    :class="[
                      'block md:grid md:grid-cols-[1fr_auto] items-center px-3 py-2.5 text-sm md:text-[0.95rem] transition-colors duration-200 ease-in-out gap-2', /* 小屏幕块状显示 */
                      index < filteredAndSortedThemes.length - 1 ? 'border-b border-border' : '',
                      { 'bg-button text-button-text': theme._id === activeTerminalThemeId?.toString() },
                      { 'hover:bg-header': theme._id !== activeTerminalThemeId?.toString() }
                    ]"
                 >
                     <span class="block md:col-start-1 md:col-end-2 overflow-hidden text-ellipsis whitespace-nowrap mb-2 md:mb-0" :class="theme._id === activeTerminalThemeId?.toString() ? 'font-bold text-button-text' : 'text-foreground'" :title="theme.name">{{ theme.name }}</span>
                     <div class="flex md:col-start-2 md:col-end-3 flex-shrink-0 gap-2 justify-start md:justify-end flex-wrap"> 
                          <button
                              @click="handleApplyTheme(theme)"
                              :disabled="theme._id === activeTerminalThemeId?.toString()"
                              :title="t('styleCustomizer.applyThemeTooltip', 'Apply this theme')"
                              :class="[
                                'px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed', /* 调整字体大小 */
                                theme._id === activeTerminalThemeId?.toString() ? 'text-button-text border-white/30 bg-white/10 hover:bg-white/20 hover:border-white/50 disabled:opacity-50 disabled:cursor-default disabled:bg-transparent disabled:border-transparent' : 'border-border bg-header text-foreground hover:bg-border hover:border-text-secondary'
                              ]"
                          >
                              {{ t('styleCustomizer.applyButton', 'Apply') }}
                          </button>
                         <button @click="handleEditTheme(theme)" :title="theme.isPreset ? t('styleCustomizer.editAsCopy', 'Edit as Copy') : t('common.edit')"
                            :class="[
                              'px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed', /* 调整字体大小 */
                              theme._id === activeTerminalThemeId?.toString() ? 'text-button-text border-white/30 bg-white/10 hover:bg-white/20 hover:border-white/50' : 'border-border bg-header text-foreground hover:bg-border hover:border-text-secondary'
                            ]"
                         >{{ t('common.edit') }}</button>
                         <button @click="handleDeleteTheme(theme)" :disabled="theme.isPreset" :title="theme.isPreset ? t('styleCustomizer.cannotDeletePreset', 'Cannot delete preset theme') : t('common.delete')"
                            :class="[
                              'px-3 py-1.5 text-xs md:text-sm border rounded transition-colors duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed', /* 调整字体大小 */
                              theme._id === activeTerminalThemeId?.toString() ? 'text-button-text border-white/30 bg-white/10 hover:bg-white/20 hover:border-white/50' : 'bg-error/10 text-error border-error/30 hover:bg-error/20'
                            ]"
                         >{{ t('common.delete') }}</button>
                     </div>
                 </li>
             </ul>

           </section>

            
            <section v-if="isEditingTheme && editingTheme">
                <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ editingTheme._id ? t('styleCustomizer.editThemeTitle') : t('styleCustomizer.newThemeTitle') }}</h3>
                 <p v-if="saveThemeError" class="text-error-text bg-error/10 border border-error/30 px-3 py-2 rounded text-sm mb-3">{{ saveThemeError }}</p>
                <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-2 mb-2">
                    <label for="editingThemeName" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ t('styleCustomizer.themeName') }}:</label>
                    <input type="text" id="editingThemeName" v-model="editingTheme.name" required class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"/>
                </div>

                 <hr class="my-4 md:my-8 border-border">
                 <h4 class="mt-6 mb-2 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalThemeColorEditorTitle') }}</h4>

                 
              <div v-for="(value, key) in editingTheme.themeData" :key="key" class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-2 mb-2">
                <label :for="`xterm-${key}`" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ formatXtermLabel(key as keyof ITheme) }}:</label>
                <div class="flex items-center gap-2 w-full">
                  
                  <input
                    v-if="typeof value === 'string' && value.startsWith('#')"
                    type="color"
                    :id="`xterm-${key}`"
                    v-model="(editingTheme.themeData as any)[key]"
                    class="p-0.5 h-[34px] min-w-[40px] max-w-[50px] rounded border border-border flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                  
                  <input
                    v-if="typeof value === 'string' && value.startsWith('#')"
                    type="text"
                    :value="(editingTheme.themeData as any)[key]"
                    readonly
                    class="flex-grow min-w-[80px] bg-header cursor-text border border-border px-[0.7rem] py-2 rounded text-sm text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    @focus="handleFocusAndSelect"
                  />
                  
                  <input
                    v-else
                    type="text"
                    :id="`xterm-${key}`"
                    v-model="(editingTheme.themeData as any)[key]"
                    class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
             </div>

                
                <hr class="my-4 md:my-8 border-border">
                <h4 class="mt-6 mb-2 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalThemeJsonEditorTitle') }}</h4>
                <p class="text-text-secondary text-sm leading-relaxed mb-3">{{ t('styleCustomizer.terminalThemeJsonEditorDesc') }}</p>
                <div class="mt-4">
                   <label for="terminalThemeTextarea" class="sr-only">{{ t('styleCustomizer.terminalThemeJsonEditorTitle') }}</label>
                   <textarea
                     id="terminalThemeTextarea"
                     v-model="editableTerminalThemeString"
                     @blur="handleTerminalThemeStringChange"
                     rows="10"
                     :placeholder="terminalThemePlaceholder"
                     spellcheck="false"
                     class="w-full font-mono text-sm leading-snug border border-border rounded p-3 bg-background text-foreground resize-y min-h-[150px] md:min-h-[200px] box-border whitespace-pre-wrap break-words transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                   ></textarea>
                </div>
                 <p v-if="terminalThemeParseError" class="text-error-text bg-error/10 border border-error/30 px-3 py-2 rounded text-sm mt-2">{{ terminalThemeParseError }}</p>
            <div class="mt-4 flex justify-end gap-2 pt-4 border-t border-border">
                 <button @click="handleCancelEditingTheme" class="px-4 md:px-5 py-2 rounded font-bold border border-border bg-header text-foreground hover:bg-border disabled:opacity-60 disabled:cursor-not-allowed text-sm md:text-base">{{ t('common.cancel') }}</button> 
                 <button @click="handleSaveEditingTheme" class="px-4 md:px-5 py-2 rounded font-bold border border-button bg-button text-button-text hover:bg-button-hover hover:border-button-hover disabled:opacity-60 disabled:cursor-not-allowed text-sm md:text-base">{{ t('common.save') }}</button> 
             </div>
           </section>

           <section v-if="currentTab === 'background'">
                <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.backgroundSettings') }}</h3>

                
                

                <hr class="my-4 md:my-8 border-border">

                
                <div class="flex items-center justify-between mb-3">
                  <h4 class="m-0 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalBackground') }}</h4>
                  
                  <button
                    type="button"
                    @click="handleToggleTerminalBackground"
                    :class="[
                      'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
                      localTerminalBackgroundEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    ]"
                    role="switch"
                    :aria-checked="localTerminalBackgroundEnabled"
                  >
                    <span
                      aria-hidden="true"
                      :class="[
                        'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
                        localTerminalBackgroundEnabled ? 'translate-x-5' : 'translate-x-0'
                      ]"
                    ></span>
                  </button>
                </div>

                 
                 <div v-if="localTerminalBackgroundEnabled">
                   <div class="w-full h-[100px] md:h-[150px] border border-dashed border-border mb-2 flex justify-center items-center text-text-secondary bg-cover bg-center bg-no-repeat rounded bg-header relative overflow-hidden" :style="{ backgroundImage: terminalBackgroundImage ? `url(${terminalBackgroundImage})` : 'none' }"> 
                       <span v-if="!terminalBackgroundImage" class="bg-white/80 px-3 py-1.5 rounded text-sm font-medium text-foreground shadow-sm">{{ t('styleCustomizer.noBackground') }}</span>
                   </div>
                 <div class="flex gap-2 mb-4 flex-wrap items-center">
                    <button @click="handleTriggerTerminalBgUpload" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.uploadTerminalBg') }}</button>
                    <button @click="handleRemoveTerminalBg" :disabled="!terminalBackgroundImage" class="px-3 py-1.5 text-sm border rounded transition duration-200 ease-in-out whitespace-nowrap bg-error/10 text-error border-error/30 hover:bg-error/20 disabled:opacity-60 disabled:cursor-not-allowed">{{ t('styleCustomizer.removeTerminalBg') }}</button>
                    <input type="file" ref="terminalBgFileInput" @change="handleTerminalBgUpload" accept="image/*" class="hidden" />
                 </div>
                </div>
                <div v-else class="p-4 text-center text-text-secondary italic border border-dashed border-border/50 rounded-md">
                   {{ t('styleCustomizer.terminalBgDisabled', '终端背景功能已禁用。') }}
                </div>

           </section>
           <section v-if="currentTab === 'other'">
             <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.otherSettings') }}</h3>
             
             <div class="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] items-start md:items-center gap-2 md:gap-3 mb-3">
                 <label for="editorFontSize" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ t('styleCustomizer.editorFontSize') }}:</label>
                 <input type="number" id="editorFontSize" v-model.number="editableEditorFontSize" class="border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground max-w-[100px] justify-self-start box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" min="1" />
                 <button @click="handleSaveEditorFontSize" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap justify-self-start mt-1 md:mt-0">{{ t('common.save') }}</button>
             </div>
           </section>
        </main>
      </div>
      
      <footer class="flex justify-end p-3 md:p-4 border-t border-border bg-footer flex-shrink-0 flex-wrap gap-2"> 
        <button v-if="currentTab === 'ui'" @click="handleResetUiTheme" class="px-4 md:px-5 py-2 rounded font-bold ml-2 border border-border bg-header text-foreground hover:bg-border disabled:opacity-60 disabled:cursor-not-allowed text-sm md:text-base">{{ t('styleCustomizer.resetUiTheme') }}</button> 
        <button v-if="currentTab === 'ui'" @click="handleSaveUiTheme" class="px-4 md:px-5 py-2 rounded font-bold ml-2 border border-button bg-button text-button-text hover:bg-button-hover hover:border-button-hover disabled:opacity-60 disabled:cursor-not-allowed text-sm md:text-base">{{ t('styleCustomizer.saveUiTheme') }}</button> 
        <button @click="closeCustomizer" class="px-4 md:px-5 py-2 rounded font-bold ml-2 border border-border bg-header text-foreground hover:bg-border disabled:opacity-60 disabled:cursor-not-allowed text-sm md:text-base">{{ t('common.close') }}</button> 
      </footer>
    </div>
  </div>
</template>

