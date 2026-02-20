import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import PwaControls from '@/components/PwaControls';
import './globals.css';

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');

export const metadata: Metadata = {
  title: 'SecPlus Quest',
  description: 'Hands-on Security+ practice with missions, spaced repetition, and mastery tracking.',
  manifest: `${basePath}/manifest.webmanifest`
};

export const viewport: Viewport = {
  themeColor: '#0b0d16'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        <header className="site-header">
          <nav className="site-nav">
            <Link href={'/map' as Route} className="site-brand">SecPlus Quest</Link>
            <div className="site-links">
              <Link href={'/map' as Route}>Campaign</Link>
              <Link href={'/exam/sim' as Route}>Exam Sim</Link>
              <Link href={'/roguelike' as Route}>Roguelike</Link>
              <Link href={'/roguelike/plan' as Route}>Run Plan</Link>
              <Link href={'/review' as Route}>Mistakes</Link>
              <Link href={'/review/coverage' as Route}>Coverage</Link>
              <Link href={'/ops/stats' as Route}>Ops Stats</Link>
            </div>
          </nav>
          <div className="site-controls">
            <PwaControls />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
