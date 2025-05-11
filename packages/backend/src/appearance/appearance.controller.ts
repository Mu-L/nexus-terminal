import { Request, Response } from 'express';
import * as appearanceService from '../services/appearance.service';
import { UpdateAppearanceDto } from '../types/appearance.types';
import multer from 'multer';
import path from 'path';
import fs from 'fs'; // Keep fs for sync operations if needed, add promises for async
import fsp from 'fs/promises'; // Use fs.promises for async file operations

// --- 背景图片上传配置 (保持不变) ---
const backgroundStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../uploads/backgrounds/');
        // 确保目录存在
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, uniqueSuffix + '-' + safeOriginalName);
    }
});

const backgroundUpload = multer({
    storage: backgroundStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传图片文件 (JPEG, PNG, GIF, WebP, SVG)！'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 限制文件大小为 5MB
});


/**
 * 获取外观设置 (保持不变)
 */
export const getAppearanceSettingsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const settings = await appearanceService.getSettings();
        res.status(200).json(settings);
    } catch (error: any) {
        res.status(500).json({ message: '获取外观设置失败', error: error.message });
    }
};

/**
 * 更新外观设置 (保持不变)
 */
export const updateAppearanceSettingsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const settingsDto: UpdateAppearanceDto = req.body;
        const success = await appearanceService.updateSettings(settingsDto);
        if (success) {
            const updatedSettings = await appearanceService.getSettings();
            res.status(200).json(updatedSettings);
        } else {
            res.status(500).json({ message: '更新外观设置似乎失败了' });
        }
    } catch (error: any) {
        res.status(400).json({ message: '更新外观设置失败', error: error.message });
    }
};


/**
 * 上传页面背景图片 (修改返回路径)
 */
export const uploadPageBackgroundController = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
        res.status(400).json({ message: '没有上传文件' });
        return;
    }
    try {
        // 构建新的 API 路径
        const apiPath = `/api/v1/appearance/background/file/${req.file.filename}`;

        // 更新数据库中的设置，保存 API 路径
        await appearanceService.updateSettings({ pageBackgroundImage: apiPath });

        // 返回新的 API 路径给前端
        res.status(200).json({ message: '页面背景上传成功', filePath: apiPath });
    } catch (error: any) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("删除上传失败的背景文件时出错:", err);
            });
        }
        res.status(500).json({ message: '上传页面背景失败', error: error.message });
    }
};

/**
 * 上传终端背景图片 (修改返回路径)
 */
export const uploadTerminalBackgroundController = async (req: Request, res: Response): Promise<void> => {
     if (!req.file) {
        res.status(400).json({ message: '没有上传文件' });
        return;
    }
    try {
        // 构建新的 API 路径
        const apiPath = `/api/v1/appearance/background/file/${req.file.filename}`;

        // 更新数据库中的设置，保存 API 路径
        await appearanceService.updateSettings({ terminalBackgroundImage: apiPath });

        // 返回新的 API 路径给前端
        res.status(200).json({ message: '终端背景上传成功', filePath: apiPath });
    } catch (error: any) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("删除上传失败的背景文件时出错:", err);
            });
        }
        res.status(500).json({ message: '上传终端背景失败', error: error.message });
    }
};

/**
 * 获取背景图片文件
 */
export const getBackgroundFileController = async (req: Request, res: Response): Promise<void> => {
    const filename = req.params.filename;

    // 基本安全检查，防止路径遍历等
    if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/')) {
        res.status(400).json({ message: '无效的文件名' });
        return;
    }

    try {
        // 构建文件的绝对路径 (基于 multer 的保存位置)
        const absolutePath = path.join(__dirname, '../../uploads/backgrounds/', filename);

        // 检查文件是否存在且可读
        await fsp.access(absolutePath, fs.constants.R_OK);

        // 发送文件
        res.sendFile(absolutePath, (err) => {
             if (err) {
                console.error(`[AppearanceController] 发送文件时出错 (${absolutePath}):`, err);
                // 避免在已发送响应头后再次发送
                if (!res.headersSent) {
                     res.status(500).json({ message: '发送文件时出错' });
                }
             }
        });

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.warn(`[AppearanceController] 请求的背景文件未找到: ${filename}`);
            res.status(404).json({ message: '文件未找到' });
        } else {
            console.error(`[AppearanceController] 获取背景文件时出错 (${filename}):`, error);
            res.status(500).json({ message: '获取背景文件时出错', error: error.message });
        }
    }
};


// 导出 multer 中间件以便在路由中使用 (保持不变)
export const uploadPageBackgroundMiddleware = backgroundUpload.single('pageBackgroundFile');
export const uploadTerminalBackgroundMiddleware = backgroundUpload.single('terminalBackgroundFile');

/**
 * 移除页面背景图片 (保持不变，Service 层会处理路径解析)
 */
export const removePageBackgroundController = async (req: Request, res: Response): Promise<void> => {
    try {
        await appearanceService.removePageBackground();
        res.status(200).json({ message: '页面背景已移除' });
    } catch (error: any) {
        res.status(500).json({ message: '移除页面背景失败', error: error.message });
    }
};

/**
 * 移除终端背景图片 (保持不变，Service 层会处理路径解析)
 */
export const removeTerminalBackgroundController = async (req: Request, res: Response): Promise<void> => {
    try {
        await appearanceService.removeTerminalBackground();
        res.status(200).json({ message: '终端背景已移除' });
    } catch (error: any) {
        res.status(500).json({ message: '移除终端背景失败', error: error.message });
    }
};
