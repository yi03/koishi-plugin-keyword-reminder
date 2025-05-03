// src/listeners/message.ts
import { Context, Session, h } from 'koishi';
import { keywordTemp, ignoredUsersCache, updateIgnoredUsersCache, updateKeywordCache } from '../cache'; // 导入缓存及更新函数

export function registerMessageListener(ctx: Context): void {
    ctx.on('message', async (session: Session) => {
        if (!session.guildId || !session.userId || session.userId === session.selfId || session.event?.user?.isBot) {
            return;
        }

        const cid = session.guildId;
        const botId = session.bot.selfId;
        const senderUid = session.userId;

        // --- 忽略用户检查 ---
        if (ignoredUsersCache[botId] === undefined) await updateIgnoredUsersCache(ctx, botId);
        if (ignoredUsersCache[botId]?.has(senderUid)) return;

        // --- 关键词缓存检查和按需加载 ---
        // 检查特定群聊和全局缓存是否都已加载 (简化处理：如果任一未定义，尝试重新加载全部)
        // 注意：更精细的按需加载可以分别检查 cid 和 '全局'
        if (keywordTemp[cid] === undefined || keywordTemp['全局'] === undefined) {
             ctx.logger.debug(`Cache miss for guild ${cid} or global, refreshing keyword cache...`);
             // 这里可以考虑只加载缺失的部分，但全量更新更简单
             await updateKeywordCache(ctx); // 确保 updateKeywordCache 能处理 '全局'
        }

        // 合并当前群聊关键词和全局关键词
        const specificKeywords = keywordTemp[cid] || [];
        const globalKeywords = keywordTemp['全局'] || [];
        const relevantKeywords = Array.from(new Set([...specificKeywords, ...globalKeywords])); // 去重合并

        if (relevantKeywords.length === 0) return; // 无关键词则跳过

        // --- 检查消息内容中的关键词 ---
        const elements = h.normalize(session.elements || []);
        if (elements.length === 0) return;

        const matchedKeywords = new Set<string>();
        let hasTextContent = false;
        let combinedTextContent = '';

        for (const element of elements) {
             if (element.type === 'text' && element.attrs.content) {
                 const textContent = element.attrs.content;
                 hasTextContent = true;
                 combinedTextContent += textContent;
                 for (const kw of relevantKeywords) { // 使用合并后的关键词列表检查
                     if (textContent.includes(kw)) {
                         matchedKeywords.add(kw);
                     }
                 }
             } else if (element.type === 'at') {
                 combinedTextContent += `<at id="${element.attrs.id}" name="${element.attrs.name || ''}"/>`;
             } else if (element.type === 'img') {
                  combinedTextContent += '[图片]';
             }
        }

        if (!hasTextContent || matchedKeywords.size === 0) {
            return;
        }

        // --- 查询需要被提醒的用户 (包括全局和特定群聊) ---
        const matchedKeywordsArray = Array.from(matchedKeywords);

        try {
            // 查询数据库，匹配当前群聊ID或'全局'ID
            const potentialRecipients = await ctx.database.get('keywordRemind', {
                $or: [
                    { cid: cid },       // 匹配当前群聊的提醒
                    { cid: '全局' }      // 匹配全局提醒
                ],
                keyword: { $in: matchedKeywordsArray },
                botId,
                uid: { $ne: senderUid } // 不提醒发送者
            });

            // 按用户 ID 分组，记录他们各自匹配到的关键词和来源类型 (全局/特定)
            // (来源类型用于后续判断是否需要检查成员资格)
            const notifications = new Map<string, { keywords: Set<string>, isGlobalSource: boolean }>();
            potentialRecipients.forEach(recipient => {
                // 检查关键词是否真的匹配 (理论上 $in 保证了，但多一层保险)
                if (matchedKeywords.has(recipient.keyword)) {
                    if (!notifications.has(recipient.uid)) {
                        notifications.set(recipient.uid, { keywords: new Set(), isGlobalSource: false });
                    }
                    const data = notifications.get(recipient.uid);
                    data.keywords.add(recipient.keyword);
                    // 如果任何一个匹配的记录是全局的，就标记需要检查成员资格
                    if (recipient.cid === '全局') {
                        data.isGlobalSource = true;
                    }
                }
            });

            if (notifications.size > 0) {
                // --- 获取发送者和频道名称 ---
                let senderName = session.username || session.author?.nick || session.author?.name || senderUid;
                let channelName = session.event?.channel?.name || cid;
                // ... (尝试获取更好名称的逻辑不变) ...
                if (senderName === senderUid && session.bot.getUser) {
                    try { senderName = (await session.bot.getUser(senderUid))?.nick || senderName; } catch { /* 忽略错误 */ }
                }
                if (channelName === cid && session.bot.getGuild) {
                     try { channelName = (await session.bot.getGuild(cid))?.name || channelName; } catch { /* 忽略错误 */ }
                }

                const timeStamp = new Date().toLocaleString('zh-CN', { hour12: false });
                const sendTasks: Promise<any>[] = [];

                // --- 准备高亮内容 ---
                let highlightedContent = combinedTextContent;
                // ... (高亮逻辑不变) ...
                 matchedKeywordsArray.forEach(kw => {
                    const escapedKeyword = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    try {
                        highlightedContent = highlightedContent.replace(new RegExp(escapedKeyword, 'gi'), (match) => `【${match}】`);
                    } catch (regexError) {
                        ctx.logger.warn(`高亮关键词 "${kw}" 时正则表达式错误: ${regexError.message}`);
                         if (!highlightedContent.includes(`(无法高亮关键词: ${kw})`)) {
                             highlightedContent += ` (无法高亮关键词: ${kw})`;
                         }
                    }
                });


                // --- 遍历潜在接收者并发送消息 ---
                for (const [uid, data] of notifications.entries()) {
                    const triggeredKeywords = Array.from(data.keywords);

                    // **核心检查**：如果提醒来源于全局设置，必须检查该用户是否真的在当前群聊
                    if (data.isGlobalSource) {
                        try {
                            // 尝试获取成员信息，如果获取不到或出错，则跳过此用户的提醒
                            const memberInfo = await session.bot.getGuildMember(cid, uid).catch(() => null);
                            if (!memberInfo) {
                                ctx.logger.debug(`用户 ${uid} 的全局提醒在群 ${cid} 中触发，但用户不在该群或无法验证成员，跳过提醒。`);
                                continue; // 跳过此用户
                            }
                        } catch (memberError) {
                            // 处理可能的API错误（如权限不足）
                            ctx.logger.warn(`检查全局提醒接收者 ${uid} 是否在群 ${cid} 时出错: ${memberError.message}`);
                            continue; // 出错也跳过，避免发送不必要的提醒
                        }
                    }

                    // 构建并发送私聊消息 (如果检查通过或提醒源于特定群聊)
                    const messageToSend = `${timeStamp}\n来自群聊 [${channelName}] 的提醒 (关键词: ${triggeredKeywords.map(k => `"${k}"`).join(', ')})\n${senderName} (${senderUid}) 说：\n${highlightedContent}`;

                    sendTasks.push(
                        session.bot.sendPrivateMessage(uid, messageToSend).catch(error => {
                            ctx.logger.warn(`发送私聊提醒给用户 ${uid} 失败。错误: ${error?.message}`);
                            return { status: 'rejected', reason: error };
                        })
                    );
                }

                if (sendTasks.length > 0) {
                    await Promise.all(sendTasks);
                    ctx.logger.debug(`向 ${sendTasks.length} 个用户发送了关键词提醒 (触发词: ${matchedKeywordsArray.join(', ')})`);
                }
            }
        } catch (dbError) {
            ctx.logger.error(`查询或处理关键词提醒接收者时发生数据库错误 (群: ${cid}): ${dbError.message}`);
        }
    });
}