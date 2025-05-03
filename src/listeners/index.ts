// src/listeners/index.ts
import { Context } from 'koishi';
import { registerLifecycleListeners } from './lifecycle';
import { registerGuildListeners } from './guild';
import { registerMessageListener } from './message';

export function registerAllListeners(ctx: Context): void {
    registerLifecycleListeners(ctx);
    registerGuildListeners(ctx);
    registerMessageListener(ctx);
    ctx.logger.info('所有事件监听器已注册');
}