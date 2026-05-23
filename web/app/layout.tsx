import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "tnuk — pre-push code quality gate",
  description: "Thermo-nuclear maintainability review on every git push. $40/mo.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="site-header">
            <Link href="/" className="logo">
              tnuk
            </Link>
            <nav>
              <Link href="/pricing">Pricing</Link>
              <SignedIn>
                <Link href="/billing">Billing</Link>
              </SignedIn>
            </nav>
            <div className="auth">
              <SignedOut>
                <SignInButton mode="modal">
                  <button type="button">Sign in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button type="button" className="primary">
                    Start trial
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </div>
          </header>
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
