import { useEffect, useRef, useState } from 'react'
import type { CourseStop, LatLng } from '../types.ts'

export type MapNearby = LatLng & {
  id: string
  name: string
  selected: boolean
  labeled?: boolean
}

const NO_TRACK: [number, number][] = []

type MapViewProps = {
  center: LatLng
  start: LatLng | null
  stops: CourseStop[]
  nearby: MapNearby[]
  line: [number, number][]
  track?: [number, number][]
  user: LatLng | null
  draggable: boolean
  focusMeters?: number
  className?: string
  onStartChange?: (point: LatLng) => void
  onStopClick?: (stop: CourseStop) => void
  onNearbyClick?: (id: string) => void
}

export function MapView({
  center,
  start,
  stops,
  nearby,
  line,
  track = NO_TRACK,
  user,
  draggable,
  focusMeters,
  className,
  onStartChange,
  onStopClick,
  onNearbyClick,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const onStartChangeRef = useRef(onStartChange)
  const onStopClickRef = useRef(onStopClick)
  const onNearbyClickRef = useRef(onNearbyClick)
  const initialCenter = useRef(center)
  const focusedRef = useRef(false)
  const touchingRef = useRef(false)
  const [ready, setReady] = useState(false)
  onStartChangeRef.current = onStartChange
  onStopClickRef.current = onStopClick
  onNearbyClickRef.current = onNearbyClick

  useEffect(() => {
    let cancelled = false
    const first = initialCenter.current
    void import('leaflet').then((leaflet) => {
      if (cancelled || !hostRef.current || mapRef.current) return
      const map = leaflet
        .map(hostRef.current, {
          zoomControl: true,
          zoomSnap: 0,
          touchZoom: true,
          dragging: true,
        })
        .setView([first.lat, first.lng], 14)
      map.on('movestart', (event) => {
        if ('originalEvent' in event && event.originalEvent) touchingRef.current = true
      })
      map.on('moveend', () => {
        touchingRef.current = false
      })
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        })
        .addTo(map)
      layerRef.current = leaflet.layerGroup().addTo(map)
      mapRef.current = map
      setReady(true)
    })
    return () => {
      cancelled = true
      mapRef.current?.stop()
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layers = layerRef.current
    if (!ready || !map || !layers) return
    void import('leaflet').then((leaflet) => {
      layers.clearLayers()
      if (track.length > 1) {
        leaflet.polyline(track, { color: '#1d4e89', weight: 4 }).addTo(layers)
      }
      if (line.length > 1) {
        leaflet.polyline(line, { color: '#2f6f4e', weight: 5 }).addTo(layers)
      }
      for (const point of nearby) {
        leaflet
          .circleMarker([point.lat, point.lng], {
            radius: point.selected ? 9 : 7,
            color: '#6b4423',
            fillColor: point.selected ? '#e7c7a1' : '#fffdf8',
            fillOpacity: 1,
            weight: 2,
          })
          .bindTooltip(point.selected ? `${point.name}（選択中）` : point.name, {
            permanent: Boolean(point.labeled),
            direction: 'top',
          })
          .on('click', () => onNearbyClickRef.current?.(point.id))
          .addTo(layers)
      }
      for (const stop of stops) {
        leaflet.circleMarker([stop.lat, stop.lng], {
          radius: 8,
          color: '#6b4423',
          fillColor: '#e7c7a1',
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(stop.name)
          .on('click', () => onStopClickRef.current?.(stop))
          .addTo(layers)
      }
      if (user) {
        leaflet.circleMarker([user.lat, user.lng], {
          radius: 7,
          color: '#1d4e89',
          fillColor: '#7eb6ff',
          fillOpacity: 1,
          weight: 2,
        }).bindTooltip('今いる場所').addTo(layers)
      }
      if (start) {
        const marker = leaflet.marker([start.lat, start.lng], {
          draggable,
          icon: leaflet.divIcon({
            className: 'start-pin',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        })
        marker.bindTooltip('起点')
        marker.on('dragend', () => {
          const next = marker.getLatLng()
          onStartChangeRef.current?.({ lat: next.lat, lng: next.lng })
        })
        marker.addTo(layers)
      }
      if (!map.getContainer().isConnected) return
      map.invalidateSize()
      if (focusMeters && user) {
        if (!focusedRef.current) {
          const half = focusMeters / 2
          const latScale = 111320
          const lngScale = 111320 * Math.cos((user.lat * Math.PI) / 180) || latScale
          map.fitBounds(
            leaflet.latLngBounds(
              [user.lat - half / latScale, user.lng - half / lngScale],
              [user.lat + half / latScale, user.lng + half / lngScale],
            ),
            { animate: false, padding: [0, 0], maxZoom: 19 },
          )
          focusedRef.current = true
        }
        return
      }
      focusedRef.current = false
      const bounds = leaflet.latLngBounds([])
      if (start) bounds.extend([start.lat, start.lng])
      for (const stop of stops) bounds.extend([stop.lat, stop.lng])
      if (line.length > 1) bounds.extend(line)
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { animate: false })
      else map.setView([center.lat, center.lng], 14, { animate: false })
    })
  }, [ready, center, start, stops, nearby, line, track, user, draggable, focusMeters, className])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focusMeters || !user || !focusedRef.current || touchingRef.current) return
    const here = map.getCenter()
    const samePlace = Math.abs(here.lat - user.lat) < 1e-7 && Math.abs(here.lng - user.lng) < 1e-7
    if (samePlace) return
    map.setView([user.lat, user.lng], map.getZoom(), { animate: false })
  }, [ready, user, focusMeters])

  return <div ref={hostRef} className={className ? `map ${className}` : 'map'} />
}
