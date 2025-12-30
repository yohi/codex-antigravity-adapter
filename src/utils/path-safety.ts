/**
 * パスの安全性をチェックするユーティリティ関数
 */

/**
 * 指定されたファイルパスが安全でないパスかどうかをチェックします。
 *
 * 安全でないパスの条件:
 * - 絶対パス（Unix: / で始まる、Windows: ドライブレター）
 * - '..' を含むパス（ディレクトリトラバーサル攻撃の防止）
 *
 * @param filePath チェックするファイルパス
 * @returns 安全でないパスの場合はtrue、安全なパスの場合はfalse
 */
export function isUnsafePath(filePath: string): boolean {
  // 絶対パスかチェック（Unix: / で始まる、Windows: ドライブレター）
  if (filePath.startsWith("/") || /^[a-zA-Z]:\\/.test(filePath)) {
    return true;
  }
  // '..' を含むパスを拒否
  if (filePath.includes("..")) {
    return true;
  }
  return false;
}
