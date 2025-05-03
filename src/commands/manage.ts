// src/commands/manage.ts
import { Context, Session, h, Dict } from 'koishi';
import { KeywordRemind } from '../types';
import { keywordTemp, updateKeywordCache } from '../cache'; // 确保 updateKeywordCache 导入，虽然此文件没直接用，但逻辑相关
import { parseKeywords } from '../utils';

export function registerManageCommands(ctx: Context): void {

    // --- MODIFIED ---
    ctx.command('提醒.群提醒 <keywordsRaw:text> [(可选)guildId:string]', '添加新的关键词提醒')
        .option('global', '-g, --global 设置为全局提醒 (所有共同群聊生效)', { fallback: false })
        .usage('关键词用逗号分隔。若含逗号用 \\, 转义 (如: "你好\\,世界")。反斜杠用 \\\\。')
        .example('提醒.群提醒 项目进度,紧急通知')
        .example('提醒.群提醒 新版本发布 -g')
        .example('提醒.群提醒 "截图\\,确认" 123456789') // 添加带群号的例子
        .action(async ({ session, options }, keywordsRaw, guildId) => {
            // ... (action 逻辑保持不变)
            if (!keywordsRaw) return '请输入要添加的提醒关键词。';

            const uid = session.userId;
            const botId = session.bot.selfId;
            const keywordsToAdd = parseKeywords(keywordsRaw);

            if (keywordsToAdd.length === 0) return '未能解析出有效的关键词。请检查输入格式，例如 `关键词1,关键词2` 或 `你好\\,世界`。';

            // --- 全局提醒逻辑 ---
            if (options.global) {
                const keywordsListStr = keywordsToAdd.map(k => `"${k}"`).join(', ');
                let preliminaryPmSuccess = false;
                let preliminaryPmErrorMsg = '';
                try {
                    await session.bot.sendPrivateMessage(uid, `正在为您设置全局提醒关键词: ${keywordsListStr}...`);
                    preliminaryPmSuccess = true;
                } catch (err) { /* ... 错误处理 ... */
                    const errorCode = err.code || err.errno?.toString();
                    const errorMessage = err.message?.toLowerCase() || '';
                    if (errorMessage.includes('send_private_msg') || ['10008', '28013', '50007'].includes(errorCode)) {
                        preliminaryPmErrorMsg = h.at(uid) + ' 我似乎无法向您发送私聊消息，请检查好友关系或私聊权限。提醒仍会尝试设置，结果将在当前聊天窗口提示。';
                    } else {
                        ctx.logger.warn(`尝试发送全局提醒的初始私聊确认时出错: ${err.message}`, err);
                        preliminaryPmErrorMsg = '尝试发送初始私聊确认时遇到内部问题，但提醒仍会尝试设置。';
                    }
                }

                try {
                    const globalMarkerUpserts = keywordsToAdd.map(keyword => ({ cid: '全局', uid, keyword, botId }));
                    await ctx.database.upsert('keywordRemind', globalMarkerUpserts);
                    ctx.logger.info(`全局提醒设置: 用户 ${uid} 添加/更新关键词 ${keywordsListStr}`);

                    if (!keywordTemp['全局']) keywordTemp['全局'] = [];
                    keywordsToAdd.forEach(kw => {
                        if (!keywordTemp['全局'].includes(kw)) {
                            keywordTemp['全局'].push(kw);
                        }
                    });

                    const successMessage = `全局提醒关键词 ${keywordsListStr} 添加/更新成功！将在您所在的共同群聊中生效。`;

                    try {
                        await session.bot.sendPrivateMessage(uid, successMessage);
                    } catch (pmErr) {
                        ctx.logger.warn(`发送全局提醒设置成功的最终私聊消息给 ${uid} 失败: ${pmErr.message}`);
                        if (!preliminaryPmSuccess && session.guildId) {
                            await session.send(h.at(uid) + ' 最终的私聊成功通知也发送失败，请检查私聊设置。');
                        }
                    }

                    if (session.guildId) {
                        if (!preliminaryPmSuccess) {
                            await session.send(preliminaryPmErrorMsg);
                        }
                        await session.send(successMessage);
                        return;
                    } else {
                        return (!preliminaryPmSuccess ? preliminaryPmErrorMsg + '\n' : '') + successMessage;
                    }
                } catch (err) {
                    ctx.logger.error(`添加/更新全局提醒时发生数据库错误: ${err.message}`, err);
                    return h.at(uid) + ' 添加/更新全局提醒时发生数据库错误，请稍后再试。';
                }
            }
            // --- 普通群提醒逻辑 ---
            else {
                let cid: string;
                let cName: string = '未知群聊';

                if (!guildId) {
                    if (!session.guildId) return '该指令不能在私聊中使用普通群提醒，请提供群组ID，或使用 -g 设置全局提醒。';
                    cid = session.guildId;
                    try {
                        cName = session.event?.channel?.name || (await session.bot.getGuild(cid))?.name || cid;
                    } catch { cName = cid; }
                } else {
                    cid = guildId;
                    try {
                        const guild = await session.bot.getGuild(cid).catch(() => null);
                        if (!guild) return `找不到群组 ${cid}，或者我不在该群组中。`;
                        cName = guild.name || cid;
                        const memberInfo = await session.bot.getGuildMember(cid, uid).catch(() => null);
                        if (!memberInfo) {
                            return `您似乎不在群组 ${cName}(${cid}) 中，或无法验证成员信息。`;
                        }
                    } catch (e) {
                        ctx.logger.error(`检查群组 ${cid} 或成员信息时出错: ${e.message}`);
                        return `检查群组 ${cid} 时出错，请稍后再试。`;
                    }
                }

                const addedKeywords: string[] = [];
                const failedKeywords: { keyword: string; reason: string }[] = [];
                let dbErrorOccurred = false;

                for (const keyword of keywordsToAdd) {
                    try {
                        await ctx.database.create('keywordRemind', { cid, uid, keyword, botId });
                        if (!keywordTemp[cid]) keywordTemp[cid] = [];
                        if (!keywordTemp[cid].includes(keyword)) {
                            keywordTemp[cid].push(keyword);
                        }
                        addedKeywords.push(keyword);
                    } catch (err) { /* ... 错误处理 ... */
                        const errorMessage = err.message?.toLowerCase() || '';
                        if (errorMessage.includes('unique constraint failed') || errorMessage.includes('duplicate entry')) {
                            failedKeywords.push({ keyword, reason: '已存在' });
                            if (!keywordTemp[cid]) keywordTemp[cid] = [];
                            if (!keywordTemp[cid].includes(keyword)) keywordTemp[cid].push(keyword);
                        } else {
                            ctx.logger.error(`添加群提醒关键词 "${keyword}" (群: ${cid}) 时出错: ${err.message}`, err);
                            failedKeywords.push({ keyword, reason: '添加失败(数据库错误)' });
                            dbErrorOccurred = true;
                        }
                    }
                }

                let responseParts: string[] = [];
                let hasSuccess = addedKeywords.length > 0;
                let hasFailure = failedKeywords.length > 0;

                if (hasSuccess) {
                    responseParts.push(`成功添加关键词: ${addedKeywords.map(k => `"${k}"`).join(', ')}。`);
                }
                if (hasFailure) {
                    responseParts.push(`未能添加关键词: ${failedKeywords.map(f => `"${f.keyword}" (${f.reason})`).join(', ')}。`);
                }
                if (!hasSuccess && !hasFailure) {
                    responseParts.push('没有有效关键词被处理。');
                }
                const finalResponseMessage = responseParts.join(' ');
                const pmMessage = `在群聊 [${cName}](${cid}) 的提醒设置结果：\n${finalResponseMessage}`;

                let pmSendFailed = false;
                let pmErrorMessage = '';
                try {
                    await session.bot.sendPrivateMessage(uid, pmMessage);
                } catch (err) { /* ... 错误处理 ... */
                    pmSendFailed = true;
                    const errorCode = err.code || err.errno?.toString();
                    const errorMessage = err.message?.toLowerCase() || '';
                    if (errorMessage.includes('send_private_msg') || ['10008', '28013', '50007'].includes(errorCode)) {
                        pmErrorMessage = h.at(uid) + ' 我无法向您发送私聊确认消息，请检查好友关系或私聊权限。结果将在当前聊天窗口提示。';
                    } else {
                        ctx.logger.warn(`发送普通群提醒的最终私聊确认消息失败: ${err.message}`);
                        pmErrorMessage = '发送私聊确认时遇到内部问题。';
                    }
                }

                if (session.guildId) {
                    if (pmSendFailed) {
                        await session.send(pmErrorMessage);
                    }
                    await session.send(finalResponseMessage);
                    return;
                } else {
                    return (pmSendFailed ? pmErrorMessage + '\n' : '') + finalResponseMessage;
                }
            }
        });

    // --- MODIFIED ---
    ctx.command('提醒.删除 <keywordsRaw:text> [(可选)guildId:string]', '删除已设置的关键词提醒')
        .option('global', '-g, --global 删除全局提醒。私聊中不加 -g 默认也删除全局。', { fallback: false })
        .usage('关键词用逗号分隔, 转义同添加。删除时会精确匹配范围 (全局或特定群聊)。')
        .example('提醒.删除 旧项目')
        .example('提醒.删除 老版本 -g')
        .action(async ({ session, options }, keywordsRaw, guildId) => {
            // ... (action 逻辑保持不变)
            if (!keywordsRaw) return '请输入要删除的关键词。';
            const keywordsToDelete = parseKeywords(keywordsRaw);
            if (keywordsToDelete.length === 0) return '未能解析出有效的关键词。请检查输入格式。';

            const uid = session.userId;
            const botId = session.bot.selfId;
            let totalRemovedCount: number = 0;
            let targetScopeDesc = '';
            let queryFilter: any;

            try {
                if (options.global) {
                    targetScopeDesc = '(全局)';
                    queryFilter = { uid, botId, keyword: { $in: keywordsToDelete }, cid: '全局' };
                    // ... (后续删除和缓存更新逻辑不变) ...
                    const removeResult = await ctx.database.remove('keywordRemind', queryFilter);
                    totalRemovedCount = removeResult.removed;
                    if (totalRemovedCount > 0 && keywordTemp['全局']) {
                        const remainingGlobal = await ctx.database.get('keywordRemind', { cid: '全局', keyword: { $in: keywordsToDelete } });
                        const keywordsToRemoveFromGlobalCache = keywordsToDelete.filter(kw =>
                            !remainingGlobal.some(rem => rem.keyword === kw) // 简化：只要没人用就从全局缓存移除
                        );
                        if (keywordsToRemoveFromGlobalCache.length > 0) {
                            keywordTemp['全局'] = keywordTemp['全局'].filter(k => !keywordsToRemoveFromGlobalCache.includes(k));
                            if (keywordTemp['全局'].length === 0) delete keywordTemp['全局'];
                        }
                    }
                } else if (guildId === undefined && !session.guildId) {
                    targetScopeDesc = '(全局)';
                    queryFilter = { uid, botId, keyword: { $in: keywordsToDelete }, cid: '全局' };
                    // ... (同上一个分支的删除和缓存更新逻辑) ...
                    const removeResult = await ctx.database.remove('keywordRemind', queryFilter);
                    totalRemovedCount = removeResult.removed;
                    if (totalRemovedCount > 0 && keywordTemp['全局']) {
                        const remainingGlobal = await ctx.database.get('keywordRemind', { cid: '全局', keyword: { $in: keywordsToDelete } });
                        const keywordsToRemoveFromGlobalCache = keywordsToDelete.filter(kw =>
                            !remainingGlobal.some(rem => rem.keyword === kw)
                        );
                        if (keywordsToRemoveFromGlobalCache.length > 0) {
                            keywordTemp['全局'] = keywordTemp['全局'].filter(k => !keywordsToRemoveFromGlobalCache.includes(k));
                            if (keywordTemp['全局'].length === 0) delete keywordTemp['全局'];
                        }
                    }
                } else {
                    const cid = guildId ?? session.guildId;
                    if (!cid) return '无法确定目标群聊。';
                    let cName = cid;
                    try { cName = (await session.bot.getGuild(cid))?.name || cid; } catch { }
                    targetScopeDesc = `(在群聊 ${cName} 中)`;
                    queryFilter = { uid, botId, keyword: { $in: keywordsToDelete }, cid };
                    // ... (特定群聊的删除和缓存更新逻辑不变) ...
                    const removeResult = await ctx.database.remove('keywordRemind', queryFilter);
                    totalRemovedCount = removeResult.removed;
                    if (totalRemovedCount > 0 && keywordTemp[cid]) {
                        const remaining = await ctx.database.get('keywordRemind', { cid: cid, keyword: { $in: keywordsToDelete } });
                        const keywordsToRemoveFromCache = keywordsToDelete.filter(kw =>
                            !remaining.some(rem => rem.keyword === kw)
                        );
                        if (keywordsToRemoveFromCache.length > 0) {
                            keywordTemp[cid] = keywordTemp[cid].filter(k => !keywordsToRemoveFromCache.includes(k));
                            if (keywordTemp[cid].length === 0) delete keywordTemp[cid];
                        }
                    }
                }

                if (totalRemovedCount === 0) {
                    return `未找到您设置的关于关键词 ${keywordsToDelete.map(k => `"${k}"`).join(', ')} 的提醒 ${targetScopeDesc}。`;
                } else {
                    return `删除成功！已移除 ${totalRemovedCount} 条关于关键词 ${keywordsToDelete.map(k => `"${k}"`).join(', ')} 的提醒记录 ${targetScopeDesc}。`;
                }
            } catch (err) {
                ctx.logger.error(`删除提醒关键词时出错: ${err.message}`, err);
                return '删除提醒时发生错误。';
            }
        });

    // --- MODIFIED ---
    ctx.command('提醒.列表', '查看您设置的所有关键词提醒')
        .action(async ({ session }) => {
            // ... (action 逻辑保持不变)
            const uid = session.userId;
            const botId = session.bot.selfId;
            let userReminders: KeywordRemind[];

            try {
                userReminders = await ctx.database.get('keywordRemind', { uid, botId });
            } catch (e) {
                ctx.logger.error(`获取用户 ${uid} 的提醒列表失败: ${e.message}`);
                return '获取提醒列表时出错，请稍后再试。';
            }

            if (userReminders.length === 0) return '您还没有设置任何提醒关键词哦~';

            const remindersByKeyword: Dict<{ isGlobal: boolean; guilds: Map<string, string> }> = {};
            const allCids = new Set<string>();

            userReminders.forEach(reminder => {
                if (!remindersByKeyword[reminder.keyword]) {
                    remindersByKeyword[reminder.keyword] = { isGlobal: false, guilds: new Map() };
                }
                if (reminder.cid === '全局') {
                    remindersByKeyword[reminder.keyword].isGlobal = true;
                } else {
                    // 即使是全局，也可能因为历史原因残留特定群聊记录（虽然新逻辑不会创建），这里仅处理非全局的
                    if (reminder.cid !== '全局') {
                        remindersByKeyword[reminder.keyword].guilds.set(reminder.cid, reminder.cid);
                        allCids.add(reminder.cid);
                    }
                }
            });

            const guildNameMap = new Map<string, string>();
            await Promise.all(Array.from(allCids).map(async cid => {
                try {
                    const guild = await session.bot.getGuild(cid);
                    guildNameMap.set(cid, guild?.name || `未知群聊(${cid})`);
                } catch {
                    guildNameMap.set(cid, `无法访问(${cid})`);
                }
            }));

            const outputLines: string[] = ['您的提醒关键词列表：'];
            const keywords = Object.keys(remindersByKeyword).sort();

            for (const keyword of keywords) {
                const data = remindersByKeyword[keyword];
                let scopeParts: string[] = [];
                const guildNames = Array.from(data.guilds.keys())
                    .map(cid => guildNameMap.get(cid) || `未知群聊(${cid})`);

                if (data.isGlobal) {
                    scopeParts.push('全局');
                    // 可选：如果想在全局也显示关联的特定群聊（虽然不推荐），可以在这里加上
                }
                if (guildNames.length > 0) {
                    if (guildNames.length <= 3) {
                        scopeParts.push(`特定群聊: ${guildNames.join(', ')}`);
                    } else {
                        scopeParts.push(`特定群聊 (${guildNames.length}个)`);
                    }
                }

                let scope = scopeParts.join(' | '); // 用 | 分隔全局和特定群聊
                if (!scope) scope = '范围异常或未应用'; // 如果既不是全局也没有特定群聊

                outputLines.push(`- 关键词: '${keyword}'  =>  范围: ${scope}`);
            }

            return outputLines.join('\n');
        });
}