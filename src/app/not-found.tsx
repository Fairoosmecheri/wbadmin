import Link from "next/link";
export default function NotFound() { return <main className="empty-state"><h1>Page not found</h1><p>This record may have moved or is unavailable to your account.</p><Link href="/dashboard" className="btn btn-primary">Back to dashboard</Link></main>; }
