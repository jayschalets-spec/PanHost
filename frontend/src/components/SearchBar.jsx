import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const ICON = { listing: '🏠', reservation: '📅', invoice: '💳' };

export default function SearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Cmd/Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api
        .get(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setResults(r.data.results);
          setOpen(true);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (r) => {
    setOpen(false);
    setQ('');
    navigate(r.to);
  };

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="searchbar" ref={boxRef}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search…  (⌘K)"
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={i} className={`search-item ${i === active ? 'active' : ''}`} onClick={() => go(r)}>
              <span>{ICON[r.type] || '🔎'}</span>
              <span className="search-label">{r.label}</span>
              <span className="search-sub">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
