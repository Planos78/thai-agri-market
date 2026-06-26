import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// Swappable storage adapter (mirror lib/psp.ts / lib/line.ts). Default `local` writes
// to public/uploads and returns a served URL — no bucket creds, build/tests work offline.
// Real `s3` is env-gated and throws loud if selected without creds (no silent fallback).
// Only the returned URL/path is persisted (DeliveryImage.url); binary never touches the DB (bug #7).
export interface StorageFile {
  name: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}

export interface StorageAdapter {
  putImage(file: StorageFile): Promise<{ url: string }>;
}

// Strip path separators from a client-supplied filename (no traversal).
function safeName(name: string): string {
  return (name || "upload").replace(/[/\\]/g, "_").replace(/[^\w.\-]/g, "_");
}

class LocalStorage implements StorageAdapter {
  async putImage(file: StorageFile): Promise<{ url: string }> {
    const dir = process.env.STORAGE_LOCAL_DIR ?? "public/uploads";
    const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    await fs.mkdir(absDir, { recursive: true });
    const fileName = `${crypto.randomUUID()}-${safeName(file.name)}`;
    await fs.writeFile(path.join(absDir, fileName), Buffer.from(file.bytes));
    return { url: `/uploads/${fileName}` };
  }
}

class S3Storage implements StorageAdapter {
  async putImage(_file: StorageFile): Promise<{ url: string }> {
    throw new Error("STORAGE_PROVIDER=s3 not implemented in P4 (deferred); set S3_* creds and implement before use");
  }
}

export function getStorage(): StorageAdapter {
  switch (process.env.STORAGE_PROVIDER ?? "local") {
    case "s3": {
      if (!process.env.S3_BUCKET) {
        throw new Error("STORAGE_PROVIDER=s3 but S3_BUCKET is not set (no silent local fallback)");
      }
      return new S3Storage();
    }
    case "local":
    default:
      return new LocalStorage();
  }
}
