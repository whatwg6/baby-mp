import { z } from 'zod'
import { isIP } from 'node:net'

const localExampleSecrets = new Set([
  'local-access-secret-change-me',
  'local-refresh-secret-change-me',
  'local-minio-secret',
  'local-only-secret',
  'replace-for-local-development-only',
  'baby-mp-local-password',
])
const productionWechatAppId = 'wx433aecb90d44e9fe'

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      url.origin === value.replace(/\/$/, '')
  } catch {
    return false
  }
}

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const timeZone = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}, 'must be a valid IANA time zone')

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

const optionalWechatAppId = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().regex(/^wx[0-9a-fA-F]{16}$/, 'must be a valid WeChat AppID').optional(),
)

const optionalWechatAppSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(16, 'must contain at least 16 characters').optional(),
)

const trustProxy = z.string().min(1).refine((value) => {
  if (value === 'false' || value === 'loopback') return true
  return value.split(',').every((entry) => {
    const [address, prefix, extra] = entry.trim().split('/')
    if (!address || extra) return false
    const version = isIP(address)
    if (!version) return false
    if (prefix === undefined) return true
    if (!/^\d+$/.test(prefix)) return false
    const bits = Number(prefix)
    return bits >= 0 && bits <= (version === 4 ? 32 : 128)
  })
}, 'must be false, loopback, or an explicit comma-separated IP/CIDR allowlist')

const environmentSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TRUST_PROXY: trustProxy.default('false'),
    JSON_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(262_144),
    SWAGGER_ENABLED: booleanFromString.default('false'),
    INTERNAL_MONITORING_TOKEN: optionalString,
    BUSINESS_TIME_ZONE: timeZone.default('Asia/Shanghai'),
    CORS_ORIGINS: z.string().min(1).default('http://localhost:10086'),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgresql://baby_mp:baby_mp@localhost:5432/baby_mp'),
    JWT_ACCESS_SECRET: z.string().min(16).default('local-access-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().min(16).default('local-refresh-secret-change-me'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(2_592_000),
    MOCK_AUTH_ENABLED: booleanFromString.default('false'),
    WECHAT_APP_ID: optionalWechatAppId,
    WECHAT_APP_SECRET: optionalWechatAppSecret,
    WECHAT_CODE2SESSION_URL: z
      .string()
      .url()
      .default('https://api.weixin.qq.com/sns/jscode2session'),
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('local'),
    S3_BUCKET: z.string().min(3).default('baby-mp-local'),
    S3_ACCESS_KEY: z.string().min(3).default('local-minio'),
    S3_SECRET_KEY: z.string().min(8).default('local-minio-secret'),
    S3_FORCE_PATH_STYLE: booleanFromString.default('true'),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
    RATE_LIMIT_INVITE_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
    RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
    EXPORT_WORKER_MAX_ITERATION_SECONDS: z.coerce.number().int().min(300).max(86_400).default(7_200),
    MEDIA_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  })
  .superRefine((environment, context) => {
    if (!['staging', 'production'].includes(environment.APP_ENV)) {
      return
    }

    if (environment.MOCK_AUTH_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MOCK_AUTH_ENABLED must be false in staging and production',
        path: ['MOCK_AUTH_ENABLED'],
      })
    }

    const corsOrigins = environment.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    if (corsOrigins.some((origin) => !isHttpsOrigin(origin))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGINS must list explicit HTTPS origins without paths, credentials, query, or fragments outside local/test',
        path: ['CORS_ORIGINS'],
      })
    }

    for (const key of ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'INTERNAL_MONITORING_TOKEN'] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required in staging and production`,
          path: [key],
        })
      }
    }

    if (environment.WECHAT_APP_ID && environment.WECHAT_APP_ID !== productionWechatAppId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `WECHAT_APP_ID must be ${productionWechatAppId} in staging and production`,
        path: ['WECHAT_APP_ID'],
      })
    }

    if (environment.INTERNAL_MONITORING_TOKEN && environment.INTERNAL_MONITORING_TOKEN.length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'INTERNAL_MONITORING_TOKEN must contain at least 32 characters',
        path: ['INTERNAL_MONITORING_TOKEN'],
      })
    }

    for (const key of ['WECHAT_CODE2SESSION_URL', 'S3_ENDPOINT'] as const) {
      if (new URL(environment[key]).protocol !== 'https:') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must use HTTPS in staging and production`,
          path: [key],
        })
      }
    }

    if (environment.SWAGGER_ENABLED && !environment.INTERNAL_MONITORING_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'INTERNAL_MONITORING_TOKEN is required when Swagger is enabled outside local/test',
        path: ['SWAGGER_ENABLED'],
      })
    }

    if (environment.APP_ENV === 'production') {
      const sslMode = new URL(environment.DATABASE_URL).searchParams.get('sslmode')
      if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL must set sslmode=require, verify-ca, or verify-full in production',
          path: ['DATABASE_URL'],
        })
      }
    }

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'S3_SECRET_KEY'] as const) {
      if (localExampleSecrets.has(environment[key])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must not use a local example value outside local/test`,
          path: [key],
        })
      }
    }

    for (const key of ['DATABASE_URL', 'S3_ENDPOINT'] as const) {
      const hostname = new URL(environment[key]).hostname
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must not point to localhost outside local/test`,
          path: [key],
        })
      }
    }
  })

export type Environment = z.infer<typeof environmentSchema>

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input)

  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid API configuration: ${summary}`)
  }

  return result.data
}
