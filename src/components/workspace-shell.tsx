"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Users, ListFilter, Upload, CalendarCheck, MessageSquare, Megaphone, LayoutTemplate, BarChart3, Settings, UserCog, Search, ArrowUpRight, Menu, X, ChevronDown, Radio, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { Actor } from "@/lib/authorization";
const groups = [
  { title: "WORKSPACE", links: [{ title: "Overview", href: "/dashboard", icon: LayoutDashboard }, { title: "Customers", href: "/customers", icon: Users }, { title: "Segments", href: "/segments", icon: ListFilter, management: true }, { title: "Imports", href: "/imports", icon: Upload, admin: true }] },
  { title: "ENGAGE", links: [{ title: "Inbox", href: "/inbox", icon: MessageSquare }, { title: "Campaigns", href: "/campaigns", icon: Megaphone, management: true }, { title: "Templates", href: "/templates", icon: LayoutTemplate, management: true }, { title: "Follow-ups", href: "/followups", icon: CalendarCheck }] },
  { title: "MANAGE", links: [{ title: "Reports", href: "/reports", icon: BarChart3, management: true }, { title: "Team", href: "/users", icon: UserCog, admin: true }, { title: "Settings", href: "/settings", icon: Settings, admin: true }] }
];
export function WorkspaceShell({ children, actor, businessName, mock }: { children: React.ReactNode; actor: Actor; businessName: string; mock: boolean }) {
  const pathname = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false);
  const title = groups.flatMap(g => g.links).find(l => pathname.startsWith(l.href))?.title ?? "Workspace";
  return <div className="workspace"><a className="skip-link" href="#main-content">Skip to content</a>{open && <button aria-label="Close navigation" className="sidebar-overlay" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open ? "is-open" : ""}`}><Link className="brand" href="/dashboard"><span className="brand-mark"><MessageSquare size={21}/></span>reach<span className="brand-dot">.</span></Link><button className="mobile-close icon-btn" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={20}/></button>
    <div className="workspace-switch"><div className="workspace-avatar">{businessName.slice(0,1)}</div><div><strong>{businessName}</strong><small>Private workspace</small></div><ChevronDown size={14}/></div>
    <nav aria-label="Main navigation">{groups.map(group=><div className="nav-group" key={group.title}><p>{group.title}</p>{group.links.filter(l=>(!("admin" in l) || actor.role==="ADMIN")&&(!("management" in l)||actor.role!=="SALESMAN")).map(l=><Link onClick={()=>setOpen(false)} key={l.href} className={`nav-link ${pathname.startsWith(l.href)?"active":""}`} href={l.href}><l.icon size={18}/><span>{l.title}</span>{pathname.startsWith(l.href)&&<span className="active-dot"/>}</Link>)}</div>)}</nav>
    <div className="sidebar-bottom">{mock&&<div className="mock-note"><Radio size={16}/><div><strong>WhatsApp Mock Mode</strong><small>A safe space to try things out</small></div></div>}<div className="profile"><div className="avatar">{actor.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div><div><strong>{actor.name}</strong><small>{actor.role.toLowerCase()}</small></div><button className="icon-btn" aria-label="Sign out" onClick={async()=>{await authClient.signOut();router.replace("/login");router.refresh();}}><LogOut size={17}/></button></div></div>
    </aside><div className="workspace-main"><header className="topbar"><button className="mobile-menu icon-btn" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu size={22}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{title}</strong></div><form action="/customers" className="global-search"><Search size={16}/><input aria-label="Search customers" name="search" placeholder="Search customers…"/><kbd>↵</kbd></form><Link className="topbar-followup" href="/followups?bucket=my">My follow-ups <ArrowUpRight size={15}/></Link></header><main id="main-content" className="main-content">{children}</main><footer className="app-footer"><span>Made for meaningful customer connections.</span><span>Reach CRM</span></footer></div></div>;
}
