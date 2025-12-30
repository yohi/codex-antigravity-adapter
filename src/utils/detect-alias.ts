export type AliasDetectionResult = {
  alias: string | null;
  remainingContent: string;
};

export function detectAlias(
  content: string,
  knownAliases: ReadonlySet<string>
): AliasDetectionResult {
  if (!content.startsWith("@")) {
    return { alias: null, remainingContent: content };
  }

  const spaceIndex = content.indexOf(" ");
  const aliasCandidate =
    spaceIndex === -1 ? content : content.slice(0, spaceIndex);

  if (!knownAliases.has(aliasCandidate)) {
    return { alias: null, remainingContent: content };
  }

  const remainingContent =
    spaceIndex === -1 ? "" : content.slice(spaceIndex + 1);
  return { alias: aliasCandidate, remainingContent };
}
