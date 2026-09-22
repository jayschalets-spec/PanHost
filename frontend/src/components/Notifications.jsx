import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const ICON = { approval: '⏳', invoice: '💸', checkin: '🛬', task: '✅', conflict: '⚠️' };

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = () => api.get('/api/notifications').then((r) => setItems(r.data.items)).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="notif" ref={ref}>
      <button className="notif-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔
        {items.length > 0 && <span className="notif-badge">{items.length}</span>}
      </button>
      {open && (
        <div className="notif-menu">
          <div className="notif-head">Notifications</div>
          {items.length === 0 ? (
            <div className="notif-empty">🎉 All caught up!</div>
          ) : (
            items.map((n, i) => (
              <button key={i} className="notif-item" onClick={() => { setOpen(false); navigate(n.to); }}>
                <span>{ICON[n.type] || '🔔'}</span>
                <span>{n.text}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
