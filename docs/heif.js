// Claroscuro — genera en el navegador un .heic con dos imágenes (claro/oscuro)
// y el metadato `apple_desktop:apr` que macOS usa para alternarlas. Licencia MIT.
//
// Cada imagen se divide en mosaicos de 512×512 codificados en HEVC con WebCodecs
// y se describe como un ítem `grid`, igual que hace ImageIO de Apple.

const TILE = 512;

// Plist binario {"l": 0, "d": 1} en base64 (índice de la imagen clara y de la oscura).
const APR_PLIST = 'YnBsaXN0MDDSAQIDBFFkUWwQARAACA0PERMAAAAAAAABAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAFQ==';

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:apple_desktop="http://ns.apple.com/namespace/1.0/">
   <apple_desktop:apr>${APR_PLIST}</apple_desktop:apr>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

const CODECS = ['hvc1.1.6.L93.B0', 'hvc1.1.6.L120.B0', 'hvc1.1.6.L123.B0', 'hvc1.1.6.L150.B0', 'hvc1.1.6.L153.B0'];

// ───────────────────────── Codificación HEVC ─────────────────────────

async function pickConfig() {
  if (typeof VideoEncoder === 'undefined') return null;
  const base = { width: TILE, height: TILE, framerate: 1, latencyMode: 'quality', hevc: { format: 'hevc' } };
  for (const codec of CODECS) {
    for (const extra of [{ bitrateMode: 'quantizer' }, { bitrate: TILE * TILE * 3 }]) {
      const config = { ...base, ...extra, codec };
      try {
        const { supported } = await VideoEncoder.isConfigSupported(config);
        if (supported) return config;
      } catch { /* probar el siguiente */ }
    }
  }
  return null;
}

export async function isSupported() {
  return (await pickConfig()) !== null;
}

/** Codifica una imagen como mosaicos HEVC. Devuelve { hvcC, tiles, rows, cols, width, height, colorSpace }. */
async function encodeImage(bitmap, config, quality, onTile) {
  const { width, height } = bitmap;
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);

  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d');

  const tiles = [];
  let hvcC = null;
  let colorSpace = null;
  let error = null;

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      tiles.push(data);
      if (meta?.decoderConfig) {
        if (meta.decoderConfig.description) hvcC = new Uint8Array(toArrayBuffer(meta.decoderConfig.description));
        if (meta.decoderConfig.colorSpace) colorSpace = meta.decoderConfig.colorSpace;
      }
    },
    error(e) { error = e; },
  });
  encoder.configure(config);

  // QP de HEVC: 0 (mejor) – 51 (peor). Calidad 0–100 → QP 40–10.
  const qp = Math.round(40 - (quality / 100) * 30);
  const total = rows * cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.clearRect(0, 0, TILE, TILE);
      ctx.drawImage(bitmap, -c * TILE, -r * TILE);
      const frame = new VideoFrame(canvas, { timestamp: (r * cols + c) * 1_000_000, duration: 1_000_000 });
      const opts = { keyFrame: true };
      if (config.bitrateMode === 'quantizer') opts.hevc = { quantizer: qp };
      encoder.encode(frame, opts);
      frame.close();
      if (encoder.encodeQueueSize > 8) await new Promise((res) => encoder.addEventListener('dequeue', res, { once: true }));
      if (error) throw error;
      onTile?.(r * cols + c + 1, total);
    }
  }
  await encoder.flush();
  encoder.close();
  if (error) throw error;
  if (tiles.length !== total) throw new Error(`El codificador devolvió ${tiles.length} de ${total} mosaicos.`);

  // Si el navegador entrega Annex B (con códigos de inicio) en vez de hvcC, lo convertimos.
  if (!hvcC) {
    const params = new Map();
    for (let i = 0; i < tiles.length; i++) {
      const nalus = splitAnnexB(tiles[i]);
      for (const n of nalus) {
        const type = (n[0] >> 1) & 0x3f;
        if (type >= 32 && type <= 34 && !params.has(type)) params.set(type, n);
      }
      tiles[i] = lengthPrefixed(nalus.filter((n) => { const t = (n[0] >> 1) & 0x3f; return t < 32 || t > 34; }));
    }
    hvcC = buildHvcC(params);
  }

  return { hvcC, tiles, rows, cols, width, height, colorSpace };
}

function toArrayBuffer(src) {
  if (src instanceof ArrayBuffer) return src.slice(0);
  return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
}

function splitAnnexB(buf) {
  const out = [];
  let start = -1;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      if (start >= 0) out.push(trimZeros(buf.subarray(start, i)));
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0) out.push(buf.subarray(start));
  return out.filter((n) => n.length);
}

function trimZeros(n) {
  let end = n.length;
  while (end > 0 && n[end - 1] === 0) end--;
  return n.subarray(0, end);
}

function lengthPrefixed(nalus) {
  const w = new Writer();
  for (const n of nalus) { w.u32(n.length); w.bytes(n); }
  return w.toUint8Array();
}

function buildHvcC(params) {
  const sps = params.get(33);
  if (!sps || !params.get(32) || !params.get(34)) throw new Error('No se encontraron los parámetros VPS/SPS/PPS de HEVC.');
  const rbsp = removeEmulation(sps);
  // rbsp[0..1] cabecera NAL, rbsp[2] vps_id/max_sub_layers, rbsp[3..14] profile_tier_level.
  const ptl = rbsp.subarray(3, 15);
  const w = new Writer();
  w.u8(1);
  w.bytes(ptl.subarray(0, 1));   // profile_space, tier, profile_idc
  w.bytes(ptl.subarray(1, 5));   // compatibility flags
  w.bytes(ptl.subarray(5, 11));  // constraint flags
  w.bytes(ptl.subarray(11, 12)); // level_idc
  w.u16(0xf000); w.u8(0xfc); w.u8(0xfd); w.u8(0xf8); w.u8(0xf8); // chroma 4:2:0, 8 bits
  w.u16(0); w.u8(0x0f);
  w.u8(3);
  for (const type of [32, 33, 34]) {
    const n = params.get(type);
    w.u8(0x80 | type); w.u16(1); w.u16(n.length); w.bytes(n);
  }
  return w.toUint8Array();
}

function removeEmulation(n) {
  const out = [];
  for (let i = 0; i < n.length; i++) {
    if (i >= 2 && n[i] === 3 && n[i - 1] === 0 && n[i - 2] === 0) continue;
    out.push(n[i]);
  }
  return new Uint8Array(out);
}

// ───────────────────────── Contenedor HEIF ─────────────────────────

class Writer {
  constructor() { this.parts = []; this.length = 0; }
  u8(v) { this.bytes(Uint8Array.of(v)); }
  u16(v) { this.bytes(Uint8Array.of(v >> 8, v & 0xff)); }
  u32(v) { this.bytes(Uint8Array.of(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)); }
  str(s) { this.bytes(new TextEncoder().encode(s)); }
  cstr(s) { this.str(s); this.u8(0); }
  bytes(b) { this.parts.push(b); this.length += b.length; }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

function box(type, ...children) {
  const w = new Writer();
  const body = children.map((c) => (c instanceof Uint8Array ? c : c.toUint8Array()));
  w.u32(8 + body.reduce((s, b) => s + b.length, 0));
  w.str(type);
  body.forEach((b) => w.bytes(b));
  return w.toUint8Array();
}

function fullBox(type, version, flags, fill) {
  const w = new Writer();
  w.u8(version); w.u8(flags >> 16); w.u16(flags & 0xffff);
  fill?.(w);
  return box(type, w);
}

const PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
const MATRIX = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };

function colrBox(cs) {
  return box('colr', (() => {
    const w = new Writer();
    w.str('nclx');
    w.u16(PRIMARIES[cs?.primaries] ?? 1);
    w.u16(TRANSFER[cs?.transfer] ?? 13);
    w.u16(MATRIX[cs?.matrix] ?? 6);
    w.u8(cs?.fullRange ? 0x80 : 0);
    return w;
  })());
}

function gridData(img) {
  const w = new Writer();
  const big = img.width > 0xffff || img.height > 0xffff;
  w.u8(0); w.u8(big ? 1 : 0); w.u8(img.rows - 1); w.u8(img.cols - 1);
  if (big) { w.u32(img.width); w.u32(img.height); } else { w.u16(img.width); w.u16(img.height); }
  return w.toUint8Array();
}

/** Arma el archivo HEIC con dos imágenes codificadas: [claro, oscuro]. */
function mux(images) {
  // ── Ítems: mosaicos claros, grid claro, XMP, mosaicos oscuros, grid oscuro (mismo orden que ImageIO).
  const items = []; // { id, type, data, props: [índices ipco 1-based con bit esencial], contentType }
  const props = [];
  const addProp = (p) => props.push(p); // devuelve el índice 1-based en ipco
  const pixi = addProp(fullBox('pixi', 0, 0, (w) => { w.u8(3); w.u8(8); w.u8(8); w.u8(8); }));
  const tileIspe = addProp(fullBox('ispe', 0, 0, (w) => { w.u32(TILE); w.u32(TILE); }));

  const dimg = [];
  let xmpId = 0;
  let nextId = 1;
  const gridIds = [];
  images.forEach((img, index) => {
    const hvcC = addProp(box('hvcC', img.hvcC));
    const colr = addProp(colrBox(img.colorSpace));
    const ispe = addProp(fullBox('ispe', 0, 0, (w) => { w.u32(img.width); w.u32(img.height); }));
    const tileIds = img.tiles.map((data) => {
      const id = nextId++;
      items.push({ id, type: 'hvc1', data, props: [0x80 | hvcC, tileIspe, 0x80 | colr] });
      return id;
    });
    const gridId = nextId++;
    gridIds.push(gridId);
    items.push({ id: gridId, type: 'grid', data: gridData(img), props: [ispe, 0x80 | colr, pixi] });
    dimg.push({ from: gridId, to: tileIds });
    if (index === 0) {
      xmpId = nextId++;
      items.push({ id: xmpId, type: 'mime', contentType: 'application/rdf+xml', data: new TextEncoder().encode(XMP), props: [] });
    }
  });
  if (nextId > 0xffff) throw new Error('La imagen es demasiado grande.');

  const build = (offsets) => {
    const hdlr = fullBox('hdlr', 0, 0, (w) => { w.u32(0); w.str('pict'); w.u32(0); w.u32(0); w.u32(0); w.u8(0); });
    const dinf = box('dinf', fullBox('dref', 0, 0, (w) => { w.u32(1); w.bytes(fullBox('url ', 0, 1)); }));
    const pitm = fullBox('pitm', 0, 0, (w) => w.u16(gridIds[0]));
    const iinf = fullBox('iinf', 0, 0, (w) => {
      w.u16(items.length);
      for (const it of items) {
        // flags=1 oculta los mosaicos para que no cuenten como imágenes sueltas.
        w.bytes(fullBox('infe', 2, it.type === 'hvc1' ? 1 : 0, (b) => {
          b.u16(it.id); b.u16(0); b.str(it.type); b.u8(0);
          if (it.contentType) b.cstr(it.contentType);
        }));
      }
    });
    const iref = fullBox('iref', 0, 0, (w) => {
      const ref = (type, from, to) => {
        const r = new Writer();
        r.u16(from); r.u16(to.length); to.forEach((t) => r.u16(t));
        w.bytes(box(type, r));
      };
      ref('dimg', dimg[0].from, dimg[0].to);
      ref('cdsc', xmpId, [gridIds[0]]);
      ref('dimg', dimg[1].from, dimg[1].to);
    });
    const withProps = items.filter((it) => it.props.length);
    const ipma = fullBox('ipma', 0, 0, (w) => {
      w.u32(withProps.length);
      for (const it of withProps) { w.u16(it.id); w.u8(it.props.length); it.props.forEach((p) => w.u8(p)); }
    });
    const iprp = box('iprp', box('ipco', ...props), ipma);
    const iloc = fullBox('iloc', 0, 0, (w) => {
      w.u8(0x44); w.u8(0x00); // offset_size=4, length_size=4, base_offset_size=0
      w.u16(items.length);
      items.forEach((it, i) => { w.u16(it.id); w.u16(0); w.u16(1); w.u32(offsets[i]); w.u32(it.data.length); });
    });
    const versionAndFlags = new Uint8Array(4); // 'meta' es un FullBox
    return box('meta', versionAndFlags, hdlr, dinf, pitm, iinf, iref, iprp, iloc);
  };

  const ftyp = box('ftyp', (() => {
    const w = new Writer();
    w.str('heic'); w.u32(0); w.str('mif1'); w.str('miaf'); w.str('MiHB'); w.str('heic');
    return w;
  })());

  // Primero calculamos el tamaño de 'meta' para saber dónde empieza 'mdat'.
  const metaSize = build(items.map(() => 0)).length;
  const mdatSize = 8 + items.reduce((s, it) => s + it.data.length, 0);
  if (ftyp.length + metaSize + mdatSize > 0xffffffff) throw new Error('El archivo resultante supera 4 GB.');
  let offset = ftyp.length + metaSize + 8;
  const offsets = items.map((it) => { const o = offset; offset += it.data.length; return o; });
  const meta = build(offsets);

  const mdatHeader = new Writer();
  mdatHeader.u32(mdatSize); mdatHeader.str('mdat');
  return new Blob([ftyp, meta, mdatHeader.toUint8Array(), ...items.map((it) => it.data)], { type: 'image/heic' });
}

/**
 * Crea el fondo dinámico.
 * @param {ImageBitmap} light imagen para modo claro
 * @param {ImageBitmap} dark imagen para modo oscuro
 * @param {{ quality?: number, onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<Blob>}
 */
export async function createWallpaper(light, dark, { quality = 85, onProgress } = {}) {
  const config = await pickConfig();
  if (!config) throw new Error('Este navegador no puede codificar HEVC. Prueba con Safari o Chrome en un Mac.');
  const tilesOf = (b) => Math.ceil(b.width / TILE) * Math.ceil(b.height / TILE);
  const total = tilesOf(light) + tilesOf(dark);
  const encodedLight = await encodeImage(light, config, quality, (n) => onProgress?.(n, total));
  const firstCount = encodedLight.tiles.length;
  const encodedDark = await encodeImage(dark, config, quality, (n) => onProgress?.(firstCount + n, total));
  return mux([encodedLight, encodedDark]);
}
