import { deleteSharedCourse, listSharedCourses, publishSharedCourse, updateSharedCourse } from './cloud.ts'
import type { CoursePlan, Visit } from '../types.ts'

const PERSON_KEY = 'kofun-marathon-person'
const LEGACY_COURSES_KEY = 'kofun-marathon-courses'
const LEGACY_VISITS_KEY = 'kofun-marathon-visits'
export const COURSE_LIMIT = 20

export type StoreResult = { ok: true } | { ok: false; message: string }

function coursesKey(person: string) {
  return `${LEGACY_COURSES_KEY}:${person}`
}

function visitsKey(person: string) {
  return `${LEGACY_VISITS_KEY}:${person}`
}

function deletedKey(person: string) {
  return `kofun-marathon-deleted:${person}`
}

export type SyncResult = { ok: true; courses: CoursePlan[] } | { ok: false; message: string; courses: CoursePlan[] }

function changedLater(local: CoursePlan, remote: CoursePlan) {
  return (local.updatedAt ?? '') > (remote.updatedAt ?? '')
}

export function mergeCourses(local: CoursePlan[], remote: CoursePlan[], deletedIds: string[]) {
  const deleted = new Set(deletedIds)
  const dropRemote = remote.filter((course) => deleted.has(course.id))
  const remoteById = new Map(remote.filter((course) => !deleted.has(course.id)).map((course) => [course.id, course]))
  const kept = new Map<string, CoursePlan>()
  const replace: CoursePlan[] = []
  for (const [id, remoteCourse] of remoteById) {
    const localCourse = local.find((course) => course.id === id)
    if (localCourse && changedLater(localCourse, remoteCourse)) {
      kept.set(id, localCourse)
      replace.push(localCourse)
    } else {
      kept.set(id, remoteCourse)
    }
  }
  const push: CoursePlan[] = []
  for (const course of local) {
    if (deleted.has(course.id) || kept.has(course.id)) continue
    if (kept.size >= COURSE_LIMIT) continue
    kept.set(course.id, course)
    push.push(course)
  }
  const courses = [...kept.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, COURSE_LIMIT)
  return { courses, push, dropRemote, replace }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): StoreResult {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: 'このブラウザには記録を残せません。プライベート閲覧をやめ、通常のブラウザで開き直してください。',
    }
  }
}

export function loadPerson(): string {
  try {
    return localStorage.getItem(PERSON_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function rememberPerson(name: string): StoreResult {
  const person = name.trim()
  if (!person) return { ok: false, message: '名前を入力してください。' }
  try {
    localStorage.setItem(PERSON_KEY, person)
  } catch {
    return {
      ok: false,
      message: 'このブラウザには記録を残せません。プライベート閲覧をやめ、通常のブラウザで開き直してください。',
    }
  }
  adoptLegacy(person)
  return { ok: true }
}

function adoptLegacy(person: string) {
  if (readJson<CoursePlan[]>(coursesKey(person), []).length === 0) {
    const legacyCourses = readJson<CoursePlan[]>(LEGACY_COURSES_KEY, [])
    if (legacyCourses.length > 0) writeJson(coursesKey(person), legacyCourses)
  }
  if (readJson<Visit[]>(visitsKey(person), []).length === 0) {
    const legacyVisits = readJson<Visit[]>(LEGACY_VISITS_KEY, [])
    if (legacyVisits.length > 0) writeJson(visitsKey(person), legacyVisits)
  }
}

export function loadCourses(person = loadPerson()): CoursePlan[] {
  if (!person) return []
  return readJson<CoursePlan[]>(coursesKey(person), [])
}

export function loadVisits(person = loadPerson()): Visit[] {
  if (!person) return []
  return readJson<Visit[]>(visitsKey(person), [])
}

export function saveCourse(course: CoursePlan, person = loadPerson()): StoreResult {
  if (!person) return { ok: false, message: '先に名前を入れてから保存してください。' }
  const courses = loadCourses(person)
  if (courses.some((item) => item.id === course.id)) return { ok: true }
  if (courses.length >= COURSE_LIMIT) {
    return { ok: false, message: '保存は20本までです。どれかを消してから保存してください。' }
  }
  return writeJson(coursesKey(person), [course, ...courses])
}

function loadDeleted(person: string): string[] {
  return readJson<string[]>(deletedKey(person), [])
}

function rememberDeleted(person: string, id: string) {
  const deleted = loadDeleted(person)
  if (!deleted.includes(id)) writeJson(deletedKey(person), [id, ...deleted])
}

export function deleteCourse(id: string, person = loadPerson()): StoreResult {
  if (!person) return { ok: false, message: '先に名前を入れてください。' }
  rememberDeleted(person, id)
  return writeJson(
    coursesKey(person),
    loadCourses(person).filter((course) => course.id !== id),
  )
}

let syncQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(work, work)
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function saveAndShare(course: CoursePlan, person = loadPerson()): Promise<StoreResult> {
  if (!person) return Promise.resolve({ ok: false, message: '先に名前を入れてから保存してください。' })
  return enqueue(async () => {
    const saved = saveCourse(course, person)
    if (!saved.ok) return saved
    try {
      const shared = await listSharedCourses(person)
      if (shared.some((item) => item.course.id === course.id)) return { ok: true }
      if (shared.length >= COURSE_LIMIT) {
        return { ok: false, message: 'このスマホには保存しました。別のスマホの保存は20本までです。どれかを消してください。' }
      }
      await publishSharedCourse(person, course)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'このスマホには保存しました。別のスマホへは、通信できるときにこのページを開くと送られます。',
      }
    }
  })
}

export function renameAndShare(id: string, title: string, person = loadPerson()): Promise<StoreResult> {
  const nextTitle = title.trim()
  if (!person) return Promise.resolve({ ok: false, message: '先に名前を入れてください。' })
  if (!nextTitle) return Promise.resolve({ ok: false, message: 'コースの名前を入力してください。' })
  if (nextTitle.length > 40) return Promise.resolve({ ok: false, message: 'コースの名前は40文字までにしてください。' })
  return enqueue(async () => {
    const courses = loadCourses(person)
    const current = courses.find((course) => course.id === id)
    if (!current) return { ok: false, message: 'そのコースは、この一覧にありません。' }
    const renamed = { ...current, title: nextTitle, updatedAt: new Date().toISOString() }
    const saved = writeJson(
      coursesKey(person),
      courses.map((course) => (course.id === id ? renamed : course)),
    )
    if (!saved.ok) return saved
    try {
      const shared = await listSharedCourses(person)
      const matches = shared.filter((item) => item.course.id === id)
      const [first, ...rest] = matches
      if (first) {
        await updateSharedCourse(first.remoteId, person, renamed)
        for (const extra of rest) await deleteSharedCourse(extra.remoteId)
      } else {
        await publishSharedCourse(person, renamed)
      }
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'このスマホの名前は変えました。別のスマホへは、通信できるときにこのページを開くと送られます。',
      }
    }
  })
}

export function removeAndUnshare(id: string, person = loadPerson()): Promise<StoreResult> {
  if (!person) return Promise.resolve({ ok: false, message: '先に名前を入れてください。' })
  return enqueue(async () => {
    const removed = deleteCourse(id, person)
    if (!removed.ok) return removed
    try {
      const shared = await listSharedCourses(person)
      for (const item of shared) {
        if (item.course.id === id) await deleteSharedCourse(item.remoteId)
      }
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'このスマホからは消しました。別のスマホには、通信できるときにこのページを開くと反映されます。',
      }
    }
  })
}

export function syncCourses(person = loadPerson()): Promise<SyncResult> {
  if (!person) return Promise.resolve({ ok: true, courses: [] })
  return enqueue(async () => {
    const local = loadCourses(person)
    try {
      const shared = await listSharedCourses(person)
      const merged = mergeCourses(
        local,
        shared.map((item) => item.course),
        loadDeleted(person),
      )
      for (const course of merged.dropRemote) {
        const matches = shared.filter((item) => item.course.id === course.id)
        for (const match of matches) await deleteSharedCourse(match.remoteId)
      }
      for (const course of merged.replace) {
        const matches = shared.filter((item) => item.course.id === course.id)
        const [first, ...rest] = matches
        if (first) await updateSharedCourse(first.remoteId, person, course)
        for (const extra of rest) await deleteSharedCourse(extra.remoteId)
      }
      for (const course of merged.push) await publishSharedCourse(person, course)
      const saved = writeJson(coursesKey(person), merged.courses)
      if (!saved.ok) return { ok: false, message: saved.message, courses: local }
      return { ok: true, courses: merged.courses }
    } catch {
      return {
        ok: false,
        message: '別のスマホとコースを共有できませんでした。通信できるときに、もう一度このページを開いてください。',
        courses: local,
      }
    }
  })
}

export function recordVisit(visit: Visit, person = loadPerson()): StoreResult {
  if (!person) return { ok: false, message: '先に名前を入れてから走ってください。' }
  const visits = loadVisits(person)
  if (visits.some((item) => item.id === visit.id)) return { ok: true }
  return writeJson(visitsKey(person), [visit, ...visits])
}
