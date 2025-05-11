import { Client, SFTPWrapper, Stats, WriteStream } from 'ssh2'; // Import WriteStream (Removed Dirent)
import { WebSocket } from 'ws';
import { ClientState } from '../websocket'; // 导入统一的 ClientState
import * as pathModule from 'path'; // +++ Import path module +++
import * as jschardet from 'jschardet'; // +++ Import jschardet +++
import * as iconv from 'iconv-lite'; // +++ Import iconv-lite +++

// +++ Define local interface for readdir results +++
interface SftpDirEntry {
    filename: string;
    longname: string;
    attrs: Stats;
}

// 定义服务器状态的数据结构 (与前端 StatusMonitor.vue 匹配)
// Note: This interface seems out of place here, but keeping it for now as it was in the original file.
// Ideally, it should be in a shared types file.
interface ServerStatus {
    cpuPercent?: number;
    memPercent?: number;
    memUsed?: number; // MB
    memTotal?: number; // MB
    swapPercent?: number;
    swapUsed?: number; // MB
    swapTotal?: number; // MB
    diskPercent?: number;
    diskUsed?: number; // KB
    diskTotal?: number; // KB
    cpuModel?: string;
    netRxRate?: number; // Bytes per second
    netTxRate?: number; // Bytes per second
    netInterface?: string;
    osName?: string;
    loadAvg?: number[]; // 系统平均负载 [1min, 5min, 15min]
    timestamp: number; // 状态获取时间戳
}

// Interface for parsed network stats - Also seems out of place here.
interface NetworkStats {
    [interfaceName: string]: {
        rx_bytes: number;
        tx_bytes: number;
    }
}

// Note: These constants seem related to StatusMonitorService, not SftpService.
const DEFAULT_POLLING_INTERVAL = 1000;
const previousNetStats = new Map<string, { rx: number, tx: number, timestamp: number }>();

// Interface for tracking active uploads
interface ActiveUpload {
    remotePath: string;
    totalSize: number;
    bytesWritten: number;
    stream: WriteStream;
    sessionId: string; // Link back to the session for cleanup
    relativePath?: string;
}

export class SftpService {
    private clientStates: Map<string, ClientState>; // 使用导入的 ClientState
    private activeUploads: Map<string, ActiveUpload>; // Map<uploadId, ActiveUpload>

    constructor(clientStates: Map<string, ClientState>) {
        this.clientStates = clientStates;
        this.activeUploads = new Map(); // Initialize the map
    }

    /**
     * 初始化 SFTP 会话
     * @param sessionId 会话 ID
     */
    async initializeSftpSession(sessionId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient || state.sftp) {
            console.warn(`[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`);
            return;
        }
        if (!state.sshClient) {
             console.error(`[SFTP] 会话 ${sessionId} 的 SSH 客户端不存在，无法初始化 SFTP。`);
             return;
        }
        return new Promise((resolve, reject) => {
            state.sshClient.sftp((err, sftpInstance) => {
                if (err) {
                    console.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' } }));
                    reject(err);
                } else {
                    console.log(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
                    state.sftp = sftpInstance;
                    state.ws.send(JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } }));
                    sftpInstance.on('end', () => {
                        console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);
                        if (state) state.sftp = undefined;
                    });
                    sftpInstance.on('close', () => {
                        console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);
                         if (state) state.sftp = undefined;
                    });
                    sftpInstance.on('error', (sftpErr: Error) => {
                         console.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);
                         if (state) state.sftp = undefined;
                         state?.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' } }));
                    });
                    resolve();
                }
            });
        });
    }

    /**
     * 清理 SFTP 会话
     * @param sessionId 会话 ID
     */
    cleanupSftpSession(sessionId: string): void {
        const state = this.clientStates.get(sessionId);
        if (state?.sftp) {
            console.log(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);
            state.sftp.end();
            state.sftp = undefined;
        }
        // Also clean up any active uploads associated with this session
        this.activeUploads.forEach((upload, uploadId) => {
            if (upload.sessionId === sessionId) {
                console.warn(`[SFTP] Cleaning up active upload ${uploadId} for session ${sessionId} due to SFTP session cleanup.`);
                this.cancelUploadInternal(uploadId, 'SFTP session ended'); // Internal cancel without sending message
            }
        });
    }

    // --- SFTP 操作方法 ---

    /** 读取目录内容 */
    async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
        }
        console.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.readdir(path, (err, list) => {
                 if (err) {
                    console.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录失败: ${err.message}`, requestId: requestId }));
                 } else {
                    const files = list.map((item) => ({
                        filename: item.filename,
                        longname: item.longname,
                        attrs: {
                            size: item.attrs.size, uid: item.attrs.uid, gid: item.attrs.gid, mode: item.attrs.mode,
                            atime: item.attrs.atime * 1000, mtime: item.attrs.mtime * 1000,
                            isDirectory: item.attrs.isDirectory(), isFile: item.attrs.isFile(), isSymbolicLink: item.attrs.isSymbolicLink(),
                         }
                     }));
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:success', path: path, payload: files, requestId: requestId }));
                 }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 获取文件/目录状态信息 */
    async stat(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 stat (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received stat request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.lstat(path, (err, stats: Stats) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] stat ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态失败: ${err.message}`, requestId: requestId }));
                } else {
                     const fileStats = {
                         size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                         atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                         isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                     };
                    // Send specific success type
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:success', path: path, payload: fileStats, requestId: requestId }));
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] stat ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 读取文件内容 (支持指定编码) */
    async readFile(sessionId: string, path: string, requestId: string, requestedEncoding?: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readFile (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`);
        try {
            const readStream = state.sftp.createReadStream(path);
            let fileData = Buffer.alloc(0);
            let errorOccurred = false;

            readStream.on('data', (chunk: Buffer) => { fileData = Buffer.concat([fileData, chunk]); });
            readStream.on('error', (err: Error) => {
                if (errorOccurred) return; errorOccurred = true;
                console.error(`[SFTP ${sessionId}] readFile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件流错误: ${err.message}`, requestId: requestId }));
            });
            readStream.on('end', () => {
                if (errorOccurred) return;

                console.log(`[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`);
                let encodingUsed: string = 'utf-8'; // Default encoding
                let decodedContent: string = '';
                let decodeError: string | null = null;

                try {
                    if (requestedEncoding) {
                        // 用户指定了编码
                        encodingUsed = requestedEncoding;
                        console.log(`[SFTP ${sessionId}] Using requested encoding: ${encodingUsed} (ID: ${requestId})`);
                        const normalizedEncoding = encodingUsed.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize more aggressively
                        if (iconv.encodingExists(normalizedEncoding)) {
                            decodedContent = iconv.decode(fileData, normalizedEncoding);
                            encodingUsed = normalizedEncoding; // Use the normalized name if valid
                        } else {
                            console.warn(`[SFTP ${sessionId}] Requested encoding "${requestedEncoding}" is not supported by iconv-lite. Falling back to UTF-8. (ID: ${requestId})`);
                            encodingUsed = 'utf-8'; // Fallback
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            // Optionally add a warning?
                        }
                    } else {
                        // 自动检测编码
                        console.log(`[SFTP ${sessionId}] Detecting encoding for ${path} (ID: ${requestId})`);
                        const detection = jschardet.detect(fileData);
                        const detectedEncodingRaw = detection.encoding ? detection.encoding.toLowerCase() : 'utf-8'; // Default to utf-8 if detection fails
                        const confidence = detection.confidence || 0;
                        console.log(`[SFTP ${sessionId}] Detected encoding: ${detectedEncodingRaw} (confidence: ${confidence})`);

                        const chineseEncodings = ['gbk', 'gb2312', 'gb18030', 'big5', 'euc-tw'];
                        let normalizedDetected = detectedEncodingRaw.replace(/[^a-z0-9]/g, '');
                        if (normalizedDetected === 'windows1252') normalizedDetected = 'cp1252';
                        else if (normalizedDetected === 'gb2312') normalizedDetected = 'gbk'; // Prefer gbk

                        if (normalizedDetected === 'utf8' || normalizedDetected === 'ascii') {
                            encodingUsed = 'utf-8';
                            decodedContent = fileData.toString('utf8');
                            console.log(`[SFTP ${sessionId}] Decoded ${path} as UTF-8/ASCII.`);
                        } else if (chineseEncodings.includes(normalizedDetected)) {
                            // If detected as a common Chinese encoding, trust it and use gb18030 for broader compatibility
                            encodingUsed = 'gb18030'; // Report gb18030 as used
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from detected Chinese encoding (${normalizedDetected}) as ${encodingUsed}.`);
                        } else if (confidence < 0.90) { // Low confidence threshold
                            console.warn(`[SFTP ${sessionId}] Low confidence detection (${normalizedDetected}, ${confidence}) for ${path}. Attempting GB18030 decode first.`);
                            try {
                                // Try decoding as GB18030 first
                                const tempContent = iconv.decode(fileData, 'gb18030');
                                // Basic check for Mojibake
                                if (tempContent.includes('\uFFFD')) {
                                     console.warn(`[SFTP ${sessionId}] GB18030 decoding resulted in replacement characters. Falling back to original detection (${normalizedDetected}) or UTF-8.`);
                                     // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                     if (iconv.encodingExists(normalizedDetected)) {
                                         encodingUsed = normalizedDetected;
                                         decodedContent = iconv.decode(fileData, encodingUsed);
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
                                     } else {
                                         encodingUsed = 'utf-8';
                                         decodedContent = fileData.toString('utf8');
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                                     }
                                } else {
                                     encodingUsed = 'gb18030'; // Success with GB18030
                                     decodedContent = tempContent;
                                     console.log(`[SFTP ${sessionId}] Decoded ${path} as ${encodingUsed} due to low confidence detection.`);
                                }
                            } catch (gbkError) {
                                console.warn(`[SFTP ${sessionId}] Error decoding as GB18030, falling back to original detection (${normalizedDetected}) or UTF-8:`, gbkError);
                                // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                if (iconv.encodingExists(normalizedDetected)) {
                                    encodingUsed = normalizedDetected;
                                    decodedContent = iconv.decode(fileData, encodingUsed);
                                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
                                } else {
                                    encodingUsed = 'utf-8';
                                    decodedContent = fileData.toString('utf8');
                                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                                }
                            }
                        } else if (iconv.encodingExists(normalizedDetected)) {
                            // Higher confidence, non-Chinese, supported encoding
                            encodingUsed = normalizedDetected;
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from ${encodingUsed} using iconv-lite (high confidence).`);
                        } else {
                            console.warn(`[SFTP ${sessionId}] Unsupported or unknown encoding detected for ${path}: ${normalizedDetected}. Falling back to UTF-8.`);
                            encodingUsed = 'utf-8'; // Final fallback
                            decodedContent = fileData.toString('utf8');
                        }
                    }

                    // Final check for replacement characters after deciding the encoding
                    if (decodedContent.includes('\uFFFD')) {
                         console.warn(`[SFTP ${sessionId}] Final decoded content for ${path} (using ${encodingUsed}) contains replacement characters (U+FFFD). Decoding might be incorrect. (ID: ${requestId})`);
                         // decodeError = `解码内容可能不正确 (使用 ${encodingUsed})，检测到无效字符。`; // Optionally set error
                    }

                } catch (err: any) {
                    console.error(`[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`, err);
                    decodeError = `文件编码检测或转换失败: ${err.message}`;
                    state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: decodeError, requestId: requestId }));
                    return; // Stop processing
                }

                // 发送 Base64 编码的原始数据和实际使用的编码
                console.log(`[SFTP ${sessionId}] Sending raw content (Base64) and encoding used (${encodingUsed}) for ${path} (ID: ${requestId})`);
                state.ws.send(JSON.stringify({
                    type: 'sftp:readfile:success',
                    path: path,
                    payload: {
                        rawContentBase64: fileData.toString('base64'), // 发送 Base64 字符串
                        encodingUsed: encodingUsed // 发送实际使用的编码
                    },
                    requestId: requestId
                }));
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readFile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 写入文件内容 (支持指定编码) */
    // --- 修改：添加 encoding 参数 ---
    async writefile(sessionId: string, path: string, data: string, requestId: string, encoding?: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 writefile (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
         }
        // --- 修改：使用传入的 encoding 或默认 utf-8 ---
        const targetEncoding = encoding || 'utf-8';
        console.debug(`[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`);
        try {
            // --- 修改：使用 iconv-lite 根据指定编码创建 Buffer ---
            let buffer: Buffer;
            try {
                buffer = iconv.encode(data, targetEncoding);
                console.log(`[SFTP ${sessionId}] Encoded content for ${path} using ${targetEncoding} (Buffer size: ${buffer.length})`);
            } catch (encodeError: any) {
                 console.error(`[SFTP ${sessionId}] Failed to encode content for ${path} with encoding ${targetEncoding} (ID: ${requestId}):`, encodeError);
                 state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `无效的编码或编码失败: ${targetEncoding}`, requestId: requestId }));
                 return;
            }

            console.debug(`[SFTP ${sessionId}] Creating write stream for ${path} (ID: ${requestId})`);
            const writeStream = state.sftp.createWriteStream(path);
            let errorOccurred = false;

            writeStream.on('error', (err: Error) => {
                if (errorOccurred) return; // Prevent sending multiple errors
                errorOccurred = true;
                console.error(`[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件流错误: ${err.message}`, requestId: requestId }));
            });

            // Listen for the 'close' event which indicates the stream has finished writing and the file descriptor is closed.
            writeStream.on('close', () => {
                if (!errorOccurred) {
                    console.log(`[SFTP ${sessionId}] writefile ${path} stream closed successfully (ID: ${requestId}). Fetching updated stats...`);
                    // Get updated stats after writing
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after writefile ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without updated item details
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending writefile success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });

            console.debug(`[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`);
            writeStream.end(buffer); // Start writing and close the stream afterwards
            console.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);

            // Success message is now sent in the 'close' event handler

        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] writefile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件时发生意外错误: ${error.message}`, requestId: requestId }));
         }
    }

    /** 创建目录 */
    async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.mkdir(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] mkdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`);
                    // Get stats for the new directory
                    state.sftp!.lstat(path, (statErr, stats) => {
                         if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: null, requestId: requestId }));
                         } else {
                            const newItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending mkdir success with new item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: newItem, requestId: requestId }));
                         }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] mkdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 删除目录 (强制递归) */
    async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        // 检查 SSH 客户端是否存在，而不是 SFTP 实例
        if (!state || !state.sshClient) {
            console.warn(`[SSH Exec] SSH 客户端未准备好，无法在 ${sessionId} 上执行 rmdir (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: 'SSH 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SSH Exec ${sessionId}] Received rmdir (force) request for ${path} (ID: ${requestId})`);

        // 构建 rm -rf 命令，确保路径被正确引用
        const command = `rm -rf "${path.replace(/"/g, '\\"')}"`; // Basic quoting for paths with spaces/quotes
        console.log(`[SSH Exec ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    console.error(`[SSH Exec ${sessionId}] Failed to start exec for rmdir ${path} (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `执行删除命令失败: ${err.message}`, requestId: requestId }));
                    return;
                }

                let stderrOutput = '';
                stream.stderr.on('data', (data: Buffer) => {
                    stderrOutput += data.toString();
                });

                stream.on('close', (code: number | null, signal: string | null) => {
                    if (code === 0) {
                        console.log(`[SSH Exec ${sessionId}] rmdir ${path} command executed successfully (ID: ${requestId})`);
                        state.ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path: path, requestId: requestId }));
                    } else {
                        const errorMessage = stderrOutput.trim() || `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
                        console.error(`[SSH Exec ${sessionId}] rmdir ${path} command failed (ID: ${requestId}). Code: ${code}, Signal: ${signal}, Stderr: ${stderrOutput}`);
                        state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: ${errorMessage}`, requestId: requestId }));
                    }
                });

                stream.on('data', (data: Buffer) => {
                    // 通常 rm -rf 成功时 stdout 没有输出，但可以记录以防万一
                    console.debug(`[SSH Exec ${sessionId}] rmdir stdout (ID: ${requestId}): ${data.toString()}`);
                });
            });
        } catch (error: any) {
            console.error(`[SSH Exec ${sessionId}] rmdir ${path} caught unexpected error during exec setup (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `执行删除时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 删除文件 */
     async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received unlink request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.unlink(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] unlink ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:success', path: path, requestId: requestId })); // Send specific success type
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] unlink ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 重命名/移动文件或目录 */
     async rename(sessionId: string, oldPath: string, newPath: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 rename (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`);
        try {
            state.sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`);
                    // Get stats for the new path
                    state.sftp!.lstat(newPath, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: null }, requestId: requestId }));
                        } else {
                            const newItem = {
                                filename: newPath.substring(newPath.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending rename success with new item for ${newPath} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: newItem }, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 修改文件/目录权限 */
     async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 chmod (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received chmod request for ${path} to ${mode.toString(8)} (ID: ${requestId})`);
        try {
            state.sftp.chmod(path, mode, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} success (ID: ${requestId}). Fetching updated stats...`);
                    // Get updated stats after chmod
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after chmod ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without updated item details
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending chmod success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] chmod ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }


    /** 获取路径的绝对表示 */
    async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 realpath (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received realpath request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.realpath(path, (err, absPath) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] realpath ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: `获取绝对路径失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] realpath ${path} -> ${absPath} success (ID: ${requestId})`);
                    // 在 payload 中同时发送请求的路径和绝对路径
            state.ws.send(JSON.stringify({ type: 'sftp:realpath:success', path: path, payload: { requestedPath: path, absolutePath: absPath }, requestId: requestId }));
                }
            });
        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] realpath ${path} caught unexpected error (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: `获取绝对路径时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 复制文件或目录 +++
    async copy(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Copy] SFTP 未准备好，无法在 ${sessionId} 上执行 copy (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received copy request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const copiedItemsDetails: any[] = []; // Store details of successfully copied items
        let firstError: Error | null = null;

        try {
            // Ensure destination directory exists
            try {
                await this.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const sourcePath of sources) {
                const sourceName = pathModule.basename(sourcePath);
                const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                if (sourcePath === destPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                }

                try {
                    const stats = await this.getStats(sftp, sourcePath);
                    if (stats.isDirectory()) {
                        console.log(`[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.copyDirectoryRecursive(sftp, sourcePath, destPath);
                    } else if (stats.isFile()) {
                        console.log(`[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.copyFile(sftp, sourcePath, destPath);
                    } else {
                        // Handle symlinks or other types if necessary, for now just skip/warn
                        console.warn(`[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`);
                        continue;
                    }
                    // Get stats of the *newly copied* item
                    const copiedStats = await this.getStats(sftp, destPath);
                    copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));

                } catch (copyErr: any) {
                    console.error(`[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`, copyErr);
                    firstError = copyErr; // Store the first error encountered
                    break; // Stop processing further sources on error
                }
            }

            if (firstError) {
                throw firstError; // Throw the first error to be caught below
            }

            // Send success message with details of copied items
            console.log(`[SFTP ${sessionId}] Copy operation completed successfully (ID: ${requestId}). Copied items: ${copiedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:copy:success',
                payload: { destination: destinationDir, items: copiedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Copy operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: `复制操作失败: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 移动文件或目录 +++
    async move(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const movedItemsDetails: any[] = [];
        let firstError: Error | null = null;

        try {
             // Ensure destination directory exists (important for move)
            try {
                await this.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const oldPath of sources) {
                const sourceName = pathModule.basename(oldPath);
                const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                 if (oldPath === newPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                 }

                try {
                    // --- 移动前检查目标是否存在 ---
                    let targetExists = false;
                    try {
                        await this.getStats(sftp, newPath);
                        targetExists = true;
                    } catch (statErr: any) {
                        if (!(statErr.code === 'ENOENT' || (statErr.message && statErr.message.includes('No such file')))) {
                            // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
                            throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErr.message}`);
                        }
                        // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
                    }

                    if (targetExists) {
                        console.error(`[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`);
                        throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
                    }
                    // --- 结束新增 ---

                    console.log(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
                    await this.performRename(sftp, oldPath, newPath); // Use helper for rename logic

                    // Get stats of the *moved* item at the new location
                    const movedStats = await this.getStats(sftp, newPath);
                    movedItemsDetails.push(this.formatStatsToFileListItem(newPath, movedStats));

                } catch (moveErr: any) {
                    console.error(`[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`, moveErr);
                    firstError = moveErr;
                    break; // Stop on first error for move
                }
            }

            if (firstError) {
                throw firstError;
            }

            console.log(`[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:move:success',
                payload: { sources: sources, destination: destinationDir, items: movedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: `移动操作失败: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 辅助方法 - 复制文件 +++
    private copyFile(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const readStream = sftp.createReadStream(sourcePath);
            const writeStream = sftp.createWriteStream(destPath);
            let errorOccurred = false;

            const onError = (err: Error) => {
                if (errorOccurred) return;
                errorOccurred = true;
                // Ensure streams are destroyed on error
                readStream.destroy();
                writeStream.destroy();
                console.error(`Error copying file ${sourcePath} to ${destPath}:`, err);
                reject(new Error(`复制文件失败: ${err.message}`));
            };

            readStream.on('error', onError);
            writeStream.on('error', onError);

            writeStream.on('close', () => { // Use 'close' for write stream completion
                if (!errorOccurred) {
                    resolve();
                }
            });

            readStream.pipe(writeStream);
        });
    }

    // +++ 辅助方法 - 递归复制目录 +++
    private async copyDirectoryRecursive(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
        try {
            // Create destination directory
            await this.ensureDirectoryExists(sftp, destPath);

            // Read source directory contents
            const items = await this.listDirectory(sftp, sourcePath);

            for (const item of items) {
                const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
                const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
                const itemStats = item.attrs; // Assuming readdir provides stats

                if (itemStats.isDirectory()) {
                    await this.copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath);
                } else if (itemStats.isFile()) {
                    await this.copyFile(sftp, currentSourcePath, currentDestPath);
                } else {
                    console.warn(`[SFTP Copy Recurse] Skipping unsupported type: ${currentSourcePath}`);
                }
            }
        } catch (error: any) {
            console.error(`Error recursively copying directory ${sourcePath} to ${destPath}:`, error);
            throw new Error(`递归复制目录失败: ${error.message}`);
        }
    }

     // +++ 辅助方法 - 获取 Stats (Promise wrapper) +++
    private getStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
        return new Promise((resolve, reject) => {
            sftp.lstat(path, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stats);
                }
            });
        });
    }

    // +++ 修改：辅助方法 - 确保目录存在 (递归创建) +++
    private async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
        // 规范化路径，移除尾部斜杠（如果存在）
        const normalizedPath = dirPath.replace(/\/$/, '');
        if (!normalizedPath || normalizedPath === '/') {
            return; // 根目录不需要创建
        }

        try {
            // 1. 尝试直接 stat 目录
            await this.getStats(sftp, normalizedPath);
            // console.log(`[SFTP Util] Directory already exists: ${normalizedPath}`);
            return; // 目录已存在
        } catch (statError: any) {
            // 2. 如果 stat 失败，检查是否是 "No such file" 错误
            if (statError.code === 'ENOENT' || (statError.message && statError.message.includes('No such file'))) {
                // 目录不存在，尝试创建
                try {
                    // 3. 尝试递归创建 (ssh2 的 mkdir 支持非标准 recursive 属性)
                    // 注意：这可能不适用于所有 SFTP 服务器
                    await new Promise<void>((resolveMkdir, rejectMkdir) => {
                        // @ts-ignore - ssh2 types might not include 'recursive' in attributes
                        sftp.mkdir(normalizedPath, { recursive: true }, (mkdirErr) => {
                            if (mkdirErr) {
                                // 如果递归创建失败，尝试逐级创建
                                console.warn(`[SFTP Util] Recursive mkdir failed for ${normalizedPath}, falling back to iterative creation:`, mkdirErr);
                                rejectMkdir(mkdirErr); // Reject to trigger fallback
                            } else {
                                console.log(`[SFTP Util] Recursively created directory: ${normalizedPath}`);
                                resolveMkdir();
                            }
                        });
                    });
                    return; // 递归创建成功
                } catch (recursiveMkdirError) {
                    // 4. 递归创建失败，回退到逐级创建
                    const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
                    if (parentDir && parentDir !== '/' && parentDir !== '.') {
                        // 递归确保父目录存在
                        await this.ensureDirectoryExists(sftp, parentDir);
                    }
                    // 创建当前目录
                    try {
                        await new Promise<void>((resolveMkdir, rejectMkdir) => {
                             sftp.mkdir(normalizedPath, (mkdirErr) => {
                                if (mkdirErr) {
                                    // 如果逐级创建也失败，则抛出错误
                                    rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
                                } else {
                                    console.log(`[SFTP Util] Iteratively created directory: ${normalizedPath}`);
                                    resolveMkdir();
                                }
                            });
                        });
                    } catch (iterativeMkdirError: any) {
                         console.error(`[SFTP Util] Iterative mkdir failed for ${normalizedPath}:`, iterativeMkdirError);
                         // 检查是否是因为目录已存在（可能由并发操作创建）
                         try {
                             const finalStats = await this.getStats(sftp, normalizedPath);
                             if (!finalStats.isDirectory()) {
                                 throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
                             }
                             // 如果目录现在存在，则忽略错误
                             console.log(`[SFTP Util] Directory ${normalizedPath} exists after iterative mkdir failure, likely created concurrently.`);
                         } catch (finalStatError) {
                             // 如果最终检查也失败，则抛出原始的逐级创建错误
                             throw iterativeMkdirError;
                         }
                    }
                }
            } else {
                // 其他 stat 错误
                throw new Error(`检查目录失败 ${normalizedPath}: ${statError.message}`);
            }
        }
    }

     // +++ 辅助方法 - 列出目录内容 (Promise wrapper) +++
    private listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> { // 使用本地接口 SftpDirEntry
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => { // list 的类型现在是 SftpDirEntry[]
                if (err) {
                    reject(err);
                } else {
                    resolve(list);
                }
            });
        });
    }

     // +++ 辅助方法 - 执行重命名 (Promise wrapper) +++
    private performRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // +++ 辅助方法 - 格式化 Stats 为 FileListItem +++
    private formatStatsToFileListItem(itemPath: string, stats: Stats): any {
         return {
            filename: pathModule.basename(itemPath),
            longname: '', // stat doesn't provide longname, maybe generate a basic one?
            attrs: {
                size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
            }
        };
    }


    // --- File Upload Methods ---

    /** Start a new file upload */
    // --- 修改：添加 relativePath 参数 ---
    async startUpload(sessionId: string, uploadId: string, remotePath: string, totalSize: number, relativePath?: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] SFTP not ready for session ${sessionId}.`);
            state?.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'SFTP 会话未就绪' } }));
            return;
        }
        if (this.activeUploads.has(uploadId)) {
            console.warn(`[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'Upload already started' } }));
            return;
        }

        console.log(`[SFTP Upload ${uploadId}] Starting upload for ${remotePath} (${totalSize} bytes) in session ${sessionId}`);

        try {
            // --- 在创建流之前确保目录存在 ---
            if (relativePath) {
                const targetDirectory = pathModule.dirname(remotePath).replace(/\\/g, '/');
                console.log(`[SFTP Upload ${uploadId}] Ensuring directory exists: ${targetDirectory}`);
                try {
                    // 确保 state.sftp 存在
                    if (!state.sftp) throw new Error('SFTP session is not available.');
                    await this.ensureDirectoryExists(state.sftp, targetDirectory);
                    console.log(`[SFTP Upload ${uploadId}] Directory ensured: ${targetDirectory}`); // +++ 增加成功日志 +++
                } catch (dirError: any) {
                    console.error(`[SFTP Upload ${uploadId}] Failed to create/ensure directory ${targetDirectory}:`, dirError);
                    state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `创建目录失败: ${dirError.message}` } }));
                    // 不再删除 activeUploads，因为可能还没有创建
                    return; // Stop the upload process
                }
            }
            // --- 结束新增 ---

            // --- 预检查文件是否可写 ---
            console.log(`[SFTP Upload ${uploadId}] Pre-checking writability for: ${remotePath}`);
            try {
                // 确保 state.sftp 存在
                if (!state.sftp) throw new Error('SFTP session is not available.');
                await new Promise<void>((resolve, reject) => {
                    // 'w' flag: Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
                    state.sftp!.open(remotePath, 'w', (openErr, handle) => {
                        if (openErr) {
                            console.error(`[SFTP Upload ${uploadId}] Pre-check failed (sftp.open 'w') for ${remotePath}:`, openErr);
                            return reject(openErr); // Reject if cannot open for writing
                        }
                        // Immediately close the handle, we just wanted to check writability
                        state.sftp!.close(handle, (closeErr) => {
                            if (closeErr) {
                                // Log warning but don't fail the pre-check if closing fails
                                console.warn(`[SFTP Upload ${uploadId}] Error closing handle during pre-check for ${remotePath}:`, closeErr);
                            }
                            console.log(`[SFTP Upload ${uploadId}] Pre-check successful for: ${remotePath}`);
                            resolve();
                        });
                    });
                });
            } catch (preCheckError: any) {
                 console.error(`[SFTP Upload ${uploadId}] Writability pre-check failed for ${remotePath}:`, preCheckError);
                 state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `文件不可写或创建失败: ${preCheckError.message}` } }));
                 return; // Stop if pre-check fails
            }
            // --- 结束新增 ---


            console.log(`[SFTP Upload ${uploadId}] Creating write stream for: ${remotePath}`);
            // 确保 state.sftp 存在
            if (!state.sftp) throw new Error('SFTP session is not available after pre-check.');
            const stream = state.sftp.createWriteStream(remotePath);
            const uploadState: ActiveUpload = {
                remotePath,
                totalSize,
                bytesWritten: 0,
                stream,
                sessionId,
                relativePath, // +++ 存储 relativePath +++
            };
            this.activeUploads.set(uploadId, uploadState);

            stream.on('error', (err: Error) => {
                console.error(`[SFTP Upload ${uploadId}] Write stream error for ${remotePath}:`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `写入流错误: ${err.message}` } }));
                this.activeUploads.delete(uploadId); // Clean up state on error
            });

            stream.on('close', () => {
                console.log(`[SFTP Upload ${uploadId}] Write stream 'close' event triggered for ${remotePath}.`);
                const finalState = this.activeUploads.get(uploadId);
                if (finalState) {
                    // Check if the upload *should* have completed successfully based on bytes written
                    if (finalState.bytesWritten >= finalState.totalSize) {
                        console.log(`[SFTP Upload ${uploadId}] Stream closed and bytesWritten >= totalSize. Fetching final stats...`);
                        // Get final stats *after* the stream is closed
                        state.sftp!.lstat(finalState.remotePath, (statErr, stats) => {
                            if (statErr) {
                                console.error(`[SFTP Upload ${uploadId}] lstat after stream close ${finalState.remotePath} failed:`, statErr);
                                // Send error if lstat fails after close
                                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `获取最终文件状态失败: ${statErr.message}` } }));
                            } else {
                                // Ensure the size matches what we expect (or is at least the total size)
                                if (stats.size < finalState.totalSize) {
                                     console.error(`[SFTP Upload ${uploadId}] Final file size (${stats.size}) is less than expected total size (${finalState.totalSize}) after stream close.`);
                                     state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `最终文件大小 (${stats.size}) 小于预期 (${finalState.totalSize})` } }));
                                } else {
                                    const finalStatsPayload = {
                                        filename: finalState.remotePath.substring(finalState.remotePath.lastIndexOf('/') + 1),
                                        longname: '',
                                        attrs: {
                                            size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                            atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                            isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                        }
                                    };
                                    console.log(`[SFTP Upload ${uploadId}] Upload appears complete. Final size: ${stats.size}. Sending success message NOW.`);
                                    // *** SEND SUCCESS MESSAGE HERE ***
                                    state.ws.send(JSON.stringify({ type: 'sftp:upload:success', payload: finalStatsPayload, uploadId: uploadId, path: finalState.remotePath }));
                                }
                            }
                            // Clean up state regardless of lstat success/failure after close
                            this.activeUploads.delete(uploadId);
                        });
                    } else {
                         // Stream closed, but not all bytes were written (likely due to cancellation or error)
                         console.warn(`[SFTP Upload ${uploadId}] Write stream closed, but written bytes (${finalState.bytesWritten}) < total size (${finalState.totalSize}). Upload likely failed or was cancelled before completion.`);
                         this.activeUploads.delete(uploadId); // Clean up state
                    }
                } else {
                     console.log(`[SFTP Upload ${uploadId}] Write stream closed, but upload state was already removed (likely cancelled earlier).`);
                }
            });

             stream.on('finish', () => {
                 // The 'finish' event fires when stream.end() is called and all data has been flushed.
                 console.log(`[SFTP Upload ${uploadId}] Write stream 'finish' event triggered for ${remotePath}. Waiting for 'close'.`);
             });


            // Notify client that we are ready for chunks
            state.ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId } }));

        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `开始上传时出错: ${error.message}` } }));
            this.activeUploads.delete(uploadId); // Clean up if start failed
        }
    }

    /** Handle an incoming file chunk */
    // --- FIX: Make async to handle await for drain ---
    async handleUploadChunk(sessionId: string, uploadId: string, chunkIndex: number, dataBase64: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state || !state.sftp) {
            // Session or SFTP gone, can't process chunk. Upload might be cleaned up elsewhere.
            console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but session ${sessionId} or SFTP is invalid.`);
            this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but no active upload found.`);
            // Send error back to client? Might flood if many chunks arrive after cancellation.
            // state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '无效的上传 ID 或上传已取消/完成' } }));
            return;
        }

        try {
            const chunkBuffer = Buffer.from(dataBase64, 'base64');
            // console.debug(`[SFTP Upload ${uploadId}] Writing chunk ${chunkIndex} (${chunkBuffer.length} bytes) to ${uploadState.remotePath}`);

            // Write the chunk. The 'drain' event is handled automatically by Node.js streams
            // if the write buffer is full. We just write.
            const writeSuccess = uploadState.stream.write(chunkBuffer, (err) => {
                 if (err) {
                     // This callback handles errors specifically related to *this* write operation.
                     console.error(`[SFTP Upload ${uploadId}] Error writing chunk ${chunkIndex} to ${uploadState.remotePath}:`, err);
                     state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `写入块 ${chunkIndex} 失败: ${err.message}` } }));
                     // Consider cancelling the upload on write error
                     this.cancelUploadInternal(uploadId, `Write error on chunk ${chunkIndex}`);
                 }
                 // else { console.debug(`[SFTP Upload ${uploadId}] Chunk ${chunkIndex} write callback success.`); }
            });

            if (!writeSuccess) {
                // This indicates the buffer is full and we should wait for 'drain'.
                // However, for simplicity in this WebSocket context, we might rely on TCP backpressure
                // or simply continue writing, letting the stream buffer handle it.
                // Adding explicit 'drain' handling can add complexity.
                console.warn(`[SFTP Upload ${uploadId}] Write stream buffer full after chunk ${chunkIndex}. Waiting for drain is recommended for large files/slow connections.`);
            }


            // --- FIX: Handle backpressure ---
            if (!writeSuccess) {
                console.warn(`[SFTP Upload ${uploadId}] Write stream buffer full after chunk ${chunkIndex}. Pausing chunk processing until 'drain'.`);
                try {
                    await new Promise<void>(resolve => uploadState.stream.once('drain', resolve));
                    console.log(`[SFTP Upload ${uploadId}] Write stream drained after chunk ${chunkIndex}. Resuming chunk processing.`);
                } catch (drainError) {
                     // Should not happen with .once, but handle defensively
                     console.error(`[SFTP Upload ${uploadId}] Error waiting for drain event:`, drainError);
                     // Consider cancelling upload if waiting for drain fails critically
                     this.cancelUploadInternal(uploadId, 'Error waiting for drain');
                     throw drainError; // Re-throw to stop further processing in this chunk handler
                }
            }
            // --- End Backpressure Fix ---


            // --- FIX: Handle backpressure ---
            if (!writeSuccess) {
                console.warn(`[SFTP Upload ${uploadId}] Write stream buffer full after chunk ${chunkIndex}. Pausing chunk processing until 'drain'.`);
                try {
                    await new Promise<void>(resolve => uploadState.stream.once('drain', resolve));
                    console.log(`[SFTP Upload ${uploadId}] Write stream drained after chunk ${chunkIndex}. Resuming chunk processing.`);
                } catch (drainError) {
                     // Should not happen with .once, but handle defensively
                     console.error(`[SFTP Upload ${uploadId}] Error waiting for drain event:`, drainError);
                     // Consider cancelling upload if waiting for drain fails critically
                     this.cancelUploadInternal(uploadId, 'Error waiting for drain');
                     throw drainError; // Re-throw to stop further processing in this chunk handler
                }
            }
            // --- End Backpressure Fix ---


            uploadState.bytesWritten += chunkBuffer.length;

            // Send progress (optional, consider throttling)
            // const progress = Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100);
            // state.ws.send(JSON.stringify({ type: 'sftp:upload:progress', payload: { uploadId, progress } }));

            // Check if upload is complete
            if (uploadState.bytesWritten > uploadState.totalSize) {
                 console.error(`[SFTP Upload ${uploadId}] Bytes written (${uploadState.bytesWritten}) exceeded total size (${uploadState.totalSize}) for ${uploadState.remotePath}.`);
                 state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '写入字节数超过文件总大小' } }));
                 this.cancelUploadInternal(uploadId, 'Bytes written exceeded total size');

            // --- FIX: Check if bytesWritten is >= totalSize ---
            } else if (uploadState.bytesWritten >= uploadState.totalSize) {
                 // Prevent this block from running multiple times if more data arrives somehow
                 if (!uploadState.stream.writableEnded) {
                    console.log(`[SFTP Upload ${uploadId}] All expected bytes received (or exceeded). Written: ${uploadState.bytesWritten}, Total: ${uploadState.totalSize}. Ending stream.`);
                    // End the stream now that all data is received
                    uploadState.stream.end((endErr: Error | undefined) => {
                        if (endErr) {
                            console.error(`[SFTP Upload ${uploadId}] Error ending write stream for ${uploadState.remotePath}:`, endErr);
                            // If ending fails, send an error (the 'close' event might not fire reliably after error)
                            if (state && state.ws) { // Check if state and ws still exist
                                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `结束写入流时出错: ${endErr.message}` } }));
                            }
                            this.cancelUploadInternal(uploadId, `Stream end error`);
                        } else {
                            console.log(`[SFTP Upload ${uploadId}] stream.end() called successfully. Waiting for 'close' event.`);
                            // Success message will be sent in the 'close' handler
                        }
                    });
                 }
            }

        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error handling chunk ${chunkIndex} for ${uploadState?.remotePath}:`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `处理块 ${chunkIndex} 时出错: ${error.message}` } }));
            this.cancelUploadInternal(uploadId, `Error handling chunk ${chunkIndex}`);
        }
    }

    /** Cancel an ongoing upload */
    cancelUpload(sessionId: string, uploadId: string): void {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state) {
            console.warn(`[SFTP Upload ${uploadId}] Request to cancel, but session ${sessionId} not found.`);
            // Can't send message back if session is gone
            this.cancelUploadInternal(uploadId, 'Session not found'); // Clean up if state exists
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Request to cancel, but no active upload found.`);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '无效的上传 ID 或上传已取消/完成' } }));
            return;
        }

        console.log(`[SFTP Upload ${uploadId}] Cancelling upload for ${uploadState.remotePath}`);
        this.cancelUploadInternal(uploadId, 'User cancelled');
        state.ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId } }));
    }

    /** Internal helper to clean up an upload */
    private cancelUploadInternal(uploadId: string, reason: string): void {
        const uploadState = this.activeUploads.get(uploadId);
        if (uploadState) {
            console.log(`[SFTP Upload ${uploadId}] Internal cancel (${reason}): Closing stream for ${uploadState.remotePath}`);
            // End the stream. The 'close' handler should ideally detect the size mismatch or see the state is gone.
            // Using destroy might be more immediate but could lead to unclosed file descriptors on the server in some cases.
            uploadState.stream.end(); // Gracefully try to end
            // uploadState.stream.destroy(); // More forceful, might be needed
            this.activeUploads.delete(uploadId);
        } else {
            // console.log(`[SFTP Upload ${uploadId}] Internal cancel called, but upload state already removed.`);
        }
    }
}
