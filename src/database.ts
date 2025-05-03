// src/database.ts
import { Context } from 'koishi';
import { KeywordRemind, IgnoredUser } from './types'; // 导入接口

// --- 扩展 Koishi 的 Tables 类型 ---
// 这部分必须放在一个会被 Koishi 加载的文件中，通常放在这里或入口文件。
// 但为了集中管理数据库相关内容，放在这里更好。
declare module 'koishi' {
    interface Tables {
        keywordRemind: KeywordRemind;
        keywordRemind_ignored: IgnoredUser;
    }
}

// --- 数据库模型定义函数 ---
export function defineDatabaseModels(ctx: Context): void {
    // 提醒表
    ctx.model.extend('keywordRemind', {
        cid: "string",
        uid: "string",
        keyword: "string",
        botId: "string"
    }, {
        primary: ['cid', 'uid', 'keyword', 'botId'] // 联合主键
    });

    // 忽略用户表
    ctx.model.extend('keywordRemind_ignored', {
        id: 'unsigned',
        botId: 'string',
        ignoredUid: 'string',
    }, {
        primary: 'id',
        autoInc: true,
        unique: [['botId', 'ignoredUid']] // 唯一约束
    });
}
