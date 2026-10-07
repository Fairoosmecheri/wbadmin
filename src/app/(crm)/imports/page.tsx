import { requireRole } from "@/lib/authorization";
import { listImports } from "@/modules/imports/service";
import { ImportWizard } from "@/modules/imports/import-wizard";
export default async function ImportsPage() {
  const imports = await listImports(await requireRole("ADMIN", "MANAGER"));
  return <ImportWizard history={imports.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))} />;
}
