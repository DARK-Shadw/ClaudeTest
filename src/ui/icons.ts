/** Small line icons, drawn on a 24px grid and coloured by currentColor. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  wood: svg('<rect x="3" y="6" width="14" height="5" rx="2.5"/><rect x="7" y="13" width="14" height="5" rx="2.5"/><circle cx="14.5" cy="8.5" r=".8"/><circle cx="18.5" cy="15.5" r=".8"/>'),
  stone: svg('<path d="M3.5 17.5 6 10l5-4 6 2 3.5 6.5-3 3z"/><path d="M11 6l1 5.5 5.5-2.5M12 11.5 8 17.5"/>'),
  berries: svg('<circle cx="7.5" cy="15.5" r="3.5"/><circle cx="16" cy="15.5" r="3.5"/><circle cx="12" cy="9" r="3.5"/><path d="M12 5.5c0-1.8 1.4-3 3.4-3"/>'),
  meal: svg('<path d="M3 12h18a9 7.5 0 0 1-18 0z"/><path d="M9 8.5c0-1.6 1.2-2 1.2-3.8M13.5 8.5c0-1.6 1.2-2 1.2-3.8"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  select: svg('<path d="M6 3.5 18 12l-5.4 1.3 2.8 5.6-2.4 1.2-2.8-5.6L6 18z"/>'),
  harvest: svg('<path d="M14 5 5 20"/><path d="M12 4.5c2.5-2 6-2 8 .5-1.5.4-3 1.6-3.6 3.6z"/>'),
  build: svg('<path d="M14.5 9.5 5 19"/><path d="M12 5.5l4-2.5 5 5-2.5 4z"/><path d="M12.5 6.5l5 5"/>'),
  zone: svg('<rect x="4" y="7" width="16" height="12" rx="1.5"/><path d="M4 11h16M9.5 7v4M14.5 7v4M8 3.5h8"/>'),
  rally: svg('<path d="M6 21V3.5"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>'),
  clear: svg('<path d="M7 19h13"/><path d="M4.5 14.5 13 6l6 6-6.5 6.5H9z"/><path d="M9.5 9.5l6 6"/>'),
  chronicle: svg('<path d="M6 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7.5A2.5 2.5 0 0 1 5 18V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  room: svg('<path d="M10 20H4V4h16v16h-6"/><path d="M10 20v-4h4v4"/>'),
  wall: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>'),
  stoneWall: svg('<path d="M3 11h7V5H4.5A1.5 1.5 0 0 0 3 6.5zM10 11h11V6.5A1.5 1.5 0 0 0 19.5 5H10zM3 11v6.5A1.5 1.5 0 0 0 4.5 19H14v-8M14 19h5.5a1.5 1.5 0 0 0 1.5-1.5V11"/>'),
  door: svg('<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3.5 21h17"/><circle cx="14.5" cy="12.5" r="1"/>'),
  bed: svg('<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/>'),
  campfire: svg('<path d="M12 3c1 3 4.5 4.5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-2.2 1.3-3.3 2-4.5.5 1.5 1.5 2 1.5 2S10.5 6 12 3z"/><path d="M4 20l16-3M4 17l16 3"/>'),
  trap: svg('<path d="M3 19h18"/><path d="M5 19l2-9 2 9M10 19l2-12 2 12M15 19l2-9 2 9"/>'),
  demolish: svg('<path d="M4 20h16"/><path d="M6 20v-6h4v-4h5v10"/><path d="M15 4l5 5M20 4l-5 5"/>'),
  person: svg('<circle cx="12" cy="7" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0"/>'),
  sword: svg('<path d="M20 4 9.5 14.5M20 4h-4.5M20 4v4.5M7 12l5 5M8.5 15.5 4 20"/>'),
  down: svg('<path d="M12 21s-7.5-4.7-7.5-10.7A4.3 4.3 0 0 1 12 7.7a4.3 4.3 0 0 1 7.5 2.6C19.5 16.3 12 21 12 21z"/><path d="M8 13h2.5l1.5-2.5 1.5 4 1.2-1.5H16"/>'),
  sleep: svg('<path d="M5 9h5l-5 6h5M13 5h6l-6 7h6"/>'),
  flee: svg('<circle cx="14" cy="4.5" r="2"/><path d="M7 11l3-3.5 4 1.5 2 3.5 3 1M10 7.5 8.5 14 5 20M9 15l4 2 1 4"/>'),
  daze: svg('<path d="M12 12a2 2 0 1 1 2-2 4 4 0 1 1-4 4 6 6 0 1 1 6-6 8 8 0 1 1-8 8"/>'),
  hungry: svg('<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 21V3c-2 1.5-3 4-3 7v3h3"/>'),
  speed: svg('<path d="M5 6v12l7-6zM12 6v12l7-6z"/>'),
  goals: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.3 1.3L7 5M3.5 12l1.3 1.3L7 11M3.5 18l1.3 1.3L7 17"/>'),
  warning: svg('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/>'),
} as const;

export type IconName = keyof typeof ICONS;
