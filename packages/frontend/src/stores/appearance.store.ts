import { defineStore } from 'pinia';
import apiClient from '../utils/apiClient';
import { ref, computed, watch, nextTick } from 'vue'; 
import { useDeviceDetection } from '../composables/useDeviceDetection';
import type { ITheme } from 'xterm';
import type { TerminalTheme } from '../types/terminal-theme.types'; 
import type { AppearanceSettings, UpdateAppearanceDto } from '../types/appearance.types';
import { defaultXtermTheme, defaultUiTheme } from '../features/appearance/config/default-themes';

// Helper function to safely parse JSON
export const safeJsonParse = <T>(jsonString: string | undefined | null, defaultValue: T): T => { 
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("JSON 解析失败:", e);
        return defaultValue;
    }
};

export const useAppearanceStore = defineStore('appearance', () => {
    const { isMobile } = useDeviceDetection(); // + 获取设备检测结果

    // --- State ---
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const isStyleCustomizerVisible = ref(false); // 控制样式编辑器可见性

    // Appearance Settings State
    const appearanceSettings = ref<Partial<AppearanceSettings>>({}); // 从 API 获取的原始设置
    const allTerminalThemes = ref<TerminalTheme[]>([]); // 重命名: 存储从后端获取的所有主题

    // State for theme preview
    const isPreviewingTerminalTheme = ref(false);
    const previewTerminalThemeData = ref<ITheme | null>(null);

    // --- Computed Properties (Getters) ---

    // 移除 availableTerminalThemes 计算属性，直接使用 allTerminalThemes
    // 当前应用的 UI 主题 (CSS 变量对象)
    const currentUiTheme = computed<Record<string, string>>(() => {
        return safeJsonParse(appearanceSettings.value.customUiTheme, defaultUiTheme);
    });

    // 当前激活的终端主题 ID
    const activeTerminalThemeId = computed(() => appearanceSettings.value.activeTerminalThemeId);

    // 当前应用的终端主题对象 (ITheme)
    const currentTerminalTheme = computed<ITheme>(() => {
        const activeId = activeTerminalThemeId.value; // number | null | undefined
        if (activeId === null || activeId === undefined || allTerminalThemes.value.length === 0) {
             // 如果没有激活 ID 或列表为空，查找默认主题
             // TODO: 需要确认默认主题的识别方式 (preset_key='default' 或 name='默认')
             const defaultTheme = allTerminalThemes.value.find(t => t.name === '默认'); // 假设按名称查找
             return defaultTheme ? defaultTheme.themeData : defaultXtermTheme;
        }
        // 根据数字 ID 查找 (需要将 theme._id 转回数字比较)
        const activeTheme = allTerminalThemes.value.find(t => parseInt(t._id ?? '-1', 10) === activeId);
        return activeTheme ? activeTheme.themeData : defaultXtermTheme; // 找不到也回退到 xterm 默认
    });

    // Effective terminal theme, considering preview
    const effectiveTerminalTheme = computed<ITheme>(() => {
        if (isPreviewingTerminalTheme.value && previewTerminalThemeData.value) {
            return previewTerminalThemeData.value;
        }
        // Fallback to the currently set theme if not previewing
        const activeId = activeTerminalThemeId.value;
        if (activeId === null || activeId === undefined || allTerminalThemes.value.length === 0) {
            const defaultPresetTheme = allTerminalThemes.value.find(t => t.name === '默认'); // Adjust if default theme identified differently
            return defaultPresetTheme ? defaultPresetTheme.themeData : defaultXtermTheme;
        }
        const activeSetTheme = allTerminalThemes.value.find(t => parseInt(t._id ?? '-1', 10) === activeId);
        return activeSetTheme ? activeSetTheme.themeData : defaultXtermTheme;
    });

    // 当前终端字体设置
    const currentTerminalFontFamily = computed<string>(() => {
        return appearanceSettings.value.terminalFontFamily || 'Consolas, "Courier New", monospace, "Microsoft YaHei", "微软雅黑"'; // 提供默认值
    });

    // 当前终端字体大小
    const currentTerminalFontSize = computed<number>(() => {
        // 提供默认值 14，如果后端没有设置或设置无效
        let size;
        if (isMobile.value) {
            size = appearanceSettings.value.terminalFontSizeMobile;
        } else {
            size = appearanceSettings.value.terminalFontSize;
        }
        return typeof size === 'number' && size > 0 ? size : 14;
    });

    // 桌面端终端字体大小 (用于设置面板等处区分显示)
    const terminalFontSizeDesktop = computed<number>(() => {
        const size = appearanceSettings.value.terminalFontSize;
        return typeof size === 'number' && size > 0 ? size : 14;
    });

    // 移动端终端字体大小 (用于设置面板等处区分显示)
    const terminalFontSizeMobile = computed<number>(() => {
        const size = appearanceSettings.value.terminalFontSizeMobile;
        return typeof size === 'number' && size > 0 ? size : 14;
    });

    // 页面背景图片 URL
    const pageBackgroundImage = computed(() => appearanceSettings.value.pageBackgroundImage);

    // 终端背景图片 URL
    const terminalBackgroundImage = computed(() => appearanceSettings.value.terminalBackgroundImage);

    // 当前编辑器字体大小
    const currentEditorFontSize = computed<number>(() => {
        // 提供默认值 14，如果后端没有设置或设置无效
        const size = appearanceSettings.value.editorFontSize;
        return typeof size === 'number' && size > 0 ? size : 14;
    });

    // 当前编辑器字体家族
    const currentEditorFontFamily = computed<string>(() => {
        return appearanceSettings.value.editorFontFamily || 'Consolas, "Noto Sans SC", "Microsoft YaHei"'; // 提供默认值
    });
 
    // 终端背景是否启用
    const isTerminalBackgroundEnabled = computed<boolean>(() => {
        // 提供默认值 true，如果后端没有设置或设置无效
        const enabled = appearanceSettings.value.terminalBackgroundEnabled;
        return typeof enabled === 'boolean' ? enabled : true; // 默认启用
    });
 
    // 终端背景蒙版透明度
    const currentTerminalBackgroundOverlayOpacity = computed<number>(() => {
        const opacity = appearanceSettings.value.terminalBackgroundOverlayOpacity;
        return typeof opacity === 'number' && opacity >= 0 && opacity <= 1 ? opacity : 0.5; // 默认 0.5
    });

    // 获取终端自定义 CSS
    const terminalCustomHTML = computed(() => appearanceSettings.value.terminal_custom_html ?? null);

    // --- Actions ---

    /**
     * 加载所有外观相关设置 (外观设置 + 终端主题列表)
     */
    async function loadInitialAppearanceData() {
        isLoading.value = true;
        error.value = null;
        try {
            // 并行加载外观设置和主题列表
            const [settingsResponse, themesResponse] = await Promise.all([
                apiClient.get<AppearanceSettings>('/appearance'), // 使用 apiClient
                apiClient.get<TerminalTheme[]>('/terminal-themes') // 使用 apiClient
            ]);
            appearanceSettings.value = settingsResponse.data;
            allTerminalThemes.value = themesResponse.data; // 更新 allTerminalThemes

            // 应用加载的 UI 主题
            applyUiTheme(currentUiTheme.value);
            // 应用背景
            applyPageBackground();
            // 终端主题将由 Terminal 组件根据 activeTerminalThemeId 自动应用

        } catch (err: any) {
            console.error('加载外观数据失败:', err);
            error.value = err.response?.data?.message || err.message || '加载外观数据失败';
            // 出错时应用默认值
            appearanceSettings.value = {}; // 清空可能不完整的设置
            allTerminalThemes.value = []; // 清空 allTerminalThemes
            applyUiTheme(defaultUiTheme);
            applyPageBackground(); // 应用默认背景（可能为空）
        } finally {
            isLoading.value = false;
        }
    }

     /**
     * 切换样式编辑器面板的可见性。
     * @param visible 可选，强制设置可见性
     */
    function toggleStyleCustomizer(visible?: boolean) {
        isStyleCustomizerVisible.value = visible === undefined ? !isStyleCustomizerVisible.value : visible;
        console.log('[AppearanceStore] Style Customizer visibility toggled:', isStyleCustomizerVisible.value);
    }


    /**
     * 更新外观设置 (不包括主题列表管理)
     * @param updates 要更新的设置项 (activeTerminalThemeId 应为 number | null)
     */
    async function updateAppearanceSettings(updates: UpdateAppearanceDto) {
        try {
            // 移除预设主题闪烁修复逻辑，不再需要
            const response = await apiClient.put<AppearanceSettings>('/appearance', updates); // 使用 apiClient
            // 使用后端返回的最新设置更新本地状态
            appearanceSettings.value = response.data;
            console.log('[AppearanceStore] 外观设置已更新:', appearanceSettings.value);

            // 如果 UI 主题或背景更新，重新应用
            if (updates.customUiTheme !== undefined) applyUiTheme(currentUiTheme.value);
            if (updates.pageBackgroundImage !== undefined) applyPageBackground(); // 移除 pageBackgroundOpacity 检查
            // 终端相关设置由 Terminal 组件监听应用
            // 注意：terminalBackgroundEnabled 的应用逻辑在 Terminal 组件中处理
 
        } catch (err: any) {
            console.error('更新外观设置失败:', err);
            throw new Error(err.response?.data?.message || err.message || '更新外观设置失败');
        }
    }

    /**
     * 保存当前编辑器中的自定义 UI 主题到后端。
     * @param uiTheme UI 主题对象
     */
    async function saveCustomUiTheme(uiTheme: Record<string, string>) {
        await updateAppearanceSettings({ customUiTheme: JSON.stringify(uiTheme) });
    }

    /**
     * 重置为默认 UI 主题并保存。
     */
    async function resetCustomUiTheme() {
        await saveCustomUiTheme(defaultUiTheme);
    }

     /**
     * 设置激活的终端主题
     * @param themeId 主题的字符串 ID (来自 UI) 或 null (用于重置，但新逻辑下不直接使用 null)
     */
    async function setActiveTerminalTheme(themeId: string) { // 参数改为 string，不允许 null
        const previousActiveId = appearanceSettings.value.activeTerminalThemeId; // 记录之前的数字 ID 或 null

        // 1. 将传入的字符串 ID 转换为数字
        const idNum = parseInt(themeId, 10);
        if (isNaN(idNum)) {
            console.error(`[AppearanceStore] setActiveTerminalTheme 接收到无效的数字 ID 字符串: ${themeId}`);
            throw new Error(`无效的主题 ID: ${themeId}`);
        }

        // 2. 立即更新前端本地状态 (使用数字 ID)
        appearanceSettings.value.activeTerminalThemeId = idNum;
        console.log(`[AppearanceStore] Applied theme locally (ID): ${idNum}`);

        // 3. 更新后端 (发送数字 ID)
        try {
            await updateAppearanceSettings({ activeTerminalThemeId: idNum });
            console.log(`[AppearanceStore] Notified backend. Sent activeTerminalThemeId: ${idNum}`);
        } catch (error) {
            // 如果更新后端失败，回滚前端状态
            console.error('[AppearanceStore] Failed to update backend activeTerminalThemeId:', error);
            appearanceSettings.value.activeTerminalThemeId = previousActiveId; // 回滚到之前的数字 ID 或 null
            throw new Error(`应用主题失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 设置终端字体
     * @param fontFamily 字体列表字符串
     */
    async function setTerminalFontFamily(fontFamily: string) {
        await updateAppearanceSettings({ terminalFontFamily: fontFamily });
    }

    /**
     * 设置终端字体大小
     * @param size 字体大小 (数字)
     */
    async function setTerminalFontSize(size: number) { // 此函数专用于桌面端
        await updateAppearanceSettings({ terminalFontSize: size });
    }

    /**
     * 设置移动端终端字体大小
     * @param size 字体大小 (数字)
     */
    async function setTerminalFontSizeMobile(size: number) {
        await updateAppearanceSettings({ terminalFontSizeMobile: size });
    }

    /**
     * 设置编辑器字体大小
     * @param size 字体大小 (数字)
     */
    async function setEditorFontSize(size: number) {
        await updateAppearanceSettings({ editorFontSize: size });
    }

    /**
     * 设置编辑器字体家族
     * @param fontFamily 字体列表字符串
     */
    async function setEditorFontFamily(fontFamily: string) {
        await updateAppearanceSettings({ editorFontFamily: fontFamily });
    }
 
    /**
     * 设置终端背景是否启用
     * @param enabled 是否启用
     */
    async function setTerminalBackgroundEnabled(enabled: boolean) {
        console.log(`[AppearanceStore LOG] setTerminalBackgroundEnabled 调用，准备发送给后端的值: ${enabled}`);
        await updateAppearanceSettings({ terminalBackgroundEnabled: enabled });
        console.log(`[AppearanceStore LOG] setTerminalBackgroundEnabled 更新后端调用完成。`); 
    }
 
    /**
     * 设置终端背景蒙版透明度
     * @param opacity 透明度 (0-1)
     */
    async function setTerminalBackgroundOverlayOpacity(opacity: number) {
        await updateAppearanceSettings({ terminalBackgroundOverlayOpacity: opacity });
    }

    /**
     * 设置终端自定义 HTML
     * @param html HTML 字符串，或 null 清除
     */
    async function setTerminalCustomHTML(html: string | null) {
        try {
            await updateAppearanceSettings({ terminal_custom_html: html });
            // console.log('[AppearanceStore] Terminal custom HTML updated successfully.');
            // 可以在此调用 uiNotifications.store 来显示成功消息
        } catch (err: any) {
            console.error('设置终端自定义 HTML 失败:', err);
            // 可以在此调用 uiNotifications.store 来显示失败消息
            throw new Error(err.response?.data?.message || err.message || '设置终端自定义 HTML 失败');
        }
    }

    // --- 终端主题列表管理 Actions ---

    /**
    // 移除 reloadTerminalThemes，统一由 loadInitialAppearanceData 处理加载

    /**
     * 创建新的终端主题
     * @param name 主题名称
     * @param themeData 主题数据 (ITheme)
     */
    async function createTerminalTheme(name: string, themeData: ITheme) {
        try {
            await apiClient.post('/terminal-themes', { name, themeData }); // 使用 apiClient
            await loadInitialAppearanceData(); // 重新加载所有数据以更新列表
        } catch (err: any) {
             console.error('创建终端主题失败:', err);
             throw new Error(err.response?.data?.message || err.message || '创建终端主题失败');
        }
    }

    /**
     * 更新终端主题
     * @param id 主题 ID
     * @param name 新名称
     * @param themeData 新主题数据
     */
    async function updateTerminalTheme(id: string, name: string, themeData: ITheme) {
         try {
           await apiClient.put(`/terminal-themes/${id}`, { name, themeData }); // 使用 apiClient
           await loadInitialAppearanceData(); // 重新加载所有数据以更新列表
       } catch (err: any) {
            console.error('更新终端主题失败:', err);
            throw new Error(err.response?.data?.message || err.message || '更新终端主题失败');
        }
    }

    /**
     * 删除终端主题
     * @param id 主题 ID
     */
    async function deleteTerminalTheme(id: string) {
         try {
            await apiClient.delete(`/terminal-themes/${id}`); // 使用 apiClient
            // 如果删除的是当前激活的主题，则切换回默认主题 ID
            // 需要将字符串 id 转换为数字进行比较
            const idNum = parseInt(id, 10);
            if (!isNaN(idNum) && activeTerminalThemeId.value === idNum) {
                 // 查找默认主题的数字 ID (这里假设默认主题 ID 为 1，实际应从配置或查询获取)
                 // TODO: 需要一种可靠的方式获取默认主题的数字 ID
                 const defaultThemeIdNum = 1; // 临时硬编码，需要改进
                 console.log(`[AppearanceStore] 删除的主题是当前激活主题，尝试切换到默认主题 ID: ${defaultThemeIdNum}`);
                 await setActiveTerminalTheme(defaultThemeIdNum.toString()); // setActiveTerminalTheme 需要字符串 ID
            }
            await loadInitialAppearanceData(); // 重新加载所有数据以更新列表
        } catch (err: any) {
             console.error('删除终端主题失败:', err);
             throw new Error(err.response?.data?.message || err.message || '删除终端主题失败');
        }
    }

    /**
     * 导入终端主题文件
     * @param file File 对象
     * @param name 可选，如果提供则覆盖文件名作为主题名
     */
    async function importTerminalTheme(file: File, name?: string) {
        const formData = new FormData();
        formData.append('themeFile', file);
        if (name) {
            formData.append('name', name);
        }
        try {
            await apiClient.post('/terminal-themes/import', formData, { // 使用 apiClient
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            await loadInitialAppearanceData(); // 重新加载所有数据以更新列表
        } catch (err: any) {
            console.error('导入终端主题失败:', err);
            throw new Error(err.response?.data?.message || err.message || '导入终端主题失败');
        }
    }

    /**
     * 导出终端主题文件
     * @param id 主题 ID
     */
    async function exportTerminalTheme(id: string) {
        try {
            const response = await apiClient.get(`/terminal-themes/${id}/export`, { // 使用 apiClient
                responseType: 'blob' // 重要：接收二进制数据
            });
            // 从响应头获取文件名
            const contentDisposition = response.headers['content-disposition'];
            let filename = `terminal_theme_${id}.json`; // 默认文件名
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
                if (filenameMatch && filenameMatch.length > 1) {
                    filename = filenameMatch[1];
                }
            }
            // 创建下载链接并触发下载
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
             console.error('导出终端主题失败:', err);
             throw new Error(err.response?.data?.message || err.message || '导出终端主题失败');
        }
    }

/**
     * 按需加载单个终端主题的详细数据
     * @param themeId 主题的字符串 ID
     * @returns 返回主题的 ITheme 数据，如果找不到或加载失败则返回 null
     */
    async function loadTerminalThemeData(themeId: string): Promise<ITheme | null> {
        // 1. 尝试从已加载的列表中查找
        const existingTheme = allTerminalThemes.value.find(t => t._id === themeId);

        // 2. 如果找到且已有 themeData，直接返回
        if (existingTheme?.themeData && Object.keys(existingTheme.themeData).length > 0) {
            console.log(`[AppearanceStore] Theme data for ${themeId} already loaded.`);
            return existingTheme.themeData;
        }

        // 3. 如果未找到或缺少 themeData，从后端加载
        console.log(`[AppearanceStore] Loading theme data for ${themeId} from backend...`);
        try {
            const response = await apiClient.get<TerminalTheme>(`/terminal-themes/${themeId}`); // 假设后端提供此接口
            const fullTheme = response.data;

            if (fullTheme && fullTheme.themeData) {
                // 更新 allTerminalThemes 列表中的对应项
                const index = allTerminalThemes.value.findIndex(t => t._id === themeId);
                if (index !== -1) {
                    // 确保响应性，可以考虑替换整个对象或使用 Vue.set (在 Vue 3 中不推荐)
                    // 简单的替换可能足够，因为 allTerminalThemes 本身是 ref
                     allTerminalThemes.value[index] = { ...allTerminalThemes.value[index], themeData: fullTheme.themeData };
                     console.log(`[AppearanceStore] Updated theme data for ${themeId} in local store.`);
                } else {
                    // 如果列表中不存在（理论上不应发生，因为初始加载了元数据），可以考虑添加到列表
                     console.warn(`[AppearanceStore] Theme metadata for ${themeId} not found in initial list, but loaded data.`);
                     // allTerminalThemes.value.push(fullTheme); // 或者不添加，仅返回数据
                }
                return fullTheme.themeData;
            } else {
                 console.error(`[AppearanceStore] Loaded data for theme ${themeId} is invalid or missing themeData.`);
                 return null;
            }
        } catch (err: any) {
            console.error(`加载终端主题 ${themeId} 数据失败:`, err);
            error.value = err.response?.data?.message || err.message || `加载主题 ${themeId} 数据失败`;
            return null; // 返回 null 表示加载失败
        }
    }
    // --- 背景图片 Actions ---
    /**
     * 上传页面背景图片
     * @param file File 对象
     */
    async function uploadPageBackground(file: File): Promise<string> {
        const formData = new FormData();
        formData.append('pageBackgroundFile', file);
        try {
            const response = await apiClient.post<{ filePath: string }>('/appearance/background/page', formData, { // 使用 apiClient
                 headers: { 'Content-Type': 'multipart/form-data' }
            });
            // 更新本地状态 (虽然 updateAppearanceSettings 也会做，但这里立即反映)
            appearanceSettings.value.pageBackgroundImage = response.data.filePath;
            applyPageBackground(); // 应用新背景
            return response.data.filePath;
        } catch (err: any) {
            console.error('上传页面背景失败:', err);
            throw new Error(err.response?.data?.message || err.message || '上传页面背景失败');
        }
    }
     /**
     * 上传终端背景图片
     * @param file File 对象
     */
    async function uploadTerminalBackground(file: File): Promise<string> {
        const formData = new FormData();
        formData.append('terminalBackgroundFile', file);
        try {
            const response = await apiClient.post<{ filePath: string }>('/appearance/background/terminal', formData, { // 使用 apiClient
                 headers: { 'Content-Type': 'multipart/form-data' }
            });
            appearanceSettings.value.terminalBackgroundImage = response.data.filePath;
            // 终端背景的应用由 Terminal 组件处理
            return response.data.filePath;
        } catch (err: any) {
            console.error('上传终端背景失败:', err);
            throw new Error(err.response?.data?.message || err.message || '上传终端背景失败');
        }
    }

    /**
     * 移除页面背景
     */
    async function removePageBackground() {
        try {
            // 先调用后端删除接口
            await apiClient.delete('/appearance/background/page');
            // 成功后再更新数据库记录
            await updateAppearanceSettings({ pageBackgroundImage: '' });
        } catch (err: any) {
            console.error('移除页面背景失败:', err);
            throw new Error(err.response?.data?.message || err.message || '移除页面背景失败');
        }
    }

    /**
     * 移除终端背景
     */
    async function removeTerminalBackground() {
        try {
            // 先调用后端删除接口
            await apiClient.delete('/appearance/background/terminal');
            // 成功后再更新数据库记录
            await updateAppearanceSettings({ terminalBackgroundImage: '' });
        } catch (err: any) {
            console.error('移除终端背景失败:', err);
            throw new Error(err.response?.data?.message || err.message || '移除终端背景失败');
        }
    }

    // --- Terminal Theme Preview Actions ---
    function startTerminalThemePreview(themeData: ITheme) {
        previewTerminalThemeData.value = themeData;
        isPreviewingTerminalTheme.value = true;
        console.log('[AppearanceStore] Started terminal theme preview.');
    }

    function stopTerminalThemePreview() {
        previewTerminalThemeData.value = null;
        isPreviewingTerminalTheme.value = false;
        console.log('[AppearanceStore] Stopped terminal theme preview.');
    }

    // --- Helper Functions ---
    /**
     * 将 UI 主题 (CSS 变量) 应用到文档根元素。
     * @param theme 要应用的 UI 主题对象。
     */
    function applyUiTheme(theme: Record<string, string>) {
        const root = document.documentElement;
        // 先移除可能存在的旧变量（可选，但更干净）
        // Object.keys(defaultUiTheme).forEach(key => root.style.removeProperty(key));
        // 应用新变量
        for (const [key, value] of Object.entries(theme)) {
            root.style.setProperty(key, value);
        }
    }

    /**
     * 应用页面背景设置到 body 元素
     */
    function applyPageBackground() {
        const body = document.body;
        if (pageBackgroundImage.value) {
            // --- 修改开始：使用 URL 构造函数改进 URL 拼接 ---
            const backendUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin; // 如果未设置 VITE_API_BASE_URL，则回退到当前页面源
            const imagePath = pageBackgroundImage.value;
            console.log(`[AppearanceStore applyPageBackground] Base URL: "${backendUrl}", Image Path: "${imagePath}"`);

            let fullImageUrl = '';
            try {
                // 假设 imagePath 是相对于后端根目录的路径 (例如 /uploads/image.jpg)
                // 使用 URL 构造函数确保路径正确拼接
                const baseUrl = new URL(backendUrl);
                // 确保 imagePath 是以 / 开头，如果不是则添加
                const correctedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
                fullImageUrl = new URL(correctedPath, baseUrl).href;
                console.log(`[AppearanceStore applyPageBackground] Constructed Full Image URL: "${fullImageUrl}"`);
            } catch (e) {
                console.error(`[AppearanceStore applyPageBackground] Error constructing image URL:`, e);
                // URL 构建失败，清除背景并退出
                body.style.backgroundImage = 'none';
                return; // 停止执行
            }
            // --- 修改结束 ---

            // 应用背景图片
            // 先设置为空，强制浏览器重新请求（可能有助于避免缓存问题）
            body.style.backgroundImage = 'none';
            // 使用 nextTick 确保 DOM 更新后再设置背景
            nextTick(() => {
                // 再次检查 fullImageUrl 是否有效
                if (fullImageUrl) {
                    body.style.backgroundImage = `url(${fullImageUrl})`;
                    body.style.backgroundSize = 'cover'; // 覆盖整个区域
                    body.style.backgroundPosition = 'center'; // 居中显示
                    body.style.backgroundRepeat = 'no-repeat'; // 不重复
                    body.style.backgroundAttachment = 'fixed'; // 背景固定，不随滚动条滚动 (可选)
                    console.log(`[AppearanceStore applyPageBackground] Applied background image: ${fullImageUrl}`);
                } else {
                     console.warn(`[AppearanceStore applyPageBackground] Skipping background application due to invalid URL.`);
                     body.style.backgroundImage = 'none'; // 确保清除
                }
            });
        } else {
            // 如果没有设置背景图片，则清除背景
            body.style.backgroundImage = 'none';
            console.log(`[AppearanceStore applyPageBackground] Cleared background image.`);
        }
         // 注意：直接设置 body 透明度会影响所有子元素，通常不建议。
         // 如果需要背景透明效果，通常结合伪元素或额外 div 实现。
         // 这里暂时不直接应用 pageBackgroundOpacity 到 body。
        console.log('[AppearanceStore] 页面背景已应用:', pageBackgroundImage.value);
    }

    // --- Watchers ---
    // 监听 UI 主题变化并应用
    watch(currentUiTheme, (newTheme) => {
        applyUiTheme(newTheme);
    }, { deep: true, immediate: true }); // 添加 immediate: true 确保初始加载时应用默认主题

    // 监听页面背景变化并应用
    watch(pageBackgroundImage, () => { // 只监听图片变化
        applyPageBackground();
    });


    return {
        isLoading,
        error,
        // State refs (原始数据)
        appearanceSettings,
        allTerminalThemes, // 导出重命名后的 ref
        isPreviewingTerminalTheme, 
        previewTerminalThemeData, 
        currentUiTheme,
        activeTerminalThemeId,
        currentTerminalTheme,     
        effectiveTerminalTheme,   
        currentTerminalFontFamily,
        currentTerminalFontSize, // 这个 getter 会自动根据设备类型返回正确的字体大小
        terminalFontSizeDesktop, // + 用于在设置中分别显示/设置桌面端字号
        terminalFontSizeMobile,  // + 用于在设置中分别显示/设置移动端字号
        currentEditorFontSize,
        currentEditorFontFamily, // 新增
        pageBackgroundImage,
        terminalBackgroundImage,
        currentTerminalBackgroundOverlayOpacity,
        // Actions
        loadInitialAppearanceData,
        updateAppearanceSettings,
        saveCustomUiTheme,
        resetCustomUiTheme,
        setActiveTerminalTheme,
        setTerminalFontFamily,
        setTerminalFontSize, // 设置桌面端字体大小
        setTerminalFontSizeMobile, // + 设置移动端字体大小
        setEditorFontSize,
        setEditorFontFamily, // 新增
        setTerminalBackgroundEnabled,
        createTerminalTheme,
        updateTerminalTheme, 
        deleteTerminalTheme, 
        importTerminalTheme, 
        exportTerminalTheme,
        uploadPageBackground,
        uploadTerminalBackground,
        setTerminalBackgroundOverlayOpacity,
        setTerminalCustomHTML, // 设置终端自定义 HTML
        removePageBackground,
        removeTerminalBackground,
        loadTerminalThemeData, 
        isTerminalBackgroundEnabled,
        terminalCustomHTML, // 获取终端自定义 HTML
        startTerminalThemePreview,
        stopTerminalThemePreview, 
        // Visibility control
        isStyleCustomizerVisible,
        toggleStyleCustomizer,
    };
});
