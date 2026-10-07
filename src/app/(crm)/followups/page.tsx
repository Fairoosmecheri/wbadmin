import { FollowUpsBoard } from "@/modules/followups/followups-board";
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ customerId?: string; bucket?: string; view?: string }> }) {
  const { customerId, bucket, view } = await searchParams;
  return <FollowUpsBoard key={`${customerId ?? "all"}:${bucket ?? "all"}`} customerId={customerId} openCreate={Boolean(customerId) && view !== "1"} initialBucket={bucket} />;
}
