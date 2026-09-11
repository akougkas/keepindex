import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCurrentProjectEvidence } from './project-evidence'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'keepindex-project-'))
  temporary.push(path)
  return { id: 'selected-root', label: 'My projects', path }
}

describe('current project evidence within selected roots', () => {
  it('finds current documents even without any indexed chunks and preserves exact line references', async () => {
    const root = await fixture()
    const repo = join(root.path, 'widget-tool')
    await mkdir(repo)
    await writeFile(join(repo, 'CHANGELOG.md'), '# Changes\n\n## 2.8.1\n\nSafer keyboard handling.\n')
    await writeFile(join(repo, 'README.md'), '# Widget Tool\n\nA workflow tool.\n')
    const results = await readCurrentProjectEvidence('latest on widget-tool release and features', [root])
    expect(results).toHaveLength(2)
    expect(results[0].content).toContain('2.8.1')
    expect(results[0].startLine).toBe(1)
    expect(results[0].resourceId).toBe(root.id)
    await writeFile(join(repo, 'CHANGELOG.md'), '# Changes\n\n## 2.8.2\n\nNew current release.\n')
    const refreshed = await readCurrentProjectEvidence('widget-tool release', [root])
    expect(refreshed[0].content).toContain('2.8.2')
    expect(refreshed[0].content).not.toContain('2.8.1')
  })

  it('does not follow project or document symlinks outside selected roots', async () => {
    const root = await fixture(), outside = await fixture()
    await writeFile(join(outside.path, 'README.md'), 'Private outside content')
    await symlink(outside.path, join(root.path, 'widget-tool'))
    expect(await readCurrentProjectEvidence('widget-tool features', [root])).toEqual([])
    await mkdir(join(root.path, 'another-tool'))
    await symlink(join(outside.path, 'README.md'), join(root.path, 'another-tool', 'README.md'))
    expect(await readCurrentProjectEvidence('another-tool features', [root])).toEqual([])
  })

  it('does not search unselected roots or unrelated generic queries', async () => {
    expect(await readCurrentProjectEvidence('latest widget-tool release', [])).toEqual([])
    expect(await readCurrentProjectEvidence('latest news and features', [await fixture()])).toEqual([])
  })
})
