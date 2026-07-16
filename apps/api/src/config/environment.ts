import { z } from 'zod'

const localExampleSecrets = new Set([
  'local-access-secret-change-me',
  'local-refresh-secret-change-me',
  'local-minio-secret',
  'local-only-secret',
  'replace-for-local-development-only',
  'baby-mp-local-password',
])

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const environmentSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    CORS_ORIGINS: z.string().min(1).default('http://localhost:10086'),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgresql://baby_mp:baby_mp@localhost:5432/baby_mp'),
    JWT_ACCESS_SECRET: z.string().min(16).default('local-access-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().min(16).default('local-refresh-secret-change-me'),
    MOCK_AUTH_ENABLED: booleanFromString.default('false'),
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('local'),
    S3_BUCKET: z.string().min(3).default('baby-mp-local'),
    S3_ACCESS_KEY: z.string().min(3).default('local-minio'),
    S3_SECRET_KEY: z.string().min(8).default('local-minio-secret'),
    S3_FORCE_PATH_STYLE: booleanFromString.default('true'),
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

    if (environment.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGINS must list explicit origins outside local/test',
        path: ['CORS_ORIGINS'],
      })
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
