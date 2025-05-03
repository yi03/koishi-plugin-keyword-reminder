// src/utils.ts
import { Session } from 'koishi';

/** 解析带转义符的逗号分隔关键词 */
export function parseKeywords(input: string): string[] {
    if (!input) return [];

    // --- 使用更健壮的占位符 ---
    // 为防止用户输入恰好包含占位符，加入随机性和时间戳
    const placeholderBase = `__KWR_${Date.now().toString(36)}${Math.random().toString(36).substring(2)}`;
    const backslashPlaceholder = `${placeholderBase}_BSLASH__`;
    const commaPlaceholder = `${placeholderBase}_COMMA__`;
    const chineseCommaPlaceholder = `${placeholderBase}_CHICOMMA__`; // 新增中文逗号占位符

    // --- 处理转义 ---
    // 1. 先替换转义的反斜杠 \\
    let tempInput = input.replace(/\\\\/g, backslashPlaceholder);
    // 2. 再替换转义的英文逗号 \,
    tempInput = tempInput.replace(/\\,/g, commaPlaceholder);
    // 3. 再替换转义的中文逗号 \，
    tempInput = tempInput.replace(/\\，/g, chineseCommaPlaceholder);

    // --- 统一分隔符 ---
    // 4. 将所有（未转义的）中文逗号替换为英文逗号，方便后续 split
    const normalizedInput = tempInput.replace(/，/g, ',');

    // --- 分割 ---
    // 5. 使用英文逗号分割
    const keywords = normalizedInput.split(',');

    // --- 还原转义并清理 ---
    // 创建正则表达式来安全地替换占位符
    const commaRegex = new RegExp(commaPlaceholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    const chineseCommaRegex = new RegExp(chineseCommaPlaceholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    const backslashRegex = new RegExp(backslashPlaceholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');

    return keywords
        .map(kw => kw
            // 6. 还原转义的逗号（先还原中文，再还原英文，顺序理论上不重要）
            .replace(chineseCommaRegex, '，')
            .replace(commaRegex, ',')
            // 7. 还原转义的反斜杠
            .replace(backslashRegex, '\\')
            // 8. 去除首尾空格
            .trim()
        )
        // 9. 过滤掉因连续逗号或首尾逗号产生的空字符串
        .filter(kw => kw.length > 0);
}

/** 从输入文本（可能是@或ID）解析用户ID */
export async function parseUserId(session: Session, input: string | undefined): Promise<string | null> {
    if (!input) return null;
    input = input.trim();
    // 优先匹配 <at id="..."/>
    const atMatch = input.match(/^<at id="([^"]+)"/);
    if (atMatch?.[1]) return atMatch[1];
    // 匹配纯数字 ID (更宽松，允许平台前缀如 qq:123)
    const directIdMatch = input.match(/^(?:[^:]+:)?(\d+)$/);
    if (directIdMatch?.[1]) return directIdMatch[1];
    // 排除 @全体成员
    if (input === '<at type="all"/>' || input === '@全体成员') return null;
    // 如果以上都不匹配，尝试作为普通字符串处理（可能就是ID）
    // 增加一个基本的用户ID格式校验（例如，只包含数字）
    if (/^\d+$/.test(input)) {
        return input;
    }
    return null; // 无法解析或格式不符合预期
}