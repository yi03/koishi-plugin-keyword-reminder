// src/commands/index.ts
import { Context } from 'koishi';
import { registerManageCommands } from './manage';
import { registerIgnoreCommands } from './ignore';

export function registerAllCommands(ctx: Context): void {
    ctx.command('提醒', '关键词私聊提醒相关功能');
    registerManageCommands(ctx); // 注册管理类子命令 (提醒.群提醒, 提醒.删除, 提醒.列表)
    registerIgnoreCommands(ctx); // 注册忽略类子命令 (提醒.忽略, ...)
    ctx.logger.info('所有提醒命令已注册');
}