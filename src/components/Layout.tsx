import { Link, NavLink, Outlet } from "react-router-dom";
import { Shield, Crown, Ban, ListChecks, History, Users } from "lucide-react";

const links = [
  { to: "/", label: "Global", icon: Crown, end: true },
  { to: "/clans", label: "Clans", icon: Shield },
  { to: "/blacklist", label: "Blacklist", icon: Ban },
  { to: "/whitelist", label: "Whitelist", icon: ListChecks },
  { to: "/player", label: "Player", icon: History },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-gold-gradient text-primary-foreground ring-gold">
              <Users className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm uppercase tracking-widest text-muted-foreground">Alliance</div>
              <div className="font-display text-lg font-bold text-gold">Donation Tracker</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-secondary text-gold"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="container py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6">
        <div className="container text-center text-xs text-muted-foreground">
          Data refreshes every 5 minutes · Monthly reset 00:00 IST · Read-only — managed via Discord bot
        </div>
      </footer>
    </div>
  );
}
