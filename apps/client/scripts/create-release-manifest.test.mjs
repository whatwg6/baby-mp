import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { createReleaseManifest } from './create-release-manifest.mjs'

const commitSha = 'a'.repeat(40)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'baby-mp-release-manifest-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'dist/h5/static'), { recursive: true })
  await mkdir(join(root, 'dist/weapp'), { recursive: true })
  await writeFile(join(root, 'config/weapp-project.prod.config.json'), JSON.stringify({
    appid: 'wx433aecb90d44e9fe',
  }))
  await writeFile(join(root, 'dist/h5/index.html'), 'h5')
  await writeFile(join(root, 'dist/h5/static/app.js'), 'javascript')
  await writeFile(join(root, 'dist/weapp/app.js'), 'weapp')
  await writeFile(join(root, 'dist/weapp/project.config.json'), JSON.stringify({
    appid: 'wx433aecb90d44e9fe',
    setting: { urlCheck: true },
  }))
  return root
}

function environment(overrides = {}) {
  return {
    CI: 'true',
    ALLOW_TEST_RELEASE_API_ORIGIN: 'true',
    EXPECTED_RELEASE_API_ORIGIN: 'https://api.example.invalid',
    RELEASE_COMMIT_SHA: commitSha,
    RELEASE_VERSION: '0.1.0-test.1',
    ...overrides,
  }
}

describe('release artifact manifest', () => {
  it('binds sorted H5 and WeChat file hashes to the commit and release metadata', async () => {
    const manifest = await createReleaseManifest({
      clientRoot: await fixture(),
      environment: environment(),
    })
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      commitSha,
      version: '0.1.0-test.1',
      apiOrigin: 'https://api.example.invalid',
      wechatAppId: 'wx433aecb90d44e9fe',
    })
    expect(manifest.files.map((file) => file.path)).toEqual([
      'dist/h5/index.html',
      'dist/h5/static/app.js',
      'dist/weapp/app.js',
      'dist/weapp/project.config.json',
    ])
    expect(manifest.files.map((file) => file.target)).toEqual([
      'h5',
      'h5',
      'weapp',
      'weapp',
    ])
    const canonical = manifest.files
      .map((file) => `${file.sha256}  ${file.sizeBytes}  ${file.target}  ${file.path}\n`)
      .join('')
    expect(manifest.artifactSetSha256).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    )
  })

  it('rejects abbreviated commits and unsafe release identifiers', async () => {
    const clientRoot = await fixture()
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment({ RELEASE_COMMIT_SHA: 'abc123' }),
    })).rejects.toThrow('full 40-character Git commit SHA')
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment({ RELEASE_VERSION: 'version with spaces' }),
    })).rejects.toThrow('safe immutable release identifier')
  })

  it('requires both artifact targets to be non-empty', async () => {
    const clientRoot = await fixture()
    await rm(join(clientRoot, 'dist/h5'), { recursive: true })
    await mkdir(join(clientRoot, 'dist/h5'))
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('Release artifact target is empty: h5')
  })

  it('binds the built WeChat config rather than trusting only the source config', async () => {
    const clientRoot = await fixture()
    await writeFile(join(clientRoot, 'dist/weapp/project.config.json'), JSON.stringify({
      appid: 'wx0000000000000000',
      setting: { urlCheck: true },
    }))
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('Built WeChat AppID')
  })

  it('rejects source maps and symbolic links from candidate artifacts', async () => {
    const clientRoot = await fixture()
    await writeFile(join(clientRoot, 'dist/h5/static/app.js.map'), '{}')
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('must not contain a source map')

    await rm(join(clientRoot, 'dist/h5/static/app.js.map'))
    await symlink(join(clientRoot, 'dist/h5/index.html'), join(clientRoot, 'dist/h5/link.html'))
    await expect(createReleaseManifest({
      clientRoot,
      environment: environment(),
    })).rejects.toThrow('non-regular path')
  })
})
