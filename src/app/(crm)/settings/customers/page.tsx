import { requireRole } from "@/lib/authorization";
import { getCatalog } from "@/modules/catalog/service";
import { CatalogManager } from "@/modules/catalog/catalog-manager";
export default async function CustomerSettingsPage() {
  await requireRole("ADMIN");
  return <CatalogManager catalog={await getCatalog(true)} />;
}
