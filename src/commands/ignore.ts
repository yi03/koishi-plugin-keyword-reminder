// src/commands/ignore.ts
import { Context, Session } from 'koishi';
import { ignoredUsersCache, updateIgnoredUsersCache } from '../cache';
import { parseUserId } from '../utils';

export function registerIgnoreCommands(ctx: Context): void {

    // --- MODIFIED ---
    ctx.command('提醒.忽略 <user:text>', '忽略指定用户发送的消息')
        .usage('使用 @提及 或 用户ID。被忽略用户触发的关键词将不会提醒您。')
        .example('提醒.忽略 @张三')
        .example('提醒.忽略 1234567890')
        .action(async ({ session }, userInput) => {
            // ... (action 逻辑保持不变)
            const botId = session.bot.selfId;
            const targetUid = await parseUserId(session, userInput);

            if (!targetUid) return '请指定要忽略的用户（请使用 @提及 或 用户ID）。无法识别输入或@了全体成员。';
            if (targetUid === session.userId) return '您不能忽略自己。';
            if (targetUid === botId) return '您不能忽略机器人自身。';

            try {
                if (ignoredUsersCache[botId]?.has(targetUid)) {
                    return `用户 ${targetUid} 已在忽略列表中。`;
                }
                await ctx.database.create('keywordRemind_ignored', { botId, ignoredUid: targetUid });
                await updateIgnoredUsersCache(ctx, botId);

                let userName = targetUid;
                try {
                    const userInfo = await session.bot.getUser(targetUid);
                    userName = `${userInfo?.nick || userInfo?.name || targetUid} (${targetUid})`;
                } catch { /* 获取名称失败，仅用 ID */ }

                return `已将用户 ${userName} 添加到忽略列表。`;
            } catch (err) { /* ... 错误处理 ... */
                const errorMessage = err.message?.toLowerCase() || '';
                if (errorMessage.includes('unique constraint failed') || errorMessage.includes('duplicate entry')) {
                    if (!ignoredUsersCache[botId]?.has(targetUid)) await updateIgnoredUsersCache(ctx, botId);
                    return `用户 ${targetUid} 已在忽略列表中。`;
                } else {
                    ctx.logger.error(`添加忽略用户时出错: ${err.message}`, err);
                    return '添加到忽略列表时出错，请稍后再试。';
                }
            }
        });

    // --- MODIFIED ---
    ctx.command('提醒.取消忽略 <user:text>', '将用户从忽略列表中移除')
        .usage('使用 @提及 或 用户ID。')
        .example('提醒.取消忽略 @张三')
        .action(async ({ session }, userInput) => {
            // ... (action 逻辑保持不变)
            const botId = session.bot.selfId;
            const targetUid = await parseUserId(session, userInput);

            if (!targetUid) return '请指定要取消忽略的用户（请使用 @提及 或 用户ID）。无法识别输入或@了全体成员。';

            try {
                const result = await ctx.database.remove('keywordRemind_ignored', { botId, ignoredUid: targetUid });

                if (result.removed > 0) {
                    await updateIgnoredUsersCache(ctx, botId);
                    let userName = targetUid;
                    try {
                        const userInfo = await session.bot.getUser(targetUid);
                        userName = `${userInfo?.nick || userInfo?.name || targetUid} (${targetUid})`;
                    } catch { /* 获取名称失败，仅用 ID */ }
                    return `已将用户 ${userName} 从忽略列表中移除。`;
                } else {
                    if (ignoredUsersCache[botId]?.has(targetUid)) await updateIgnoredUsersCache(ctx, botId); // 同步缓存
                    return `用户 ${targetUid} 不在忽略列表中。`;
                }
            } catch (err) {
                ctx.logger.error(`移除忽略用户时出错: ${err.message}`, err);
                return '从忽略列表移除时出错，请稍后再试。';
            }
        });

    // --- MODIFIED ---
    ctx.command('提醒.忽略列表', '查看当前机器人的忽略用户列表')
        .action(async ({ session }) => {
            // ... (action 逻辑保持不变)
            const botId = session.bot.selfId;
            if (ignoredUsersCache[botId] === undefined) await updateIgnoredUsersCache(ctx, botId);
            const ignoredSet = ignoredUsersCache[botId] ?? new Set();

            if (ignoredSet.size === 0) return '当前没有忽略任何用户。';

            const ignoredList = Array.from(ignoredSet).sort();
            const outputLines: string[] = ['当前忽略的用户列表 (这些用户触发的关键词不会产生提醒):'];

            // 尝试批量获取用户信息以提高效率 (如果平台支持或有缓存)
            // 这里仍然使用循环Promise.all作为通用实现
            const userInfos = await Promise.all(ignoredList.map(async uid => {
                try {
                    const user = await session.bot.getUser(uid).catch(() => null);
                    if (user) {
                        const displayName = user.nick || user.name || uid;
                        return `- ${displayName} (${uid})`;
                    } else {
                        return `- ${uid} (无法获取昵称)`;
                    }
                } catch (error) {
                    ctx.logger.warn(`获取忽略列表用户 ${uid} 信息时出错: ${error.message}`);
                    return `- ${uid} (查询出错)`;
                }
            }));

            outputLines.push(...userInfos);
            return outputLines.join('\n');
        });
}