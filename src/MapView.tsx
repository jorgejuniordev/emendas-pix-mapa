import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type LngLatBoundsLike,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { SCALE, type Municipio, type Theme } from './data'

setWorkerUrl(workerUrl)

const MAP_THEME: Record<Theme, { background: string; border: string; selected: string; empty: string }> = {
  claro: { background: '#e9eef2', border: '#ffffff', selected: '#e11d48', empty: '#d0d5dd' },
  escuro: { background: '#0a0e15', border: '#111722', selected: '#fb7185', empty: '#313b4d' },
}

type Geometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
export type MeshFeature = { type: 'Feature'; properties: { id: string }; geometry: Geometry }
export type Mesh = { type: 'FeatureCollection'; features: MeshFeature[] }

interface Props {
  mesh: Mesh
  byId: Map<string, Municipio>
  classOf: (m: Municipio) => number
  tooltipOf: (m: Municipio) => string
  visibleIds: Set<string> | null
  focusIds: string[] | null
  selectedId: string | null
  theme: Theme
  onSelect: (id: string | null) => void
}

const BRAZIL_BOUNDS: LngLatBoundsLike = [
  [-74, -34],
  [-34.7, 5.3],
]

const SOURCE = 'mun'
const FILL_LAYER = 'mun-fill'
const LINE_LAYER = 'mun-line'
const SELECTED_LAYER = 'mun-selected'

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

const isPosition = (c: unknown): c is number[] => typeof (c as number[])[0] === 'number'

function extendBounds(b: Bounds, coords: unknown): void {
  if (!isPosition(coords)) {
    for (const child of coords as unknown[]) extendBounds(b, child)
    return
  }
  const [x, y] = coords
  b.minX = Math.min(b.minX, x)
  b.maxX = Math.max(b.maxX, x)
  b.minY = Math.min(b.minY, y)
  b.maxY = Math.max(b.maxY, y)
}

function bboxOf(features: MeshFeature[]): LngLatBoundsLike | null {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const f of features) extendBounds(b, f.geometry.coordinates)
  if (!Number.isFinite(b.minX)) return null
  return [
    [b.minX, b.minY],
    [b.maxX, b.maxY],
  ]
}

function createMap(container: HTMLDivElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': MAP_THEME.claro.background } }],
    },
    bounds: BRAZIL_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    attributionControl: { customAttribution: 'Malha: IBGE' },
  })
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
  return map
}

function addMunicipioLayers(map: MapLibreMap, mesh: Mesh): void {
  map.addSource(SOURCE, { type: 'geojson', data: mesh as never, promoteId: 'id' })
  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE,
    paint: {
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0.08, 0.85],
    },
  })
  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: SOURCE,
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.1, 8, 0.6] },
  })
  map.addLayer({
    id: SELECTED_LAYER,
    type: 'line',
    source: SOURCE,
    paint: {
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0],
    },
  })
}

function bindTooltip(map: MapLibreMap, tooltipFor: (id: string | undefined) => string | null): void {
  const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 })
  map.on('mousemove', FILL_LAYER, (e) => {
    const text = tooltipFor(e.features?.[0]?.properties?.id as string | undefined)
    if (!text) return
    map.getCanvas().style.cursor = 'pointer'
    popup.setLngLat(e.lngLat).setText(text).addTo(map)
  })
  map.on('mouseleave', FILL_LAYER, () => {
    map.getCanvas().style.cursor = ''
    popup.remove()
  })
}

function bindClick(map: MapLibreMap, onSelect: (id: string | null) => void): void {
  map.on('click', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] })[0]
    onSelect((f?.properties?.id as string) ?? null)
  })
}

function applyTheme(map: MapLibreMap, theme: Theme): void {
  const t = MAP_THEME[theme]
  map.setPaintProperty('bg', 'background-color', t.background)
  map.setPaintProperty(FILL_LAYER, 'fill-color', [
    'match',
    ['coalesce', ['feature-state', 'cls'], -1],
    ...SCALE.flatMap((c, i) => [i, c]),
    t.empty,
  ] as never)
  map.setPaintProperty(LINE_LAYER, 'line-color', t.border)
  map.setPaintProperty(SELECTED_LAYER, 'line-color', t.selected)
}

function fitFocus(map: MapLibreMap, mesh: Mesh, focusIds: string[] | null): void {
  if (!focusIds) {
    map.fitBounds(BRAZIL_BOUNDS, { padding: 20 })
    return
  }
  const ids = new Set(focusIds)
  const bounds = bboxOf(mesh.features.filter((f) => ids.has(f.properties.id)))
  if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 10 })
}

const isHidden = (id: string, visibleIds: Set<string> | null) => (visibleIds ? !visibleIds.has(id) : false)

const setSelected = (map: MapLibreMap, id: string, selected: boolean) =>
  map.setFeatureState({ source: SOURCE, id }, { selected })

export function MapView({
  mesh,
  byId,
  classOf,
  tooltipOf,
  visibleIds,
  focusIds,
  selectedId,
  theme,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null)
  const prevSelected = useRef<string | null>(null)
  const onSelectRef = useRef(onSelect)
  const byIdRef = useRef(byId)
  const tooltipRef = useRef(tooltipOf)

  // Effects can run with a stale map from a remount; only touch the live, loaded instance
  const currentMap = useCallback(
    () => (loadedMap && loadedMap === mapRef.current ? loadedMap : null),
    [loadedMap],
  )

  useEffect(() => {
    onSelectRef.current = onSelect
    byIdRef.current = byId
    tooltipRef.current = tooltipOf
  }, [onSelect, byId, tooltipOf])

  useEffect(() => {
    if (!container.current) return
    const map = createMap(container.current)
    mapRef.current = map

    map.on('load', () => {
      addMunicipioLayers(map, mesh)
      setLoadedMap(map)
    })
    bindTooltip(map, (id) => {
      const m = id ? byIdRef.current.get(id) : undefined
      return m ? tooltipRef.current(m) : null
    })
    bindClick(map, (id) => onSelectRef.current(id))

    return () => {
      setLoadedMap(null)
      map.remove()
      mapRef.current = null
    }
  }, [mesh])

  useEffect(() => {
    const map = currentMap()
    if (!map) return
    for (const f of mesh.features) {
      const m = byId.get(f.properties.id)
      map.setFeatureState(
        { source: SOURCE, id: f.properties.id },
        { cls: m ? classOf(m) : -1, hidden: isHidden(f.properties.id, visibleIds) },
      )
    }
  }, [currentMap, mesh, byId, classOf, visibleIds])

  useEffect(() => {
    const map = currentMap()
    if (map) applyTheme(map, theme)
  }, [currentMap, theme])

  useEffect(() => {
    const map = currentMap()
    if (!map) return
    if (prevSelected.current) setSelected(map, prevSelected.current, false)
    if (selectedId) setSelected(map, selectedId, true)
    prevSelected.current = selectedId
  }, [currentMap, selectedId])

  useEffect(() => {
    const map = currentMap()
    if (map) fitFocus(map, mesh, focusIds)
  }, [currentMap, mesh, focusIds])

  return <div ref={container} className="map" />
}
