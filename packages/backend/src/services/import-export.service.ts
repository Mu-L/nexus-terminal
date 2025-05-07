
import * as ConnectionRepository from '../repositories/connection.repository';
import * as ProxyRepository from '../repositories/proxy.repository';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';



interface ImportedConnectionData {
    name: string;
    type: 'SSH' | 'RDP' | 'VNC'; // Add type field
    host: string;
    port: number;
    username: string;
    auth_method: 'password' | 'key';
    encrypted_password?: string | null;
    encrypted_private_key?: string | null;
    encrypted_passphrase?: string | null;
    tag_ids?: number[];
    proxy?: {
        name: string;
        type: 'SOCKS5' | 'HTTP';
        host: string;
        port: number;
        username?: string | null;
        auth_method?: 'none' | 'password' | 'key';
        encrypted_password?: string | null;
        encrypted_private_key?: string | null;
        encrypted_passphrase?: string | null;
    } | null;
}
interface ExportedConnectionData extends Omit<ImportedConnectionData, 'id'> {}
export interface ImportResult {
    successCount: number;
    failureCount: number;
    errors: { connectionName?: string; message: string }[];
}


/**
 * 导出所有连接配置
 */
export const exportConnections = async (): Promise<ExportedConnectionData[]> => {
    try {
        const db = await getDbInstance();

        // Ensure ExportRow reflects the updated FullConnectionData (which now includes 'type')
        type ExportRow = ConnectionRepository.FullConnectionData & {
             proxy_db_id: number | null;
             proxy_name: string | null;
             proxy_type: 'SOCKS5' | 'HTTP' | null; // Proxy type remains the same
             proxy_host: string | null;
             proxy_port: number | null;
             proxy_username: string | null;
             proxy_auth_method: 'none' | 'password' | 'key' | null;
             proxy_encrypted_password?: string | null;
             proxy_encrypted_private_key?: string | null;
             proxy_encrypted_passphrase?: string | null;
        };


        const connectionsWithProxies = await allDb<ExportRow>(db,
            `SELECT
                c.*,
                p.id as proxy_db_id, p.name as proxy_name, p.type as proxy_type,
                p.host as proxy_host, p.port as proxy_port, p.username as proxy_username,
                p.auth_method as proxy_auth_method,
                p.encrypted_password as proxy_encrypted_password,
                p.encrypted_private_key as proxy_encrypted_private_key,
                p.encrypted_passphrase as proxy_encrypted_passphrase
             FROM connections c
             LEFT JOIN proxies p ON c.proxy_id = p.id
             ORDER BY c.name ASC`
        );


        const tagRows = await allDb<{ connection_id: number, tag_id: number }>(db,
            'SELECT connection_id, tag_id FROM connection_tags'
        );


        const tagsMap: { [connId: number]: number[] } = {};
        tagRows.forEach(row => {
            if (!tagsMap[row.connection_id]) tagsMap[row.connection_id] = [];
            tagsMap[row.connection_id].push(row.tag_id);
        });


        const formattedData: ExportedConnectionData[] = connectionsWithProxies.map(row => {
            const connection: ExportedConnectionData = {
                name: row.name ?? 'Unnamed',
                type: row.type, // Add type field
                host: row.host,
                port: row.port,
                username: row.username,
                auth_method: row.auth_method,
                encrypted_password: row.encrypted_password,
                encrypted_private_key: row.encrypted_private_key,
                encrypted_passphrase: row.encrypted_passphrase,
                tag_ids: tagsMap[row.id] || [],
                proxy: null
            };

            if (row.proxy_db_id) {
                connection.proxy = {
                    name: row.proxy_name ?? 'Unnamed Proxy',
                    type: row.proxy_type ?? 'SOCKS5', 
                    host: row.proxy_host ?? '', 
                    port: row.proxy_port ?? 0,
                    username: row.proxy_username,
                    auth_method: row.proxy_auth_method ?? 'none',
                    encrypted_password: row.proxy_encrypted_password,
                    encrypted_private_key: row.proxy_encrypted_private_key,
                    encrypted_passphrase: row.proxy_encrypted_passphrase,
                };
            }
            return connection;
        });

        return formattedData;

    } catch (err: any) {
        console.error('Service: 导出连接时出错:', err.message);
        throw new Error(`导出连接失败: ${err.message}`);
    }
};


/**
 * 导入连接配置
 * @param fileBuffer Buffer containing the JSON file content
 */
export const importConnections = async (fileBuffer: Buffer): Promise<ImportResult> => {
    let importedData: ImportedConnectionData[];
    try {
        const fileContent = fileBuffer.toString('utf8');
        importedData = JSON.parse(fileContent);
        if (!Array.isArray(importedData)) {
            throw new Error('JSON 文件内容必须是一个数组。');
        }
    } catch (error: any) {
        console.error('Service: 解析导入文件失败:', error);
        throw new Error(`解析 JSON 文件失败: ${error.message}`);
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: { connectionName?: string; message: string }[] = [];
    const db = await getDbInstance();

    try {
        await runDb(db, 'BEGIN TRANSACTION');

        const connectionsToInsert: Array<Omit<ConnectionRepository.FullConnectionData, 'id' | 'created_at' | 'updated_at' | 'last_connected_at'> & { tag_ids?: number[] }> = [];
        const proxyCache: { [key: string]: number } = {}; 


        for (const connData of importedData) {
             try {

                // Validate imported data, including type
                if (!connData.type || !['SSH', 'RDP', 'VNC'].includes(connData.type)) {
                    throw new Error('缺少或无效的连接类型 (type)。');
                }
                if (!connData.name || !connData.host || !connData.port || !connData.username) {
                    throw new Error('缺少必要的连接字段 (name, host, port, username)。');
                }
                // Validate SSH specific fields only if type is SSH
                if (connData.type === 'SSH' && (!connData.auth_method || !['password', 'key'].includes(connData.auth_method))) {
                     throw new Error('SSH 连接缺少有效的认证方式 (auth_method)。');
                }
                // RDP specific validation (e.g., password required) could be added here if needed


                let proxyIdToUse: number | null = null;

                if (connData.proxy) {
                    const proxyData = connData.proxy;
                    if (!proxyData.name || !proxyData.type || !proxyData.host || !proxyData.port) {
                        throw new Error('代理信息不完整 (缺少 name, type, host, port)。');
                    }
                    const cacheKey = `${proxyData.name}-${proxyData.type}-${proxyData.host}-${proxyData.port}`;
                    if (proxyCache[cacheKey]) {
                        proxyIdToUse = proxyCache[cacheKey];
                    } else {
                        const existingProxy = await ProxyRepository.findProxyByNameTypeHostPort(proxyData.name, proxyData.type, proxyData.host, proxyData.port);
                        if (existingProxy) {
                            proxyIdToUse = existingProxy.id;
                        } else {
                            const newProxyData: Omit<ProxyRepository.ProxyData, 'id' | 'created_at' | 'updated_at'> = {
                                name: proxyData.name,
                                type: proxyData.type,
                                host: proxyData.host,
                                port: proxyData.port,
                                username: proxyData.username || null,
                                auth_method: proxyData.auth_method || 'none',
                                encrypted_password: proxyData.encrypted_password || null,
                                encrypted_private_key: proxyData.encrypted_private_key || null,
                                encrypted_passphrase: proxyData.encrypted_passphrase || null,
                            };
                            proxyIdToUse = await ProxyRepository.createProxy(newProxyData);
                            console.log(`Service: 导入连接 ${connData.name}: 新代理 ${proxyData.name} 创建成功 (ID: ${proxyIdToUse})`);
                        }
                        if (proxyIdToUse) proxyCache[cacheKey] = proxyIdToUse; 
                    }
                }

                // Prepare data for repository, ensuring correct auth_method for RDP
                const authMethodForDb = (connData.type === 'RDP' || connData.type === 'VNC') ? 'password' : connData.auth_method!;
                connectionsToInsert.push({
                    name: connData.name,
                    type: connData.type, // Add type
                    host: connData.host,
                    port: connData.port,
                    username: connData.username,
                    auth_method: authMethodForDb, // Use determined auth method
                    encrypted_password: connData.encrypted_password || null,
                    encrypted_private_key: connData.encrypted_private_key || null,
                    encrypted_passphrase: connData.encrypted_passphrase || null,
                    proxy_id: proxyIdToUse,
                    tag_ids: connData.tag_ids || []
                });

            } catch (connError: any) {
                failureCount++;
                errors.push({ connectionName: connData.name || '未知连接', message: connError.message });
                console.warn(`Service: 处理导入连接 "${connData.name || '未知'}" 时出错: ${connError.message}`);
            }
        } 
        let insertedResults: { connectionId: number, originalData: any }[] = [];
        if (connectionsToInsert.length > 0) {

             insertedResults = await ConnectionRepository.bulkInsertConnections(db, connectionsToInsert);
             successCount = insertedResults.length;
        }

        const insertTagSql = `INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?, ?)`; 
        for (const result of insertedResults) {
            const originalTagIds = result.originalData?.tag_ids;
            if (Array.isArray(originalTagIds) && originalTagIds.length > 0) {
                const validTagIds = originalTagIds.filter((id: any) => typeof id === 'number' && id > 0);
                if (validTagIds.length > 0) {
                    const tagPromises = validTagIds.map(tagId =>
                        runDb(db, insertTagSql, [result.connectionId, tagId]).catch(tagError => {
                             console.warn(`Service: 导入连接 ${result.originalData.name}: 关联标签 ID ${tagId} 失败: ${tagError.message}`);
                        })
                    );
                    await Promise.all(tagPromises);
                }
            }
        }



        await runDb(db, 'COMMIT');
        console.log(`Service: 导入事务提交。成功: ${successCount}, 失败: ${failureCount}`);
        return { successCount, failureCount, errors };

    } catch (error: any) {

        console.error('Service: 导入事务处理出错，正在回滚:', error);
        try {
            await runDb(db, 'ROLLBACK');
        } catch (rollbackErr: any) {
            console.error("Service: 回滚事务失败:", rollbackErr);
        }
        failureCount = importedData.length;
        successCount = 0;
        errors.push({ message: `事务处理失败: ${error.message}` });
        return { successCount, failureCount, errors };
    }
};
