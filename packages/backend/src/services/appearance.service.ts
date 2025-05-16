import fs from 'fs/promises'; // 使用 promises API
import path from 'path';
import * as appearanceRepository from '../repositories/appearance.repository';
import { AppearanceSettings, UpdateAppearanceDto } from '../types/appearance.types';
import * as terminalThemeRepository from '../repositories/terminal-theme.repository';

/**
 * 获取外观设置
 * @returns Promise<AppearanceSettings>
 */
export const getSettings = async (): Promise<AppearanceSettings> => {
  const settings = await appearanceRepository.getAppearanceSettings();
  // 为 terminalBackgroundOverlayOpacity 提供默认值
  if (settings.terminalBackgroundOverlayOpacity === undefined || settings.terminalBackgroundOverlayOpacity === null) {
    settings.terminalBackgroundOverlayOpacity = 0.5; // 默认透明度为 0.5
  }
  return settings;
};

/**
 * 更新外观设置
 * @param settingsDto 更新数据
 * @returns Promise<boolean> 是否成功更新
 */
export const updateSettings = async (settingsDto: UpdateAppearanceDto): Promise<boolean> => {
  // 验证 activeTerminalThemeId (如果提供了)
  if (settingsDto.activeTerminalThemeId !== undefined && settingsDto.activeTerminalThemeId !== null) {
      const themeIdNum = settingsDto.activeTerminalThemeId; // ID is now number | null
      // 验证 ID 是否为有效的数字
      if (typeof themeIdNum !== 'number') {
           console.error(`[AppearanceService] 收到的 activeTerminalThemeId 不是有效的数字: ${themeIdNum}`);
           throw new Error(`无效的终端主题 ID 类型，应为数字。`);
      }
      try {
          // 直接使用数字 ID 调用 findThemeById 进行验证
          const themeExists = await terminalThemeRepository.findThemeById(themeIdNum);
          if (!themeExists) {
              console.warn(`[AppearanceService] 尝试更新为不存在的终端主题数字 ID: ${themeIdNum}`);
              throw new Error(`指定的终端主题 ID 不存在: ${themeIdNum}`);
          }
          console.log(`[AppearanceService] 终端主题数字 ID ${themeIdNum} 验证通过。`);
      } catch (e: any) {
          console.error(`[AppearanceService] 验证终端主题数字 ID (${themeIdNum}) 时出错:`, e.message);
          throw new Error(`验证终端主题 ID 时出错: ${e.message || themeIdNum}`);
      }
  } else if (settingsDto.hasOwnProperty('activeTerminalThemeId') && settingsDto.activeTerminalThemeId === null) {
      // 处理显式设置为 null (表示重置为默认/无用户主题)
      console.log(`[AppearanceService] 接收到将 activeTerminalThemeId 设置为 null 的请求。`);
      // 仓库层会处理 null
  }

  // 验证 terminalFontSize (如果提供了)
  if (settingsDto.terminalFontSize !== undefined && settingsDto.terminalFontSize !== null) {
      const size = Number(settingsDto.terminalFontSize);
      if (isNaN(size) || size <= 0) {
          throw new Error(`无效的终端字体大小: ${settingsDto.terminalFontSize}。必须是一个正数。`);
      }
      // 可以选择将验证后的数字类型赋值回 DTO，以确保类型正确传递给仓库层
      settingsDto.terminalFontSize = size;
  }

  // 验证 editorFontSize (如果提供了)
  if (settingsDto.editorFontSize !== undefined && settingsDto.editorFontSize !== null) {
      const size = Number(settingsDto.editorFontSize);
      if (isNaN(size) || size <= 0) {
          throw new Error(`无效的编辑器字体大小: ${settingsDto.editorFontSize}。必须是一个正数。`);
      }
      // 确保类型正确传递给仓库层
      settingsDto.editorFontSize = size;
  }

  // 验证 terminalBackgroundOverlayOpacity (如果提供了)
  if (settingsDto.terminalBackgroundOverlayOpacity !== undefined && settingsDto.terminalBackgroundOverlayOpacity !== null) {
    const opacity = Number(settingsDto.terminalBackgroundOverlayOpacity);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
      throw new Error(`无效的终端背景蒙版透明度: ${settingsDto.terminalBackgroundOverlayOpacity}。必须是一个 0 到 1 之间的数字。`);
    }
    settingsDto.terminalBackgroundOverlayOpacity = opacity; // 确保类型正确
  }

  // TODO: 如果实现了背景图片上传，这里需要处理文件路径或 URL 的验证/保存逻辑

  return appearanceRepository.updateAppearanceSettings(settingsDto);
};
/**
 * 移除页面背景图片
 * 1. 获取当前设置中的文件路径
 * 2. 如果路径存在，删除文件系统中的文件
 * 3. 更新数据库中的路径为空字符串
 */
export const removePageBackground = async (): Promise<boolean> => {
    const currentSettings = await getSettings();
    const filePath = currentSettings.pageBackgroundImage;

    if (filePath) {
        // 构建文件的绝对路径
        // 注意：这里的路径拼接逻辑需要与上传时的逻辑一致
        // 假设 filePath 是相对于项目根目录的 /uploads/backgrounds/xxx
        const absolutePath = path.join(__dirname, '../../', filePath); // 调整相对路径层级

        try {
            await fs.unlink(absolutePath);
            console.log(`[AppearanceService] 已删除页面背景文件: ${absolutePath}`);
        } catch (error: any) {
            // 如果文件不存在或其他删除错误，记录日志但继续执行以清空数据库记录
            if (error.code === 'ENOENT') {
                console.warn(`[AppearanceService] 尝试删除页面背景文件但未找到: ${absolutePath}`);
            } else {
                console.error(`[AppearanceService] 删除页面背景文件时出错 (${absolutePath}):`, error);
                // 可以选择抛出错误，或者仅记录并继续
                // throw new Error(`删除页面背景文件失败: ${error.message}`);
            }
        }
    } else {
        console.log('[AppearanceService] 没有页面背景文件路径需要删除。');
    }

    // 无论文件删除是否成功（或文件是否存在），都尝试清空数据库记录
    return updateSettings({ pageBackgroundImage: '' });
};

/**
 * 移除终端背景图片
 * 1. 获取当前设置中的文件路径
 * 2. 如果路径存在，删除文件系统中的文件
 * 3. 更新数据库中的路径为空字符串
 */
export const removeTerminalBackground = async (): Promise<boolean> => {
    const currentSettings = await getSettings();
    const filePath = currentSettings.terminalBackgroundImage;

    if (filePath) {
        const absolutePath = path.join(__dirname, '../../', filePath); // 调整相对路径层级

        try {
            await fs.unlink(absolutePath);
            console.log(`[AppearanceService] 已删除终端背景文件: ${absolutePath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.warn(`[AppearanceService] 尝试删除终端背景文件但未找到: ${absolutePath}`);
            } else {
                console.error(`[AppearanceService] 删除终端背景文件时出错 (${absolutePath}):`, error);
                // throw new Error(`删除终端背景文件失败: ${error.message}`);
            }
        }
    } else {
         console.log('[AppearanceService] 没有终端背景文件路径需要删除。');
    }

    // 无论文件删除是否成功（或文件是否存在），都尝试清空数据库记录
    return updateSettings({ terminalBackgroundImage: '' });
};


