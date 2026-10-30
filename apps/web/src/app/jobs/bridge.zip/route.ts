import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

/** The KIASA ChatGPT Bridge's files (the folder `bridge/`, sent along by next.config.ts). */
const FILES = ["manifest.json", "background.js", "kiasa.js", "chatgpt.js"];
const FOLDER = "kiasa-chatgpt-bridge";

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The bridge as a .zip (stored, not compressed: four small files), to unzip
 * and load in Chrome (chrome://extensions → Developer mode → Load unpacked).
 * Made from the files themselves, so it is always the version KIASA expects. */
export function GET() {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of FILES) {
    const data = new Uint8Array(readFileSync(join(process.cwd(), "bridge", file)));
    const name = new TextEncoder().encode(`${FOLDER}/${file}`);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, FILES.length, true); end.setUint16(10, FILES.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const zip = new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
  return new Response(zip, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${FOLDER}.zip"`, "Cache-Control": "no-store" },
  });
}
