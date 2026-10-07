import { requireUser } from "@/lib/authorization";
import { getCatalog } from "@/modules/catalog/service";
import { listSavedViews, listSegments, resolveCustomerFilter } from "@/modules/segments/service";
import { SegmentsUI } from "@/modules/segments/segments-ui";

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireUser();
  const query = await searchParams;
  const [segments, views, catalog, initialFilter] = await Promise.all([actor.role === "SALESMAN" ? Promise.resolve([]) : listSegments(actor), listSavedViews(actor), getCatalog(true), resolveCustomerFilter(query, actor)]);
  return <SegmentsUI segments={segments} views={views} catalog={catalog} role={actor.role} initialFilter={initialFilter} openEditor={query.create === "1"} initialTab={query.mode === "views" || actor.role === "SALESMAN" ? "views" : "segments"} />;
}
