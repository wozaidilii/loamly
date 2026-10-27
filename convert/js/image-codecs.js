/** Small BMP / ICO / TIFF (uncompressed) codecs — no third-party deps. */

export function encodeBmp(imageData) {
  const { width, height, data } = imageData;
  const rowSize = (width * 3 + 3) & ~3;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const buf = new ArrayBuffer(fileSize);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // BITMAPFILEHEADER
  v.setUint16(0, 0x4d42, true);
  v.setUint32(2, fileSize, true);
  v.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, pixelBytes, true);
  let o = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      u8[o++] = data[i + 2];
      u8[o++] = data[i + 1];
      u8[o++] = data[i];
    }
    o += rowSize - width * 3;
  }
  return new Blob([buf], { type: 'image/bmp' });
}

export function decodeBmp(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  if (v.getUint16(0, true) !== 0x4d42) throw new Error('不是 BMP');
  const offset = v.getUint32(10, true);
  const dib = v.getUint32(14, true);
  const width = Math.abs(v.getInt32(18, true));
  const heightSigned = v.getInt32(22, true);
  const height = Math.abs(heightSigned);
  const bottomUp = heightSigned > 0;
  const bpp = v.getUint16(28, true);
  if (bpp !== 24 && bpp !== 32) throw new Error('仅支持 24/32 位 BMP');
  const rowSize = ((width * (bpp / 8) + 3) & ~3);
  const img = new ImageData(width, height);
  const out = img.data;
  const u8 = new Uint8Array(arrayBuffer);
  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y;
    const row = offset + srcY * rowSize;
    for (let x = 0; x < width; x++) {
      const si = row + x * (bpp / 8);
      const di = (y * width + x) * 4;
      out[di] = u8[si + 2];
      out[di + 1] = u8[si + 1];
      out[di + 2] = u8[si];
      out[di + 3] = bpp === 32 ? u8[si + 3] : 255;
    }
  }
  return img;
}

/** PNG-in-ICO multi-size (16/32/48/256). */
export async function encodeIco(pngBlobs) {
  const entries = [];
  for (const blob of pngBlobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // read IHDR for size
    const w = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
    const h = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
    entries.push({ w: w >= 256 ? 0 : w, h: h >= 256 ? 0 : h, bytes });
  }
  const header = 6 + entries.length * 16;
  let offset = header;
  const parts = [];
  const hdr = new ArrayBuffer(header);
  const hv = new DataView(hdr);
  hv.setUint16(0, 0, true);
  hv.setUint16(2, 1, true);
  hv.setUint16(4, entries.length, true);
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    hv.setUint8(o, e.w);
    hv.setUint8(o + 1, e.h);
    hv.setUint8(o + 2, 0);
    hv.setUint8(o + 3, 0);
    hv.setUint16(o + 4, 1, true);
    hv.setUint16(o + 6, 32, true);
    hv.setUint32(o + 8, e.bytes.length, true);
    hv.setUint32(o + 12, offset, true);
    offset += e.bytes.length;
  });
  parts.push(new Uint8Array(hdr));
  for (const e of entries) parts.push(e.bytes);
  return new Blob(parts, { type: 'image/x-icon' });
}

/** Uncompressed 32-bit RGBA TIFF. */
export function encodeTiff(imageData) {
  const { width, height, data } = imageData;
  const strip = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  // Layout: header(8) + IFD(2+12*12+4=150) + bits(8) + strip
  const ifdCount = 11;
  const ifdStart = 8;
  const ifdBytes = 2 + ifdCount * 12 + 4;
  const bitsOffset = ifdStart + ifdBytes;
  const stripOffset = bitsOffset + 8;
  const buf = new ArrayBuffer(stripOffset + strip.length);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdStart, true);
  let p = ifdStart;
  v.setUint16(p, ifdCount, true); p += 2;
  const put = (tag, type, count, val) => {
    v.setUint16(p, tag, true); p += 2;
    v.setUint16(p, type, true); p += 2;
    v.setUint32(p, count, true); p += 4;
    v.setUint32(p, val, true); p += 4;
  };
  put(256, 4, 1, width);
  put(257, 4, 1, height);
  put(258, 3, 4, bitsOffset); // BitsPerSample
  put(259, 3, 1, 1); // Compression none
  put(262, 3, 1, 2); // Photometric RGB
  put(273, 4, 1, stripOffset); // StripOffsets
  put(277, 3, 1, 4); // SamplesPerPixel
  put(278, 4, 1, height); // RowsPerStrip
  put(279, 4, 1, strip.length); // StripByteCounts
  put(284, 3, 1, 1); // PlanarConfiguration contiguous
  put(338, 3, 1, 2); // ExtraSamples associated alpha
  v.setUint32(p, 0, true); // next IFD
  // bits per sample
  v.setUint16(bitsOffset, 8, true);
  v.setUint16(bitsOffset + 2, 8, true);
  v.setUint16(bitsOffset + 4, 8, true);
  v.setUint16(bitsOffset + 6, 8, true);
  u8.set(strip, stripOffset);
  return new Blob([buf], { type: 'image/tiff' });
}

/** Decode uncompressed RGB/RGBA TIFF; throws otherwise. */
export function decodeTiff(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const le = v.getUint16(0, false) === 0x4949;
  const get16 = (o) => v.getUint16(o, le);
  const get32 = (o) => v.getUint32(o, le);
  if (get16(2) !== 42) throw new Error('不是 TIFF');
  let ifd = get32(4);
  const count = get16(ifd);
  const entries = {};
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    const tag = get16(o);
    const type = get16(o + 2);
    const cnt = get32(o + 4);
    let val = get32(o + 8);
    if (type === 3 && cnt === 1) val = get16(o + 8);
    entries[tag] = { type, cnt, val };
  }
  const width = entries[256]?.val;
  const height = entries[257]?.val;
  const compression = entries[259]?.val ?? 1;
  if (compression !== 1) throw new Error('TIFF 压缩格式暂不支持');
  const spp = entries[277]?.val ?? 3;
  const stripOff = entries[273]?.val;
  const stripLen = entries[279]?.val ?? width * height * spp;
  const u8 = new Uint8Array(arrayBuffer, stripOff, stripLen);
  const img = new ImageData(width, height);
  const out = img.data;
  for (let i = 0, p = 0; i < width * height; i++, p += spp) {
    const di = i * 4;
    out[di] = u8[p];
    out[di + 1] = u8[p + 1];
    out[di + 2] = u8[p + 2];
    out[di + 3] = spp >= 4 ? u8[p + 3] : 255;
  }
  return img;
}

export async function supportsAvifEncode() {
  if (typeof HTMLCanvasElement === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const blob = await new Promise((res) => c.toBlob(res, 'image/avif', 0.8));
    return !!(blob && blob.type === 'image/avif' && blob.size > 0);
  } catch {
    return false;
  }
}
