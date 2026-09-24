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

export function deleteCourse(id: string, person = loadPerson()): StoreResult {
  if (!person) return { ok: false, message: '先に名前を入れてください。' }
  return writeJson(
    coursesKey(person),
    loadCourses(person).filter((course) => course.id !== id),
  )
}

export function recordVisit(visit: Visit, person = loadPerson()): StoreResult {
  if (!person) return { ok: false, message: '先に名前を入れてから走ってください。' }
  const visits = loadVisits(person)
  if (visits.some((item) => item.id === visit.id)) return { ok: true }
  return writeJson(visitsKey(person), [visit, ...visits])
}
