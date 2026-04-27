/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

interface LayoutProps {
  title: string;
  active?:
    | 'overview'
    | 'jobs'
    | 'applications'
    | 'companies'
    | 'runs'
    | 'settings';
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  active,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · job-hunter</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html, body { background-color: #09090b; }
            .htmx-indicator { opacity: 0; transition: opacity 200ms; }
            .htmx-request .htmx-indicator { opacity: 1; }
            .htmx-request.htmx-indicator { opacity: 1; }
          `,
        }}
      />
    </head>
    <body class="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <Nav active={active} />
      <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <footer class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-zinc-600">
        job-hunter ·{' '}
        <a
          href="https://github.com"
          class="hover:text-zinc-400"
          target="_blank"
          rel="noopener"
        >
          src
        </a>
      </footer>
    </body>
  </html>
);

const Nav: FC<{ active?: LayoutProps['active'] }> = ({ active }) => (
  <header class="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur">
    <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
      <a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-wide">
        <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-400">JH</span>
        <span>job-hunter</span>
      </a>
      <nav class="flex items-center gap-1 text-sm">
        <NavLink href="/" label="Overview" active={active === 'overview'} />
        <NavLink href="/jobs" label="Jobs" active={active === 'jobs'} />
        <NavLink
          href="/applications"
          label="Applications"
          active={active === 'applications'}
        />
        <NavLink href="/companies" label="Companies" active={active === 'companies'} />
        <NavLink href="/runs" label="Runs" active={active === 'runs'} />
        <NavLink href="/settings" label="Settings" active={active === 'settings'} />
      </nav>
    </div>
  </header>
);

const NavLink: FC<{ href: string; label: string; active: boolean }> = ({
  href,
  label,
  active,
}) => (
  <a
    href={href}
    class={`rounded-md px-3 py-1.5 transition ${
      active
        ? 'bg-zinc-800 text-zinc-100'
        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100'
    }`}
  >
    {label}
  </a>
);
