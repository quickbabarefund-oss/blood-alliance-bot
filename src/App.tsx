import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import GlobalLeaderboard from "./pages/GlobalLeaderboard";
import ClansRegistry from "./pages/ClansRegistry";
import ClanLeaderboard from "./pages/ClanLeaderboard";
import Blacklist from "./pages/Blacklist";
import Whitelist from "./pages/Whitelist";
import PlayerHistory from "./pages/PlayerHistory";
import EmbedEditor from "./pages/EmbedEditor";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<GlobalLeaderboard />} />
            <Route path="/clans" element={<ClansRegistry />} />
            <Route path="/clan/:tag" element={<ClanLeaderboard />} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/whitelist" element={<Whitelist />} />
            <Route path="/player" element={<PlayerHistory />} />
            <Route path="/embeds" element={<EmbedEditor />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
