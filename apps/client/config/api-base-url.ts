import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>

const preferredInterfaceNames = ['en0', 'en1', 'wlan0', 'eth0']

function isPrivateIpv4(address: string): boolean {
  return (
    /^10(?:\.\d{1,3}){3}$/.test(address) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(address) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(address)
  )
}

function findPrivateIpv4(
  interfaces: NetworkInterfaceMap,
  interfaceNames: readonly string[],
): string | undefined {
  for (const name of interfaceNames) {
    const address = interfaces[name]?.find(
      (candidate) =>
        candidate.family === 'IPv4' &&
        !candidate.internal &&
        isPrivateIpv4(candidate.address),
    )?.address

    if (address) return address
  }

  return undefined
}

export interface ClientApiBaseUrlOptions {
  explicitValue?: string
  nodeEnv?: string
  taroEnv?: string
  interfaces?: NetworkInterfaceMap
}

export function resolveClientApiBaseUrl({
  explicitValue,
  nodeEnv,
  taroEnv,
  interfaces = networkInterfaces(),
}: ClientApiBaseUrlOptions): string {
  const configuredValue = explicitValue?.trim().replace(/\/+$/, '')
  if (configuredValue) return configuredValue

  if (nodeEnv !== 'development' || taroEnv !== 'weapp') return ''

  const preferredAddress = findPrivateIpv4(interfaces, preferredInterfaceNames)
  const fallbackAddress = findPrivateIpv4(interfaces, Object.keys(interfaces))
  const address = preferredAddress ?? fallbackAddress

  return address ? `http://${address}:3000` : ''
}
