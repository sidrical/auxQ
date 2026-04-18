// MusicKit JS wrapper — loads Apple's script and exposes simple play/pause/seek functions.
// MusicKit plays audio directly in the browser (unlike Spotify which controls an external app).

let configured = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function configureMusicKit(developerToken) {
  await loadScript('https://js-cdn.music.apple.com/musickit/v3/musickit.js');
  if (!configured) {
    await window.MusicKit.configure({
      developerToken,
      app: { name: 'AuxQ', build: '1.0.0' }
    });
    configured = true;
  }
  return window.MusicKit.getInstance();
}

export async function authorize(developerToken) {
  const music = await configureMusicKit(developerToken);
  if (music.isAuthorized) return music.musicUserToken;
  return music.authorize();
}

export function getInstance() {
  return window.MusicKit?.getInstance() ?? null;
}

export async function playTrack(appleMusicId) {
  const music = getInstance();
  if (!music) throw new Error('MusicKit not initialized');
  await music.setQueue({ song: appleMusicId });
  await music.play();
}

export async function pauseTrack() {
  const music = getInstance();
  if (!music) throw new Error('MusicKit not initialized');
  await music.pause();
}

export async function resumeTrack() {
  const music = getInstance();
  if (!music) throw new Error('MusicKit not initialized');
  await music.play();
}

export async function seekToStart() {
  const music = getInstance();
  if (!music) throw new Error('MusicKit not initialized');
  await music.seekToTime(0);
}
