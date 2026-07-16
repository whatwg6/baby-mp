import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  getStorage: vi.fn(),
  setStorage: vi.fn(),
  removeStorage: vi.fn(),
}))
const listBabiesMock = vi.hoisted(() => vi.fn())

vi.mock('../../platform', () => ({ platform: platformMock }))
vi.mock('./api', () => ({ listBabies: listBabiesMock }))

const babyA = {
  id: '11111111-1111-4111-8111-111111111111', name: 'A', gender: 'unspecified' as const,
  birthDate: '2025-01-01', birthTime: null, birthHeightCm: null, birthWeightKg: null,
  avatarUrl: null, role: 'admin' as const, version: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const babyB = { ...babyA, id: '22222222-2222-4222-8222-222222222222', name: 'B' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('baby context store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    platformMock.getStorage.mockResolvedValue(babyA.id)
    platformMock.setStorage.mockResolvedValue(undefined)
    platformMock.removeStorage.mockResolvedValue(undefined)
  })

  it('publishes a baby switch before slow persistence finishes', async () => {
    listBabiesMock.mockResolvedValue([babyA, babyB])
    const storage = deferred<void>()
    const store = await import('./store')
    await store.loadBabies()
    platformMock.setStorage.mockReturnValueOnce(storage.promise)

    const selecting = store.selectBaby(babyB.id)

    expect(store.getBabyState().current?.id).toBe(babyB.id)
    expect(store.getBabyContext()).toMatchObject({ babyId: babyB.id })
    storage.resolve()
    await selecting
  })

  it('discards a stale list response after the user switches baby', async () => {
    listBabiesMock.mockResolvedValueOnce([babyA, babyB])
    const store = await import('./store')
    await store.loadBabies()
    const stale = deferred<typeof babyA[]>()
    listBabiesMock.mockReturnValueOnce(stale.promise)

    const loading = store.loadBabies()
    await store.selectBaby(babyB.id)
    stale.resolve([babyA])
    await loading

    expect(store.getBabyState().current?.id).toBe(babyB.id)
    expect(store.getBabyState().babies).toEqual([babyA, babyB])
  })

  it('discards older concurrent list responses', async () => {
    const older = deferred<typeof babyA[]>()
    const newer = deferred<typeof babyA[]>()
    listBabiesMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    platformMock.getStorage.mockResolvedValue(babyB.id)
    const store = await import('./store')

    const first = store.loadBabies()
    const second = store.loadBabies()
    newer.resolve([babyA, babyB])
    await second
    older.resolve([babyA])
    await first

    expect(store.getBabyState().babies).toEqual([babyA, babyB])
    expect(store.getBabyState().current?.id).toBe(babyB.id)
  })
})
