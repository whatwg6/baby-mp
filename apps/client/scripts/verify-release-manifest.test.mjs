import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createReleaseManifest } from './create-release-manifest.mjs'
import { verifyReleaseManifest } from './verify-release-manifest.mjs'

const commitSha = 'b'.repeat(40)

function environment(overrides = {}) {
  return {
    CI: 'true',
    ALLOW_TEST_RELEASE_API_ORIGIN: 'true',
    EXPECTED_RELEASE_API_ORIGIN: 'https://api.example.invalid',
    RELEASE_COMMIT_SHA: commitSha,
    RELEASE_VERSION: '0.1.0-test.2',
    ...overrides,
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'baby-mp-release-manifest-verify-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'dist/h5'), { recursive: true })
  await mkdir(join(root, 'dist/weapp'), { recursive: true })
  await writeFile(join(root, 'config/weapp-project.prod.config.json'), JSON.stringify({
    appid: 'wx433aecb90d44e9fe',
  }))
  await writeFile(join(root, 'dist/h5/index.html'), 'h5')
  await writeFile(join(root, 'dist/weapp/app.js'), 'weapp')
  await writeFile(join(root, 'dist/weapp/project.config.json'), JSON.stringify({
    appid: 'wx433aecb90d44e9fe',
    setting: { urlCheck: true },
  }))
  const manifest = await createReleaseManifest({ clientRoot: root, environment: environment() })
  await writeFile(join(root, 'dist/release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return root
}

describe('release artifact manifest verification', () => {
  it('accepts the exact metadata and artifact set', async () => {
    const clientRoot = await fixture()
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment(),
    })).resolves.toMatchObject({ commitSha })
  })

  it('rejects modified, missing, extra, or differently bound artifacts', async () => {
    let clientRoot = await fixture()
    await writeFile(join(clientRoot, 'dist/h5/index.html'), 'tampered')
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('does not match')

    clientRoot = await fixture()
    await rm(join(clientRoot, 'dist/weapp/app.js'))
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('does not match')

    clientRoot = await fixture()
    await writeFile(join(clientRoot, 'dist/h5/extra.txt'), 'extra')
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('does not match')

    clientRoot = await fixture()
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment({ RELEASE_COMMIT_SHA: 'c'.repeat(40) }),
    })).rejects.toThrow('does not match')
  })

  it('rejects a modified manifest even when the artifacts are unchanged', async () => {
    const clientRoot = await fixture()
    const manifestPath = join(clientRoot, 'dist/release-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = 'forged-version'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(verifyReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('does not match')
  })
})
