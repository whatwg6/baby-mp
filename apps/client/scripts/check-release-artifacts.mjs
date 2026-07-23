import { readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveExpectedReleaseApiOrigin } from './release-api-origin.mjs'

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const weappRoot = join(clientRoot, 'dist/weapp')
const h5Root = join(clientRoot, 'dist/h5')
const H5_JS_GZIP_BUDGET_BYTES = Number(process.env.H5_JS_GZIP_BUDGET_BYTES ?? 2.5 * 1024 * 1024)
const H5_CHUNK_GZIP_BUDGET_BYTES = Number(process.env.H5_CHUNK_GZIP_BUDGET_BYTES ?? 160 * 1024)
const expectedAppId = 'wx433aecb90d44e9fe'

export function resolveWeappBundleBudget(environment = process.env) {
  const canonical = environment.WEAPP_BUNDLE_BUDGET_BYTES
  const legacy = environment.WEAPP_ARTIFACT_BUDGET_BYTES
  const parse = (value, name) => {
    if (value === undefined || value === '') return undefined
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new Error(`${name} 必须是正整数`)
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} 超出安全整数范围`)
    return parsed
  }
  const canonicalValue = parse(canonical, 'WEAPP_BUNDLE_BUDGET_BYTES')
  const legacyValue = parse(legacy, 'WEAPP_ARTIFACT_BUDGET_BYTES')
  if (canonicalValue !== undefined && legacyValue !== undefined && canonicalValue !== legacyValue) {
    throw new Error('WEAPP_BUNDLE_BUDGET_BYTES 与旧变量 WEAPP_ARTIFACT_BUDGET_BYTES 冲突')
  }
  return canonicalValue ?? legacyValue ?? 2 * 1024 * 1024
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const WEAPP_BUDGET_BYTES = resolveWeappBundleBudget()
const prodConfig = JSON.parse(await readFile(
  join(clientRoot, 'config/weapp-project.prod.config.json'),
  'utf8',
))
const devConfig = JSON.parse(await readFile(
  join(clientRoot, 'config/weapp-project.dev.config.json'),
  'utf8',
))
const builtConfig = JSON.parse(await readFile(join(weappRoot, 'project.config.json'), 'utf8'))
const allWeappFiles = await filesBelow(weappRoot)
const allH5Files = await filesBelow(h5Root)
const h5Index = await readFile(join(h5Root, 'index.html'), 'utf8')
const h5Favicon = await readFile(join(h5Root, 'favicon.svg'), 'utf8')
const expectedApiOrigin = resolveExpectedReleaseApiOrigin()

assert(devConfig.appid === expectedAppId, '微信开发配置 AppID 不正确')
assert(devConfig.setting?.urlCheck === false, '仅微信开发配置应关闭合法域名校验')
for (const [label, config] of [['生产源配置', prodConfig], ['微信生产产物', builtConfig]]) {
  assert(config.appid === expectedAppId, `${label} AppID 不正确`)
  assert(config.setting?.urlCheck === true, `${label} 必须启用合法域名校验`)
  assert(config.setting?.compileHotReLoad !== true, `${label} 不得启用热重载`)
}
assert(JSON.stringify(builtConfig) === JSON.stringify(prodConfig), '微信产物 project.config.json 不是生产配置')
assert(h5Index.includes('href="/favicon.svg"'), 'H5 产物未引用 favicon.svg')
assert(h5Favicon.trim().length > 0, 'H5 favicon.svg 为空')
assert(
  ![...allWeappFiles, ...allH5Files].some((path) => path.endsWith('.map')),
  '生产产物不得包含 source map',
)

const weappFiles = allWeappFiles
const weappBytes = (await Promise.all(weappFiles.map(async (path) => (await stat(path)).size)))
  .reduce((sum, size) => sum + size, 0)
const weappJavaScript = weappFiles.filter((path) => path.endsWith('.js'))
const weappBundleText = (await Promise.all(
  weappJavaScript.map((path) => readFile(path, 'utf8')),
)).join('\n')
assert(!weappBundleText.includes('以测试用户登录'), '微信生产产物包含测试登录入口')
assert(!weappBundleText.includes('/auth/mock-login'), '微信生产产物包含模拟登录接口')
assert(weappBundleText.includes(expectedApiOrigin), '微信生产产物 API origin 与 EXPECTED_RELEASE_API_ORIGIN 不一致')
assert(
  weappBytes <= WEAPP_BUDGET_BYTES,
  `微信主包 ${weappBytes} bytes 超过预算 ${WEAPP_BUDGET_BYTES} bytes`,
)

const h5JavaScript = allH5Files.filter((path) => path.endsWith('.js'))
const h5JavaScriptContents = await Promise.all(h5JavaScript.map((path) => readFile(path, 'utf8')))
const h5BundleText = h5JavaScriptContents.join('\n')
assert(!h5BundleText.includes('以测试用户登录'), 'H5 生产产物包含测试登录入口')
assert(!h5BundleText.includes('/auth/mock-login'), 'H5 生产产物包含模拟登录接口')
assert(h5BundleText.includes(expectedApiOrigin), 'H5 生产产物 API origin 与 EXPECTED_RELEASE_API_ORIGIN 不一致')
const h5GzipSizes = await Promise.all(h5JavaScript.map(async (path) => ({
  path,
  size: gzipSync(await readFile(path)).byteLength,
})))
const h5GzipBytes = h5GzipSizes.reduce((sum, item) => sum + item.size, 0)
const largestH5Chunk = h5GzipSizes.reduce(
  (largest, item) => item.size > largest.size ? item : largest,
  { path: '', size: 0 },
)
assert(
  h5GzipBytes <= H5_JS_GZIP_BUDGET_BYTES,
  `H5 JavaScript gzip 总量 ${h5GzipBytes} bytes 超过预算 ${H5_JS_GZIP_BUDGET_BYTES} bytes`,
)
assert(
  largestH5Chunk.size <= H5_CHUNK_GZIP_BUDGET_BYTES,
  `H5 最大 JavaScript 分块 ${largestH5Chunk.path} (${largestH5Chunk.size} bytes) 超过预算 ${H5_CHUNK_GZIP_BUDGET_BYTES} bytes`,
)

console.log(`release artifacts ok: origin=${expectedApiOrigin}, weapp=${weappBytes}/${WEAPP_BUDGET_BYTES} bytes, h5-js-gzip=${h5GzipBytes}/${H5_JS_GZIP_BUDGET_BYTES} bytes, h5-max-chunk-gzip=${largestH5Chunk.size}/${H5_CHUNK_GZIP_BUDGET_BYTES} bytes`)
}
