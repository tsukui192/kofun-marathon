import { noteFor } from './notes.ts'
import type { CoursePlan } from '../types.ts'

const stop = {
  id: '110000277900',
  name: '埼玉古墳群',
  address: '埼玉県 行田市 大字埼玉',
  lat: 36.127829,
  lng: 139.479969,
  note: noteFor('埼玉古墳群'),
}

export const saitamaSample: CoursePlan = {
  id: 'sample-saitama',
  title: '行田市 · 6.0km',
  createdAt: '2026-09-24T09:00:00.000Z',
  targetKm: 5,
  distanceKm: 6,
  start: { lat: 36.13, lng: 139.47, label: '行田市' },
  stops: [stop],
  line: [
    [36.13, 139.47],
    [36.127829, 139.479969],
    [36.13, 139.47],
  ],
}

export const saitamaSampleStop = stop
