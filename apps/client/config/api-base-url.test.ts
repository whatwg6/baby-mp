import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'

import { resolveClientApiBaseUrl } from './api-base-url'

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    cidr: `${address}/24`,
    family: 'IPv4',
    internal,
    mac: '00:00:00:00:00:00',
    netmask: '255.255.255.0',
  }
}

describe('client API build configuration', () => {
  it('preserves an explicit API origin for every build target', () => {
    expect(
      resolveClientApiBaseUrl({
        explicitValue: ' https://api.example.com/ ',
        nodeEnv: 'production',
        taroEnv: 'weapp',
      }),
    ).toBe('https://api.example.com')
  })

  it('uses the preferred LAN interface for a development WeChat build', () => {
    expect(
      resolveClientApiBaseUrl({
        nodeEnv: 'development',
        taroEnv: 'weapp',
        interfaces: {
          bridge0: [ipv4('10.0.0.2')],
          en0: [ipv4('192.168.0.140')],
        },
      }),
    ).toBe('http://192.168.0.140:3000')
  })

  it('rejects missing production API origins and does not infer non-WeChat development origins', () => {
    const interfaces = { en0: [ipv4('192.168.0.140')] }

    expect(() =>
      resolveClientApiBaseUrl({ nodeEnv: 'production', taroEnv: 'weapp', interfaces }),
    ).toThrow('TARO_APP_API_BASE_URL is required')
    expect(
      resolveClientApiBaseUrl({ nodeEnv: 'development', taroEnv: 'h5', interfaces }),
    ).toBe('')
  })

  it('rejects insecure or malformed production API origins', () => {
    for (const explicitValue of [
      'http://api.example.com',
      'api.example.com',
      'https://user:secret@api.example.com',
      'https://api.example.com/api',
      'https://api.example.com?token=value',
    ]) {
      expect(() => resolveClientApiBaseUrl({
        explicitValue,
        nodeEnv: 'production',
        taroEnv: 'weapp',
      })).toThrow(/valid HTTP\(S\) origin|must use HTTPS/)
    }
  })

  it('allows an explicit local HTTP origin only for development builds', () => {
    expect(resolveClientApiBaseUrl({
      explicitValue: 'http://127.0.0.1:3300/',
      nodeEnv: 'development',
      taroEnv: 'h5',
    })).toBe('http://127.0.0.1:3300')
  })
})
