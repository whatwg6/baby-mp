import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveExpectedReleaseApiOrigin } from './release-api-origin.mjs'

const expectedAppId = 'wx433aecb90d44e9fe'

function required(environment, name) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return filesBelow(path)
    if (entry.isFile()) return [path]
    throw new Error(`Release artifact contains a non-regular path: ${path}`)
  }))
  return nested.flat()
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function createReleaseManifest({
  clientRoot,
  environment = process.env,
}) {
  const commitSha = required(environment, 'RELEASE_COMMIT_SHA').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error('RELEASE_COMMIT_SHA must be the full 40-character Git commit SHA')
  }
  const version = required(environment, 'RELEASE_VERSION')
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
    throw new Error('RELEASE_VERSION must be a safe immutable release identifier')
  }
  const apiOrigin = resolveExpectedReleaseApiOrigin(environment)
  const builtProject = JSON.parse(await readFile(
    join(clientRoot, 'dist/weapp/project.config.json'),
    'utf8',
  ))
  if (builtProject.appid !== expectedAppId) {
    throw new Error('Built WeChat AppID does not match the approved AppID')
  }
  if (builtProject.setting?.urlCheck !== true) {
    throw new Error('Built WeChat artifact must enable legal-domain validation')
  }

  const targets = [
    { name: 'h5', root: join(clientRoot, 'dist/h5') },
    { name: 'weapp', root: join(clientRoot, 'dist/weapp') },
  ]
  const targetFiles = await Promise.all(targets.map(async (target) => {
    const paths = await filesBelow(target.root)
    if (paths.length === 0) {
      throw new Error(`Release artifact target is empty: ${target.name}`)
    }
    return paths.map((path) => ({ target: target.name, path }))
  }))
  const artifactPaths = targetFiles
    .flat()
    .sort((left, right) => comparePaths(left.path, right.path))

  const files = await Promise.all(artifactPaths.map(async ({ target, path }) => {
    const artifactPath = relative(clientRoot, path).split('\\').join('/')
    if (artifactPath.endsWith('.map')) {
      throw new Error(`Release artifact must not contain a source map: ${artifactPath}`)
    }
    const data = await readFile(path)
    return {
      target,
      path: artifactPath,
      sizeBytes: data.byteLength,
      sha256: sha256(data),
    }
  }))
  const canonicalFileList = files
    .map((file) => `${file.sha256}  ${file.sizeBytes}  ${file.target}  ${file.path}\n`)
    .join('')
  return {
    schemaVersion: 1,
    commitSha,
    version,
    apiOrigin,
    wechatAppId: expectedAppId,
    artifactSetSha256: sha256(canonicalFileList),
    files,
  }
}

async function main() {
  const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = await createReleaseManifest({ clientRoot })
  const output = join(clientRoot, 'dist/release-manifest.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  process.stdout.write(
    `Release manifest created: commit=${manifest.commitSha} files=${manifest.files.length} sha256=${manifest.artifactSetSha256}\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
