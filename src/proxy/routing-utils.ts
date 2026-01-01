export function isAntigravityModel(model: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return lower.includes("gemini") || lower.includes("claude");
}
