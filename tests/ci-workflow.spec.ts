import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

describe('CI artifact contract', () => {
  it('allows upload-artifact to include the sanitized dot-directory', () => {
    expect(workflow).toMatch(
      /uses: actions\/upload-artifact@v4[\s\S]*?path: \.artifacts\/[\s\S]*?include-hidden-files: true/,
    )
  })
})
