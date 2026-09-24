import type { CoursePlan, Visit } from '../types.ts'

const COURSES_KEY = 'kofun-marathon-courses'
const VISITS_KEY = 'kofun-marathon-visits'
export const COURSE_LIMIT = 20

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function loadCourses(): CoursePlan[] {
  return readJson<CoursePlan[]>(COURSES_KEY, [])
}

export function loadVisits(): Visit[] {
  return readJson<Visit[]>(VISITS_KEY, [])
}

export function saveCourse(course: CoursePlan): { ok: true } | { ok: false; message: string } {
  const courses = loadCourses()
  if (courses.some((item) => item.id === course.id)) return { ok: true }
  if (courses.length >= COURSE_LIMIT) {
    return { ok: false, message: '保存は20本までです。どれかを消してから保存してください。' }
  }
  localStorage.setItem(COURSES_KEY, JSON.stringify([course, ...courses]))
  return { ok: true }
}

export function deleteCourse(id: string) {
  const courses = loadCourses().filter((course) => course.id !== id)
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses))
}

export function recordVisit(visit: Visit) {
  const visits = loadVisits()
  if (visits.some((item) => item.id === visit.id)) return
  localStorage.setItem(VISITS_KEY, JSON.stringify([visit, ...visits]))
}
