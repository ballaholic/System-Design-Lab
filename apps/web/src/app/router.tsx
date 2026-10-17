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
import { DesignsPage } from "@/features/designs/DesignsPage";
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
            // React Flow and the editor load only when the playground is opened.
            path: "playground/:designId?",
            handle: { fullBleed: true },
            lazy: async () => ({
              Component: (await import("@/features/playground/PlaygroundPage")).PlaygroundPage,
            }),
          },
          { path: "designs", element: <DesignsPage /> },
          {
            path: "docs/simulator",
            lazy: async () => ({
              Component: (await import("@/features/docs/SimulatorDocsPage")).SimulatorDocsPage,
            }),
          },
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
