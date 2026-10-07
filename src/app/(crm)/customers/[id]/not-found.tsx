import Link from "next/link";
export default function CustomerNotFound() { return <div className="empty-state card"><h1>Customer not found</h1><p>This customer is unavailable or is outside your assigned customer list.</p><Link href="/customers" className="btn btn-primary mt-4">Back to customers</Link></div>; }
