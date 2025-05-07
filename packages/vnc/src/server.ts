// @ts-ignore - Still need this for the import as no types exist
import GuacamoleLite from 'guacamole-lite';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import cors from 'cors';


// --- 配置 ---
const GUAC_WS_PORT = process.env.VNC_WS_PORT || 8082;
const API_PORT = process.env.VNC_PORT || 9091;
const GUACD_HOST = process.env.GUACD_HOST || 'localhost';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822', 10);

// --- 启动时生成内存加密密钥 ---
console.log("正在为此会话生成新的内存加密密钥...");
const ENCRYPTION_KEY_STRING = crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
console.log("内存加密密钥已生成。");

// --- Express 应用设置 ---
const app = express();
const apiServer = http.createServer(app);

const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.MAIN_BACKEND_URL || 'http://localhost:3000'
];
app.use(cors({ origin: allowedOrigins }));


const guacdOptions = {
    host: GUACD_HOST,
    port: GUACD_PORT,
};

const websocketOptions = {
    port: GUAC_WS_PORT,
    host: '0.0.0.0',
};

const clientOptions = {
    crypt: {
        // 将实际的密钥 Buffer 传递给 guacamole-lite 用于其内部加密操作
        key: ENCRYPTION_KEY_BUFFER,
        cypher: 'aes-256-cbc' // 确保加密和解密之间的密码算法一致
    },
    // 默认连接设置
    connectionDefaultSettings: {
        // VNC 通常不需要像 RDP 那样的特定默认连接设置
        // 参数将主要通过 API 请求提供
    },
};

let guacServer: any;

try {
    console.log(`[VNC 服务] 正在使用选项初始化 GuacamoleLite: WS 端口=${websocketOptions.port}, Guacd=${guacdOptions.host}:${guacdOptions.port}`);
    guacServer = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions);
    console.log(`[VNC 服务] GuacamoleLite 初始化成功。`);

    if (guacServer.on) {
        guacServer.on('error', (error: Error) => {
            console.error(`[VNC 服务] GuacamoleLite 服务器错误:`, error);
        });
        guacServer.on('connection', (client: any) => {
            const clientId = client.id || '未知客户端ID';
            console.log(`[VNC 服务] Guacd 连接事件触发。客户端 ID: ${clientId}`);


            if (client && typeof client.on === 'function') {
                client.on('disconnect', (reason: string) => {
                    console.log(`[VNC 服务] Guacd 连接断开。客户端 ID: ${clientId}, 原因: ${reason || '未知'}`);
                });
                client.on('error', (err: Error) => {
                     console.error(`[VNC 服务] Guacd 客户端错误。客户端 ID: ${clientId}, 错误:`, err);
                });

                client.on('message', (message: Buffer | string) => {
                    // 在回滚状态下移除了消息处理
                });

            } else {
                 // 对没有 'on' 方法的客户端进行最小化处理
            }
        });
   }
} catch (error) {
   console.error(`[VNC 服务] 初始化 GuacamoleLite 失败:`, error);
   process.exit(1);
}

// 更新了 encryptToken 以匹配 guacamole-lite 期望的格式 (aes-256-cbc 和特定的 JSON 结构)
// 现在直接接受密钥 Buffer 以进行正确的加密操作
const encryptToken = (data: string, keyBuffer: Buffer): string => {
    try {
        const iv = crypto.randomBytes(16); // AES-CBC 通常使用 16 字节的 IV
        // 使用密钥 Buffer 进行 Node.js 加密操作
        const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);

        let encrypted = cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        // 构建 guacamole-lite 的解密函数期望的 JSON 对象
        const output = {
            iv: iv.toString('base64'),
            value: encrypted
        };

        // 将 JSON 字符串化，然后对整个字符串进行 Base64 编码
        const jsonString = JSON.stringify(output);
        return Buffer.from(jsonString).toString('base64');

    } catch (e) {
        console.error("令牌加密失败:", e);
        throw new Error("令牌加密失败。");
    }
};



// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/api/get-vnc-token', (req: any, res: any) => {
    const { hostname, port, password } = req.query; // VNC 主要参数

    if (!hostname || !port || typeof password === 'undefined') {
        return res.status(400).json({ error: '缺少必需的 VNC 参数 (hostname, port, password)' });
    }

    const connectionParams: any = { // 使用 any 类型以允许动态添加参数
        connection: {
            type: 'vnc',
            settings: {
                hostname: hostname as string,
                port: port as string,
                password: password as string,
                // 从查询中包含动态（或默认）的大小参数
                width: String(req.query.width || '1024'),
                height: String(req.query.height || '768'),
                // VNC 特有的参数可以根据需要在这里添加
                // 例如: 'username': req.query.username (如果 VNC 服务器需要)
            }
        }
    };
    
    // 如果提供了 username，则添加到 settings 中
    if (req.query.username) {
        connectionParams.connection.settings.username = req.query.username as string;
    }
    
    // Guacamole VNC 支持的其他参数可以类似地添加
    // 例如: 'enable-audio': req.query.enableAudio || 'false'

    try {
        const tokenData = JSON.stringify(connectionParams);
        const encryptedToken = encryptToken(tokenData, ENCRYPTION_KEY_BUFFER);
        res.json({ token: encryptedToken });
    } catch (error) {
        console.error("/api/get-vnc-token 接口出错:", error);
        res.status(500).json({ error: '生成令牌失败' });
    }
});

apiServer.listen(API_PORT, () => {
    console.log(`[VNC 服务] API 服务器正在监听端口 ${API_PORT}`);
    console.log(`[VNC 服务] Guacamole WebSocket 服务器应在端口 ${GUAC_WS_PORT} 上运行 (由 GuacamoleLite 管理)`);
});

const gracefulShutdown = (signal: string) => {
    console.log(`收到 ${signal} 信号。正在优雅地关闭...`);

  let guacClosed = false;
  let apiClosed = false;

  const tryExit = () => {
    if (guacClosed && apiClosed) {
      console.log("所有服务器已关闭。正在退出。");
      process.exit(0);
    }
  };

  apiServer.close((err) => {
    if (err) {
        console.error("关闭 API 服务器时出错:", err);
    } else {
        console.log("API 服务器已关闭。");
    }
    apiClosed = true;
    tryExit();
  });

  // @ts-ignore - 假设基于通用模式存在 close 方法
  if (typeof guacServer !== 'undefined' && guacServer && typeof guacServer.close === 'function') {
    console.log("正在关闭 Guacamole 服务器..."); // 添加了关闭日志
    // @ts-ignore
    guacServer.close(() => {
        console.log("Guacamole 服务器已关闭。"); // 添加了关闭日志
        guacClosed = true;
        tryExit();
    });
  } else {
    console.log("Guacamole 服务器未运行或不支持 close() 方法。");
    guacClosed = true;
    tryExit();
  }

  // 超时后强制退出
  setTimeout(() => {
    console.error("关闭超时。强制退出。");
    process.exit(1);
  }, 10000); // 10 秒超时
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('SIGUSR2', () => {
    gracefulShutdown('SIGUSR2 (nodemon restart)');
});