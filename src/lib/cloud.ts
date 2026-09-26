import type { CoursePlan } from '../types.ts'

const COURSES_URL = 'https://crudcrud.com/api/00d3454611f946559c1425d6b1291c1b/courses'

export type SharedCourse = {
  remoteId: string
  course: CoursePlan
}

type RemoteRecord = Partial<CoursePlan> & { _id?: string; person?: string }

function asCourse(record: RemoteRecord): CoursePlan | null {
  if (!record.id || !record.title || !record.createdAt || !record.start || !record.stops || !record.line) return null
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    targetKm: record.targetKm ?? 0,
    distanceKm: record.distanceKm ?? 0,
    laps: record.laps,
    fitMessage: record.fitMessage,
    heading: record.heading,
    start: record.start,
    stops: record.stops,
    line: record.line,
  }
}

export async function listSharedCourses(person: string): Promise<SharedCourse[]> {
  const response = await fetch(COURSES_URL)
  if (!response.ok) throw new Error('保存したコースを読み込めませんでした。')
  const records = (await response.json()) as RemoteRecord[]
  return records.flatMap((record) => {
    if (record.person !== person || !record._id) return []
    const course = asCourse(record)
    return course ? [{ remoteId: record._id, course }] : []
  })
}

export async function publishSharedCourse(person: string, course: CoursePlan): Promise<void> {
  const response = await fetch(COURSES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...course, person }),
  })
  if (!response.ok) throw new Error('別のスマホへコースを送れませんでした。')
}

export async function deleteSharedCourse(remoteId: string): Promise<void> {
  const response = await fetch(`${COURSES_URL}/${remoteId}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error('別のスマホからコースを消せませんでした。')
}
