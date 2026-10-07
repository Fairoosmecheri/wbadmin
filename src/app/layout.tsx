import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Reach • Customer workspace", template: "%s • Reach" }, description: "Your customers, conversations, and next steps in one private workspace." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
