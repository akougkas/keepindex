/** Conservative answer budgets for advertised small-model size conventions. */
export function modelGenerationPolicy(model: string): { temperature: number; compactContext: boolean } {
  // Gemma's E2B/E4B names use an effective-size prefix. A MoE's A4B active
  // count must not hide a larger advertised 26B total. Unknown names keep the
  // general policy; a provider-specific size cannot be inferred from an alias.
  const sizes = Array.from(model.toLowerCase().matchAll(/(?:^|[-_ /])e?(\d+(?:\.\d+)?)b(?=[-_ /]|$)/g), match => Number(match[1]))
  const largestSize = sizes.length > 0 ? Math.max(...sizes) : null
  const compactContext = largestSize != null && largestSize <= 14
  return { temperature: compactContext ? 0.1 : 0.22, compactContext }
}
