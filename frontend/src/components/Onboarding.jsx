import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function Onboarding() {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('onboarding_dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    api.get('/api/onboarding').then((r) => setData(r.data)).catch(() => {});
  }, []);

  if (!data || dismissed || data.complete === data.total) return null;
  const pct = Math.round((data.complete / data.total) * 100);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('onboarding_dismissed', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card onboarding">
      <div className="card-body">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ fontSize: 17 }}>🚀 Get set up — {data.complete}/{data.total} done</h3>
          <button className="close-x" onClick={dismiss} title="Dismiss">×</button>
        </div>
        <div className="bar-track" style={{ marginBottom: 16 }}>
          <div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--primary)' }} />
        </div>
        <div className="onboard-steps">
          {data.steps.map((s) => (
            <Link key={s.key} to={s.to} className={`onboard-step ${s.done ? 'done' : ''}`}>
              <span className="onboard-check">{s.done ? '✅' : '⬜'}</span>
              <span style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</span>
              {!s.done && <span className="onboard-go">Start →</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
