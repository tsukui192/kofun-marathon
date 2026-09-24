import { useState } from 'react'
import { MapView } from '../components/MapView.tsx'
import { fetchWiki, type WikiSummary } from '../lib/api.ts'
import { formatKm } from '../lib/geo.ts'
import type { CoursePlan, CourseStop } from '../types.ts'

type CoursePageProps = {
  course: CoursePlan
  saveMessage: string
  onRun: () => void
  onBack: () => void
  onSave: () => void
}

export function CoursePage({ course, saveMessage, onRun, onBack, onSave }: CoursePageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wiki, setWiki] = useState<WikiSummary | null>(null)
  const [wikiError, setWikiError] = useState('')
  const [loading, setLoading] = useState(false)

  async function openStop(stop: CourseStop) {
    setSelectedId(stop.id)
    setWiki(null)
    setWikiError('')
    setLoading(true)
    try {
      setWiki(await fetchWiki(stop.name, stop.address))
    } catch (caught) {
      setWikiError(
        caught instanceof Error ? caught.message : 'ウィキペディアにまとめが見つかりませんでした。',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page">
      <header>
        <p className="step">2 / 3</p>
        <h1>周回コース</h1>
      </header>
      <p className="distance">
        {formatKm(course.distanceKm)}
        <span>希望 {formatKm(course.targetKm)}</span>
      </p>
      <MapView
        center={course.start}
        start={course.start}
        stops={course.stops}
        nearby={[]}
        line={course.line}
        user={null}
        draggable={false}
        onStopClick={(stop) => void openStop(stop)}
      />
      <p className="muted">古墳を押すと、ウィキペディアの要約が出ます。</p>
      <ol className="list">
        {course.stops.map((stop) => (
          <li key={stop.id}>
            <button type="button" className="text-button" onClick={() => void openStop(stop)}>
              <strong>{stop.name}</strong>
              <span className="muted">{stop.address}</span>
            </button>
            {selectedId === stop.id && loading && <p className="muted">要約を読んでいます。</p>}
            {selectedId === stop.id && wikiError && <p className="error">{wikiError}</p>}
            {selectedId === stop.id && wiki && (
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
                <p className="muted">
                  日本語版ウィキペディアの記事に基づきます。
                  <a href={wiki.url} target="_blank" rel="noreferrer">
                    記事を開く
                  </a>
                </p>
              </article>
            )}
          </li>
        ))}
      </ol>
      <p className="muted">道に沿った徒歩ルートです。直線ではありません。</p>
      {saveMessage && (
        <p className={saveMessage === '保存しました。' ? 'muted' : 'error'}>{saveMessage}</p>
      )}
      <div className="row">
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
