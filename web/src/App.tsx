import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Account } from "@/pages/Account";
import { Compare } from "@/pages/Compare";
import { Landing } from "@/pages/Landing";
import { Library } from "@/pages/Library";
import { PostingDetail } from "@/pages/PostingDetail";
import { Profile } from "@/pages/Profile";
import { Upload } from "@/pages/Upload";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? "";

export function App() {
  return (
    <AuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppShell />}>
            <Route element={<ProtectedRoute />}>
              <Route path="/library" element={<Library />} />
              <Route path="/library/:key" element={<PostingDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/account" element={<Account />} />
              <Route path="/upload" element={<Upload />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
