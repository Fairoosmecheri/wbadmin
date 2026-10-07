import { requireUser } from "@/lib/authorization";
import { listCustomers } from "@/modules/customers/service";
import { getCatalog } from "@/modules/catalog/service";
import { CustomerList } from "@/modules/customers/customer-list";
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireUser();
  const query = await searchParams;
  const [data, catalog] = await Promise.all([listCustomers(query, actor), getCatalog()]);
  return <CustomerList data={data} catalog={catalog} role={actor.role} />;
}
