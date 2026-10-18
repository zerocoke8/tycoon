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
  // 짓기 (ui/panels/build.ts 목록 묶음, ui/buildBar.ts 도구)
  booth: wrap(
    '<rect x="6.5" y="14" width="19" height="12.5" rx="1.5" fill="#f6ebd5"/><path d="M4.5 14 7.5 6h17l3 8z" fill="#f2a65a"/><path d="M12.5 6 11 14M19.5 6 21 14"/><path d="M4.5 14a3.8 3.8 0 0 0 7.6 0 3.9 3.9 0 0 0 7.8 0 3.8 3.8 0 0 0 7.6 0" fill="#f6ebd5"/><path d="M13 26.5v-5h6v5"/>',
  ),
  facility: wrap('<ellipse cx="15" cy="20.5" rx="11.5" ry="6.5" fill="#f3d36a"/><ellipse cx="15" cy="20.5" rx="5.5" ry="2.6" fill="#8cc47a"/><path d="M23 15V4"/><path d="M23 4.5h6l-2 2.6 2 2.6h-6z" fill="#e46f5a"/>'),
  shop: wrap('<rect x="6" y="12.5" width="20" height="14" rx="1.5" fill="#f6ebd5"/><path d="M4 13 7 6h18l3 7z" fill="#8ec8ee"/><path d="M13 26.5v-7.5h6v7.5" fill="#876045"/>'),
  decor: wrap(
    '<path d="M16 28v-10"/><path d="M16 23c-3.4-.4-5.6-2.6-6-5.8 3.4.3 5.6 2.4 6 5.8z" fill="#8cc47a"/><circle cx="16" cy="5.8" r="3.3" fill="#f2a0b5"/><circle cx="20.4" cy="10.2" r="3.3" fill="#f2a0b5"/><circle cx="16" cy="14.6" r="3.3" fill="#f2a0b5"/><circle cx="11.6" cy="10.2" r="3.3" fill="#f2a0b5"/><circle cx="16" cy="10.2" r="2.6" fill="#f3d36a"/>',
  ),
  road: wrap('<path d="M9.5 28 13.5 4h5l4 24z" fill="#ebc68e"/><path d="M16 8v3M16 15v3M16 22v3"/>'),
  land: wrap('<path d="M3.5 9.5 11 6.5l10 3 7.5-3v17l-7.5 3-10-3-7.5 3z" fill="#8cc47a"/><path d="M11 6.5v17M21 9.5v17"/>'),
  undo: wrap('<path d="M11 8.5 5.5 14l5.5 5.5" stroke-width="3"/><path d="M6 14h12.5a7 7 0 0 1 0 14H14" stroke-width="3"/>'),
  eraser: wrap('<path d="M4.5 20.5 16.5 8.5l9 9-7.5 7.5H9z" fill="#f2a0b5"/><path d="M12 13l9 9"/><path d="M9 25h18"/>'),
  check: wrap('<path d="M6.5 16.5 13 23 25.5 9" stroke-width="4.2"/>'),
  move: wrap('<path d="M16 5v22M5 16h22"/><path d="M12 9l4-4 4 4M12 23l4 4 4-4M9 12l-4 4 4 4M23 12l4 4-4 4"/>'),
  box: wrap('<path d="M5.5 12h21v14.5h-21z" fill="#d9a066"/><path d="M4 7h24v5H4z" fill="#ebbd85"/><path d="M13 17h6"/>'),
  list: wrap('<rect x="5" y="5.5" width="22" height="21" rx="3" fill="#f6ebd5"/><path d="M10 11.5h12M10 16h12M10 20.5h7.5"/>'),
  // 다섯째 묶음: 놀이기구 (관람차), 사진관 (사진기)
  ride: wrap(
    '<path d="M10 28 16 14l6 14"/><circle cx="16" cy="13" r="9" fill="#f6ebd5"/><path d="M16 4v18M7 13h18M9.6 6.6l12.8 12.8M22.4 6.6 9.6 19.4" stroke-width="1.6"/><circle cx="16" cy="13" r="2.2" fill="#f2a65a"/><circle cx="16" cy="4" r="2" fill="#e46f5a"/><circle cx="25" cy="13" r="2" fill="#8ec8ee"/><circle cx="7" cy="13" r="2" fill="#f3d36a"/><circle cx="16" cy="22" r="2" fill="#8cc47a"/>',
  ),
  camera: wrap('<rect x="4" y="10" width="24" height="16" rx="3" fill="#8ec8ee"/><path d="M11 10l2-3.5h6L21 10" fill="#f6ebd5"/><circle cx="16" cy="18" r="5" fill="#f6ebd5"/><circle cx="16" cy="18" r="2" fill="#3b2a20" stroke="none"/><path d="M23.5 13.5h1.5"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `mpv-svg ${cls}`.trim();
  s.innerHTML = ICONS[name];
  return s;
}
