import { AppError, handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { listImports, uploadImport } from "@/modules/imports/service";
import { MAX_FILE_BYTES } from "@/modules/imports/files";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleApi(async () => Response.json({ imports: await listImports(await requireRole("ADMIN", "MANAGER")) }), request); }
export async function POST(request: Request) { return handleApi(async () => {
  const actor = await requireRole("ADMIN", "MANAGER");
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_FILE_BYTES + 65536) throw new AppError(413, "Choose a CSV or XLSX file up to 10 MB.");
  // Read bounded multipart input before parsing, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(422, "Choose a CSV or XLSX file.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_FILE_BYTES + 65536) { await reader.cancel(); throw new AppError(413, "Choose a CSV or XLSX file up to 10 MB."); } chunks.push(next.value); }
  let body: FormData;
  try { body = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new AppError(422, "The upload could not be read. Choose your file again."); }
  const file = body.get("file");
  if (!(file instanceof File)) throw new AppError(422, "Choose a CSV or XLSX file.");
  if (file.size > MAX_FILE_BYTES) throw new AppError(413, "Choose a file up to 10 MB.");
  return Response.json(await uploadImport(file.name, Buffer.from(await file.arrayBuffer()), actor), { status: 201 });
}, request); }
