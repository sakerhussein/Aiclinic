// Where the photos and documents are kept. Production: the private Supabase Storage bucket, reached only from this server with the
// project's service key (the browser never talks to the bucket). Local testing: a folder. Files are named by numbers only:
// <clinic id>/<patient id>/<file id>.
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http.js";

export function createStorage(cfg, { fetchImpl = fetch } = {}) {
  if (cfg.kind === "off") {
    const off = async () => { throw new HttpError(409, "files_not_set_up"); };
    return { kind: "off", put: off, get: off };
  }
  if (cfg.kind === "supabase") {
    const base = `${cfg.url}/storage/v1/object`;
    const headers = { apikey: cfg.key, authorization: `Bearer ${cfg.key}` };
    const at = (p) => `${encodeURIComponent(cfg.bucket)}/${p.split("/").map(encodeURIComponent).join("/")}`;
    return {
      kind: "supabase",
      async put(p, buf, mime) {
        const r = await fetchImpl(`${base}/${at(p)}`, { method: "POST", headers: { ...headers, "content-type": mime, "x-upsert": "false" }, body: buf });
        if (!r.ok) throw new Error(`storage upload failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
      },
      async get(p) {
        const r = await fetchImpl(`${base}/authenticated/${at(p)}`, { headers });
        if (!r.ok) throw new Error(`storage download failed: ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      },
    };
  }
  const root = path.resolve(cfg.dir);
  const file = (p) => {
    const f = path.resolve(root, p);
    if (!f.startsWith(root + path.sep)) throw new Error("bad storage path");
    return f;
  };
  return {
    kind: "disk",
    async put(p, buf) { await fs.mkdir(path.dirname(file(p)), { recursive: true }); await fs.writeFile(file(p), buf, { flag: "wx" }); },
    async get(p) { return fs.readFile(file(p)); },
  };
}

// What a file really is, from its first bytes (the name and the browser's word are not trusted).
export function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// Photos lose what the camera wrote about them (EXIF: place, phone, time). JPEG: the APP1 segments go; PNG: the eXIf chunk goes.
// The page has already redrawn photos upright, so nothing is lost by dropping the orientation.
export function stripMetadata(buf, mime) {
  if (mime === "image/jpeg") {
    const out = [buf.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda) break;                                   // start of scan: the picture itself follows
      const len = buf.readUInt16BE(i + 2);
      if (marker !== 0xe1) out.push(buf.subarray(i, i + 2 + len));  // APP1 (EXIF, XMP) dropped
      i += 2 + len;
    }
    out.push(buf.subarray(i));
    return Buffer.concat(out);
  }
  if (mime === "image/png") {
    const out = [buf.subarray(0, 8)];
    let i = 8;
    while (i + 12 <= buf.length) {
      const len = buf.readUInt32BE(i), type = buf.subarray(i + 4, i + 8).toString("latin1");
      if (type !== "eXIf") out.push(buf.subarray(i, i + 12 + len));
      i += 12 + len;
    }
    return Buffer.concat(out);
  }
  return buf;
}
