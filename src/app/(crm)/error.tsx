"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <div className="card p-8"><h1>We couldn’t load this page</h1><p className="text-muted my-4">Check your connection and try again. Your saved work is safe.</p><button onClick={reset} className="btn btn-primary">Try again</button></div>; }
