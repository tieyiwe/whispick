import type { Request } from "express";
import type multer from "multer";

// multer's own `limits.fileSize` applies one ceiling across every field in
// a multipart request — with two fields of very different sizes (a ~30MB
// video and a small thumbnail), that means a "thumbnail" field can itself
// carry up to the video's cap before anything rejects it, fully buffered
// into process memory first (multer.memoryStorage() buffers before handing
// control back). This engine enforces a separate limit per fieldname,
// aborting the stream (not just rejecting after the fact) once a field
// exceeds its own cap.
export function fieldLimitedMemoryStorage(limitsByField: Record<string, number>): multer.StorageEngine {
  return {
    _handleFile(req: Request, file: Express.Multer.File, callback) {
      const limit = limitsByField[file.fieldname];
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;

      file.stream.on("data", (chunk: Buffer) => {
        if (rejected) return;
        size += chunk.length;
        if (limit !== undefined && size > limit) {
          rejected = true;
          file.stream.unpipe();
          file.stream.resume(); // drain so the request can still complete
          callback(new Error(`FIELD_TOO_LARGE:${file.fieldname}`));
          return;
        }
        chunks.push(chunk);
      });

      file.stream.on("end", () => {
        if (rejected) return;
        callback(null, { buffer: Buffer.concat(chunks), size });
      });

      file.stream.on("error", (err) => {
        if (!rejected) callback(err);
      });
    },
    _removeFile(_req, _file, callback) {
      callback(null);
    },
  };
}
