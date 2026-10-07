import { z } from "zod";
import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { previewSegment } from "@/modules/segments/service";

export async function POST(request: Request) {
  return handleApi(async () => {
    const actor = await requireUser();
    const data = z.object({ filterDefinition: z.record(z.string(), z.unknown()), limit: z.number().int().min(1).max(100).optional() }).strict().parse(await request.json());
    return Response.json(await previewSegment(data.filterDefinition, actor, data.limit));
  }, request);
}
