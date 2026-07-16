import { describe, expect, it } from 'vitest'

import { validateEnvironment } from '../src/config/environment'

const productionEnvironment = {
  APP_ENV: 'production',
  API_HOST: '0.0.0.0',
  API_PORT: '3000',
  APP_VERSION: '1.0.0',
  CORS_ORIGINS: 'https://app.example.com',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/baby_mp',
  JWT_ACCESS_SECRET: 'production-access-secret',
  JWT_REFRESH_SECRET: 'production-refresh-secret',
  MOCK_AUTH_ENABLED: 'false',
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

  it('rejects wildcard CORS outside local and test', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        APP_ENV: 'staging',
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/CORS_ORIGINS must list explicit origins/)
  })
})
