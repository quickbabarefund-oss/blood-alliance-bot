import { NavLink, useLocation } from "react-router-dom";
import { Crown, Shield, Ban, ListChecks, History, Sparkles, Swords, LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";

const publicLinks = [
  { to: "/", label: "Global", icon: Crown, end: true },
  { to: "/clans", label: "Clans", icon: Shield },
  { to: "/player", label: "Player Lookup", icon: History },
];

const adminLinks = [
  { to: "/blacklist", label: "Blacklist", icon: Ban },
  { to: "/whitelist", label: "Whitelist", icon: ListChecks },
  { to: "/embeds", label: "Embed Editor", icon: Sparkles },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { isAdmin, logout } = useAdminAuth();

  const isActive = (path: string, end?: boolean) =>
    end ? pathname === path : pathname === path || pathname.startsWith(path + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gold-gradient text-primary-foreground ring-gold">
            <Swords className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Alliance</div>
              <div className="font-display text-base text-gold">Command Center</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Tracking</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {publicLinks.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={isActive(item.to, item.end)}>
                    <NavLink to={item.to} end={item.end} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{isAdmin ? "Admin" : "Admin (locked)"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminLinks.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={isActive(item.to)}>
                    <NavLink to={item.to} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {isAdmin ? (
          <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sign out admin</span>}
          </Button>
        ) : (
          !collapsed && <p className="px-2 text-[11px] text-muted-foreground">Unlock admin from any locked page.</p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
