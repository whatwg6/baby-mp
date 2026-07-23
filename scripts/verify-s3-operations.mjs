import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromApi = createRequire(resolve(root, 'apps/api/package.json'))
const {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} = requireFromApi('@aws-sdk/client-s3')
const { getSignedUrl } = requireFromApi('@aws-sdk/s3-request-presigner')

function fail(message) {
  throw new Error(message)
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) fail(`${name} is required`)
  return value
}

function isDenied(status) {
  return status === 401 || status === 403
}

function checkedUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`${name} must be an HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail(`${name} must be an HTTP(S) URL`)
  if (url.username || url.password || url.search || url.hash) {
    fail(`${name} must not contain credentials, query parameters, or fragments`)
  }
  return url
}

async function statusFor(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' })
    await response.body?.cancel()
    return response.status
  } catch {
    return 0
  }
}

const appEnv = process.env.APP_ENV ?? 'local'
if (!['local', 'test', 'staging', 'production'].includes(appEnv)) {
  fail('APP_ENV must be local, test, staging, or production')
}

const endpoint = required('S3_ENDPOINT')
const endpointUrl = checkedUrl(endpoint, 'S3_ENDPOINT')
const region = required('S3_REGION')
const bucket = required('S3_BUCKET')
if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/.test(bucket)) {
  fail('S3_BUCKET has an unsafe or invalid value')
}

const anonymousBucketUrl = checkedUrl(
  process.env.S3_ANONYMOUS_BUCKET_URL ?? `${endpoint.replace(/\/$/, '')}/${bucket}`,
  'S3_ANONYMOUS_BUCKET_URL',
)
if (['staging', 'production'].includes(appEnv) &&
    (endpointUrl.protocol !== 'https:' || anonymousBucketUrl.protocol !== 'https:')) {
  fail('S3 endpoints must use HTTPS outside local/test')
}

const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID
const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
  fail('Supply both S3/AWS access key and secret key, or neither when using another credential provider')
}

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE
    ? process.env.S3_FORCE_PATH_STYLE === 'true'
    : ['local', 'test'].includes(appEnv),
  ...(accessKeyId && secretAccessKey
    ? { credentials: { accessKeyId, secretAccessKey } }
    : {}),
})

await client.send(new HeadBucketCommand({ Bucket: bucket }))
const lifecycle = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))
const rules = lifecycle.Rules ?? []
const exportRule = rules.find((rule) =>
  rule.Status === 'Enabled' &&
  (rule.Filter?.Prefix ?? rule.Prefix) === 'exports/' &&
  rule.Expiration?.Days === 7 &&
  (rule.NoncurrentVersionExpiration?.NoncurrentDays ?? Number.POSITIVE_INFINITY) <= 1,
)
if (!exportRule) fail('Export lifecycle must expire current archives after 7 days and noncurrent versions within 1 day')

const abortsMultipart = rules.some((rule) =>
  rule.Status === 'Enabled' &&
  (rule.Filter?.Prefix ?? rule.Prefix) === 'exports/' &&
  (rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? Number.POSITIVE_INFINITY) <= 1,
)
if (!abortsMultipart) {
  if (['staging', 'production'].includes(appEnv)) {
    fail('Export lifecycle does not abort incomplete multipart uploads within one day')
  }
  process.stderr.write('Local object store omitted multipart lifecycle cleanup; verify the export worker fallback.\n')
}

const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }))
if (versioning.Status === 'Enabled') {
  fail('Bucket versioning retains deleted private objects; disable it or implement version-aware purging')
}

const anonymousListUrl = new URL(anonymousBucketUrl)
anonymousListUrl.searchParams.set('list-type', '2')
anonymousListUrl.searchParams.set('max-keys', '1')
const anonymousListStatus = await statusFor(anonymousListUrl)
if (!isDenied(anonymousListStatus)) {
  fail(`Anonymous bucket listing was not denied (HTTP ${anonymousListStatus})`)
}

const probeKey = process.env.S3_PRIVATE_PROBE_KEY?.trim()
if (probeKey) {
  if (!/^[A-Za-z0-9._/-]+$/.test(probeKey) || probeKey.startsWith('/') || probeKey.includes('..')) {
    fail('S3_PRIVATE_PROBE_KEY must be a URL-safe relative object key')
  }
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: probeKey }))
  const anonymousReadUrl = new URL(`${anonymousBucketUrl.toString().replace(/\/$/, '')}/${probeKey}`)
  const anonymousReadStatus = await statusFor(anonymousReadUrl)
  if (!isDenied(anonymousReadStatus)) {
    fail(`Anonymous object read was not denied (HTTP ${anonymousReadStatus})`)
  }

  const signedProbeUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: probeKey }),
    { expiresIn: 5 },
  )
  const signedReadStatus = await statusFor(signedProbeUrl)
  if (signedReadStatus !== 200) {
    fail(`Fresh signed object URL was not readable (HTTP ${signedReadStatus})`)
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 6_000))
  const expiredReadStatus = await statusFor(signedProbeUrl)
  if (!isDenied(expiredReadStatus)) {
    fail(`Expired signed object URL was not rejected (HTTP ${expiredReadStatus})`)
  }
} else if (['staging', 'production'].includes(appEnv)) {
  fail('S3_PRIVATE_PROBE_KEY is required outside local/test to prove anonymous reads are denied')
} else {
  process.stderr.write('No private object probe supplied; anonymous read and signed-URL checks skipped for local/test.\n')
}

if (['staging', 'production'].includes(appEnv)) {
  const encryption = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }))
  if (!(encryption.ServerSideEncryptionConfiguration?.Rules?.length > 0)) {
    fail('Bucket server-side encryption is required outside local/test')
  }
}

console.log('S3 checks passed: operator access, export lifecycle, private access, signed-URL expiry, and required encryption were verified.')
