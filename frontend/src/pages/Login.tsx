import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/** Loads the Google Identity Services script once, resolving when it's ready. */
function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google script failed to load'));
    document.head.appendChild(script);
  });
}

export function Login() {
  const { signInWithGoogle } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) {
      setError('Google sign-in is not configured yet.');
      return;
    }

    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            setError(null);
            signInWithGoogle(response.credential).catch(() => {
              setError('That Google account is not allowed to sign in here.');
            });
          },
        });

        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach Google. Check your connection and retry.');
      });

    return () => {
      cancelled = true;
    };
  }, [signInWithGoogle]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Tradeit</h1>
        <p>Research desk. One account.</p>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <div ref={buttonRef} className="google-button" />
      </div>
    </div>
  );
}
