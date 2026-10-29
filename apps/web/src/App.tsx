import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LogoMark } from './components/ui/LogoMark';
import { bootstrapSession } from './lib/api';
import { useAuthStore } from './store/auth.store';

import PublicLandingPage from './pages/PublicLandingPage';
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import AcceptInvitation from './pages/auth/AcceptInvitation';
import SelfSignup from './pages/auth/SelfSignup';
import PendingApproval from './pages/PendingApproval';
import RfiExternalPage from './pages/RfiExternalPage';
import ProgressReportExternalPage from './pages/ProgressReportExternalPage';
import DocumentExternalPage from './pages/DocumentExternalPage';

import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import IssuesPage from './pages/IssuesPage';
import RfisLandingPage from './pages/RfisLandingPage';
import RfisPage from './pages/RfisPage';
import RfiDetailPage from './pages/RfiDetailPage';
import SnaggingPage from './pages/SnaggingPage';
import SubmittalsPage from './pages/SubmittalsPage';
import DocumentsPage from './pages/DocumentsPage';
import TransmittalsPage from './pages/TransmittalsPage';
import QaInspectionsPage from './pages/QaInspectionsPage';
import QaqcLandingPage from './pages/QaqcLandingPage';
import QaqcListPage from './pages/QaqcListPage';
import QaqcDetailPage from './pages/QaqcDetailPage';
import ProgressReportPage from './pages/ProgressReportPage';
import AssistantPage from './pages/AssistantPage';
import ReportsPage from './pages/ReportsPage';
import RiskPage from './pages/RiskPage';
import MessagesPage from './pages/MessagesPage';
import WorkforcePage from './pages/WorkforcePage';
import DeveloperSettingsPage from './pages/DeveloperSettingsPage';
import AiSettingsPage from './pages/AiSettingsPage';
import SharePointIntegrationPage from './pages/SharePointIntegrationPage';
import EmailSettingsPage from './pages/EmailSettingsPage';
import BuildLensPage from './pages/BuildLensPage';
import HelpPage from './pages/HelpPage';

// These four pull in the heaviest dependencies in the app (Three.js +
// @thatopen/components + @thatopen/fragments for the two BIM routes,
// pdf.js for the drawing viewer) and are far from every user's most common
// path — lazy-loading them keeps those libraries out of the bundle every
// other route has to download and parse. Confirmed by hand: before this,
// the single main JS chunk was ~6.9MB (1.33MB gzipped) regardless of which
// page a user actually landed on first.
const Viewer360 = lazy(() => import('./pages/Viewer360'));
const BimModelsPage = lazy(() => import('./pages/BimModelsPage'));
const BimViewerPage = lazy(() => import('./pages/BimViewerPage'));
const FloorPlanViewer = lazy(() => import('./pages/FloorPlanViewer'));
// BuildLensTimelinePage reuses ThreeJsViewer (the same Three.js panorama
// renderer Viewer360 uses) -- lazy-loaded for the same bundle-splitting
// reason as the routes above. The BuildLens landing page has no such
// dependency and stays a normal eager import.
const BuildLensTimelinePage = lazy(() => import('./pages/BuildLensTimelinePage'));
// "Buildlense Captures" (nav label; route/component keep the original
// "captures" name) is the camera-location plan-upload-and-pin tool -- pulls
// in pdf.js via DrawingViewer just like FloorPlanViewer, so it's lazy-loaded
// the same way. Deliberately separate from FloorPlanViewer: Floor Plans is
// the Issues/Snags pin workflow and stays that way.
const CapturesPage = lazy(() => import('./pages/CapturesPage'));
// Site Drawing Hub pulls in pdf.js too (SiteDrawingPdfViewer), same
// bundle-splitting reason as the routes above.
const SiteDrawingHubPage = lazy(() => import('./pages/SiteDrawingHubPage'));
const GisPrepPage = lazy(() => import('./pages/GisPrepPage'));

function RouteLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-screen">
      <LogoMark className="w-9 h-9 motion-safe:animate-pulse" />
      <span className="text-sm text-ink-500">Loading…</span>
    </div>
  );
}

// "/" used to redirect straight to /projects unconditionally, which meant
// an unauthenticated visitor landed on nothing before being bounced again
// to /login by ProtectedRoute -- there was no public page to read first.
// Now: a signed-in visitor still goes straight into the app (unchanged
// behavior), and a signed-out visitor sees the public marketing page
// instead. Mirrors ProtectedRoute's own isHydrated wait (see auth.store.ts)
// so a fresh page load doesn't flash the marketing page for a split second
// before a valid session is confirmed.
function RootRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  if (!isHydrated) return null;
  if (accessToken) return <Navigate to="/projects" replace />;
  return <PublicLandingPage />;
}

export default function App() {
  // Re-establishes a session from the httpOnly refresh cookie once per full
  // page load -- the access token is kept in memory only (see auth.store.ts)
  // and doesn't survive a reload on its own. ProtectedRoute waits on
  // isHydrated before deciding whether to redirect to /login.
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        {/* Public / auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/signup" element={<SelfSignup />} />

        {/* No EngineeringOS account, no session -- the opaque token in the URL
            is the only credential. Deliberately outside ProtectedRoute/AppShell:
            nothing else in the app is reachable from here (see
            RfiExternalPage's own comment). */}
        <Route path="/rfi/external/:token" element={<RfiExternalPage />} />
        <Route path="/progress-report/:token" element={<ProgressReportExternalPage />} />
        <Route path="/documents/external/:token" element={<DocumentExternalPage />} />

        {/* The 360 viewer and BIM viewer are full-bleed immersive views — no sidebar chrome */}
        <Route element={<ProtectedRoute />}>
          <Route path="/projects/:projectId/viewer/:locationId" element={<Viewer360 />} />
          <Route path="/projects/:projectId/bim/:modelId" element={<BimViewerPage />} />
        </Route>

        {/* Needs a valid token (ProtectedRoute) but no AppShell -- this is the
            hard-gated dead end a pending-approval user is confined to. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/pending-approval" element={<PendingApproval />} />
        </Route>

        {/* Everything else lives inside the app shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/messages" element={<MessagesPage />} />
            <Route path="/projects/workforce" element={<WorkforcePage />} />
            <Route path="/projects/developer" element={<DeveloperSettingsPage />} />
            <Route path="/projects/sharepoint-integration" element={<SharePointIntegrationPage />} />
            <Route path="/projects/ai-settings" element={<AiSettingsPage />} />
            <Route path="/projects/email-settings" element={<EmailSettingsPage />} />
            <Route path="/projects/help" element={<HelpPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/projects/:projectId/captures" element={<CapturesPage />} />
            <Route path="/projects/:projectId/drawings" element={<FloorPlanViewer />} />
            <Route path="/projects/:projectId/buildlens" element={<BuildLensPage />} />
            <Route path="/projects/:projectId/buildlens/:locationId" element={<BuildLensTimelinePage />} />
            <Route path="/projects/:projectId/bim" element={<BimModelsPage />} />
            <Route path="/projects/:projectId/issues" element={<IssuesPage />} />
            <Route path="/projects/:projectId/rfis" element={<RfisLandingPage />} />
            {/* Literal path segments, not a shared :view param -- React
                Router ranks a static segment above a dynamic one, so these
                two always win over :rfiId below for the exact strings
                "main"/"subcontractor" (never a real RFI id, always a UUID). */}
            <Route path="/projects/:projectId/rfis/main" element={<RfisPage view="main" />} />
            <Route path="/projects/:projectId/rfis/subcontractor" element={<RfisPage view="subcontractor" />} />
            <Route path="/projects/:projectId/rfis/:rfiId" element={<RfiDetailPage />} />
            <Route path="/projects/:projectId/snagging" element={<SnaggingPage />} />
            <Route path="/projects/:projectId/submittals" element={<SubmittalsPage />} />
            <Route path="/projects/:projectId/documents" element={<DocumentsPage />} />
            <Route path="/projects/:projectId/transmittals" element={<TransmittalsPage />} />
            <Route path="/projects/:projectId/qa-inspections" element={<QaInspectionsPage />} />
            <Route path="/projects/:projectId/qaqc" element={<QaqcLandingPage />} />
            <Route path="/projects/:projectId/qaqc/:recordType" element={<QaqcListPage />} />
            <Route path="/projects/:projectId/qaqc/:recordType/:id" element={<QaqcDetailPage />} />
            <Route path="/projects/:projectId/progress-report" element={<ProgressReportPage />} />
            <Route path="/projects/:projectId/assistant" element={<AssistantPage />} />
            <Route path="/projects/:projectId/risk" element={<RiskPage />} />
            <Route path="/projects/:projectId/site-drawings" element={<SiteDrawingHubPage />} />
            <Route path="/projects/:projectId/gis-prep" element={<GisPrepPage />} />
            <Route path="/projects/:projectId/reports" element={<ReportsPage />} />
          </Route>
        </Route>

        <Route path="/" element={<RootRoute />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Suspense>
  );
}
