// --- START OF FILE index.ts ---

// 1. Keep imports clean
import { Context, Schema, Session, h, $, Dict, Bot } from 'koishi'

// 2. Declare injections on a separate line *before* other exports like 'name'
export const inject = ['database']

export const name = 'keyword-reminder'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

// Define the new table for ignored users
declare module 'koishi' {
    interface Tables {
        keywordRemind: KeywordRemind
        keywordRemind_ignored: IgnoredUser // New table definition
    }
}

export interface KeywordRemind {
    cid: string;
    uid: string;
    keyword: string;
    botId: string;
}

// Interface for the ignored users table
export interface IgnoredUser {
    id: number; // Auto-incrementing primary key
    botId: string;
    ignoredUid: string; // The user ID to ignore
}


export function apply(ctx: Context) {

    ctx.model.extend('keywordRemind', {
        cid: "string",
        uid: "string", // User who set the reminder
        keyword: "string",
        botId: "string"
    },{
        primary: ['cid', 'uid', 'keyword', 'botId']
    })

    // Extend the model for the ignored users table
    ctx.model.extend('keywordRemind_ignored', {
        id: 'unsigned', // Use unsigned integer for auto-increment
        botId: 'string',
        ignoredUid: 'string',
    }, {
        primary: 'id',
        autoInc: true, // Enable auto-increment for 'id'
        // Add a unique constraint to prevent duplicates per bot
        unique: [['botId', 'ignoredUid']]
    })


    // Use Dict<string[]> for better type safety
    const keywordTemp: Dict<string[]> = {};
    // Cache for ignored users per bot
    const ignoredUsersCache: Dict<Set<string>> = {}; // BotID -> Set<ignoredUid>

    // Function to update the ignored users cache for a specific bot
    async function updateIgnoredUsersCache(botId: string) {
        // Now ctx.database should be available
        const ignoredList = await ctx.database.get('keywordRemind_ignored', { botId });
        ignoredUsersCache[botId] = new Set(ignoredList.map(entry => entry.ignoredUid));
        ctx.logger.info(`Updated ignored users cache for bot ${botId}. Count: ${ignoredUsersCache[botId].size}`);
    }

    // Function to update ignored users cache for all bots
    async function updateAllIgnoredUsersCache() {
        Object.keys(ignoredUsersCache).forEach(key => delete ignoredUsersCache[key]); // Clear cache
        const botIds = ctx.bots.map(bot => bot.selfId);
        await Promise.all(botIds.map(botId => updateIgnoredUsersCache(botId)));
        ctx.logger.info('Updated ignored users cache for all bots.');
    }


    ctx.on('ready', async() => {
        await cidKeywordUpdate();
        await updateAllIgnoredUsersCache(); // Load ignored users on ready
    })

    // Update keyword cache (keep existing logic, maybe add logging)
    async function cidKeywordUpdate() {
        ctx.logger.info('Starting keyword cache update...');
        Object.keys(keywordTemp).forEach(key => delete keywordTemp[key]);
        const cidListSet = new Set<string>();
        try {
            await Promise.all(ctx.bots.map(async bot => {
                try {
                    // Add platform prefix to channel id for uniqueness across platforms if needed
                    // const platform = bot.platform;
                    (await bot.getGuildList()).data.forEach(guild => {
                        // cidListSet.add(`${platform}:${guild.id}`); // Example if prefix needed
                        cidListSet.add(guild.id);
                    });
                } catch (e) {
                    ctx.logger.warn(`Failed to get guild list for bot ${bot.selfId}: ${e.message}`);
                }
            }));
        } catch (e) {
             ctx.logger.error(`Error fetching guild lists: ${e.message}`);
             return; // Abort if we can't get guild lists
        }


        const cidListArr:Array<string> = Array.from(cidListSet)
        ctx.logger.info(`Found ${cidListArr.length} unique channels across all bots.`);

        await Promise.all(cidListArr.map(async cid => {
             try {
                // Ensure keywordTemp[cid] is initialized
                // Now ctx.database should be available
                keywordTemp[cid] = (await ctx.database.get('keywordRemind', { cid })).map((data => data.keyword));
            } catch (dbError) {
                 ctx.logger.error(`Database error fetching keywords for cid ${cid}: ${dbError.message}`);
                 keywordTemp[cid] = []; // Initialize as empty on error
            }
        }));
        ctx.logger.info('Finished updating keyword cache from database.');

        // Cleanup logic (keep existing)
        try {
            // Now ctx.database should be available
            const allDbCids = (await ctx.database.select('keywordRemind').groupBy('cid').execute()).map(data => data.cid);
            const invalidCidList = allDbCids.filter(cid => cid !== '全局' && !cidListSet.has(cid)); // Exclude '全局' explicitly

            if (invalidCidList.length > 0) {
                ctx.logger.info(`Removing reminders for ${invalidCidList.length} inactive channels...`);
                await Promise.all(invalidCidList.map(async cid => {
                   await ctx.database.remove('keywordRemind', { cid }); // Now ctx.database should be available
                }));
                ctx.logger.info('Finished removing reminders for inactive channels.');
            }
        } catch (dbError) {
            ctx.logger.error(`Database error during cleanup: ${dbError.message}`);
        }
    }

    // Main help command
    ctx.command('提醒').action(async ({ session }) => {
        return `
本指令提供了关键词提醒功能
在触发关键词时会进行私聊提醒 (会忽略已屏蔽用户的消息)
指令列表：
提醒.群提醒 [关键词] [(可选)群id]
  -在指定群中提醒关键词
  -不指定群id则为当前群
提醒.全局提醒 [关键词]
  -在所有群中提醒关键词
提醒.删除 [要删除的关键词] [(可选)群id]
  -删除指定群中的关键词提醒
  -不指定群id则为当前群
提醒.列表
  -查看自己的关键词提醒列表
提醒.忽略 <用户>
  -将指定用户加入忽略列表 (可用@或用户ID)
提醒.取消忽略 <用户>
  -将指定用户从忽略列表中移除 (可用@或用户ID)
提醒.忽略列表
  -查看当前机器人的忽略列表`
    })

    // --- Existing Commands (群提醒, 全局提醒, 删除, 列表) remain largely the same ---
    // Minor adjustment: Ensure keywordTemp is updated correctly

    ctx.command('提醒.群提醒','[关键词] [(可选)群id]').action(async ({ args, session }) => {
        if(args[0] === undefined) return '请输入群提醒关键词';
        const uid = session.userId; // Use session.userId for simplicity
        const botId = session.bot.selfId;
        const keyword = args[0];
        let cid: string;
        let cName: string = '未知群聊'; // Default name

        if(args[1] === undefined) { // Current channel
            if (!session.guildId) return '该指令不能在私聊中使用，请提供群组ID。';
            cid = session.guildId;
            try {
                const guild = await session.bot.getGuild(cid);
                cName = guild.name;
            } catch {
                 ctx.logger.warn(`无法获取当前群聊 ${cid} 的名称`);
            }
        } else { // Specified channel ID
             cid = args[1];
             try {
                // Verify bot and user are in the target guild
                const [guild, memberList] = await Promise.all([
                     session.bot.getGuild(cid).catch(() => null),
                     session.bot.getGuildMemberList(cid).catch(() => null)
                ]);

                if (!guild || !memberList) {
                    return `找不到群组 ${cid}，或者我不在该群组中。`;
                }
                 cName = guild.name;
                if (!memberList.data.some(member => member.user.id === uid)) {
                    return `你好像不在群组 ${cName}(${cid}) 中。`;
                }
            } catch (e) {
                ctx.logger.error(`Error verifying guild ${cid}: ${e.message}`);
                return `检查群组 ${cid} 时出错，请稍后再试。`;
            }
        }

        try {
            // Now ctx.database should be available
            await ctx.database.create('keywordRemind', {cid, uid, keyword, botId});
            // Update cache immediately
            if (!keywordTemp[cid]) {
                keywordTemp[cid] = [];
            }
            if (!keywordTemp[cid].includes(keyword)) { // Avoid duplicates in cache
                 keywordTemp[cid].push(keyword);
            }
             await session.bot.sendPrivateMessage(uid, `在 ${cName}(${cid}) 中，当有人发送了关键词 "${keyword}" 时，我会提醒你哦~`);
             return `群提醒添加成功！`;
        }
        catch(err) {
            if (err.message?.includes('send_private_msg')) // More robust error check
                return h.at(uid) + ' 我无法向你发送私聊消息，请检查是否已添加好友或开启了私聊权限。';
            else if(err.message?.includes('UNIQUE constraint failed') || err.message?.includes('duplicate key')) // Check for DB specific unique errors
                return `关键词 "${keyword}" 在 ${cName}(${cid}) 的提醒已存在。`;
            else {
                 ctx.logger.error(`Error adding group reminder: ${err.message}`, err);
                 return '添加提醒时发生未知错误。';
            }
        }
    })

    ctx.command('提醒.全局提醒','[关键词]').action(async ({ session }, keyword) => {
        if(keyword === undefined) return '请输入全局提醒关键词'
        const uid = session.userId;
        const botId = session.bot.selfId;
        const globalCid = '全局'; // Use a constant

        try {
            // Try sending PM first
            await session.bot.sendPrivateMessage(uid, `设置成功！当有人在共同群聊中发送关键词 "${keyword}" 时，我会提醒你哦~`);

            // Add the '全局' marker entry
            // Now ctx.database should be available
            await ctx.database.upsert('keywordRemind', [{cid: globalCid, uid, keyword, botId}]);

            // Add specific entries for current mutual guilds
            const guilds = (await session.bot.getGuildList()).data;
            let addedCount = 0;
            await Promise.all(guilds.map(async guild => {
                const cid = guild.id;
                try {
                    const members = (await session.bot.getGuildMemberList(guild.id)).data;
                    if (members.some(member => member.user.id === uid)) {
                        // Upsert ensures it doesn't fail if it somehow already exists
                        // Now ctx.database should be available
                        await ctx.database.upsert('keywordRemind', [{cid, uid, keyword, botId}]);
                        // Update cache
                        if (!keywordTemp[cid]) keywordTemp[cid] = [];
                        if (!keywordTemp[cid].includes(keyword)) keywordTemp[cid].push(keyword);
                        addedCount++;
                    }
                } catch (e) {
                    ctx.logger.warn(`Error processing guild ${guild.id} for global reminder: ${e.message}`);
                }
            }));

            ctx.logger.info(`Added global reminder "${keyword}" for ${uid} to ${addedCount} specific guilds.`);
            return `全局提醒 "${keyword}" 添加成功！已应用于 ${addedCount} 个共同群聊。`;

        } catch(err) {
            if (err.message?.includes('send_private_msg'))
                return h.at(uid) + ' 我无法向你发送私聊消息，请检查好友关系或私聊权限。全局提醒仍会尝试设置，但你可能收不到此确认消息。';
            else if(err.message?.includes('UNIQUE constraint failed') || err.message?.includes('duplicate key') ) {
                 // This might happen if '全局' entry already exists, which is fine with upsert.
                 // Log it but don't necessarily return an error to the user unless the PM failed.
                 ctx.logger.warn(`Unique constraint likely hit for global reminder marker (uid: ${uid}, keyword: ${keyword}). Upsert should handle this.`);
                 return `全局提醒 "${keyword}" 可能已存在，已尝试更新应用范围。`; // Adjust message
            }
            else {
                 ctx.logger.error(`Error adding global reminder: ${err.message}`, err);
                 return '添加全局提醒时发生未知错误。';
            }
        }
    })

    ctx.command('提醒.删除','[要删除的关键词] [(可选)群id]').action(async ({ args, session }) => {
        if(args[0] === undefined) return '请输入要删除的关键词'
        const uid = session.userId;
        const botId = session.bot.selfId;
        const keyword = args[0];
        let result: number; // To store affected rows count

        try {
            if(args[1] === undefined) { // Delete from current group or '全局' if in PM
                const targetCid = session.guildId ?? '全局'; // If no guildId (PM), assume they mean '全局'
                if (targetCid === '全局') {
                    // Also remove the specific guild entries linked to this global keyword
                     // Now ctx.database should be available
                     const userReminders = await ctx.database.get('keywordRemind', { uid, botId, keyword });
                     const specificCids = userReminders.filter(r => r.cid !== '全局').map(r => r.cid);
                     // Now ctx.database should be available
                     result = (await ctx.database.remove('keywordRemind', { uid, botId, keyword })).matched;
                     // Update cache for affected cids
                    specificCids.forEach(c => {
                         if (keywordTemp[c]) {
                            keywordTemp[c] = keywordTemp[c].filter(k => k !== keyword);
                        }
                    });
                    delete keywordTemp['全局']; // Clear potential cached global keywords? Or handle more gracefully. Best to just refetch below.

                } else {
                     // Now ctx.database should be available
                     result = (await ctx.database.remove('keywordRemind', { uid, botId, keyword, cid: targetCid })).matched;
                     // Update cache for this specific cid
                    if (keywordTemp[targetCid]) {
                         keywordTemp[targetCid] = keywordTemp[targetCid].filter(k => k !== keyword);
                    }
                }

            } else { // Delete from specified group ID
                const cid = args[1];
                 // Now ctx.database should be available
                result = (await ctx.database.remove('keywordRemind', { uid, botId, keyword, cid })).matched;
                 // Update cache
                 if (keywordTemp[cid]) {
                    keywordTemp[cid] = keywordTemp[cid].filter(k => k !== keyword);
                }
            }

            if (result === 0) return `未找到关键词为 "${keyword}" 的提醒${args[1] ? ` (在群 ${args[1]} 中)` : (session.guildId ? ' (在当前群中)' : '(全局)')}。`;

            // Optionally, call cidKeywordUpdate() for full refresh, or rely on incremental cache update above.
            // Incremental is usually faster if done correctly.
            // await cidKeywordUpdate(); // Uncomment for full refresh if needed

            return `删除成功！`;

        } catch (err) {
            ctx.logger.error(`Error deleting reminder: ${err.message}`, err);
            return '删除提醒时发生错误。';
        }
    })

    ctx.command('提醒.列表').action(async ({ session }) => {
        const uid = session.userId;
        const botId = session.bot.selfId;
        // Now ctx.database should be available
        const userReminders = await ctx.database.get('keywordRemind', { uid, botId });

        if (userReminders.length === 0) return '您没有设置任何提醒词哦~';

        const remindersByKeyword: Dict<string[]> = {};

        // Group reminders by keyword
        for (const reminder of userReminders) {
            if (!remindersByKeyword[reminder.keyword]) {
                remindersByKeyword[reminder.keyword] = [];
            }
            remindersByKeyword[reminder.keyword].push(reminder.cid);
        }

        const outputLines: string[] = [];
        outputLines.push('您的提醒词列表：');

        // Format output, fetching guild names
        for (const keyword in remindersByKeyword) {
            const cids = remindersByKeyword[keyword];
            let scope = '未知范围';
            if (cids.includes('全局')) {
                scope = '全局';
            } else {
                const guildNames = await Promise.all(
                    cids.map(async cid => {
                        try {
                            const guild = await session.bot.getGuild(cid);
                            return `${guild.name || '未知群聊'}(${cid})`;
                        } catch {
                            return `未知群聊(${cid})`; // Handle cases where guild info is unavailable
                        }
                    })
                );
                scope = guildNames.join(', ');
            }
            outputLines.push(`关键词：'${keyword}' —— 范围：${scope}`);
        }

        return outputLines.join('\n');
    })

    // --- New Commands for Ignoring Users ---

    async function parseUserId(session: Session, input: string | undefined): Promise<string | null> {
         if (!input) return null;

         // Check for mentions first
         const mentionedUsers = session.elements?.filter(e => e.type === 'at').map(e => e.attrs.id) || [];
         if (mentionedUsers.length > 0) {
             // If multiple mentioned, maybe take the first one or ask user to be specific?
             // Taking the first one for now.
             return mentionedUsers[0];
         }

         // Assume it's a raw ID if no mention
         // Optional: Add validation to check if it looks like a user ID format
         return input.trim();
     }


    ctx.command('提醒.忽略 <user>', '添加用户到提醒忽略列表')
        .action(async ({ session, args }) => {
            const botId = session.bot.selfId;
            const targetUid = await parseUserId(session, args[0]);

            if (!targetUid) return '请指定要忽略的用户（可以使用 @ 或 用户ID）。';
            if (targetUid === session.userId) return '你不能忽略自己。';
            if (targetUid === botId) return '你不能忽略机器人自己。';


            try {
                // Check if already ignored using cache first
                if (ignoredUsersCache[botId]?.has(targetUid)) {
                     return `用户 ${targetUid} 已在忽略列表中。`;
                }

                // Attempt to add to database
                // Now ctx.database should be available
                await ctx.database.create('keywordRemind_ignored', { botId, ignoredUid: targetUid });

                // Update cache on success
                await updateIgnoredUsersCache(botId); // Refresh cache for this bot

                // Try to get username for better feedback
                let userName = targetUid;
                try {
                     const user = await session.bot.getUser(targetUid);
                     if (user?.name) userName = `${user.name} (${targetUid})`;
                 } catch { /* Ignore if user info fetch fails */ }

                return `已将用户 ${userName} 添加到忽略列表。来自该用户的消息将不再触发提醒。`;

            } catch (err) {
                 if (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('duplicate key')) {
                    // If somehow cache was stale, update it and inform user
                    await updateIgnoredUsersCache(botId);
                    return `用户 ${targetUid} 已在忽略列表中。`;
                } else {
                    ctx.logger.error(`Error adding user to ignore list: ${err.message}`, err);
                    return '添加到忽略列表时出错，请稍后再试。';
                }
            }
        });

     ctx.command('提醒.取消忽略 <user>', '从提醒忽略列表移除用户')
        .action(async ({ session, args }) => {
            const botId = session.bot.selfId;
            const targetUid = await parseUserId(session, args[0]);

            if (!targetUid) return '请指定要取消忽略的用户（可以使用 @ 或 用户ID）。';

            try {
                // Check cache first
                if (!ignoredUsersCache[botId]?.has(targetUid)) {
                     // Verify with DB in case cache is stale
                     // Now ctx.database should be available
                     const dbCheck = await ctx.database.get('keywordRemind_ignored', { botId, ignoredUid: targetUid });
                     if (dbCheck.length === 0) {
                         return `用户 ${targetUid} 不在忽略列表中。`;
                     }
                }

                 // Attempt to remove from database
                 // Now ctx.database should be available
                const result = await ctx.database.remove('keywordRemind_ignored', { botId, ignoredUid: targetUid });

                if (result.matched > 0) {
                     // Update cache on success
                    await updateIgnoredUsersCache(botId);
                    // Try to get username
                    let userName = targetUid;
                     try {
                        const user = await session.bot.getUser(targetUid);
                        if (user?.name) userName = `${user.name} (${targetUid})`;
                    } catch { /* Ignore */ }
                    return `已将用户 ${userName} 从忽略列表中移除。`;
                } else {
                    // Should have been caught by cache/DB check, but handle anyway
                     return `用户 ${targetUid} 不在忽略列表中。`;
                }
            } catch (err) {
                 ctx.logger.error(`Error removing user from ignore list: ${err.message}`, err);
                 return '从忽略列表移除时出错，请稍后再试。';
            }
        });

    ctx.command('提醒.忽略列表', '查看当前忽略的用户列表')
        .action(async ({ session }) => {
            const botId = session.bot.selfId;
            // Use cache if available, otherwise fetch
            let ignoredSet = ignoredUsersCache[botId];
             if (!ignoredSet) {
                 await updateIgnoredUsersCache(botId); // Fetch if not cached
                 ignoredSet = ignoredUsersCache[botId];
            }

            if (!ignoredSet || ignoredSet.size === 0) {
                return '当前没有忽略任何用户。';
            }

            const ignoredList = Array.from(ignoredSet);
            const outputLines: string[] = ['当前忽略的用户列表：'];

            // Try to fetch usernames, fall back to IDs
            const userInfos = await Promise.all(ignoredList.map(async uid => {
                try {
                    const user = await session.bot.getUser(uid);
                    return user?.name ? `${user.name} (${uid})` : uid;
                } catch {
                    return uid; // Fallback to ID if API fails
                }
            }));

            outputLines.push(...userInfos.map(info => `- ${info}`)); // Prepend dash here
            return outputLines.join('\n'); // Join lines
        });


    // --- Modified Message Handler ---

    ctx.on('message', async (session) => {
        // Ignore messages from self or other bots if desired (optional)
        // if (session.event.user.id === session.bot.selfId || session.event.user.isBot) return;
        if (!session.guildId) return; // Only process guild messages
        if (!session.content) return; // Ignore messages without text content

        const cid = session.guildId;
        const botId = session.bot.selfId;
        const senderUid = session.userId;

        // --- Check if sender is ignored ---
        const ignoredSet = ignoredUsersCache[botId];
        if (ignoredSet && ignoredSet.has(senderUid)) {
            // ctx.logger.debug(`Message from ignored user ${senderUid} in ${cid}. Skipping reminder check.`);
            return; // Stop processing if sender is ignored
        }
        // --- End of ignore check ---

        const keywordlist: readonly string[] = keywordTemp[cid] ?? []; // Use readonly and default to empty array

        if(keywordlist.length > 0) {
            // Find *first* matching keyword (avoids multiple triggers for overlapping keywords)
            const keyword = keywordlist.find(kw => session.content.includes(kw));

            if(keyword !== undefined) {
                // ctx.logger.info(`Keyword "${keyword}" detected in channel ${cid} from user ${senderUid}.`); // Debug log

                // Get users who set a reminder for this keyword in this channel/bot, excluding the sender
                // Now ctx.database should be available
                const potentialRecipients = await ctx.database.get('keywordRemind', { cid, keyword, botId });
                const uidList = potentialRecipients
                    .filter(data => data.uid !== senderUid) // Exclude sender
                    .map(data => data.uid);

                if(uidList.length > 0) {
                     ctx.logger.info(`Notifying users: ${uidList.join(', ')}`);
                     // Get sender name once
                     let senderName = session.event.user.name ?? senderUid; // Fallback to ID
                     if (!session.event.user.name) { // Try API if name is missing
                        try {
                            const senderUser = await session.bot.getUser(senderUid);
                            if (senderUser?.name) senderName = senderUser.name;
                        } catch { /* Ignore error, keep ID */}
                     }


                    uidList.forEach(async uid => {
                        try{
                            const highlightedContent = session.content.replace(
                                new RegExp(keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), // Escape regex special chars in keyword
                                `【${keyword}】`
                            );
                            await session.bot.sendPrivateMessage(uid, `${new Date().toLocaleString('zh-CN', { hour12: false })}
来自群聊 [${session.event.channel?.name || cid}] 的提醒
${senderName} (${senderUid}) 说：
${highlightedContent}`);
                        }
                        catch (e) {
                            // Avoid spamming the channel if PM fails repeatedly
                             ctx.logger.warn(`Failed to send private reminder to ${uid} for keyword "${keyword}". Error: ${e.message}`);
                             // Maybe send a single notification to the channel tagging the user after a few failures?
                             // session.send(h.at(uid) + ` 无法向你发送关键词 "${keyword}" 的私聊提醒，请检查好友关系或私聊设置。`); // Be careful with this, could be noisy.
                        }
                    })
                }
            }
        }
    })

    // --- Event handlers for guild/member changes ---
    // Consider updating ignoredUsersCache as well if needed, though less critical than keywordTemp

    ctx.on('guild-added', async (session) => {
        ctx.logger.info(`Bot joined guild ${session.guildId}. Running updates...`);
        // Standard keyword update for global reminders
        const cid = session.guildId;
        const botId = session.bot.selfId;
        try {
            // Now ctx.database should be available
            const globalReminders = await ctx.database.get('keywordRemind', { cid: '全局', botId });
            const guildUidList = (await session.bot.getGuildMemberList(cid)).data.map(member => member.user.id);

            for (const reminder of globalReminders) {
                if (guildUidList.includes(reminder.uid)) {
                    // Now ctx.database should be available
                    await ctx.database.upsert('keywordRemind', [{ cid, uid: reminder.uid, keyword: reminder.keyword, botId }]);
                }
            }
        } catch (e) {
             ctx.logger.error(`Error processing guild-added for ${cid}: ${e.message}`);
        }
        // Refresh caches
        await cidKeywordUpdate(); // Refresh keywords
        // No need to update ignore cache here unless ignores are guild-specific
    })

    ctx.on('guild-member-added', async (session) => {
         ctx.logger.info(`User ${session.userId} joined guild ${session.guildId}. Checking for global reminders...`);
         // Add specific reminders if user has global ones
         const cid = session.guildId;
         const botId = session.bot.selfId;
         const uid = session.userId;
         try {
            // Now ctx.database should be available
            const userGlobalReminders = await ctx.database.get('keywordRemind', { uid, botId, cid: '全局' });
            const upserts = userGlobalReminders.map(data => ({ cid, uid, keyword: data.keyword, botId }));
            if (upserts.length > 0) {
                // Now ctx.database should be available
                await ctx.database.upsert('keywordRemind', upserts);
            }
        } catch (e) {
             ctx.logger.error(`Error processing guild-member-added for user ${uid} in ${cid}: ${e.message}`);
        }
         // Refresh caches
        await cidKeywordUpdate(); // Refresh keywords
    })

    ctx.on('guild-member-removed', async (session) => {
         ctx.logger.info(`User ${session.userId} left guild ${session.guildId}. Removing reminders...`);
         // Remove user's specific reminders for this guild
         const cid = session.guildId;
         const botId = session.bot.selfId;
         const uid = session.userId;
         try {
            // Now ctx.database should be available
            await ctx.database.remove('keywordRemind', { uid, botId, cid });
        } catch (e) {
            ctx.logger.error(`Error processing guild-member-removed for user ${uid} in ${cid}: ${e.message}`);
        }
         // Refresh caches
        await cidKeywordUpdate(); // Refresh keywords
    })

    ctx.on('bot-status-updated', async (bot: Bot) => { // 确保 bot 有类型注解 : Bot
        // Directly compare with the numeric values corresponding to Status enum
        // Status.ONLINE is 1
        if (bot.status === 1) { // <--- No change needed here, was already correct
            ctx.logger.info(`Bot ${bot.selfId} (${bot.platform}) connected. Updating caches.`);
            await updateIgnoredUsersCache(bot.selfId);
            await cidKeywordUpdate();
        // Status.OFFLINE is 0
        } else if (bot.status === 0) { // <--- No change needed here, was already correct
             ctx.logger.info(`Bot ${bot.selfId} (${bot.platform}) disconnected. Clearing its caches.`);
             delete ignoredUsersCache[bot.selfId];
             // await cidKeywordUpdate(); // Optional: Update cache here if needed
        }
        // Other status values (if needed):
        // CONNECT = 2
        // DISCONNECT = 3
        // RECONNECT = 4
    });
}

// --- END OF FILE index.ts ---