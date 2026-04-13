/**
 * svgRenderer.js
 * Drop this into your Electron overlay renderer process.
 * Detects SVG in any LLM response string and renders it inline.
 * Falls back to plain text if no SVG found.
 */

// ─────────────────────────────────────────────────────────────
// Parse SVG out of LLM response (handles raw SVG or ```svg blocks)
// ─────────────────────────────────────────────────────────────
function extractSVG(text) {
  if (!text) return null;
  // Case 1: fenced code block  ```svg ... ```
  const fenced = text.match(/```svg\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  // Case 2: raw <svg ...> ... </svg>
  const raw = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (raw) return raw[0].trim();

  return null;
}

// ─────────────────────────────────────────────────────────────
// Inject CSS variables so SVG colors match overlay dark theme
// SVG uses var(--p) etc — we define them on the container
// ─────────────────────────────────────────────────────────────
const THEME_VARS = `
  --p: rgba(200,200,210,0.9);
  --s: rgba(200,200,210,0.45);
  --t: rgba(200,200,210,0.25);
  --bg2: rgba(255,255,255,0.06);
  --b: rgba(160,160,180,0.4);
`;

// Pre-built class styles injected into a <style> inside SVG
// These mirror the classes used in the prompt (t, ts, th, box, arr, c-*)
const SVG_CLASS_STYLES = `
  <style>
    .t  { fill: rgba(220,220,230,0.9); font-size:14px; font-family: -apple-system, sans-serif; }
    .ts { fill: rgba(160,160,180,0.8); font-size:12px; font-family: -apple-system, sans-serif; }
    .th { fill: rgba(220,220,230,0.95); font-size:14px; font-weight:500; font-family: -apple-system, sans-serif; }
    .box { fill: rgba(255,255,255,0.06); stroke: rgba(200,200,210,0.25); }
    .arr { stroke: rgba(200,200,210,0.5); stroke-width:1.5; fill:none; }
    .leader { stroke: rgba(200,200,210,0.25); stroke-width:0.5; stroke-dasharray:3 3; fill:none; }
    /* color ramps for dark overlay */
    .c-purple rect,.c-purple circle,.c-purple ellipse { fill:#2D2660; stroke:#7F77DD; }
    .c-purple .t,.c-purple .th { fill:#CECBF6; }
    .c-purple .ts { fill:#AFA9EC; }
    .c-teal rect,.c-teal circle,.c-teal ellipse { fill:#083828; stroke:#1D9E75; }
    .c-teal .t,.c-teal .th { fill:#9FE1CB; }
    .c-teal .ts { fill:#5DCAA5; }
    .c-coral rect,.c-coral circle,.c-coral ellipse { fill:#3A1208; stroke:#D85A30; }
    .c-coral .t,.c-coral .th { fill:#F5C4B3; }
    .c-coral .ts { fill:#F0997B; }
    .c-amber rect,.c-amber circle,.c-amber ellipse { fill:#2A1800; stroke:#BA7517; }
    .c-amber .t,.c-amber .th { fill:#FAC775; }
    .c-amber .ts { fill:#EF9F27; }
    .c-blue rect,.c-blue circle,.c-blue ellipse { fill:#041E38; stroke:#378ADD; }
    .c-blue .t,.c-blue .th { fill:#B5D4F4; }
    .c-blue .ts { fill:#85B7EB; }
    .c-gray rect,.c-gray circle,.c-gray ellipse { fill:#1A1A18; stroke:#5F5E5A; }
    .c-gray .t,.c-gray .th { fill:#D3D1C7; }
    .c-gray .ts { fill:#B4B2A9; }
    .c-green rect,.c-green circle,.c-green ellipse { fill:#0A1E04; stroke:#3B6D11; }
    .c-green .t,.c-green .th { fill:#C0DD97; }
    .c-green .ts { fill:#97C459; }
  </style>
`;

// ─────────────────────────────────────────────────────────────
// Inject styles into SVG string (before first child element)
// ─────────────────────────────────────────────────────────────
function injectStyles(svgString) {
  // If SVG already has a <style> block, leave it alone
  if (/<style/i.test(svgString)) return svgString;
  // Inject after opening <svg ...> tag
  return svgString.replace(/(<svg[^>]*>)/, `$1${SVG_CLASS_STYLES}`);
}

// ─────────────────────────────────────────────────────────────
// Render into a container element
// ─────────────────────────────────────────────────────────────
function renderSVGResponse(containerEl, llmResponseText) {
  const svg = extractSVG(llmResponseText);

  if (svg) {
    // SVG found — render it
    const styled = injectStyles(svg);
    containerEl.style.cssText = THEME_VARS;
    containerEl.innerHTML = `
      <div style="
        background: rgba(18,18,26,0.0);
        border-radius: 10px;
        overflow: hidden;
        width: 100%;
      ">
        ${styled}
      </div>
    `;
    // Make SVG responsive
    const svgEl = containerEl.querySelector('svg');
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = 'auto';
      svgEl.removeAttribute('width');  // let CSS control width
    }
    return 'svg';
  } else {
    // No SVG — render as plain text
    containerEl.innerHTML = `
      <div style="
        font-size:13px;
        color:rgba(220,220,230,0.9);
        line-height:1.7;
        white-space:pre-wrap;
      ">${escapeHtml(llmResponseText)}</div>
    `;
    return 'text';
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

if (typeof module !== 'undefined') {
  module.exports = { renderSVGResponse, extractSVG, injectStyles };
}
