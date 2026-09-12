import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Draft Map", template: "%s · Draft Map" },
  description: "What's on draft at every pub and bar in the UK. Find your beer, rate the pour.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <Nav user={user ? { displayName: user.displayName, role: user.role } : null} />
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="border-t border-stone-200 text-xs text-stone-500 px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
          <span>© Draft Map</span>
          <span>
            Pub locations © <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
          </span>
          <Link className="underline" href="/for-pubs">Run a pub?</Link>
          <Link className="underline" href="/about">About</Link>
        </footer>
      </body>
    </html>
  );
}
