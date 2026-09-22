import { createContext, useContext, useEffect, useState } from 'react';
import api from './api';
import { setCurrency } from './components/ui.jsx';

const AuthContext = createContext(null);

// Apply white-label branding: accent color as CSS var + currency + document title.
function applyBranding(user) {
  const root = document.documentElement;
  if (user?.brand_color) {
    root.style.setProperty('--primary', user.brand_color);
  } else {
    root.style.removeProperty('--primary');
  }
  setCurrency(user?.currency || 'USD');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setReady(true);
      return;
    }
    api
      .get('/api/auth/me')
      .then((res) => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        applyBranding(res.data);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const login = (token, u) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
    applyBranding(u);
  };

  const updateUser = (u) => {
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
    applyBranding(u);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    applyBranding(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
