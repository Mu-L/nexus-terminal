import { ref, reactive, nextTick, onUnmounted, readonly, type Ref } from 'vue'; // 再次修正导入，移除大写 Readonly
import { createWebSocketConnectionManager } from './useWebSocketConnection'; // 导入工厂函数
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types'; // 从 sftp 类型文件导入
import type { UploadItem } from '../types/upload.types'; // 从 upload 类型文件导入
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types'; // 从类型文件导入

// --- 接口定义 (已移至 upload.types.ts) ---

import type { WebSocketDependencies } from './useSftpActions'; // 导入 WebSocketDependencies 类型

// 辅助函数 (从 FileManager.vue 复制)
const generateUploadId = (): string => {
    // 如果需要，可以使用稍微不同的格式作为上传 ID
    return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// 辅助函数 (从 FileManager.vue 复制)
const joinPath = (base: string, name: string): string => {
    if (base === '/') return `/${name}`;
    if (base.endsWith('/')) return `${base}${name}`;
    return `${base}/${name}`;
};

export function useFileUploader(
    currentPathRef: Ref<string>,
    fileListRef: Readonly<Ref<readonly FileListItem[]>>, // 使用 Readonly 类型
    // refreshDirectory: () => void, // 不再需要此回调
    // sessionId: string, // 不再需要，因为 wsDeps 包含了会话上下文
    // dbConnectionId: string, // 不再需要
    wsDeps: WebSocketDependencies // 注入 WebSocket 依赖项
) {
    const { t } = useI18n();
    // 不再创建独立的连接管理器，而是使用注入的依赖项
    // const { sendMessage, onMessage, isConnected } = createWebSocketConnectionManager(sessionId, dbConnectionId, t);
    const { sendMessage, onMessage, isConnected } = wsDeps; // 使用注入的依赖项

    // 对 uploads 字典使用 reactive 以获得更好的深度响应性
    const uploads = reactive<Record<string, UploadItem>>({});

    // --- 上传逻辑 ---

    const sendFileChunks = (uploadId: string, file: File, startByte = 0) => {
        const upload = uploads[uploadId];
        // 在继续之前检查连接和上传状态
        if (!isConnected.value || !upload || upload.status !== 'uploading') {
            console.warn(`[文件上传模块] 无法为 ${uploadId} 发送块。连接状态: ${isConnected.value}, 上传状态: ${upload?.status}`);
            return;
        }

        const chunkSize = 1024 * 64; // 64KB 块大小
        const reader = new FileReader();
        let offset = startByte;
        let chunkIndex = 0; // Initialize chunk index counter
        let currentChunkSize = 0; // Store the size of the chunk being processed

        reader.onload = (e) => {
            const currentUpload = uploads[uploadId];
            // *发送前* 再次检查连接和状态
            if (!isConnected.value || !currentUpload || currentUpload.status !== 'uploading') {
                 console.warn(`[文件上传模块] 上传 ${uploadId} 在发送偏移量 ${offset} 的块之前状态已更改或连接已断开。`);
                 return; // 如果状态改变或断开连接，则停止发送
            }

            const chunkResult = e.target?.result as string;
            // 确保结果是字符串并且包含 base64 前缀
            if (typeof chunkResult === 'string' && chunkResult.startsWith('data:')) {
                const chunkBase64 = chunkResult.split(',')[1];
                const isLast = offset + chunkSize >= file.size;

                sendMessage({
                    type: 'sftp:upload:chunk',
                    payload: { uploadId, chunkIndex: chunkIndex++, data: chunkBase64, isLast } // Add and increment chunkIndex
                });

                // --- FIX: Update offset based on the actual chunk size that was read ---
                offset += currentChunkSize; // Use the stored size of the slice
                // currentUpload.progress = Math.min(100, Math.round((offset / file.size) * 100)); // --- REMOVED: Optimistic progress update

                if (!isLast) {
                    // 使用 requestAnimationFrame 或 nextTick 在块之间添加轻微延迟
                    // 以潜在地改善 UI 响应性并减少负载。
                    nextTick(readNextChunk);
                } else {
                    console.log(`[文件上传模块] 已发送 ${uploadId} 的最后一个块`);
                    // 后端将在收到最后一个块后发送 sftp:upload:success
                }
            } else {
                 console.error(`[文件上传模块] FileReader 为 ${uploadId} 返回了意外结果:`, chunkResult);
                 // 处理错误：更新上传状态，也许重试？
                 currentUpload.status = 'error';
                 currentUpload.error = t('fileManager.errors.readFileError');
            }
        };

        reader.onerror = () => {
            console.error(`[文件上传模块] FileReader 错误，上传 ID: ${uploadId}`);
            const failedUpload = uploads[uploadId];
            if (failedUpload) {
                failedUpload.status = 'error';
                failedUpload.error = t('fileManager.errors.readFileError');
            }
        };

        const readNextChunk = () => {
            // 读取下一个块之前再次检查状态
            if (offset < file.size && uploads[uploadId]?.status === 'uploading') {
                const slice = file.slice(offset, offset + chunkSize);
                currentChunkSize = slice.size; // Store the actual size of the slice being read
                reader.readAsDataURL(slice);
            }
        };

        // 开始读取第一个块（或恢复时的下一个块）
        if (file.size > 0) {
             readNextChunk();
        } else {
             // 立即处理零字节文件
             console.log(`[文件上传模块] 处理零字节文件 ${uploadId}`);
             // Send chunkIndex 0 for zero-byte file
             sendMessage({ type: 'sftp:upload:chunk', payload: { uploadId, chunkIndex: 0, data: '', isLast: true } });
             upload.progress = 100;
             // Backend should send success message shortly after this
        }
    };


    const startFileUpload = (file: File, relativePath?: string) => { // 保持签名修改
        if (!isConnected.value) {
            console.warn('[文件上传模块] 无法开始上传：WebSocket 未连接。');
            // 可以选择向用户显示错误消息
            return;
        }

        const uploadId = generateUploadId();
        // --- 修正：直接构建最终远程路径 ---
        let finalRemotePath: string;
        if (relativePath) {
            // 确保 currentPathRef.value 结尾有斜杠
            const basePath = currentPathRef.value.endsWith('/') ? currentPathRef.value : `${currentPathRef.value}/`;
            // 确保 relativePath 开头没有斜杠，末尾有斜杠 (如果非空)
            let cleanRelativePath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
            // 移除末尾斜杠（如果有），因为文件名会加上
            cleanRelativePath = cleanRelativePath.endsWith('/') ? cleanRelativePath.slice(0, -1) : cleanRelativePath;
            // 拼接路径，确保 cleanRelativePath 和 file.name 之间只有一个斜杠
            finalRemotePath = `${basePath}${cleanRelativePath ? cleanRelativePath + '/' : ''}${file.name}`;
        } else {
            finalRemotePath = joinPath(currentPathRef.value, file.name); // 对于非文件夹上传，保持原样
        }
        // 规范化路径，移除多余的斜杠 e.g. /root//dir -> /root/dir
        finalRemotePath = finalRemotePath.replace(/\/+/g, '/');
        console.log(`[文件上传模块] Calculated finalRemotePath: ${finalRemotePath} (current: ${currentPathRef.value}, relative: ${relativePath}, filename: ${file.name})`); // 添加日志
        // --- 结束修正 ---


        // 添加到响应式 uploads 字典
        uploads[uploadId] = {
            id: uploadId,
            file,
            filename: file.name,
            progress: 0,
            status: 'pending' // 初始状态
        };

        console.log(`[文件上传模块] 开始上传 ${uploadId} 到 ${finalRemotePath}`); // 使用 finalRemotePath
        sendMessage({
            type: 'sftp:upload:start',
            payload: { uploadId, remotePath: finalRemotePath, size: file.size, relativePath: relativePath || undefined } // 发送修正后的 remotePath
        });
        // 后端应该响应 sftp:upload:ready
    };

    const cancelUpload = (uploadId: string, notifyBackend = true) => {
        const upload = uploads[uploadId];
        if (upload && ['pending', 'uploading', 'paused'].includes(upload.status)) {
            console.log(`[文件上传模块] 取消上传 ${uploadId}`);
            upload.status = 'cancelled'; // 立即更新状态

            if (notifyBackend && isConnected.value) {
                sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
            }

            // 短暂延迟后从列表中移除，以显示取消状态
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'cancelled') {
                    delete uploads[uploadId];
                }
            }, 3000);
        }
    };

    // --- 消息处理器 ---

    const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload && upload.status === 'pending') {
            console.log(`[文件上传模块] 上传 ${uploadId} 已就绪，开始发送块。`);
            upload.status = 'uploading';
            sendFileChunks(uploadId, upload.file); // 开始发送块
        } else {
             console.warn(`[文件上传模块] 收到未知或非待处理状态的上传 ID 的 upload:ready 消息: ${uploadId}`);
        }
    };

    const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload) {
            console.log(`[文件上传模块] 上传 ${uploadId} 成功`);
            upload.status = 'success';
            upload.progress = 100;

            // 不再调用 refreshDirectory()，由 useSftpActions 处理列表更新
            // refreshDirectory();

            // 立即删除记录
            if (uploads[uploadId]) { // 确保记录仍然存在
                delete uploads[uploadId];
            }

            // 延迟后从列表中移除
            // setTimeout(() => {
            //      if (uploads[uploadId]?.status === 'success') {
            //         delete uploads[uploadId];
            //      }
            // }, 2000); // 成功状态显示时间短一些
        } else {
            console.warn(`[文件上传模块] 收到未知上传 ID 的 upload:success 消息: ${uploadId}`);
        }
    };

    const onUploadError = (payload: MessagePayload, message: WebSocketMessage) => {
        // 从 message 中获取 uploadId，因为 payload 此时是错误字符串
        const uploadId = message.uploadId;
        if (!uploadId) {
             console.warn(`[文件上传模块] 收到缺少 uploadId 的 upload:error 消息:`, message);
             return;
        }

        const upload = uploads[uploadId];
        if (upload) {
            const errorMessage = typeof payload === 'string' ? payload : t('fileManager.errors.uploadFailed');
            console.error(`[文件上传模块] 上传 ${uploadId} 出错:`, errorMessage);
            upload.status = 'error';
            upload.error = errorMessage; // 使用 payload 作为错误消息

            // 让错误消息可见时间长一些
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'error') {
                    delete uploads[uploadId];
                }
            }, 5000);
        } else {
             console.warn(`[文件上传模块] 收到未知上传 ID 的 upload:error 消息: ${uploadId}`);
        }
    };

    const onUploadPause = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload && upload.status === 'uploading') {
            console.log(`[文件上传模块] 上传 ${uploadId} 已暂停`);
            upload.status = 'paused';
        }
    };

    const onUploadResume = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload && upload.status === 'paused') {
            console.log(`[文件上传模块] 恢复上传 ${uploadId}`);
            upload.status = 'uploading';
            // 恢复发送块（后端应该告知从哪里恢复，
            // 但现在假设我们重新开始或后端处理了它）
            // 更健壮的实现需要后端发送最后接收到的字节偏移量。
            sendFileChunks(uploadId, upload.file); // 为简单起见，现在重新开始发送块
        }
    };

     const onUploadCancelled = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload) {
            console.log(`[文件上传模块] 后端确认上传 ${uploadId} 已取消。`);
            // 状态可能已经由用户操作设置为 'cancelled'
            if (upload.status !== 'cancelled') {
                 upload.status = 'cancelled';
            }
            // 确保它会被移除（如果尚未计划移除）
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'cancelled') {
                    delete uploads[uploadId];
                }
            }, 3000);
        }
    };

    // +++ 新增：处理上传进度更新 +++
    const onUploadProgress = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId; // 从顶层获取 uploadId
        if (!uploadId) {
            console.warn(`[文件上传模块] 收到缺少 uploadId 的 upload:progress 消息:`, message);
            return;
        }

        const upload = uploads[uploadId];
        if (upload && upload.status === 'uploading') {
            // payload 现在应该包含 bytesWritten 和 totalSize
            if (typeof payload?.bytesWritten === 'number' && typeof payload?.totalSize === 'number') {
                upload.progress = Math.min(100, Math.round((payload.bytesWritten / payload.totalSize) * 100));
                // console.debug(`[文件上传模块] 更新上传 ${uploadId} 进度: ${upload.progress}% (${payload.bytesWritten}/${payload.totalSize})`);
            } else {
                console.warn(`[文件上传模块] 收到 upload:progress 消息，但 payload 格式不正确:`, payload);
            }
        } else if (upload) {
            // console.warn(`[文件上传模块] 收到 upload:progress 消息，但上传 ${uploadId} 状态为 ${upload.status}，不予更新。`);
        } else {
            console.warn(`[文件上传模块] 收到未知上传 ID 的 upload:progress 消息: ${uploadId}`);
        }
    };
    // --- 结束新增 ---

    // --- 注册处理器 ---
    const unregisterUploadReady = onMessage('sftp:upload:ready', onUploadReady);
    const unregisterUploadSuccess = onMessage('sftp:upload:success', onUploadSuccess);
    const unregisterUploadError = onMessage('sftp:upload:error', onUploadError);
    const unregisterUploadPause = onMessage('sftp:upload:pause', onUploadPause);
    const unregisterUploadResume = onMessage('sftp:upload:resume', onUploadResume);
    const unregisterUploadCancelled = onMessage('sftp:upload:cancelled', onUploadCancelled);
    const unregisterUploadProgress = onMessage('sftp:upload:progress', onUploadProgress); // +++ 注册新处理器 +++

    // --- 清理 ---
    onUnmounted(() => {
        console.log('[文件上传模块] 卸载并注销处理器。');
        unregisterUploadReady?.();
        unregisterUploadSuccess?.();
        unregisterUploadError?.();
        unregisterUploadPause?.();
        unregisterUploadResume?.();
        unregisterUploadCancelled?.();
        unregisterUploadProgress?.(); // +++ 注销新处理器 +++

        // 当使用此 composable 的组件卸载时，取消任何正在进行的上传
        Object.keys(uploads).forEach(uploadId => {
            cancelUpload(uploadId, true); // 卸载时通知后端
        });
    });

    return {
        uploads, // 暴露响应式字典
        startFileUpload,
        cancelUpload,
        // 如果拖放/选择处理程序要在这里管理，则暴露它们，
        // 或者将它们保留在组件中并调用 startFileUpload。
        // 为简单起见，假设组件处理 UI 事件
        // 并为每个文件调用 startFileUpload(file)。
    };
}
