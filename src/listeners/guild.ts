// src/listeners/guild.ts
import { Context, Session } from 'koishi';
// 移除 KeywordRemind 导入，因为不再直接操作它来复制全局记录
// import { KeywordRemind } from '../types';
import { keywordTemp } from '../cache'; // 缓存导入保持

export function registerGuildListeners(ctx: Context): void {
    ctx.on('guild-added', async (session: Session) => {
        const cid = session.guildId;
        const botId = session.bot.selfId;
        // 【移除】不再需要检查全局提醒并应用到新群聊的数据库条目
        ctx.logger.info(`机器人 ${botId} 加入新群聊 ${cid}。全局提醒将自动在该群生效（无需数据库操作）。`);
        // 可选：如果需要，可以在这里预热该群聊的特定关键词缓存（如果它之前已存在）
        // 但通常 message listener 中的按需加载就够了
    });

    ctx.on('guild-member-added', async (session: Session) => {
        const cid = session.guildId;
        const botId = session.bot.selfId;
        const uid = session.userId;
        // 【移除】不再需要检查用户的全局提醒并应用到该群聊的数据库条目
        ctx.logger.info(`用户 ${uid} 加入群聊 ${cid}。该用户的全局提醒将自动在该群生效（无需数据库操作）。`);
    });

    // guild-member-removed 逻辑基本不变，因为它只处理特定群聊的记录
    ctx.on('guild-member-removed', async (session: Session) => {
        const cid = session.guildId;
        const botId = session.bot.selfId;
        const uid = session.userId;
        try {
            // 查询并删除该用户在该特定群聊的提醒（非全局）
            const removedReminders = await ctx.database.get('keywordRemind', { uid, botId, cid }); // 只查特定 cid
            if (removedReminders.length === 0) return; // 该用户在此群无特定提醒

            const keywordsToRemoveFromCacheCheck = removedReminders.map(r => r.keyword);

            await ctx.database.remove('keywordRemind', { uid, botId, cid }); // 只删除该用户在该特定群的
            ctx.logger.info(`用户 ${uid} 离开群聊 ${cid}，已移除其在该群的 ${removedReminders.length} 条特定提醒`);

            // 更新该特定群聊的缓存
            if (keywordTemp[cid] && keywordsToRemoveFromCacheCheck.length > 0) {
                // 检查这些关键词是否还有其他人在用（在该特定群聊）
                const remainingRemindersForKeywords = await ctx.database.get('keywordRemind', { cid, keyword: { $in: keywordsToRemoveFromCacheCheck } });
                const keywordsActuallyRemovedFromCache = keywordsToRemoveFromCacheCheck.filter(kw =>
                    !remainingRemindersForKeywords.some(rem => rem.keyword === kw)
                );
                if (keywordsActuallyRemovedFromCache.length > 0) {
                    keywordTemp[cid] = keywordTemp[cid].filter(kw => !keywordsActuallyRemovedFromCache.includes(kw));
                    if (keywordTemp[cid].length === 0) delete keywordTemp[cid];
                    ctx.logger.debug(`用户 ${uid} 离开群聊 ${cid}，从缓存中移除特定关键词: ${keywordsActuallyRemovedFromCache.join(', ')}`);
                }
            }
        } catch (e) {
            ctx.logger.error(`处理 guild-member-removed 事件 (用户: ${uid}, 群: ${cid}) 时出错: ${e.message}`);
        }
    });
}