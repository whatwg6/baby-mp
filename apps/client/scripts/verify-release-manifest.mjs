import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createReleaseManifest } from './create-release-manifest.mjs'

export async function verifyReleaseManifest({
  clientRoot,
  environment = process.env,
}) {
  const manifestPath = join(clientRoot, 'dist/release-manifest.json')
  const actual = JSON.parse(await readFile(manifestPath, 'utf8'))
  const expected = await createReleaseManifest({ clientRoot, environment })
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Release manifest does not match the expected metadata and artifact files')
  }
  return actual
}

async function main() {
  const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = await verifyReleaseManifest({ clientRoot })
  process.stdout.write(
    `Release manifest verified: commit=${manifest.commitSha} files=${manifest.files.length} sha256=${manifest.artifactSetSha256}\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
