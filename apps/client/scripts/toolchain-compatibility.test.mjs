import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = join(clientRoot, '../..')

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

describe('Taro toolchain compatibility', () => {
  it('keeps the Taro runner on its compatible dev-server major', async () => {
    const workspacePackage = await readJson(join(workspaceRoot, 'package.json'))
    expect(workspacePackage.pnpm?.overrides).toMatchObject({
      'webpack-dev-server': '5.2.6',
      '@tarojs/webpack5-runner@4.1.5>webpack-dev-server': '4.15.2',
    })
  })

  it('avoids Taro doctor remote-schema validation in hermetic builds', async () => {
    const clientPackage = await readJson(join(clientRoot, 'package.json'))
    const taroScripts = [
      'dev',
      'dev:h5',
      'dev:weapp',
      'build:h5',
      'build:h5:e2e',
      'build:weapp',
    ]
    for (const name of taroScripts) {
      expect(clientPackage.scripts[name]).toContain(' --no-check')
    }
  })

  it('patches the legacy URL normalizer without passing Node warning flags', async () => {
    const workspacePackage = await readJson(join(workspaceRoot, 'package.json'))
    const clientPackage = await readJson(join(clientRoot, 'package.json'))

    expect(workspacePackage.pnpm?.patchedDependencies).toMatchObject({
      'normalize-url@2.0.1': 'patches/normalize-url@2.0.1.patch',
    })
    for (const name of ['dev', 'dev:h5', 'dev:weapp']) {
      expect(clientPackage.scripts[name]).not.toContain('NODE_OPTIONS')
      expect(clientPackage.scripts[name]).not.toContain('--no-warnings')
    }
  })
})
