import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import AdminGate from "@/components/AdminGate";
import { AdminAuthProvider } from "@/hooks/useAdminAuth";
import GlobalLeaderboard from "./pages/GlobalLeaderboard";
import ClansRegistry from "./pages/ClansRegistry";
import ClanLeaderboard from "./pages/ClanLeaderboard";
import Blacklist from "./pages/Blacklist";
import Whitelist from "./pages/Whitelist";
import PlayerHistory from "./pages/PlayerHistory";
import EmbedEditor from "./pages/EmbedEditor";
import WarTracker from "./pages/WarTracker";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AdminAuthProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<GlobalLeaderboard />} />
              <Route path="/clans" element={<ClansRegistry />} />
              <Route path="/clan/:tag" element={<ClanLeaderboard />} />
              <Route path="/player" element={<PlayerHistory />} />
              <Route path="/blacklist" element={<AdminGate title="Unlock to view & manage the blacklist."><Blacklist /></AdminGate>} />
              <Route path="/whitelist" element={<AdminGate title="Unlock to view & manage the whitelist."><Whitelist /></AdminGate>} />
              <Route path="/embeds" element={<AdminGate title="Unlock to edit Discord embeds."><EmbedEditor /></AdminGate>} />
            </Route>
            <Route path="/war/:clanTag" element={<WarTracker />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AdminAuthProvider>
      </Toaster>
    </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
