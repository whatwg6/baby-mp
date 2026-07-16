export interface RuntimeSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown }
}

export function runtimeSchema<T>(guard: (value: unknown) => value is T): RuntimeSchema<T> {
  return {
    safeParse(value) {
      return guard(value)
        ? { success: true, data: value }
        : { success: false, error: new Error('Unexpected response shape') }
    },
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
