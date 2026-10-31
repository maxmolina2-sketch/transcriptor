// =============================================================
//  Worker de transcripción — Whisper ejecutándose en el navegador
//  Todo el procesamiento ocurre en el equipo del usuario.
// =============================================================
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

// Los modelos se descargan desde Hugging Face y quedan en caché del navegador.
env.allowLocalModels = false;
env.useBrowserCache = true;

const SAMPLE_RATE = 16000;
const SEGMENT_S = 300;        // procesa en bloques de ~5 minutos para informar progreso
const SEARCH_WINDOW_S = 10;   // busca un silencio ±10 s alrededor de cada corte

let transcriber = null;
let loadedKey = null;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function loadModel(model, device) {
  const key = `${model}|${device}`;
  if (transcriber && loadedKey === key) return;

  if (transcriber?.dispose) {
    try { await transcriber.dispose(); } catch (_) { /* noop */ }
  }
  transcriber = null;

  const dtype = device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : 'q8';

  post('status', { message: 'Preparando el modelo…' });

  transcriber = await pipeline('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === 'progress_total') {
        post('download', { progress: p.progress, loaded: p.loaded, total: p.total });
      }
    },
  });
  loadedKey = key;
  post('model-ready', { model, device });
}

// Encuentra el punto de menor energía cerca de `target` para cortar sin partir palabras.
function quietestCut(audio, target) {
  const win = Math.floor(0.05 * SAMPLE_RATE); // ventanas de 50 ms
  const from = Math.max(0, target - SEARCH_WINDOW_S * SAMPLE_RATE);
  const to = Math.min(audio.length - win, target + SEARCH_WINDOW_S * SAMPLE_RATE);
  let best = target;
  let bestEnergy = Infinity;
  for (let i = from; i < to; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += audio[j] * audio[j];
    if (e < bestEnergy) { bestEnergy = e; best = i + Math.floor(win / 2); }
  }
  return best;
}

function buildSegments(audio) {
  const segLen = SEGMENT_S * SAMPLE_RATE;
  const cuts = [0];
  let pos = segLen;
  while (pos < audio.length - SEARCH_WINDOW_S * SAMPLE_RATE) {
    const c = quietestCut(audio, pos);
    cuts.push(c);
    pos = c + segLen;
  }
  cuts.push(audio.length);
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) segs.push([cuts[i], cuts[i + 1]]);
  return segs;
}

async function transcribe({ audio, model, device, language, task }) {
  await loadModel(model, device);

  const segments = buildSegments(audio);
  const allChunks = [];
  const t0 = performance.now();

  for (let i = 0; i < segments.length; i++) {
    const [start, end] = segments[i];
    const offset = start / SAMPLE_RATE;
    post('progress', {
      current: i, total: segments.length,
      message: `Transcribiendo bloque ${i + 1} de ${segments.length}…`,
    });

    const out = await transcriber(audio.subarray(start, end), {
      language: language === 'auto' ? null : language,
      task,
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    const chunks = (out.chunks || [{ text: out.text, timestamp: [0, (end - start) / SAMPLE_RATE] }])
      .map((c) => ({
        text: c.text,
        start: (c.timestamp?.[0] ?? 0) + offset,
        end: (c.timestamp?.[1] ?? (end - start) / SAMPLE_RATE) + offset,
      }))
      .filter((c) => c.text && c.text.trim());

    allChunks.push(...chunks);
    post('partial', { chunks, current: i + 1, total: segments.length });
  }

  post('done', {
    chunks: allChunks,
    seconds: (performance.now() - t0) / 1000,
    duration: audio.length / SAMPLE_RATE,
  });
}

self.addEventListener('message', async (e) => {
  const { type, payload } = e.data;
  try {
    if (type === 'transcribe') await transcribe(payload);
  } catch (err) {
    console.error(err);
    post('error', { message: err?.message || String(err) });
  }
});
