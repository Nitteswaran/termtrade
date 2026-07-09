import { memo, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { createMap, addBuildings, addNetwork, applyNight, isNight, attachFlyCam, showJourney, clearJourney, declutter, enableGoogle3DTiles } from './map/initMap.js';
import { fetchNetwork, connectWS } from './lib/net.js';
import { prepareShape } from './lib/geo.js';
import { TrainWorld } from './lib/interp.js';
import { TrainsLayer } from './three/TrainsLayer.js';

const LINE_ORDER = ['KJ', 'AG', 'PH', 'KGL', 'PYL', 'MR', 'BRT', 'SA'];
const titleCase = (s) => s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase());

export default function App() {
  const mapEl = useRef(null);
  const uiRef = useRef(null);
  const stateRef = useRef({});
  const [routes, setRoutes] = useState(null);
  const [stops, setStops] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [demo, setDemo] = useState(false);
  const [counts, setCounts] = useState({});
  const [hidden, setHidden] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const [clock, setClock] = useState('');
  const [night, setNight] = useState(isNight());
  const [journey, setJourney] = useState(null);

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
      const n = isNight();
      const map = createMap(mapEl.current, config, n);
      const layer = new TrainsLayer(world, network.routes);
      stateRef.current = { map, world, layer, network, config };
      window.__tt = stateRef.current;

      map.on('style.load', () => {
        addBuildings(map, n);
        addNetwork(map, network);
        if (!config.maptilerKey) applyNight(map, n);
        map.addLayer(layer);
        declutter(map);
        if (config.googleMapsKey) enableGoogle3DTiles(map, config.googleMapsKey);
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
            setDemo(!!snap.demo);
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

  // refresh selected train card
  useEffect(() => {
    if (!selected) return;
    const iv = setInterval(() => {
      const { world } = stateRef.current;
      const cur = world?.sim.get(selected.id) || world?.live.get(selected.id);
      cur ? setSelected({ ...cur }) : setSelected(null);
    }, 600);
    return () => clearInterval(iv);
  }, [selected?.id]);

  // entrance choreography
  useEffect(() => {
    if (!routes || !uiRef.current) return;
    const q = gsap.utils.selector(uiRef);
    gsap.fromTo(q('.tt-top'), { y: -50, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out' });
    gsap.fromTo(q('.tt-search'), { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.8, delay: 0.25, ease: 'power3.out' });
    gsap.fromTo(q('.tt-chip'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, stagger: 0.045, delay: 0.5, ease: 'power2.out' });
  }, [routes]);

  const cardRef = useRef(null);
  useEffect(() => {
    if (selected && cardRef.current)
      gsap.fromTo(cardRef.current, { x: 50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
  }, [selected?.id]);

  const lines = useMemo(() => {
    if (!routes) return [];
    const arr = LINE_ORDER.filter((id) => routes[id]).map((id) => routes[id]);
    arr.push({ id: 'KTMB', shortName: 'KTM', name: 'KTM Komuter / ETS — live GPS', color: '#1c3f94' });
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

  const selRoute = selected && routes ? routes[selected.routeId] : null;
  const selStop = selected && stops ? stops[selected.nextStop] : null;

  return (
    <div className="tt-root" ref={uiRef}>
      <div ref={mapEl} className="tt-map" />
      <div className={`tt-vignette ${night ? 'night' : 'day'}`} />

      <header className="tt-top">
        <div className="tt-brand">
          <span className="tt-logo-mark" />
          <h1>TERM<span>TRADE</span></h1>
          <em>Malaysia Transit · Live 3D</em>
        </div>
        <div className="tt-top-right">
          {demo && <span className="tt-badge demo">timetable replay · after hours</span>}
          <span className={`tt-badge status ${status === "live" ? "live" : status}`}><i />{status === 'live' ? 'LIVE' : status.toUpperCase()}</span>
          <span className="tt-clock">{clock}<small>MYT · {night ? 'night' : 'day'}</small></span>
        </div>
      </header>

      {stops && routes && (
        <SearchPanel stops={stops} routes={routes} journey={journey} onPlan={planJourney} onReset={resetJourney} />
      )}

      <nav className="tt-lines">
        {lines.map((r) => (
          <LineChip key={r.id} route={r} count={counts[r.id] ?? 0} off={hidden.has(r.id)}
            onToggle={() => setHidden((h) => { const n2 = new Set(h); n2.has(r.id) ? n2.delete(r.id) : n2.add(r.id); return n2; })} />
        ))}
      </nav>

      {selected && (
        <section className="tt-card" ref={cardRef}>
          <header style={{ '--line': selRoute?.color ?? '#1c3f94' }}>
            <span className="pill">{selRoute?.shortName ?? 'KTM'}</span>
            <h2>{selRoute?.name ?? selected.label ?? 'KTM service'}</h2>
            <button className="x" onClick={() => setSelected(null)}>×</button>
          </header>
          <dl>
            {selected.headsign && (<><dt>Destination</dt><dd>{selected.headsign.replace(/^From /, '')}</dd></>)}
            {selStop && (<><dt>Next station</dt><dd>{titleCase(selStop.name)}</dd></>)}
            <dt>Speed</dt><dd>{Math.round((selected.speed ?? 0) * 3.6)} km/h</dd>
            <dt>Doors</dt><dd className={selected.doors ? 'open' : ''}>{selected.doors ? 'OPEN — boarding' : 'Closed'}</dd>
            {String(selected.id).startsWith('ktmb-') && (<><dt>Source</dt><dd>Live GPS · data.gov.my</dd></>)}
          </dl>
          <button className="tt-follow" onClick={() =>
            stateRef.current.map?.flyTo({ center: [selected.lon, selected.lat], zoom: 16.8, pitch: 62, speed: 1.4 })
          }>⌖ Fly to train</button>
        </section>
      )}

      <footer className="tt-hint">
        <span><b>Drag</b> orbit</span><span><b>W A S D</b> fly</span><span><b>Q E</b> rotate</span>
        <span><b>R F</b> zoom</span><span><b>T G</b> tilt</span><span><b>Click train</b> details</span>
      </footer>
    </div>
  );
}

const LineChip = memo(function LineChip({ route, count, off, onToggle }) {
  return (
    <button className={`tt-chip ${off ? 'off' : ''}`} style={{ '--line': route.color }} onClick={onToggle} title={route.name}>
      <span className="dot" />
      <span className="code">{route.shortName}</span>
      <span className="count">{count}</span>
    </button>
  );
});

function SearchPanel({ stops, routes, journey, onPlan, onReset }) {
  const options = useMemo(
    () =>
      Object.values(stops)
        .map((s) => ({ id: s.id, name: titleCase(s.name), line: routes[s.routeId]?.shortName ?? '', color: routes[s.routeId]?.color ?? '#888' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stops, routes]
  );
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);

  return (
    <aside className="tt-search">
      <h3>Plan a journey</h3>
      <StationInput placeholder="From — search a station" options={options} value={from} onSelect={setFrom} />
      <div className="tt-search-mid">
        <span className="line" />
        <button className="swap" title="Swap" onClick={() => { const f = from; setFrom(to); setTo(f); }}>⇅</button>
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
              <li key={i} className={leg.mode}>
                {leg.mode === 'ride' ? (
                  <>
                    <span className="pill" style={{ background: routes[leg.routeId]?.color }}>{routes[leg.routeId]?.shortName}</span>
                    <div>
                      <b>{titleCase(leg.stopNames[0])} → {titleCase(leg.stopNames[leg.stopNames.length - 1])}</b>
                      <small>{leg.stops.length - 1} stops · {Math.round(leg.secs / 60)} min</small>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="pill walk">🚶</span>
                    <div><b>Transfer at {titleCase(leg.stopNames[0])}</b><small>{Math.round(leg.secs / 60)} min</small></div>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </aside>
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
              <span className="dot" style={{ background: m.color }} />
              {m.name}
              <em>{m.line}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
