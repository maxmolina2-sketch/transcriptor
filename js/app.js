// =============================================================
//  Transcriptor — lógica de interfaz
// =============================================================
import {
  toPlainText, toTimestamped, toSRT, toVTT, toJSON, download, shortClock,
} from './export.js';

const $ = (s) => document.querySelector(s);
const SAMPLE_RATE = 16000;

const MODELS = {
  'onnx-community/whisper-tiny':            { label: 'Muy rápido (tiny)',   size: '~40 MB',  gpuOnly: false },
  'onnx-community/whisper-base':            { label: 'Equilibrado (base)',  size: '~80 MB',  gpuOnly: false },
  'onnx-community/whisper-small':           { label: 'Preciso (small)',     size: '~250 MB', gpuOnly: false },
  'onnx-community/whisper-large-v3-turbo':  { label: 'Máxima precisión (large-v3-turbo)', size: '~600 MB', gpuOnly: true },
};

const state = {
  device: 'wasm',
  worker: null,
  audio: null,          // Float32Array 16 kHz mono
  fileName: 'transcripcion',
  chunks: [],
  busy: false,
  recorder: null,
  recChunks: [],
  recTimer: null,
};

// ---------- Detección de capacidades ----------
async function detectDevice() {
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch (_) { /* sin WebGPU */ }
  return 'wasm';
}

function renderModelOptions() {
  const sel = $('#model');
  sel.innerHTML = '';
  for (const [id, m] of Object.entries(MODELS)) {
    if (m.gpuOnly && state.device !== 'webgpu') continue;
    const opt = new Option(`${m.label} · ${m.size}`, id);
    sel.appendChild(opt);
  }
  sel.value = state.device === 'webgpu' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
}

// ---------- Worker ----------
function getWorker() {
  if (state.worker) return state.worker;
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.addEventListener('message', onWorkerMessage);
  w.addEventListener('error', (e) => fail(e.message || 'Error al iniciar el motor de transcripción.'));
  state.worker = w;
  return w;
}

function onWorkerMessage({ data }) {
  switch (data.type) {
    case 'status':
      setStatus(data.message);
      break;
    case 'download': {
      const mb = (b) => (b / 1048576).toFixed(0);
      setProgress(data.progress, `Descargando modelo… ${mb(data.loaded)} / ${mb(data.total)} MB (solo la primera vez)`);
      break;
    }
    case 'model-ready':
      setStatus(`Modelo listo (${data.device === 'webgpu' ? 'GPU' : 'CPU'}).`);
      break;
    case 'progress':
      setProgress((data.current / data.total) * 100, data.message);
      break;
    case 'partial':
      state.chunks.push(...data.chunks);
      renderTranscript();
      setProgress((data.current / data.total) * 100, `Bloque ${data.current} de ${data.total} listo`);
      break;
    case 'done': {
      state.chunks = data.chunks;
      renderTranscript();
      const ratio = data.duration / Math.max(data.seconds, 0.1);
      setProgress(100, `Listo: ${shortClock(data.duration)} de audio en ${shortClock(data.seconds)} (${ratio.toFixed(1)}× tiempo real)`);
      setBusy(false);
      $('#results').hidden = false;
      break;
    }
    case 'error':
      fail(data.message);
      break;
  }
}

// ---------- Audio ----------
async function decodeToMono16k(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: SAMPLE_RATE });
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer);
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close?.();
  }
}

async function loadMedia(blob, name) {
  try {
    setStatus('Leyendo audio…');
    state.fileName = (name || 'grabacion').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    const player = $('#player');
    player.src = url;
    $('#media').hidden = false;
    $('#mediaName').textContent = name || 'Grabación';

    state.audio = await decodeToMono16k(await blob.arrayBuffer());
    const dur = state.audio.length / SAMPLE_RATE;
    $('#mediaInfo').textContent = `Duración: ${shortClock(dur)}`;
    $('#start').disabled = false;
    setStatus('Audio listo. Elige el modelo y presiona «Transcribir».');
  } catch (err) {
    console.error(err);
    fail('No se pudo leer el archivo. Prueba con MP3, WAV, M4A, OGG, WEBM o MP4.');
  }
}

// ---------- Grabación con micrófono ----------
async function toggleRecording() {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recChunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && state.recChunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(state.recTimer);
      $('#record').classList.remove('recording');
      $('#recordLabel').textContent = 'Grabar con micrófono';
      const blob = new Blob(state.recChunks, { type: rec.mimeType });
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      loadMedia(blob, `grabacion_${stamp}`);
    };
    rec.start();
    state.recorder = rec;
    const t0 = Date.now();
    $('#record').classList.add('recording');
    state.recTimer = setInterval(() => {
      $('#recordLabel').textContent = `Detener · ${shortClock((Date.now() - t0) / 1000)}`;
    }, 500);
  } catch (err) {
    fail('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
  }
}

// ---------- Transcripción ----------
function start() {
  if (!state.audio || state.busy) return;
  state.chunks = [];
  renderTranscript();
  $('#results').hidden = false;
  setBusy(true);
  setProgress(0, 'Iniciando…');
  const audio = state.audio.slice(); // copia transferible
  getWorker().postMessage({
    type: 'transcribe',
    payload: {
      audio,
      model: $('#model').value,
      device: state.device,
      language: $('#language').value,
      task: $('#task').value,
    },
  }, [audio.buffer]);
}

function cancel() {
  state.worker?.terminate();
  state.worker = null;
  setBusy(false);
  setStatus('Transcripción cancelada. El texto parcial se conserva.');
}

// ---------- Render ----------
function renderTranscript() {
  const box = $('#transcript');
  box.innerHTML = '';
  if (!state.chunks.length) {
    box.innerHTML = '<p class="empty">La transcripción aparecerá aquí a medida que avance.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  state.chunks.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'seg';
    const t = document.createElement('button');
    t.className = 'ts';
    t.type = 'button';
    t.textContent = shortClock(c.start);
    t.title = 'Ir a este momento del audio';
    t.onclick = () => { const p = $('#player'); p.currentTime = c.start; p.play(); };
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.contentEditable = 'true';
    txt.spellcheck = true;
    txt.textContent = c.text.trim();
    txt.oninput = () => { state.chunks[i].text = ' ' + txt.textContent; };
    row.append(t, txt);
    frag.appendChild(row);
  });
  box.appendChild(frag);
  $('#wordCount').textContent = `${toPlainText(state.chunks).split(/\s+/).filter(Boolean).length} palabras`;
}

// Resalta el segmento que se está reproduciendo
function syncHighlight() {
  const t = $('#player').currentTime;
  const rows = document.querySelectorAll('.seg');
  state.chunks.forEach((c, i) => {
    rows[i]?.classList.toggle('active', t >= c.start && t < c.end);
  });
}

// ---------- UI helpers ----------
function setStatus(msg) { $('#status').textContent = msg; }
function setProgress(pct, msg) {
  $('#progress').hidden = false;
  $('#bar').style.width = `${Math.min(100, Math.max(0, pct || 0))}%`;
  if (msg) setStatus(msg);
}
function setBusy(b) {
  state.busy = b;
  $('#start').disabled = b || !state.audio;
  $('#cancel').hidden = !b;
  $('#file').disabled = b;
  $('#record').disabled = b;
  document.body.classList.toggle('busy', b);
}
function fail(msg) {
  setBusy(false);
  setStatus('⚠️ ' + msg);
}

function exportAs(kind) {
  if (!state.chunks.length) return;
  const n = state.fileName;
  const meta = {
    archivo: n,
    modelo: $('#model').value,
    idioma: $('#language').value,
    generado: new Date().toISOString(),
  };
  const map = {
    txt:  [toPlainText(state.chunks), `${n}.txt`, 'text/plain'],
    tst:  [toTimestamped(state.chunks), `${n}_tiempos.txt`, 'text/plain'],
    srt:  [toSRT(state.chunks), `${n}.srt`, 'application/x-subrip'],
    vtt:  [toVTT(state.chunks), `${n}.vtt`, 'text/vtt'],
    json: [toJSON(state.chunks, meta), `${n}.json`, 'application/json'],
  };
  download(...map[kind]);
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(toPlainText(state.chunks));
    const b = $('#copy');
    const old = b.textContent;
    b.textContent = '✓ Copiado';
    setTimeout(() => (b.textContent = old), 1500);
  } catch (_) {
    setStatus('No se pudo copiar automáticamente; usa una de las descargas.');
  }
}

// ---------- Enviar al Codificador ----------
// Deja el texto en el almacenamiento del navegador (mismo sitio) y abre el
// Codificador en una pestaña nueva, que lo recoge y lo borra al cargar.
const HANDOFF_KEY = 'transcriptor-a-codificador';
const CODER_URL = '/codificador/?desde=transcriptor';

function sendToCoder() {
  if (!state.chunks.length) return;
  const text = toPlainText(state.chunks);
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ name: state.fileName, text, at: Date.now() }));
  } catch (_) {
    setStatus('No se pudo enviar al Codificador. Descarga el .txt y cárgalo allí.');
    return;
  }
  const w = window.open(CODER_URL, '_blank');
  if (!w) location.href = CODER_URL; // si el navegador bloquea la pestaña nueva
}

// ---------- Inicio ----------
async function init() {
  state.device = await detectDevice();
  $('#deviceBadge').textContent = state.device === 'webgpu' ? 'Aceleración GPU disponible' : 'Modo CPU';
  $('#deviceBadge').classList.add(state.device);
  renderModelOptions();
  renderTranscript();

  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) loadMedia(f, f.name);
  });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f && !state.busy) loadMedia(f, f.name);
  });

  $('#record').addEventListener('click', toggleRecording);
  $('#start').addEventListener('click', start);
  $('#cancel').addEventListener('click', cancel);
  $('#copy').addEventListener('click', copyText);
  const toCoder = Object.assign(document.createElement('button'), {
    id: 'toCoder', type: 'button', className: 'btn primary',
    textContent: 'Enviar al Codificador →',
    title: 'Abre esta transcripción en el Codificador, en una pestaña nueva',
  });
  $('.exports').prepend(toCoder);
  toCoder.addEventListener('click', sendToCoder);
  document.querySelectorAll('[data-export]').forEach((b) =>
    b.addEventListener('click', () => exportAs(b.dataset.export)));
  $('#player').addEventListener('timeupdate', syncHighlight);

  if (!window.MediaRecorder || !navigator.mediaDevices) $('#record').hidden = true;

  window.addEventListener('beforeunload', (e) => {
    if (state.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

init();
