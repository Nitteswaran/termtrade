import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { createMap, addBuildings, addNetwork, applyNight, isNight, attachFlyCam, KL_CENTER } from './map/initMap.js';
import { fetchNetwork, connectWS } from './lib/net.js';
import { prepareShape } from './lib/geo.js';
import { TrainWorld } from './lib/interp.js';
import { TrainsLayer } from './three/TrainsLayer.js';

const LINE_ORDER = ['KJ', 'AG', 'PH', 'KGL', 'PYL', 'MR', 'BRT', 'SA'];

export default function App() {
  const mapEl = useRef(null);
  const uiRef = useRef(null);
  const stateRef = useRef({});
  const [routes, setRoutes] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [demo, setDemo] = useState(false);
  const [counts, setCounts] = useState({});
  const [hidden, setHidden] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const [clock, setClock] = useState('');
  const [night, setNight] = useState(isNight());

  useEffect(() => {
    let dispose = [];
    (async () => {
      const network = await fetchNetwork();
      setRoutes(network.routes);
      const shapes = Object.fromEntries(Object.entries(network.shapes).map(([id, s]) => [id, prepareShape(s)]));
      const world = new TrainWorld(shapes);
      const map = createMap(mapEl.current);
      const layer = new TrainsLayer(world, network.routes);
      stateRef.current = { map, world, layer, network };
      window.__tt = stateRef.current;

      map.on('style.load', () => {
        const n = isNight();
        addBuildings(map, n);
        addNetwork(map, network);
        applyNight(map, n);
        map.addLayer(layer);
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

  // keep selected card fresh + follow, and apply line visibility
  useEffect(() => {
    const { world } = stateRef.current;
    if (!world) return;
    const iv = setInterval(() => {
      if (!selected) return;
      const cur = world.sim.get(selected.id) || world.live.get(selected.id);
      if (cur) setSelected({ ...cur });
      else setSelected(null);
    }, 500);
    return () => clearInterval(iv);
  }, [selected?.id]);

  useEffect(() => {
    const { world } = stateRef.current;
    if (!world) return;
    world.hiddenRoutes = hidden;
  }, [hidden]);

  // GSAP entrance choreography
  useEffect(() => {
    if (!routes || !uiRef.current) return;
    const q = gsap.utils.selector(uiRef);
    gsap.fromTo(q('.tt-top'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power3.out' });
    gsap.fromTo(q('.tt-chip'), { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, stagger: 0.05, delay: 0.3, ease: 'power2.out' });
    gsap.fromTo(q('.tt-hint'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, delay: 0.8, ease: 'power2.out' });
  }, [routes]);

  const cardRef = useRef(null);
  useEffect(() => {
    if (selected && cardRef.current) {
      gsap.fromTo(cardRef.current, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
    }
  }, [selected?.id]);

  const lines = useMemo(() => {
    if (!routes) return [];
    const arr = LINE_ORDER.filter((id) => routes[id]).map((id) => routes[id]);
    arr.push({ id: 'KTMB', shortName: 'KTM', name: 'KTM Komuter / ETS (live GPS)', color: '#1c3f94', category: 'KTM' });
    return arr;
  }, [routes]);

  function toggleLine(id) {
    setHidden((h) => {
      const n = new Set(h);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const selRoute = selected && routes ? routes[selected.routeId] : null;
  const selStop = selected && stateRef.current.network ? stateRef.current.network.stops[selected.nextStop] : null;

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
          {demo && <span className="tt-badge demo">timetable replay · service hours over</span>}
          <span className={`tt-badge status ${status}`}>
            <i />{status === 'live' ? 'LIVE' : status.toUpperCase()}
          </span>
          <span className="tt-clock">{clock} <small>MYT · {night ? 'night' : 'day'}</small></span>
        </div>
      </header>

      <aside className="tt-lines">
        {lines.map((r) => (
          <button
            key={r.id}
            className={`tt-chip ${hidden.has(r.id) ? 'off' : ''}`}
            style={{ '--line': r.color }}
            onClick={() => toggleLine(r.id)}
            title={r.name}
          >
            <span className="dot" />
            <span className="code">{r.shortName}</span>
            <span className="count">{counts[r.id] ?? 0}</span>
          </button>
        ))}
      </aside>

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
            <dt>Doors</dt><dd className={selected.doors ? 'open' : ''}>{selected.doors ? 'OPEN — boarding' : 'closed'}</dd>
            {selected.id.startsWith('ktmb-') && (<><dt>Source</dt><dd>live GPS · data.gov.my</dd></>)}
          </dl>
          <button className="tt-follow" onClick={() => {
            stateRef.current.map?.flyTo({ center: [selected.lon, selected.lat], zoom: 16.5, pitch: 65, speed: 1.4 });
          }}>
            ⌖ Fly to train
          </button>
        </section>
      )}

      <footer className="tt-hint">
        <span><b>drag</b> orbit</span><span><b>W A S D</b> fly</span><span><b>Q E</b> rotate</span>
        <span><b>R F</b> zoom</span><span><b>T G</b> tilt</span><span><b>click train</b> details</span>
      </footer>
    </div>
  );
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase());
