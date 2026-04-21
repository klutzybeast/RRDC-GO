import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { UserAuthProvider, AdminAuthProvider, useUserAuth, useAdminAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import ARPage from "@/pages/ARPage";
import CollectionPage from "@/pages/CollectionPage";
import AdminLoginPage from "@/pages/AdminLoginPage";
import AdminPage from "@/pages/AdminPage";
import { Toaster } from "sonner";

function UserRoute({ children }) {
    const { user } = useUserAuth();
    if (user === undefined) return <LoadingScreen />;
    if (!user) return <Navigate to="/" replace />;
    return children;
}

function AdminRoute({ children }) {
    const { admin } = useAdminAuth();
    if (admin === undefined) return <LoadingScreen />;
    if (!admin) return <Navigate to="/admin/login" replace />;
    return children;
}

function LoadingScreen() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-river-50" data-testid="loading-screen">
            <div className="font-heading text-2xl text-river-600 animate-pulse">Loading the camp…</div>
        </div>
    );
}

export default function App() {
    return (
        <div className="App">
            <UserAuthProvider>
                <AdminAuthProvider>
                    <BrowserRouter>
                        <Routes>
                            <Route path="/" element={<LoginPage />} />
                            <Route path="/ar" element={<UserRoute><ARPage /></UserRoute>} />
                            <Route path="/collection" element={<UserRoute><CollectionPage /></UserRoute>} />
                            <Route path="/admin/login" element={<AdminLoginPage />} />
                            <Route path="/admin/*" element={<AdminRoute><AdminPage /></AdminRoute>} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                        <Toaster position="top-center" richColors />
                    </BrowserRouter>
                </AdminAuthProvider>
            </UserAuthProvider>
        </div>
    );
}
