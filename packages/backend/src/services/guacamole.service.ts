import axios from 'axios';
import { ConnectionWithTags } from '../types/connection.types';

// RDP 后端服务的 Base URL
const RDP_BACKEND_API_BASE = process.env.DEPLOYMENT_MODE === 'local'
    ? (process.env.RDP_BACKEND_API_BASE_LOCAL || 'http://localhost:9090')
    : (process.env.RDP_BACKEND_API_BASE_DOCKER || 'http://nexus-rdp:9090');

console.log(`[GuacamoleService] DEPLOYMENT_MODE: ${process.env.DEPLOYMENT_MODE}`);
console.log(`[GuacamoleService] RDP_BACKEND_API_BASE_LOCAL: ${process.env.RDP_BACKEND_API_BASE_LOCAL}`);
console.log(`[GuacamoleService] RDP_BACKEND_API_BASE_DOCKER: ${process.env.RDP_BACKEND_API_BASE_DOCKER}`);
console.log(`[GuacamoleService] Using RDP Backend API Base: ${RDP_BACKEND_API_BASE}`);
    

// VNC 后端服务的 Base URL
const VNC_BACKEND_API_BASE = process.env.DEPLOYMENT_MODE === 'local'
    ? (process.env.VNC_BACKEND_API_BASE_LOCAL || 'http://localhost:9091')
    : (process.env.VNC_BACKEND_API_BASE_DOCKER || 'http://nexus-vnc:9091');

console.log(`[GuacamoleService] VNC_BACKEND_API_BASE_LOCAL: ${process.env.VNC_BACKEND_API_BASE_LOCAL}`);
console.log(`[GuacamoleService] VNC_BACKEND_API_BASE_DOCKER: ${process.env.VNC_BACKEND_API_BASE_DOCKER}`);
console.log(`[GuacamoleService] Using VNC Backend API Base: ${VNC_BACKEND_API_BASE}`);

/**
 * 从 RDP 后端服务获取 Guacamole 令牌
 * @param connection 连接对象
 * @param decryptedPassword 解密后的密码
 * @returns Guacamole 令牌
 */
export const getRdpToken = async (connection: ConnectionWithTags, decryptedPassword?: string): Promise<string> => {
    if (connection.type !== 'RDP') {
        throw new Error('连接类型必须是 RDP。');
    }
    if (connection.auth_method !== 'password' || !decryptedPassword) {
        console.warn(`[GuacamoleService:getRdpToken] RDP connection ${connection.id} does not use password auth or password decryption failed.`);
        throw new Error('RDP 连接需要使用密码认证，或密码解密失败。');
    }

    const rdpApiParams = new URLSearchParams({
        hostname: connection.host,
        port: connection.port.toString(),
        username: connection.username,
        password: decryptedPassword,
        // 确保传递 RDP 特定的参数，如果存在的话
        security: (connection as any).rdp_security || 'any', // 从连接对象中获取，如果存在
        ignoreCert: String((connection as any).rdp_ignore_cert ?? true), // 从连接对象中获取，如果存在
        // 可以根据需要添加更多参数，例如 domain, width, height, dpi 等
    });
    const rdpTokenUrl = `${RDP_BACKEND_API_BASE}/api/get-token?${rdpApiParams.toString()}`;

    console.log(`[GuacamoleService:getRdpToken] Calling RDP backend API: ${RDP_BACKEND_API_BASE}/api/get-token?... for connection ${connection.id}`);

    try {
        const rdpResponse = await axios.get<{ token: string }>(rdpTokenUrl, {
            timeout: 10000 // 10 秒超时
        });

        if (rdpResponse.status !== 200 || !rdpResponse.data?.token) {
            console.error(`[GuacamoleService:getRdpToken] RDP backend API call failed or returned invalid data. Status: ${rdpResponse.status}`, rdpResponse.data);
            throw new Error('从 RDP 后端获取令牌失败。');
        }
        console.log(`[GuacamoleService:getRdpToken] Received Guacamole token from RDP backend for connection ${connection.id}`);
        return rdpResponse.data.token;
    } catch (error: any) {
        console.error(`[GuacamoleService:getRdpToken] Error calling RDP backend for connection ${connection.id}:`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`调用 RDP 后端服务失败 (状态: ${error.response.status}): ${error.response.data?.message || error.message}`);
        }
        throw new Error(`调用 RDP 后端服务时发生错误: ${error.message}`);
    }
};

/**
 * 从 VNC 后端服务获取 Guacamole 令牌
 * @param connection 连接对象
 * @param decryptedPassword 解密后的密码 (VNC 通常需要密码)
 * @returns Guacamole 令牌
 */
export const getVncToken = async (connection: ConnectionWithTags, decryptedPassword?: string, width?: number, height?: number): Promise<string> => {
    if (connection.type !== 'VNC') {
        throw new Error('连接类型必须是 VNC。');
    }
    // VNC 通常总是需要密码，并且 auth_method 应该被设置为 'password'
    if (connection.auth_method !== 'password' || !decryptedPassword) {
        console.warn(`[GuacamoleService:getVncToken] VNC connection ${connection.id} does not use password auth or password decryption failed.`);
        throw new Error('VNC 连接需要使用密码认证，或密码解密失败。');
    }

    const vncApiParams = new URLSearchParams({
        hostname: connection.host,
        port: connection.port.toString(),
        password: decryptedPassword, // VNC 通常只需要密码
        // VNC 特有的参数可以根据 @nexus-terminal/vnc 的 API 进行添加
        // 例如: username (如果 VNC 服务器需要), colorDepth, etc.
        // username: connection.username, // 如果 VNC 服务支持用户名
    });

    if (width !== undefined) {
        vncApiParams.append('width', String(width));
    }
    if (height !== undefined) {
        vncApiParams.append('height', String(height));
    }

    // 如果 VNC 服务也支持用户名，可以取消注释上面的 username 参数
    // 注意：标准的 VNC 协议主要通过密码进行认证，用户名不是标准部分，但某些实现可能支持。
    // 这里假设 @nexus-terminal/vnc 的 /api/get-vnc-token 接受这些参数。

    const vncTokenUrl = `${VNC_BACKEND_API_BASE}/api/get-vnc-token?${vncApiParams.toString()}`;

    console.log(`[GuacamoleService:getVncToken] Calling VNC backend API: ${VNC_BACKEND_API_BASE}/api/get-vnc-token?... for connection ${connection.id}`);

    try {
        const vncResponse = await axios.get<{ token: string }>(vncTokenUrl, {
            timeout: 10000 // 10 秒超时
        });

        if (vncResponse.status !== 200 || !vncResponse.data?.token) {
            console.error(`[GuacamoleService:getVncToken] VNC backend API call failed or returned invalid data. Status: ${vncResponse.status}`, vncResponse.data);
            throw new Error('从 VNC 后端获取令牌失败。');
        }
        console.log(`[GuacamoleService:getVncToken] Received Guacamole token from VNC backend for connection ${connection.id}`);
        return vncResponse.data.token;
    } catch (error: any) {
        console.error(`[GuacamoleService:getVncToken] Error calling VNC backend for connection ${connection.id}:`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`调用 VNC 后端服务失败 (状态: ${error.response.status}): ${error.response.data?.message || error.message}`);
        }
        throw new Error(`调用 VNC 后端服务时发生错误: ${error.message}`);
    }
};
