export interface AliasDetectionResult {
  alias: string | null;
  remainingContent: string;
}

/**
 * コンテンツ先頭からエイリアスを検出し、残りテキストを抽出する
 * @param content スキーマ検証後の文字列コンテンツ
 * @param knownAliases 設定済みエイリアスの集合
 * @returns 検出結果
 */
export function detectAlias(
  content: string,
  knownAliases: ReadonlySet<string>
): AliasDetectionResult {
  if (!content.startsWith("@")) {
    return { alias: null, remainingContent: content };
  }

  // Sort aliases by length descending to ensure we match the longest possible alias
  // (e.g. match "@foo bar" before "@foo")
  const sortedAliases = Array.from(knownAliases).sort((a, b) => b.length - a.length);

  for (const alias of sortedAliases) {
    if (content.startsWith(alias)) {
      const rest = content.slice(alias.length);
      
      // Exact match at end of string
      if (rest.length === 0) {
        return { alias, remainingContent: "" };
      }

      // Check for whitespace separator
      const firstChar = rest[0];
      if (/\s/.test(firstChar)) {
        // Remove alias and the 1 character of whitespace
        return { alias, remainingContent: rest.slice(1) };
      }
    }
  }

  return { alias: null, remainingContent: content };
}