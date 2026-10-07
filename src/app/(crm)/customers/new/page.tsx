import { requireRole } from "@/lib/authorization";
import { getCatalog } from "@/modules/catalog/service";
import { CustomerForm } from "@/modules/customers/customer-form";
export default async function NewCustomerPage() {
  const actor = await requireRole("ADMIN", "MANAGER");
  return <CustomerForm catalog={await getCatalog()} role={actor.role} />;
}
