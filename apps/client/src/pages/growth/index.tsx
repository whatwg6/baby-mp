import { Button, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { GrowthMetric, GrowthPoint, GrowthSeries } from '@baby-mp/contracts'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { getBabyContext, loadBabies, selectBaby, useBabyState } from '../../features/babies/store'
import { getGrowthSeries } from '../../features/growth/api'
import { formatGrowthDate, formatGrowthValue, twelveMonthsAgo } from '../../features/growth/format'
import { GrowthChart } from '../../features/growth/GrowthChart'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './index.scss'

const METRIC_STORAGE_KEY = 'baby-mp.growth-metric.v1'
type GrowthRange = '12m' | 'all'

export default function GrowthPage() {
  const ready = useProtectedPage()
  const babyState = useBabyState()
  const baby = babyState.current
  const [metric, setMetric] = useState<GrowthMetric>('height')
  const [range, setRange] = useState<GrowthRange>('12m')
  const [series, setSeries] = useState<GrowthSeries>()
  const [selected, setSelected] = useState<GrowthPoint>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [allHistoryFallback, setAllHistoryFallback] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [showRevision, setShowRevision] = useState(0)
  const requestRevision = useRef(0)

  useEffect(() => {
    void platform.getStorage<GrowthMetric>(METRIC_STORAGE_KEY).then((stored) => {
      if (stored === 'height' || stored === 'weight') setMetric(stored)
    })
  }, [])
  useDidShow(() => setShowRevision((value) => value + 1))

  const load = useCallback(async () => {
    if (!baby?.id) return
    const revision = ++requestRevision.current
    const context = getBabyContext()
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    try {
      const now = new Date()
      const recent = range === '12m'
        ? await getGrowthSeries(baby.id, { metric, startAt: twelveMonthsAgo(now), endAt: now.toISOString() })
        : await getGrowthSeries(baby.id, { metric })
      let result = recent
      let fallback = false
      if (range === '12m' && recent.points.length === 0) {
        const all = await getGrowthSeries(baby.id, { metric })
        if (all.points.length > 0) { result = all; fallback = true }
      }
      const latest = getBabyContext()
      if (revision !== requestRevision.current || latest.babyId !== context.babyId || latest.generation !== context.generation) return
      setSeries(result)
      setAllHistoryFallback(fallback)
    } catch (cause) {
      const latest = getBabyContext()
      if (revision === requestRevision.current && latest.babyId === context.babyId && latest.generation === context.generation) {
        if (isResourceAccessError(cause)) {
          setSeries(undefined)
          setAllHistoryFallback(false)
          void loadBabies().catch(() => undefined)
        }
        setError(cause instanceof Error ? cause.message : '成长数据加载失败')
      }
    } finally {
      if (revision === requestRevision.current) setLoading(false)
    }
  }, [baby?.id, metric, range])

  useEffect(() => { setSeries(undefined); setAllHistoryFallback(false); void load() }, [load, showRevision])

  const chooseMetric = (next: GrowthMetric) => {
    setMetric(next)
    setSelected(undefined)
    void platform.setStorage(METRIC_STORAGE_KEY, next)
  }

  if (!ready || babyState.status === 'idle' || babyState.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在准备成长数据" /></View>
  if (babyState.status === 'error') return <View className="page-shell"><PageState kind="error" description={babyState.error} actionLabel="重新加载" onAction={() => void loadBabies()} /></View>
  if (!baby) return <View className="page-shell"><PageState kind="empty" title="先创建宝宝档案" description="创建档案后，可以持续查看身高和体重变化。" actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} /></View>

  const points = series?.points ?? []
  const unit = metric === 'height' ? 'cm' : 'kg'
  return <View className="page-shell growth-page">
    <View className="growth-baby" onClick={() => setSwitcherOpen(true)}><View><Text className="growth-baby__label">当前宝宝</Text><Text className="growth-baby__name">{baby.name}的成长数据</Text></View><Text>⌄</Text></View>
    <View className="growth-segments"><Button className={metric === 'height' ? 'is-active' : ''} onClick={() => chooseMetric('height')}>身高</Button><Button className={metric === 'weight' ? 'is-active' : ''} onClick={() => chooseMetric('weight')}>体重</Button></View>
    <View className="growth-range"><Text>时间范围</Text><View><Button size="mini" className={range === '12m' ? 'is-active' : ''} onClick={() => setRange('12m')}>近 12 个月</Button><Button size="mini" className={range === 'all' ? 'is-active' : ''} onClick={() => setRange('all')}>全部</Button></View></View>

    {loading && !series ? <PageState kind="loading" title="正在绘制成长变化" /> : null}
    {!loading && error && !series ? <PageState kind="error" title="成长数据加载失败" description={error} actionLabel="重新加载" onAction={() => void load()} /> : null}
    {!loading && !error && points.length === 0 ? <PageState kind="empty" title={`还没有${metric === 'height' ? '身高' : '体重'}数据`} description="新增测量后，数据点和历史记录会显示在这里。" actionLabel={baby.role === 'viewer' ? undefined : '新增测量'} onAction={baby.role === 'viewer' ? undefined : () => void platform.navigateTo(`/pages/records/edit?type=measurement&babyId=${baby.id}`)} /> : null}
    {points.length > 0 ? <>
      {allHistoryFallback ? <Text className="growth-fallback-note">近 12 个月没有数据，已展示全部历史记录。</Text> : null}
      <GrowthChart points={points} metric={metric} unit={unit} selectedId={selected?.recordId} onSelect={setSelected} />
      {selected ? <View className="growth-selected"><View><Text className="growth-selected__value">{formatGrowthValue(selected.value, metric)} {unit}</Text><Text className="growth-selected__date">{formatGrowthDate(selected.occurredAt)}</Text></View><Button size="mini" onClick={() => void platform.navigateTo(`/pages/records/detail?id=${selected.recordId}`)}>查看记录</Button></View> : <Text className="growth-chart-hint">点击图表中的数据点查看精确值</Text>}
      <View className="growth-history__heading"><Text>历史记录（{points.length}）</Text>{baby.role !== 'viewer' ? <Button size="mini" onClick={() => void platform.navigateTo(`/pages/records/edit?type=measurement&babyId=${baby.id}`)}>＋ 新增</Button> : null}</View>
      <View className="growth-history">{[...points].reverse().map((point) => <View className="growth-history__item" key={point.recordId} onClick={() => void platform.navigateTo(`/pages/records/detail?id=${point.recordId}`)}><Text>{formatGrowthDate(point.occurredAt)}</Text><View><Text className="growth-history__value">{formatGrowthValue(point.value, metric)} {unit}</Text><Text className="growth-history__arrow">›</Text></View></View>)}</View>
    </> : null}
    {error && series ? <View className="growth-inline-error"><Text>{error}</Text><Button size="mini" onClick={() => void load()}>重新加载</Button></View> : null}
    <Text className="growth-medical-note">成长数据仅用于家庭记录，不构成医疗建议。页面不提供百分位、正常/异常判断或预测结论。</Text>

    {switcherOpen ? <View className="growth-switcher-overlay" onClick={() => setSwitcherOpen(false)}><View className="growth-switcher" onClick={(event) => event.stopPropagation()}><Text className="growth-switcher__title">切换宝宝</Text>{babyState.babies.map((item) => <View className={`growth-switcher__item${item.id === baby.id ? ' is-current' : ''}`} key={item.id} onClick={() => void selectBaby(item.id).then(() => setSwitcherOpen(false))}><Text>{item.name}</Text><Text>{item.id === baby.id ? '✓' : ''}</Text></View>)}</View></View> : null}
  </View>
}
