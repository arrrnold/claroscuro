import { createWallpaper, isSupported } from './heif.js';

const $ = (sel, root = document) => root.querySelector(sel);

const bitmaps = { light: null, dark: null };
const createBtn = $('.create');
const status = $('.status');
const progress = $('.progress');
const download = $('.download');
const qualityInput = $('.quality input');
const screen = $('.screen');

// ── Selección de imágenes ──
for (const picker of document.querySelectorAll('.picker')) {
  const slot = picker.dataset.slot;
  const input = $('input', picker);

  input.addEventListener('change', () => input.files[0] && loadFile(slot, input.files[0]));

  picker.addEventListener('dragover', (e) => { e.preventDefault(); picker.classList.add('dragover'); });
  picker.addEventListener('dragleave', () => picker.classList.remove('dragover'));
  picker.addEventListener('drop', (e) => {
    e.preventDefault();
    picker.classList.remove('dragover');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) loadFile(slot, file);
  });
}

async function loadFile(slot, file) {
  const picker = $(`.picker[data-slot="${slot}"]`);
  try {
    const bitmap = await createImageBitmap(file);
    bitmaps[slot]?.close();
    bitmaps[slot] = bitmap;

    const url = URL.createObjectURL(file);
    const img = $('img', picker);
    img.src = url;
    img.hidden = false;
    $('.hint', picker).hidden = true;
    $('.meta', picker).textContent = `${file.name} · ${bitmap.width}×${bitmap.height}`;
    $(`.screen-bg.${slot}`).style.backgroundImage = `url("${url}")`;

    setMode(slot);
    resetResult();
    warnIfMismatch();
  } catch {
    $('.meta', picker).textContent = 'No se pudo abrir esa imagen.';
  }
  createBtn.disabled = !(bitmaps.light && bitmaps.dark);
}

function warnIfMismatch() {
  const { light, dark } = bitmaps;
  if (light && dark && (light.width !== dark.width || light.height !== dark.height)) {
    status.className = 'status';
    status.textContent = 'Aviso: las imágenes tienen tamaños distintos. Funciona igual, pero lo ideal es que coincidan.';
  }
}

// ── Vista previa claro/oscuro ──
function setMode(mode) {
  screen.dataset.mode = mode;
  for (const b of document.querySelectorAll('.mode-toggle button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
}
for (const b of document.querySelectorAll('.mode-toggle button')) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => setMode(e.matches ? 'dark' : 'light'));
setMode(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const clock = $('.clock');
const tick = () => { clock.textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); };
tick();
setInterval(tick, 30_000);

// ── Calidad ──
qualityInput.addEventListener('input', () => { $('.quality output').textContent = qualityInput.value; });

// ── Crear el archivo ──
function resetResult() {
  if (download.href) URL.revokeObjectURL(download.href);
  download.removeAttribute('href');
  download.hidden = true;
  status.textContent = '';
  status.className = 'status';
}

createBtn.addEventListener('click', async () => {
  resetResult();
  createBtn.disabled = true;
  progress.hidden = false;
  const bar = $('div', progress);
  bar.style.width = '0';
  status.textContent = 'Codificando…';
  const started = performance.now();
  try {
    const blob = await createWallpaper(bitmaps.light, bitmaps.dark, {
      quality: Number(qualityInput.value),
      onProgress: (done, total) => {
        bar.style.width = `${(done / total) * 100}%`;
        status.textContent = `Codificando… ${Math.round((done / total) * 100)}%`;
      },
    });
    download.href = URL.createObjectURL(blob);
    download.hidden = false;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    status.textContent = `¡Listo! ${(blob.size / 1024 / 1024).toFixed(1)} MB en ${seconds} s.`;
  } catch (err) {
    console.error(err);
    status.className = 'status error';
    status.textContent = `Error: ${err.message}`;
  } finally {
    progress.hidden = true;
    createBtn.disabled = !(bitmaps.light && bitmaps.dark);
  }
});

// ── Compatibilidad ──
isSupported().then((ok) => {
  if (!ok) {
    $('.unsupported').hidden = false;
    createBtn.title = 'Tu navegador no puede codificar HEVC';
  }
});

// Para pruebas automatizadas.
window.claroscuro = { createWallpaper, isSupported };
