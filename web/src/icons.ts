/** Inline SVG icon set — no icon font, no network requests, crisp at any size. */

const ICONS: Record<string, string> = {
  gear: `<path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42H10.5a.5.5 0 0 0-.5.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L3.1 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96a7 7 0 0 0 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z"/>`,

  coin: `<circle cx="12" cy="12" r="10" fill="#F5A623"/><circle cx="12" cy="11.4" r="8.2" fill="#FFD34D"/><circle cx="12" cy="11.4" r="8.2" fill="none" stroke="#FFE79A" stroke-width="1.4"/><path fill="#F5A623" d="m12 6.6 1.42 2.9 3.2.46-2.31 2.25.55 3.18L12 13.9l-2.86 1.5.55-3.19-2.32-2.25 3.2-.46Z"/>`,

  bolt: `<path fill="#FFC93C" stroke="#F0A81E" stroke-width="1.1" stroke-linejoin="round" d="M13.6 2 5.2 13.2h4.6L8.6 22l8.4-11.2h-4.6L13.6 2Z"/><path fill="#FFE79A" d="M12.9 4.6 7.8 12.3h2.5L9.5 17l4.6-6.1h-2.4l1.2-6.3Z" opacity=".8"/>`,

  heart: `<path fill="#F2685F" d="M12 21s-7.5-4.6-9.2-8.6C1.4 9.2 3.2 5.5 6.8 5.5c2 0 3.3 1 4.2 2.2.9-1.2 2.2-2.2 4.2-2.2 3.6 0 5.4 3.7 4 6.9C19.5 16.4 12 21 12 21Z"/><path fill="#FF9C93" d="M8.2 8.3c-1.5 0-2.6 1.2-2.5 2.7.1 1 .7 1.9 1.5 2.7-.3-1.3.2-2.4 1.2-3.1.3-.2.6-.4.9-.5-.3-.5-.6-.9-1.1-1.8Z" opacity=".7"/>`,

  clock: `<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7.4V12l3.2 2"/>`,

  bulb: `<path fill="#FFC93C" d="M12 2.6a6.1 6.1 0 0 0-3.6 11c.6.5 1 1.2 1 2v.7h5.2v-.7c0-.8.4-1.5 1-2A6.1 6.1 0 0 0 12 2.6Z"/><path fill="#FFE07A" d="M9.4 5.5A4.7 4.7 0 0 0 8 10.9c.4.7.9 1.3 1.5 1.8.4.3.7.7.9 1.1.1-1.6-.1-3.2.2-4.8.2-1.3.8-2.4 1.6-3.3-.9 0-1.9-.1-2.8-.2Z"/><rect x="9.4" y="18.4" width="5.2" height="2.2" rx="1.1" fill="#7C93A3"/><rect x="10.2" y="21" width="3.6" height="1.6" rx=".8" fill="#7C93A3"/>`,

  restart: `<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M4.6 12a7.4 7.4 0 1 0 2.2-5.3"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M4.2 4.4v5.1h5.1"/>`,

  pause: `<rect x="5.6" y="4.4" width="4.4" height="15.2" rx="2.2" fill="currentColor"/><rect x="14" y="4.4" width="4.4" height="15.2" rx="2.2" fill="currentColor"/>`,

  play: `<path fill="currentColor" d="M6.4 4.3a1.6 1.6 0 0 1 2.42-1.38l11.1 6.7a1.6 1.6 0 0 1 0 2.76l-11.1 6.7A1.6 1.6 0 0 1 6.4 17.7V4.3Z" transform="translate(0 1.2)"/>`,

  sound: `<path fill="currentColor" d="M4 9.2h3.3L12 5.2v13.6l-4.7-4H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8M18.3 6a8.6 8.6 0 0 1 0 12"/>`,

  soundOff: `<path fill="currentColor" d="M4 9.2h3.3L12 5.2v13.6l-4.7-4H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1Z"/><path fill="none" stroke="#F2685F" stroke-width="2.2" stroke-linecap="round" d="m16 9.4 5 5.2M21 9.4l-5 5.2"/>`,

  back: `<path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5 7.5 12l7 7"/>`,

  lock: `<rect x="4.6" y="10.2" width="14.8" height="10" rx="3" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2.4" d="M8.2 10.2V7.8a3.8 3.8 0 0 1 7.6 0v2.4"/>`,

  star: `<path fill="#FFC93C" stroke="#F0A81E" stroke-width="1.1" stroke-linejoin="round" d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95Z"/>`,

  starEmpty: `<path fill="#DCE7EF" stroke="#C8D7E2" stroke-width="1.1" stroke-linejoin="round" d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95Z"/>`,

  levels: `<rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2.2" fill="#5AA9F0"/><rect x="13.2" y="3.4" width="7.4" height="7.4" rx="2.2" fill="#8B78F0"/><rect x="3.4" y="13.2" width="7.4" height="7.4" rx="2.2" fill="#48C46D"/><rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2.2" fill="#FFC93C"/>`,

  shop: `<path fill="none" stroke="#E0A20A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3.2 4.6h2.4l2.5 10.2"/><path fill="#FFC93C" stroke="#E0A20A" stroke-width="1.6" stroke-linejoin="round" d="M6.4 7.6h14.2l-1.8 7.2a2 2 0 0 1-2 1.5H9.6a2 2 0 0 1-1.9-1.5L6.4 7.6Z"/><path fill="none" stroke="#E0A20A" stroke-width="1.4" d="M9.6 11.2h9.2"/><circle cx="9.6" cy="19.4" r="1.7" fill="#F5A623"/><circle cx="16.6" cy="19.4" r="1.7" fill="#F5A623"/>`,

  help: `<circle cx="12" cy="12" r="9" fill="#5AA9F0"/><path fill="#fff" d="M12.05 6.4c1.9 0 3.2 1.05 3.2 2.6 0 1.1-.55 1.75-1.6 2.4-.85.55-1.1.9-1.1 1.7v.3h-2v-.45c0-1.15.4-1.75 1.45-2.45.75-.5.95-.8.95-1.4 0-.65-.55-1.05-1.35-1.05-.85 0-1.4.45-1.5 1.2H8.05c.1-1.85 1.55-2.85 4-2.85Zm-.95 9.6a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z"/>`,

  close: `<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>`,

  home: `<path fill="currentColor" d="m12 3.4 8.4 7.1-1.7 2-1.2-1v8.1H14v-5.3h-4v5.3H6.5v-8.1l-1.2 1-1.7-2Z"/>`,

  close2: `<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>`,

  zoomIn: `<circle cx="10.4" cy="10.4" r="6.4" fill="none" stroke="currentColor" stroke-width="2.1"/><path fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M15.2 15.2 21 21M10.4 7.6v5.6M7.6 10.4h5.6"/>`,

  zoomOut: `<circle cx="10.4" cy="10.4" r="6.4" fill="none" stroke="currentColor" stroke-width="2.1"/><path fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M15.2 15.2 21 21M7.6 10.4h5.6"/>`,
};

export function icon(name: string, cls = ''): string {
  const path = ICONS[name] ?? '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${path}</svg>`;
}

export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (name) el.innerHTML = icon(name);
  });
}