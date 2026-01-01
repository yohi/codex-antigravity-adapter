export function shouldRouteToOpenAI(model: string): boolean {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) return false;
  if (normalized.includes("claude")) return false;
  return true;
}
