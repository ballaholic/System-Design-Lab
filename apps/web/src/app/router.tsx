import { createBrowserRouter } from "react-router";
import { AppShell } from "@/app/layouts/AppShell";
import { AuthLayout } from "@/app/layouts/AuthLayout";
import { NotFoundPage } from "@/app/NotFoundPage";
import { RouteError } from "@/app/RouteError";
import { AuthCallbackPage } from "@/features/auth/pages/AuthCallbackPage";
import { ForgotPasswordPage } from "@/features/auth/pages/ForgotPasswordPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";
import { ResetPasswordPage } from "@/features/auth/pages/ResetPasswordPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { HomePage } from "@/features/dashboard/HomePage";
import { ProfilePage } from "@/features/profile/ProfilePage";

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          {
            path: "profile",
            element: (
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            ),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "register", element: <RegisterPage /> },
          { path: "forgot-password", element: <ForgotPasswordPage /> },
          { path: "reset-password", element: <ResetPasswordPage /> },
          { path: "auth/callback", element: <AuthCallbackPage /> },
        ],
      },
    ],
  },
]);
