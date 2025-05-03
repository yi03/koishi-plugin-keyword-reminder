// src/types.ts
import { Schema } from 'koishi';

// --- 插件配置 ---
export interface Config {}
export const Config: Schema<Config> = Schema.object({});

// --- 数据库表接口 ---
export interface KeywordRemind {
    cid: string;    // 频道/群聊 ID ('全局' 表示全局提醒标记)
    uid: string;    // 设置提醒的用户 ID
    keyword: string;// 提醒的关键词
    botId: string;  // 机器人 ID
}

export interface IgnoredUser {
    id: number;         // 自增主键
    botId: string;      // 机器人 ID
    ignoredUid: string; // 被忽略的用户 ID
}
