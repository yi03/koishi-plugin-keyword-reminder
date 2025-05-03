// src/listeners/lifecycle.ts
import { Context, Bot } from 'koishi';
import { updateKeywordCache, updateAllIgnoredUsersCache, updateIgnoredUsersCache, ignoredUsersCache } from '../cache'; // 导入缓存及更新函数

export function registerLifecycleListeners(ctx: Context): void {
    ctx.on('ready', async () => {
        ctx.logger.info('Keyword Reminder 插件启动，开始加载初始数据...');
        await updateKeywordCache(ctx); // 使用导入的函数
        await updateAllIgnoredUsersCache(ctx); // 使用导入的函数
        ctx.logger.info('初始数据加载完成');
    });

    ctx.on('bot-status-updated', async (bot: Bot) => {
        if (bot.status === 1) { // Bot online
            ctx.logger.info(`机器人 ${bot.selfId} 上线，更新其忽略用户缓存`);
            await updateIgnoredUsersCache(ctx, bot.selfId); // 使用导入的函数
        } else if (bot.status === 0) { // Bot offline
            ctx.logger.info(`机器人 ${bot.selfId} 离线，清理其忽略用户缓存`);
            delete ignoredUsersCache[bot.selfId]; // 使用导入的缓存变量
        }
    });
}