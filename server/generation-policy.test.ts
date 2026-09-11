import { describe, expect, it } from 'bun:test'
import { modelGenerationPolicy } from './generation-policy'

describe('model generation policy', () => {
  it('recognizes Gemma effective sizes and routed small-model names', () => {
    for (const id of ['Gemma-4-E2B-QAT', 'Gemma-4-E4B-it-GGUF', 'local/4B', 'Qwen3.5-9B-Q4_K_M', 'Granite-4.2-3B-Q4_K_M']) {
      expect(modelGenerationPolicy(id)).toEqual({ compactContext: true, temperature: 0.1 })
    }
  })
  it('does not confuse active MoE counts, release numbers, or unknown aliases with small total sizes', () => {
    for (const id of ['Gemma-4-26B-A4B-it-MTP-GGUF', 'dynamo/model-35B-A3B', 'Qwen3.8-27B-GGUF', 'context-1', 'my-4billion-model']) {
      expect(modelGenerationPolicy(id)).toEqual({ compactContext: false, temperature: 0.22 })
    }
  })
})
