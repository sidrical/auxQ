import { useRef } from 'react';
import { useLocation } from 'react-router-dom';

export default function useRoomSession(code) {
  const location = useLocation();
  const ref = useRef(null);

  if (!ref.current) {
    const userName = location.state?.userName || sessionStorage.getItem(`auxq-name-${code}`) || 'Guest';
    const isHost = location.state?.isHost || sessionStorage.getItem(`auxq-host-${code}`) === 'true' || false;
    const hostPlatform = location.state?.hostPlatform || sessionStorage.getItem(`auxq-platform-${code}`) || null;
    sessionStorage.setItem(`auxq-name-${code}`, userName);
    sessionStorage.setItem(`auxq-host-${code}`, String(isHost));
    if (hostPlatform) sessionStorage.setItem(`auxq-platform-${code}`, hostPlatform);
    ref.current = { userName, isHost, hostPlatform };
  }

  return ref.current;
}
