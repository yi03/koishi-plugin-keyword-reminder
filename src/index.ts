// src/index.ts
import { Context } from 'koishi';
import { Config, Config as ConfigSchema } from './types'; // 导入配置接口和 Schema
import { defineDatabaseModels } from './database';
import { registerAllCommands } from './commands';
import { registerAllListeners } from './listeners';

// --- 插件元数据 ---
export const name = 'keyword-reminder';
export const inject = ['database']; // 数据库依赖

// --- 插件配置 ---
export { Config, ConfigSchema }; // 导出配置，Koishi 会自动使用 ConfigSchema

// --- 插件主逻辑 ---
export function apply(ctx: Context, config: Config) {
    ctx.logger.info('启用 keyword-reminder 插件');

    // 1. 定义数据库模型
    defineDatabaseModels(ctx);
    ctx.logger.debug('数据库模型已定义');

    // 2. 注册所有命令
    registerAllCommands(ctx);

    // 3. 注册所有事件监听器
    registerAllListeners(ctx);

    ctx.logger.info('keyword-reminder 插件加载完成');
}