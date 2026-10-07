import { notFound } from "next/navigation";
import { requireRole, assertRole } from "@/lib/authorization";
import { AppError } from "@/lib/api";
import { getCatalog } from "@/modules/catalog/service";
import { getCustomer } from "@/modules/customers/service";
import { CustomerForm } from "@/modules/customers/customer-form";
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const customer = await getCustomer(id, actor).catch(error => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  if (customer.archivedAt) assertRole(actor, "ADMIN");
  return <CustomerForm customer={customer} catalog={await getCatalog(true)} role={actor.role} />;
}
