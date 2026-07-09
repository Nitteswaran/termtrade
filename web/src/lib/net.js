// Network layer: one-shot /api/network fetch + auto-reconnecting WebSocket.
export async function fetchNetwork() {
  const res = await fetch('/api/network');
  if (!res.ok) throw new Error('network fetch failed');
  return res.json();
}

export function connectWS({ onSnapshot, onStatus }) {
  let ws = null;
  let closed = false;
  let retry = 1000;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 1000;
      onStatus?.('live');
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'snapshot') onSnapshot(msg);
      } catch {}
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus?.('reconnecting');
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
    ws.onerror = () => ws.close();
  }
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
