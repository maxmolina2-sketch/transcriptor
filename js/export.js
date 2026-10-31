// =============================================================
//  Formatos de exportación: TXT, TXT con tiempos, SRT, VTT, JSON
// =============================================================

const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');

export function clock(sec, sep = ',') {
  const total = Math.round(Math.max(0, sec || 0) * 1000); // evita "1000 ms" por redondeo
  const ms = total % 1000, s = Math.floor(total / 1000);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${sep}${pad(ms, 3)}`;
}

export function shortClock(sec) {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// Une los fragmentos en párrafos legibles (corte tras pausas > 2 s o ~600 caracteres).
export function toPlainText(chunks) {
  const paras = [];
  let cur = '';
  chunks.forEach((c, i) => {
    const gap = i > 0 ? c.start - chunks[i - 1].end : 0;
    if (cur && (gap > 2 || cur.length > 600) && /[.?!…]$/.test(cur.trim())) {
      paras.push(cur.trim());
      cur = '';
    }
    cur += c.text;
  });
  if (cur.trim()) paras.push(cur.trim());
  return paras.join('\n\n');
}

export function toTimestamped(chunks) {
  return chunks.map((c) => `[${shortClock(c.start)}] ${c.text.trim()}`).join('\n');
}

export function toSRT(chunks) {
  return chunks.map((c, i) =>
    `${i + 1}\n${clock(c.start)} --> ${clock(c.end)}\n${c.text.trim()}\n`).join('\n');
}

export function toVTT(chunks) {
  return 'WEBVTT\n\n' + chunks.map((c) =>
    `${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${c.text.trim()}\n`).join('\n');
}

export function toJSON(chunks, meta) {
  return JSON.stringify({ ...meta, segmentos: chunks }, null, 2);
}

export function download(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
