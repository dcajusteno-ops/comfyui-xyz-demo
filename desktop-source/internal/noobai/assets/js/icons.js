/* 图标：统一 14px 线性 SVG。class="nl-ico" 供面板样式定位（旧版漏了这个类，
   导致自检成功/失败图标颜色相同、图标与文字基线错位）。 */
const svg = (body, extra = "") =>
  `<svg class="nl-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  logo: svg('<path d="M12 2.8l1.9 5.4L19.3 10l-5.4 1.8L12 17.2l-1.9-5.4L4.7 10l5.4-1.8z"/><path d="M18.4 15.2l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>'),
  sliders: svg('<path d="M4 6h8M17 6h3M4 12h3M12 12h8M4 18h8M17 18h3"/><circle cx="14.5" cy="6" r="2.1"/><circle cx="9.5" cy="12" r="2.1"/><circle cx="14.5" cy="18" r="2.1"/>'),
  user: svg('<circle cx="12" cy="8" r="3.4"/><path d="M4.8 20c1.6-3.6 4-5.2 7.2-5.2s5.6 1.6 7.2 5.2"/>'),
  brush: svg('<path d="M18.4 2.6a2.8 2.8 0 0 1 4 4l-12 12-4.4 1 1-4.4 12-12zM15 6l3 3M6 19c-1.5 1.5-3.5 1.5-4 1s-.5-2.5 1-4"/>'),
  shirt: svg('<path d="M8.2 4.2L12 6l3.8-1.8L20 8l-2.8 2.2V20H6.8V10.2L4 8z"/>'),
  map: svg('<path d="M3 6.2l6-2 6 2 6-2v13.6l-6 2-6-2-6 2z"/><path d="M9 4.2v13.6M15 6.2v13.6"/>'),
  pose: svg('<circle cx="12" cy="4.9" r="2"/><path d="M12 7v6M12 9.2l-4.2 2.8M12 9.2l4.2 2.8M12 13l-3.2 7.2M12 13l3.2 7.2"/>'),
  camera: svg('<path d="M3.8 8.2h3.4L8.8 5.8h6.4l1.6 2.4h3.4v11H3.8z"/><circle cx="12" cy="13.2" r="3.3"/>'),
  palette: svg('<path d="M12 3a9 9 0 100 18h1.3a2 2 0 001.5-3.3 2 2 0 011.5-3.3h1.6A2.1 2.1 0 0021 12.3 9 9 0 0012 3z"/><circle cx="7.6" cy="11.2" r=".9" fill="currentColor" stroke="none"/><circle cx="9.4" cy="7.6" r=".9" fill="currentColor" stroke="none"/><circle cx="14" cy="6.9" r=".9" fill="currentColor" stroke="none"/>'),
  dice: svg('<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.2"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1" fill="currentColor" stroke="none"/>'),
  refresh: svg('<path d="M20 11.2a8 8 0 10-2.3 5.7"/><path d="M20 5.2v6h-6"/>'),
  trash: svg('<path d="M4 7h16M9.2 7V4.2h5.6V7M6.4 7l1 13h9.2l1-13M10 10.5v6.5M14 10.5v6.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6L20 20"/>'),
  copy: svg('<rect x="8.2" y="8.2" width="11.4" height="11.4" rx="2"/><path d="M5.4 15.2V5.4h9.8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.4l4.2 4.2L19 6.6"/>'),
  pin: svg('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  star: svg('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/>'),
  warn: svg('<path d="M12 3.4L21 20H3z"/><path d="M12 9v4.6M12 16.8v.2"/>'),
  spark: svg('<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6z"/><path d="M18.6 15.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  shuffle: svg('<path d="M4 7h3.2c4.8 0 4.8 10 9.6 10H20M17 14l3 3-3 3M4 17h3.2c1.7 0 2.7-1.2 3.6-2.6M14 7.6c.7-.4 1.5-.6 2.4-.6H20M17 4l3 3-3 3"/>'),
  grid: svg('<rect x="4" y="4" width="6.4" height="6.4" rx="1.2"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.2"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.2"/><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.2"/>'),
  layers: svg('<path d="M12 3.4l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.4l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  image: svg('<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.6 17.2l4.8-4.4 3.4 3 3-2.6 3.6 3.4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 12H2.2M21.8 12h-2.2M6.3 6.3L4.7 4.7M19.3 19.3l-1.6-1.6M17.7 6.3l1.6-1.6M4.7 19.3l1.6-1.6"/>'),
  panel: svg('<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2"/><path d="M14.6 4.4v15.2"/>'),
  play: svg('<path d="M7 4.8l12 7.2-12 7.2z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.6"/>'),
};

export function icon(name) {
  return ICONS[name] || "";
}
