import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

export default function Layout() {
  const { isAdmin } = useAdminAuth();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-3 backdrop-blur-md sm:px-6">
            <SidebarTrigger />
            <div className="flex-1" />
            {isAdmin && (
              <Badge variant="outline" className="border-gold text-gold">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin
              </Badge>
            )}
          </header>
          <main className="flex-1 px-3 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <Outlet />
            </div>
          </main>
          <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
            Data refreshes every 5 minutes · Monthly reset 00:00 IST · Managed via the Alliance Discord bot
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
