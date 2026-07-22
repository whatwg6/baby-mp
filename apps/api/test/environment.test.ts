import { describe, expect, it } from 'vitest'

import { validateEnvironment } from '../src/config/environment'

const productionEnvironment = {
  APP_ENV: 'production',
  API_HOST: '0.0.0.0',
  API_PORT: '3000',
  APP_VERSION: '1.0.0',
  CORS_ORIGINS: 'https://app.example.com',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/baby_mp?sslmode=verify-full',
  JWT_ACCESS_SECRET: 'production-access-secret',
  JWT_REFRESH_SECRET: 'production-refresh-secret',
  MOCK_AUTH_ENABLED: 'false',
  WECHAT_APP_ID: 'wx433aecb90d44e9fe',
  WECHAT_APP_SECRET: 'production-wechat-secret',
  INTERNAL_MONITORING_TOKEN: 'production-monitoring-token-32-characters',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_REGION: 'cn-test-1',
  S3_BUCKET: 'baby-mp-production',
  S3_ACCESS_KEY: 'production-access-key',
  S3_SECRET_KEY: 'production-storage-secret',
  S3_FORCE_PATH_STYLE: 'false',
}

describe('validateEnvironment', () => {
  it('accepts a production-safe configuration', () => {
    expect(validateEnvironment(productionEnvironment)).toMatchObject({
      APP_ENV: 'production',
      MOCK_AUTH_ENABLED: false,
    })
  })

  it('rejects mock authentication in staging and production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        MOCK_AUTH_ENABLED: 'true',
      }),
    ).toThrow(/MOCK_AUTH_ENABLED must be false/)
  })

  it('rejects local endpoints and example secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://baby_mp:baby_mp@localhost:5432/baby_mp',
        S3_ENDPOINT: 'http://localhost:9000',
        JWT_ACCESS_SECRET: 'replace-for-local-development-only',
      }),
    ).toThrow(/must not/)
  })

  it('requires WeChat credentials, HTTPS dependencies, and database SSL', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/baby_mp',
        S3_ENDPOINT: 'http://s3.example.com',
        WECHAT_APP_SECRET: '',
      }),
    ).toThrow(/WECHAT_APP_SECRET|HTTPS|sslmode/)
  })

  it('requires exact HTTPS CORS origins outside local and test', () => {
    for (const CORS_ORIGINS of [
      '*',
      'http://app.example.com',
      'https://app.example.com/path',
      'https://user:secret@app.example.com',
      'https://app.example.com?token=value',
      'not-an-origin',
    ]) {
      expect(() => validateEnvironment({
        ...productionEnvironment,
        APP_ENV: 'staging',
        CORS_ORIGINS,
      })).toThrow(/CORS_ORIGINS must list explicit HTTPS origins/)
    }
  })

  it('rejects an invalid business time zone', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        BUSINESS_TIME_ZONE: 'not-a-time-zone',
      }),
    ).toThrow(/valid IANA time zone/)
  })

  it('rejects a malformed WeChat AppID', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        WECHAT_APP_ID: 'client-supplied-role-or-id',
      }),
    ).toThrow(/valid WeChat AppID/)
  })

  it('requires the configured project AppID outside local and test', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment,
      APP_ENV: 'staging',
      WECHAT_APP_ID: 'wx1111111111111111',
    })).toThrow(/WECHAT_APP_ID must be wx433aecb90d44e9fe/)
  })

  it('rejects broad or ambiguous trusted proxy settings', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        TRUST_PROXY: 'true',
      }),
    ).toThrow(/explicit comma-separated IP/)

    expect(
      validateEnvironment({
        ...productionEnvironment,
        TRUST_PROXY: '10.0.0.4,2001:db8::/64',
      }).TRUST_PROXY,
    ).toBe('10.0.0.4,2001:db8::/64')
  })
})
