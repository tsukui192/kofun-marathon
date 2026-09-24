import { useEffect, useState } from 'react'
import { MapView } from '../components/MapView.tsx'
import { knownNote } from '../data/notes.ts'
import { fetchKofunInfo, type WikiSummary } from '../lib/api.ts'
import { formatKm } from '../lib/geo.ts'
import type { CoursePlan, CourseStop } from '../types.ts'

type CoursePageProps = {
  course: CoursePlan
  choices: CourseStop[]
  busy: boolean
  error: string
  saveMessage: string
  onRun: () => void
  onBack: () => void
  onSave: () => void
  onRevise: (ids: string[]) => void
}

export function CoursePage({
  course,
  choices,
  busy,
  error,
  saveMessage,
  onRun,
  onBack,
  onSave,
  onRevise,
}: CoursePageProps) {
  const [summaries, setSummaries] = useState<Record<string, WikiSummary>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all(
      choices.map(async (stop) => {
        const summary = await fetchKofunInfo(stop.name, stop.address, knownNote(stop.name))
        return [stop.id, summary] as const
      }),
    ).then((rows) => {
      if (cancelled) return
      setSummaries(Object.fromEntries(rows))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [choices])

  return (
    <section className="page course-page">
      <header>
        <p className="step">2 / 3</p>
        <h1>周回コース</h1>
      </header>
      <section className="group">
        <p className="distance">
          {formatKm(course.distanceKm)}
          <span>希望 {formatKm(course.targetKm)} · 選んだ古墳の道のり</span>
        </p>
        <MapView
          center={course.start}
          start={course.start}
          stops={course.stops}
          nearby={[]}
          line={course.line}
          user={null}
          draggable={false}
        />
      </section>
      <section className="group">
        <p className="notice">各古墳の説明は、下に出ています。</p>
        <p className="notice">回る古墳のチェックを変えると、道順が組み直されます。</p>
      </section>
      <ol className="list">
        {choices.map((stop) => {
          const picked = course.stops.some((item) => item.id === stop.id)
          const wiki = summaries[stop.id]
          return (
          <li key={stop.id} className="group">
            <div className="group">
              <label className="check">
                <input
                  type="checkbox"
                  checked={picked}
                  disabled={busy}
                  onChange={() => {
                    const next = picked
                      ? course.stops.filter((item) => item.id !== stop.id).map((item) => item.id)
                      : [...course.stops.map((item) => item.id), stop.id]
                    onRevise(next)
                  }}
                />
                この古墳を回る
              </label>
              <div className="text-button">
                <strong>{stop.name}</strong>
                <span className="muted">{stop.address}</span>
              </div>
            </div>
            {loading && !wiki && <p className="muted">説明を読んでいます。</p>}
            {wiki && wiki.period === '特になし' && wiki.size === '特になし' && wiki.notes === '特になし' && (
              <p>特になし</p>
            )}
            {wiki && (wiki.period !== '特になし' || wiki.size !== '特になし' || wiki.notes !== '特になし') && (
              <article className="card">
                <h2>{wiki.title}</h2>
                <p>
                  <strong>年代</strong> {wiki.period}
                </p>
                <p>
                  <strong>サイズ</strong> {wiki.size}
                </p>
                <p>
                  <strong>特記事項</strong> {wiki.notes}
                </p>
                {wiki.sources.length > 0 && (
                  <p className="muted">
                    {wiki.sources.join('、')}に基づきます。
                    {wiki.url && (
                      <a href={wiki.url} target="_blank" rel="noreferrer">
                        出典を開く
                      </a>
                    )}
                  </p>
                )}
              </article>
            )}
          </li>
          )
        })}
      </ol>
      {busy && <p className="muted">選んだ古墳で道順を作り直しています。</p>}
      {error && <p className="error">{error}</p>}
      <section className="group">
        <p className="distance">
          {formatKm(course.distanceKm)}
          <span>走行距離</span>
        </p>
        <p className="muted">チェックした古墳を通り、起点に戻る道のりの長さです。</p>
      </section>
      {saveMessage && (
        <p className={saveMessage === '保存しました。' ? 'muted' : 'error'}>{saveMessage}</p>
      )}
      <div className="row group">
        <button type="button" onClick={onRun}>
          走る
        </button>
        <button type="button" className="secondary" onClick={onSave}>
          保存する
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          作り直す
        </button>
      </div>
    </section>
  )
}
