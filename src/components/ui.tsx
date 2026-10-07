import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) { return <button className={cn("btn", `btn-${variant}`, className)} {...props} />; }
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("input", className)} {...props} />; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="flex gap-2 flex-wrap">{children}</div></div>; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="empty-state"><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>; }
export function Card({ children, className }: { children: ReactNode; className?: string }) { return <section className={cn("card", className)}>{children}</section>; }
