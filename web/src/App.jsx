import { memo, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  Route, TramFront, Layers, SunMoon, Info, Eye, EyeOff, X, ArrowUpDown,
  LocateFixed, Sun, Moon, Clock3, Gauge, DoorOpen, MapPin, Keyboard,
} from 'lucide-react';
import {
  createMap, addBuildings, addNetwork, applyNight, isNight, attachFlyCam,
  showJourney, clearJourney, declutter, enableGoogle3DTiles, applyLayerPrefs, styleUrl,
} from './map/initMap.js';
import { fetchNetwork, connectWS } from './lib/net.js';
import { prepareShape } from './lib/geo.js';
import { setLightMode, getLightMode } from './lib/solar.js';
import { TrainWorld } from './lib/interp.js';
import { TrainsLayer } from './three/TrainsLayer.js';

const LINE_ORDER = ['KJ', 'AG', 'PH', 'KGL', 'PYL', 'MR', 'BRT', 'SA'];
const titleCase = (s) => s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase());
const fmtSecs = (s) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;

const RAIL_ITEMS = [
  { id: 'journey', icon: Route, label: 'Journey' },
  { id: 'lines', icon: TramFront, label: 'Lines' },
  { id: 'layers', icon: Layers, label: 'Layers' },
  { id: 'display', icon: SunMoon, label: 'Display' },
  { id: 'info', icon: Info, label: 'About' },
];

export default function App() {
  const mapEl = useRef(null);
  const uiRef = useRef(null);
  const stateRef = useRef({});
  const [routes, setRoutes] = useState(null);
  const [stops, setStops] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [replay, setReplay] = useState(false);
  const [closed, setClosed] = useState(null);
  const [counts, setCounts] = useState({});
  const [hidden, setHidden] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const [clock, setClock] = useState('');
  const [night, setNight] = useState(isNight());
  const [journey, setJourney] = useState(null);
  const [panel, setPanel] = useState('journey');
  const [prefs, setPrefs] = useState({ photoreal: true, buildings: true, routes: true, stations: true });
  const [lightMode, setLightModeState] = useState(getLightMode());
  const [hasPhotoreal, setHasPhotoreal] = useState(false);

  useEffect(() => {
    let dispose = [];
    (async () => {
      const [network, config] = await Promise.all([
        fetchNetwork(),
        fetch('/api/config').then((r) => r.json()).catch(() => ({})),
      ]);
      setRoutes(network.routes);
      setStops(network.stops);
      const shapes = Object.fromEntries(Object.entries(network.shapes).map(([id, s]) => [id, prepareShape(s)]));
      const world = new TrainWorld(shapes);
      const map = createMap(mapEl.current, config, isNight());
      const layer = new TrainsLayer(world, network.routes);
      stateRef.current = { map, world, layer, network, config, googleLayer: null };
      window.__tt = stateRef.current;

      map.on('style.load', async () => {
        const st = stateRef.current;
        const n = isNight();
        addBuildings(map, n);
        addNetwork(map, network);
        if (!config.maptilerKey) applyNight(map, n);
        map.addLayer(layer);
        declutter(map);
        if (config.googleMapsKey) {
          st.googleLayer = await enableGoogle3DTiles(map, config.googleMapsKey, st.googleLayer);
          setHasPhotoreal(!!st.googleLayer);
        }
        applyLayerPrefs(map, st.googleLayer, st.prefs ?? { photoreal: true, buildings: true, routes: true, stations: true });
        setNight(n);
      });
      map.on('click', (e) => {
        const hit = layer.pick(e.point);
        setSelected(hit ? { ...hit } : null);
      });

      dispose.push(attachFlyCam(map));
      dispose.push(
        connectWS({
          onStatus: setStatus,
          onSnapshot: (snap) => {
            world.ingest(snap);
            setReplay(!!snap.replay);
            setClosed(snap.closed ?? null);
            const byRoute = {};
            for (const t of snap.trains) byRoute[t.r] = (byRoute[t.r] || 0) + 1;
            byRoute.KTMB = (snap.ktmb || []).length;
            setCounts(byRoute);
          },
        })
      );

      const clockTimer = setInterval(() => {
        setClock(new Date().toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }));
        setNight(isNight());
      }, 1000);
      dispose.push(() => clearInterval(clockTimer));
      dispose.push(() => map.remove());
    })();
    return () => dispose.forEach((d) => d());
  }, []);

  useEffect(() => {
    const { world } = stateRef.current;
    if (world) world.hiddenRoutes = hidden;
  }, [hidden]);

  useEffect(() => {
    const st = stateRef.current;
    st.prefs = prefs;
    if (st.map?.isStyleLoaded?.() || st.map?.getLayer?.('termtrade-trains')) {
      applyLayerPrefs(st.map, st.googleLayer, prefs);
    }
  }, [prefs]);

  useEffect(() => {
    if (!selected) return;
    const iv = setInterval(() => {
      const { world } = stateRef.current;
      const cur = world?.sim.get(selected.id) || world?.live.get(selected.id);
      cur ? setSelected({ ...cur }) : setSelected(null);
    }, 600);
    return () => clearInterval(iv);
  }, [selected?.id]);

  useEffect(() => {
    if (!routes || !uiRef.current) return;
    const q = gsap.utils.selector(uiRef);
    gsap.fromTo(q('.tt-rail'), { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out' });
    gsap.fromTo(q('.tt-topbar'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, delay: 0.15, ease: 'power3.out' });
    gsap.fromTo(q('.tt-drawer'), { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, delay: 0.3, ease: 'power2.out' });
  }, [routes]);

  const cardRef = useRef(null);
  useEffect(() => {
    if (selected && cardRef.current)
      gsap.fromTo(cardRef.current, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
  }, [selected?.id]);

  const lines = useMemo(() => {
    if (!routes) return [];
    const arr = LINE_ORDER.filter((id) => routes[id]).map((id) => routes[id]);
    arr.push({ id: 'KTMB', shortName: 'KTM', name: 'KTM Komuter / ETS — live GPS', color: '#5c6676' });
    return arr;
  }, [routes]);

  async function planJourney(fromId, toId) {
    const res = await fetch(`/api/route?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
    if (!res.ok) { setJourney({ error: 'No route found between these stations.' }); return; }
    const data = await res.json();
    setJourney({ ...data, fromId, toId });
    showJourney(stateRef.current.map, data.legs);
  }
  function resetJourney() {
    setJourney(null);
    if (stateRef.current.map) clearJourney(stateRef.current.map);
  }

  function changeLightMode(mode) {
    setLightMode(mode);
    setLightModeState(mode);
    const n = isNight();
    setNight(n);
    const { map, config } = stateRef.current;
    if (!map) return;
    if (config.maptilerKey) {
      setJourney(null);
      map.setStyle(styleUrl(config, n)); // style.load handler rebuilds layers
    } else {
      applyNight(map, n);
    }
  }

  const selRoute = selected && routes ? routes[selected.routeId] : null;
  const selStop = selected && stops ? stops[selected.nextStop] : null;

  return (
    <div className="tt-root" ref={uiRef}>
      <div ref={mapEl} className="tt-map" />
      <div className={`tt-vignette ${night ? 'night' : 'day'}`} />

      {/* ---------- icon rail ---------- */}
      <nav className="tt-rail" aria-label="Controls">
        <svg className="tt-logo-mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="ttlg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#252c38" />
              <stop offset="1" stopColor="#0b0e14" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="url(#ttlg)" stroke="rgba(255,255,255,0.16)" />
          <path d="M6.2 17.8 L13 7" stroke="#4b5563" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M10.4 17.8 L17.2 7" stroke="#8a94a6" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="16.9" cy="16.4" r="2.2" fill="#e6eaf0" />
        </svg>
        <div className="tt-rail-items">
          {RAIL_ITEMS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`tt-rail-btn ${panel === id ? 'active' : ''}`}
              onClick={() => setPanel(panel === id ? null : id)}
              aria-label={label}
              title={label}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="tt-rail-label">{label}</span>
            </button>
          ))}
        </div>
        <div className={`tt-rail-status ${status}`} title={`Feed: ${status}`}>
          <i />
        </div>
      </nav>

      {/* ---------- drawer ---------- */}
      {panel && (
        <aside className="tt-drawer" aria-label={RAIL_ITEMS.find((r) => r.id === panel)?.label}>
          <header className="tt-drawer-head">
            <h2>{RAIL_ITEMS.find((r) => r.id === panel)?.label}</h2>
            <button className="tt-icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
              <X size={16} strokeWidth={2} />
            </button>
          </header>

          {panel === 'journey' && stops && routes && (
            <JourneyPanel stops={stops} routes={routes} journey={journey} onPlan={planJourney} onReset={resetJourney} />
          )}

          {panel === 'lines' && (
            <div className="tt-list">
              {lines.map((r) => {
                const off = hidden.has(r.id);
                return (
                  <button
                    key={r.id}
                    className={`tt-row ${off ? 'off' : ''}`}
                    onClick={() => setHidden((h) => { const n2 = new Set(h); n2.has(r.id) ? n2.delete(r.id) : n2.add(r.id); return n2; })}
                  >
                    <span className="tt-row-code">{r.shortName}</span>
                    <span className="tt-row-name">{r.name.replace(/ — live GPS$/, '')}</span>
                    <span className="tt-row-count">{counts[r.id] ?? 0}</span>
                    {off ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
                  </button>
                );
              })}
              <p className="tt-note">Tap a line to hide or show its trains. Counts are trains in service now.</p>
            </div>
          )}

          {panel === 'layers' && (
            <div className="tt-list">
              {hasPhotoreal && (
                <ToggleRow label="Photorealistic city" hint="Google 3D photogrammetry"
                  on={prefs.photoreal} onChange={(v) => setPrefs((p) => ({ ...p, photoreal: v }))} />
              )}
              <ToggleRow label="3D buildings" hint="Vector extrusions (when photoreal is off)"
                on={prefs.buildings} onChange={(v) => setPrefs((p) => ({ ...p, buildings: v }))} />
              <ToggleRow label="Route lines" hint="Track geometry for every line"
                on={prefs.routes} onChange={(v) => setPrefs((p) => ({ ...p, routes: v }))} />
              <ToggleRow label="Stations" hint="Stop markers and names"
                on={prefs.stations} onChange={(v) => setPrefs((p) => ({ ...p, stations: v }))} />
            </div>
          )}

          {panel === 'display' && (
            <div className="tt-list">
              <div className="tt-seg" role="radiogroup" aria-label="Lighting">
                {[
                  { id: 'auto', label: 'Auto', icon: Clock3 },
                  { id: 'day', label: 'Day', icon: Sun },
                  { id: 'night', label: 'Night', icon: Moon },
                ].map(({ id, label, icon: Icon }) => (
                  <button key={id} role="radio" aria-checked={lightMode === id}
                    className={lightMode === id ? 'active' : ''} onClick={() => changeLightMode(id)}>
                    <Icon size={15} strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="tt-note">
                Auto follows the real sun over Kuala Lumpur — dawn and dusk happen when they happen.
              </p>
            </div>
          )}

          {panel === 'info' && (
            <div className="tt-list tt-about">
              <p><strong>termtrade</strong> shows Malaysia's rail network live in 3D. KTM positions come
                from the official GPS feed; LRT, MRT and Monorail run on their published timetables
                along real track geometry.</p>
              <h3><Keyboard size={14} strokeWidth={1.8} /> Camera</h3>
              <ul className="tt-keys">
                <li><b>Drag</b> orbit</li><li><b>W A S D</b> fly</li><li><b>Q E</b> rotate</li>
                <li><b>R F</b> zoom</li><li><b>T G</b> tilt</li><li><b>Click train</b> details</li>
              </ul>
              <h3><MapPin size={14} strokeWidth={1.8} /> Data</h3>
              <p className="tt-note">GTFS &amp; GTFS-Realtime — data.gov.my · Basemap — MapTiler / OpenFreeMap ·
                Photogrammetry — Google · © OpenStreetMap contributors</p>
            </div>
          )}
        </aside>
      )}

      {/* ---------- top bar ---------- */}
      <header className="tt-topbar">
        <div className="tt-wordmark">TERMTRADE <em>Malaysia transit · live 3D</em></div>
        <div className="tt-topbar-right">
          {closed && <span className="tt-badge">Network closed · first train {fmtSecs(closed.secs)}</span>}
          {replay && <span className="tt-badge">Timetable replay (dev)</span>}
          <span className="tt-clock">{clock}<small>MYT</small></span>
        </div>
      </header>

      {/* ---------- train card ---------- */}
      {selected && (
        <section className="tt-card" ref={cardRef}>
          <header>
            <span className="pill" style={{ background: selRoute?.color ?? '#3a4354' }}>{selRoute?.shortName ?? 'KTM'}</span>
            <h2>{selRoute?.name ?? selected.label ?? 'KTM service'}</h2>
            <button className="tt-icon-btn" onClick={() => setSelected(null)} aria-label="Close">
              <X size={15} strokeWidth={2} />
            </button>
          </header>
          <dl>
            {selected.headsign && (<><dt>Destination</dt><dd>{selected.headsign.replace(/^From /, '')}</dd></>)}
            {selStop && (<><dt>Next station</dt><dd>{titleCase(selStop.name)}</dd></>)}
            <dt><Gauge size={13} strokeWidth={1.8} /> Speed</dt><dd>{Math.round((selected.speed ?? 0) * 3.6)} km/h</dd>
            <dt><DoorOpen size={13} strokeWidth={1.8} /> Doors</dt><dd>{selected.doors ? 'Open — boarding' : 'Closed'}</dd>
          </dl>
          <button className="tt-follow" onClick={() =>
            stateRef.current.map?.flyTo({ center: [selected.lon, selected.lat], zoom: 16.8, pitch: 62, speed: 1.4 })
          }>
            <LocateFixed size={15} strokeWidth={1.8} /> Fly to train
          </button>
        </section>
      )}
    </div>
  );
}

const ToggleRow = memo(function ToggleRow({ label, hint, on, onChange }) {
  return (
    <button className="tt-row tt-toggle-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="tt-row-main">
        <span className="tt-row-name">{label}</span>
        <span className="tt-row-hint">{hint}</span>
      </span>
      <span className={`tt-switch ${on ? 'on' : ''}`}><i /></span>
    </button>
  );
});

function JourneyPanel({ stops, routes, journey, onPlan, onReset }) {
  const options = useMemo(
    () =>
      Object.values(stops)
        .map((s) => ({ id: s.id, name: titleCase(s.name), line: routes[s.routeId]?.shortName ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stops, routes]
  );
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);

  return (
    <div className="tt-journey-panel">
      <StationInput placeholder="From — search a station" options={options} value={from} onSelect={setFrom} />
      <div className="tt-search-mid">
        <span className="line" />
        <button className="tt-icon-btn" title="Swap" onClick={() => { const f = from; setFrom(to); setTo(f); }}>
          <ArrowUpDown size={14} strokeWidth={1.8} />
        </button>
      </div>
      <StationInput placeholder="Destination — search a station" options={options} value={to} onSelect={setTo} />
      <div className="tt-search-actions">
        <button className="go" disabled={!from || !to || from.id === to.id} onClick={() => onPlan(from.id, to.id)}>
          Find route
        </button>
        {journey && <button className="clear" onClick={onReset}>Clear</button>}
      </div>

      {journey?.error && <p className="tt-journey-error">{journey.error}</p>}
      {journey?.legs && (
        <div className="tt-journey">
          <div className="tt-journey-total">
            <strong>{Math.max(1, Math.round(journey.totalSecs / 60))} min</strong>
            <span>{journey.legs.filter((l) => l.mode === 'ride').length} line{journey.legs.filter((l) => l.mode === 'ride').length > 1 ? 's' : ''} · {journey.legs.reduce((n, l) => n + l.stops.length - 1, 0)} stops</span>
          </div>
          <ol>
            {journey.legs.map((leg, i) => (
              <li key={i}>
                <span className="pill" style={leg.mode === 'ride' ? { background: routes[leg.routeId]?.color } : undefined}>
                  {leg.mode === 'ride' ? routes[leg.routeId]?.shortName : 'Walk'}
                </span>
                <div>
                  <b>{leg.mode === 'ride'
                    ? `${titleCase(leg.stopNames[0])} → ${titleCase(leg.stopNames[leg.stopNames.length - 1])}`
                    : `Transfer at ${titleCase(leg.stopNames[0])}`}</b>
                  <small>{leg.mode === 'ride' ? `${leg.stops.length - 1} stops · ` : ''}{Math.round(leg.secs / 60)} min</small>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function StationInput({ placeholder, options, value, onSelect }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const shown = value ? `${value.name} · ${value.line}` : text;
  const matches = useMemo(() => {
    if (!text.trim()) return [];
    const q = text.trim().toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 7);
  }, [text, options]);

  return (
    <div className="tt-station-input">
      <input
        value={shown}
        placeholder={placeholder}
        onChange={(e) => { onSelect(null); setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {open && matches.length > 0 && !value && (
        <ul className="tt-suggest">
          {matches.map((m) => (
            <li key={m.id} onMouseDown={() => { onSelect(m); setText(''); setOpen(false); }}>
              {m.name}
              <em>{m.line}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
