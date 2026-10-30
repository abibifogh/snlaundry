// Brand colours from Settings, applied the same way on every page.
// Loaded in <head>: the last colours seen are painted straight away from this
// device's memory, then each page calls applyBrandColors() with fresh settings.
(function () {
  const KEY = 'laundry_brand';
  // The built-in colours. "Restore default colours" in Settings goes back to these.
  const DEFAULTS = { accentColor: '#0f766e', accent2Color: '', hoverColor: '#fff8ed', stageColors: {} };
  // Settings key → the CSS variable each order stage paints with.
  const STAGES = { new: 'new', accepted: 'acc', cleaning: 'cln', ready: 'rdy' };

  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : '');
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  // a blended with b; w is how much of a to keep
  const mix = (a, b, w) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v * w + y[i] * (1 - w))); };
  const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  // Text that stays readable on a colour: white or near-black, whichever stands out more.
  const onColor = (c) => { const l = lum(c); return 1.05 / (l + 0.05) >= (l + 0.05) / (lum('#12201c') + 0.05) ? '#ffffff' : '#12201c'; };

  function apply(s, fromCache) {
    s = s || {};
    const st = document.documentElement.style;
    const accent = hex(s.accentColor) || DEFAULTS.accentColor;
    // No second colour chosen: use a lighter shade of the accent so everything still matches.
    const accent2 = hex(s.accent2Color) || mix(accent, '#ffffff', 0.6);
    const hover = hex(s.hoverColor) || DEFAULTS.hoverColor;
    st.setProperty('--accent', accent);
    st.setProperty('--on-accent', onColor(accent));
    // Accent used as text on light backgrounds: darkened when the accent itself is too pale to read.
    const contrastOnWhite = 1.05 / (lum(accent) + 0.05);
    st.setProperty('--accent-ink', contrastOnWhite >= 3.5 ? accent : mix(accent, '#12201c', contrastOnWhite >= 2 ? 0.6 : 0.4));
    st.setProperty('--accent-2', accent2);
    st.setProperty('--on-accent-2', onColor(accent2));
    st.setProperty('--hover', hover);
    const stages = s.stageColors || {};
    for (const [k, v] of Object.entries(STAGES)) {
      const c = hex(stages[k]);
      if (c) { st.setProperty(`--b-${v}`, c); st.setProperty(`--b-${v}-dk`, mix(c, '#ffffff', 0.72)); } else { st.removeProperty(`--b-${v}`); st.removeProperty(`--b-${v}-dk`); }
    }
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = accent;
    if (!fromCache) {
      try { localStorage.setItem(KEY, JSON.stringify({ accentColor: accent, accent2Color: hex(s.accent2Color), hoverColor: hover, stageColors: stages })); } catch (e) { /* private mode */ }
    }
  }

  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c) apply(c, true); } catch (e) { /* nothing saved yet */ }
  window.applyBrandColors = apply;
  window.BRAND_DEFAULTS = DEFAULTS;
})();
