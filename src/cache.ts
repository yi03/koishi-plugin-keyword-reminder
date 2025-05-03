// src/cache.ts
import { Context, Dict, Bot } from 'koishi';
import { KeywordRemind } from './types';

// --- 内存缓存定义 ---
export const keywordTemp: Dict<string[]> = {}; // 缓存: ChannelID -> Keywords[]
export const ignoredUsersCache: Dict<Set<string>> = {}; // 缓存: BotID -> Set<ignoredUid>

// --- 缓存更新函数 ---

/** 从数据库更新关键词缓存 */
export async function updateKeywordCache(ctx: Context): Promise<void> {
    // 优化：只清除特定群聊的缓存，全局缓存单独处理或在下面覆盖
    Object.keys(keywordTemp).forEach(key => {
        if (key !== '全局') {
            delete keywordTemp[key];
        }
    });
    keywordTemp['全局'] = []; // 初始化或清空全局缓存

    try {
        const allReminders = await ctx.database.get('keywordRemind', {});
        const remindersByCid: Dict<KeywordRemind[]> = {};
        const globalReminders: KeywordRemind[] = [];

        allReminders.forEach(reminder => {
            if (reminder.cid === '全局') {
                globalReminders.push(reminder); // 分离全局记录
            } else {
                if (!remindersByCid[reminder.cid]) {
                    remindersByCid[reminder.cid] = [];
                }
                remindersByCid[reminder.cid].push(reminder);
            }
        });

        // 填充特定群聊缓存
        Object.keys(remindersByCid).forEach(cid => {
            keywordTemp[cid] = Array.from(new Set(remindersByCid[cid].map(r => r.keyword)));
        });

        // 填充全局关键词缓存
        keywordTemp['全局'] = Array.from(new Set(globalReminders.map(r => r.keyword)));

    } catch (dbError) {
        ctx.logger.error(`加载关键词缓存失败: ${dbError.message}`);
    }
}

/** 更新指定机器人的忽略用户缓存 */
export async function updateIgnoredUsersCache(ctx: Context, botId: string): Promise<void> {
    try {
        const ignoredList = await ctx.database.get('keywordRemind_ignored', { botId });
        ignoredUsersCache[botId] = new Set(ignoredList.map(entry => entry.ignoredUid));
        ctx.logger.debug(`机器人 ${botId} 的忽略用户缓存已更新`);
    } catch (dbError) {
        ctx.logger.error(`更新机器人 ${botId} 的忽略用户缓存失败: ${dbError.message}`);
        ignoredUsersCache[botId] = new Set(); // 出错时置空
    }
}

/** 更新所有在线机器人的忽略用户缓存 */
export async function updateAllIgnoredUsersCache(ctx: Context): Promise<void> {
    const botIds = ctx.bots.filter(bot => bot.status === 1).map(bot => bot.selfId); // 只更新在线的
    if (botIds.length > 0) {
        await Promise.all(botIds.map(botId => updateIgnoredUsersCache(ctx, botId)));
        ctx.logger.info('所有在线机器人的忽略用户缓存已更新');
    }
}