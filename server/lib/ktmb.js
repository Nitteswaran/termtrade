// Live GTFS-Realtime poller for KTMB (Komuter / ETS) vehicle positions.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const FEED = 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb';
const POLL_MS = 15_000;

export class KtmbFeed {
  constructor() {
    this.vehicles = [];
    this.lastFetch = 0;
    this.error = null;
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  async poll() {
    try {
      const res = await fetch(FEED, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
      this.vehicles = feed.entity
        .filter((e) => e.vehicle?.position)
        .map((e) => {
          const v = e.vehicle;
          return {
            id: `ktmb-${e.id}`,
            lat: v.position.latitude,
            lon: v.position.longitude,
            bearing: v.position.bearing ?? null,
            speed: v.position.speed ?? null, // m/s
            routeId: v.trip?.routeId ?? null,
            tripId: v.trip?.tripId ?? null,
            label: v.vehicle?.label ?? null,
            ts: v.timestamp ? Number(v.timestamp) : null,
          };
        });
      this.lastFetch = Date.now();
      this.error = null;
    } catch (err) {
      this.error = String(err.message || err);
    }
  }
}
