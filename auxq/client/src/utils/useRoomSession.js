import { useRef } from 'react';
import { useLocation } from 'react-router-dom';

export default function useRoomSession(code) {
  const location = useLocation();
  const ref = useRef(null);

  if (!ref.current) {
    const userName = location.state?.userName || sessionStorage.getItem(`auxq-name-${code}`) || 'Guest';
    const isHost = location.state?.isHost || sessionStorage.getItem(`auxq-host-${code}`) === 'true' || false;
    sessionStorage.setItem(`auxq-name-${code}`, userName);
    sessionStorage.setItem(`auxq-host-${code}`, String(isHost));
    ref.current = { userName, isHost };
  }

  return ref.current;
}
