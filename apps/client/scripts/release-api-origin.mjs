import { isIP } from 'node:net'

function isPrivateIpv4(hostname) {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false
  return octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
}

function assertOrigin(condition, message) {
  if (!condition) throw new Error(message)
}

export function resolveExpectedReleaseApiOrigin(environment = process.env) {
  const raw = environment.EXPECTED_RELEASE_API_ORIGIN?.trim()
  assertOrigin(raw, 'EXPECTED_RELEASE_API_ORIGIN 必须显式设置为本次发布 API origin')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('EXPECTED_RELEASE_API_ORIGIN 不是有效 URL')
  }
  assertOrigin(url.protocol === 'https:', 'EXPECTED_RELEASE_API_ORIGIN 必须使用 HTTPS')
  assertOrigin(url.origin === raw, 'EXPECTED_RELEASE_API_ORIGIN 必须是不含路径、认证、查询或片段的精确 origin')

  const hostname = url.hostname.toLowerCase()
  const addressHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  const invalidTestHostname = hostname === 'invalid' || hostname.endsWith('.invalid')
  const allowInvalidInCi = environment.CI === 'true' &&
    environment.ALLOW_TEST_RELEASE_API_ORIGIN === 'true' &&
    invalidTestHostname
  const reservedExampleHostname = ['example.com', 'example.net', 'example.org']
    .some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ||
    hostname === 'example' || hostname.endsWith('.example') ||
    hostname === 'test' || hostname.endsWith('.test')
  const localHostname = hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname.endsWith('.internal')
  const localIp = isIP(addressHostname) !== 0 && (
    isPrivateIpv4(addressHostname) || addressHostname === '0.0.0.0' ||
    addressHostname === '::1' || addressHostname === '0:0:0:0:0:0:0:1' ||
    /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(addressHostname)
  )
  const literalIp = isIP(addressHostname) !== 0
  assertOrigin(
    allowInvalidInCi || (
      !invalidTestHostname &&
      !reservedExampleHostname &&
      !localHostname &&
      !localIp &&
      !literalIp
    ),
    'EXPECTED_RELEASE_API_ORIGIN 必须使用正式公网域名，不得使用 .invalid、localhost、示例域名或 IP 地址',
  )
  return raw
}
