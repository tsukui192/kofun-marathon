import { useEffect, useState } from 'react'
import { knownNote } from '../data/notes.ts'
import { fetchKofunInfo, type WikiSummary } from '../lib/api.ts'

type KofunFactsProps = {
  name: string
  address: string
}

export function KofunFacts({ name, address }: KofunFactsProps) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    setWiki(null)
    void fetchKofunInfo(name, address, knownNote(name)).then((summary) => {
      if (!cancelled) setWiki(summary)
    })
    return () => {
      cancelled = true
    }
  }, [name, address])

  if (!wiki) return <p className="muted">説明を読んでいます。</p>
  if (wiki.period === '特になし' && wiki.size === '特になし' && wiki.notes === '特になし') {
    return <p>特になし</p>
  }
  return (
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
  )
}
