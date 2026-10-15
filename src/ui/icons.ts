// UI 아이콘: 낙서풍 SVG (굵은 진갈색 선, 평면 색, 음영 없음).

const INK = '#3b2a20';
const wrap = (body: string): string =>
  `<svg viewBox="0 0 32 32" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  village: wrap('<rect x="7.5" y="14" width="17" height="12.5" rx="1.5" fill="#f6ebd5"/><path d="M4 16.5 16 6l12 10.5z" fill="#e46f5a"/><path d="M13.2 26.5v-6.5h5.6v6.5" fill="#876045"/>'),
  build: wrap(
    '<path d="M14.5 14.5 25.5 25.5" stroke-width="6"/><path d="M14.5 14.5 25.5 25.5" stroke="#c98a55" stroke-width="2.2"/><rect x="4.5" y="7.5" width="15" height="8" rx="2" transform="rotate(-45 12 11.5)" fill="#c9cdd6"/>',
  ),
  staff: wrap('<path d="M6.5 27c0-6.2 4.2-9.8 9.5-9.8s9.5 3.6 9.5 9.8z" fill="#8ec8ee"/><circle cx="16" cy="10.5" r="5.3" fill="#f6ebd5"/>'),
  workshop: wrap(
    '<path d="M7 15h18l-2.2 9a3 3 0 0 1-3 2.4h-7.6a3 3 0 0 1-3-2.4z" fill="#f2a65a"/><path d="M4.5 15h23"/><path d="M11.5 10.5c-1.6-2 1.6-3 0-5.2M16 10.5c-1.6-2 1.6-3 0-5.2M20.5 10.5c-1.6-2 1.6-3 0-5.2" stroke-width="2.2"/>',
  ),
  dex: wrap('<path d="M16 9.5c-3-2.2-7-2.6-11-2v17c4-.6 8-.2 11 2z" fill="#f6ebd5"/><path d="M16 9.5c3-2.2 7-2.6 11-2v17c-4-.6-8-.2-11 2z" fill="#f3d36a"/>'),
  gear: wrap(
    '<path d="M25 16h3.5M22.4 22.4l2.4 2.4M16 25v3.5M9.6 22.4l-2.4 2.4M7 16H3.5M9.6 9.6 7.2 7.2M16 7V3.5M22.4 9.6l2.4-2.4" stroke-width="4.6"/><circle cx="16" cy="16" r="8.6" fill="#c9cdd6"/><circle cx="16" cy="16" r="3.2" fill="#f6ebd5"/>',
  ),
  bag: wrap(
    '<path d="M11 11.5c-4 3-6.5 7-6.5 10.4 0 3.4 3.2 5.3 11.5 5.3s11.5-1.9 11.5-5.3c0-3.4-2.5-7.4-6.5-10.4z" fill="#f3d36a"/><path d="M12 11.5 9.8 6.2h12.4L20 11.5" fill="#f3d36a"/><path d="M10.5 11.5h11"/>',
  ),
  close: wrap('<path d="M9 9l14 14M23 9 9 23" stroke-width="3.4"/>'),
  heart: wrap('<path d="M16 26.5S5.5 20.5 5.5 13a5.2 5.2 0 0 1 10.5-1.2A5.2 5.2 0 0 1 26.5 13c0 7.5-10.5 13.5-10.5 13.5z" fill="#e46f5a"/>'),
  cookie: wrap('<circle cx="16" cy="16" r="10.5" fill="#f2b279"/><circle cx="12" cy="13" r="1.4" fill="' + INK + '"/><circle cx="19" cy="12.5" r="1.4" fill="' + INK + '"/><circle cx="17" cy="19.5" r="1.4" fill="' + INK + '"/>'),
  flag: wrap('<path d="M9 28V5"/><path d="M9 6.5h15l-3.5 5 3.5 5H9z" fill="#8cc47a"/>'),
  pin: wrap('<path d="M16 28s-8-8.2-8-14a8 8 0 0 1 16 0c0 5.8-8 14-8 14z" fill="#e46f5a"/><circle cx="16" cy="14" r="3" fill="#f6ebd5"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `mpv-svg ${cls}`.trim();
  s.innerHTML = ICONS[name];
  return s;
}
