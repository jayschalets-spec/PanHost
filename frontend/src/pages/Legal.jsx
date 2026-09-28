import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';

// Shared shell for the public legal pages so Terms and Privacy stay visually identical.
export default function Legal({ title, updated, version, children }) {
  return (
    <div className="legal-wrap">
      <div className="legal-doc">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="logo"><Logo size={20} /></span>
          <span>PanHost</span>
        </Link>
        <h1>{title}</h1>
        <p className="muted" style={{ marginTop: -6 }}>
          Last updated {updated} · Version {version}
        </p>
        {children}
        <hr />
        <p className="muted" style={{ fontSize: 13 }}>
          PanHost is operated by Jason Stein, 76 Park Street West, Mississauga, Ontario L5H 1K9, Canada.
          Questions: <a href="mailto:jayschalets@gmail.com">jayschalets@gmail.com</a>
        </p>
        <p style={{ fontSize: 13 }}>
          <Link to="/terms">Terms of Use</Link> · <Link to="/privacy">Privacy Policy</Link> · <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
