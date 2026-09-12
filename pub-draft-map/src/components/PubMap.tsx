"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import Link from "next/link";
import type { LatLngBoundsExpression } from "leaflet";

export type MapPub = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  city?: string | null;
  tapCount?: number;
  plan?: string;
  highlight?: boolean;
};

type Props = {
  pubs: MapPub[];
  center: { lat: number; lng: number };
  zoom?: number;
  fitTo?: LatLngBoundsExpression | null;
  onBoundsChange?: (bbox: string) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

export default function PubMap({ pubs, center, zoom = 14, fitTo, onBoundsChange, selectedId, onSelect }: Props) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} scrollWheelZoom className="rounded-lg">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <BoundsWatcher onBoundsChange={onBoundsChange} />
      <Recenter center={center} fitTo={fitTo} />
      {pubs.map((p) => {
        const selected = p.id === selectedId;
        const promoted = p.plan === "PROMOTED";
        return (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={selected ? 11 : p.highlight ? 9 : 7}
            pathOptions={{
              color: selected ? "#111827" : promoted ? "#b45309" : "#78350f",
              weight: selected ? 3 : 1.5,
              fillColor: p.highlight ? "#f59e0b" : promoted ? "#fbbf24" : p.kind === "bar" ? "#fcd34d" : "#fde68a",
              fillOpacity: 0.95,
            }}
            eventHandlers={{ click: () => onSelect?.(p.id) }}
          >
            <Popup>
              <div className="text-sm">
                <Link href={`/pub/${p.id}`} className="font-semibold underline">
                  {p.name}
                </Link>
                <div className="text-stone-500">
                  {p.kind.replace("_", " ")}
                  {p.city ? ` · ${p.city}` : ""}
                  {typeof p.tapCount === "number" ? ` · ${p.tapCount} on tap` : ""}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

function BoundsWatcher({ onBoundsChange }: { onBoundsChange?: (bbox: string) => void }) {
  const map = useMapEvents({
    moveend: () => emit(),
    zoomend: () => emit(),
  });
  function emit() {
    if (!onBoundsChange) return;
    const b = map.getBounds();
    onBoundsChange(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
  }
  useEffect(() => {
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Recenter({ center, fitTo }: { center: { lat: number; lng: number }; fitTo?: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (fitTo) map.fitBounds(fitTo, { padding: [40, 40], maxZoom: 16 });
    else map.setView([center.lat, center.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, fitTo]);
  return null;
}
