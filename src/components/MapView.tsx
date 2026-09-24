import { useEffect, useRef, useState } from 'react'
import type { CourseStop, LatLng } from '../types.ts'

type MapViewProps = {
  center: LatLng
  start: LatLng | null
  stops: CourseStop[]
  nearby: LatLng[]
  line: [number, number][]
  user: LatLng | null
  draggable: boolean
  onStartChange?: (point: LatLng) => void
  onStopClick?: (stop: CourseStop) => void
}

export function MapView({
  center,
  start,
  stops,
  nearby,
  line,
  user,
  draggable,
  onStartChange,
  onStopClick,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const onStartChangeRef = useRef(onStartChange)
  const onStopClickRef = useRef(onStopClick)
  const initialCenter = useRef(center)
  const [ready, setReady] = useState(false)
  onStartChangeRef.current = onStartChange
  onStopClickRef.current = onStopClick

  useEffect(() => {
    let cancelled = false
    const first = initialCenter.current
    void import('leaflet').then((leaflet) => {
      if (cancelled || !hostRef.current || mapRef.current) return
      const map = leaflet.map(hostRef.current, { zoomControl: true }).setView([first.lat, first.lng], 14)
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
      if (line.length > 1) {
        leaflet.polyline(line, { color: '#2f6f4e', weight: 5 }).addTo(layers)
      }
      for (const point of nearby) {
        leaflet.circleMarker([point.lat, point.lng], {
          radius: 4,
          color: '#8a5a2a',
          weight: 1,
          fillOpacity: 0.7,
        }).addTo(layers)
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
      const bounds = leaflet.latLngBounds([])
      if (start) bounds.extend([start.lat, start.lng])
      for (const stop of stops) bounds.extend([stop.lat, stop.lng])
      if (line.length > 1) bounds.extend(line)
      if (!map.getContainer().isConnected) return
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { animate: false })
      else map.setView([center.lat, center.lng], 14, { animate: false })
    })
  }, [ready, center, start, stops, nearby, line, user, draggable])

  return <div ref={hostRef} className="map" />
}
