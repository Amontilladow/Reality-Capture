import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';

import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import AcceptInvitation from './pages/auth/AcceptInvitation';
import PendingApproval from './pages/PendingApproval';

import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import CapturesPage from './pages/CapturesPage';
import IssuesPage from './pages/IssuesPage';
import RfisPage from './pages/RfisPage';
import RfiDetailPage from './pages/RfiDetailPage';
import ReinforcementElementsPage from './pages/ReinforcementElementsPage';
import ReinforcementElementDetailPage from './pages/ReinforcementElementDetailPage';
import TransmittalsPage from './pages/TransmittalsPage';
import SnaggingPage from './pages/SnaggingPage';
import AssistantPage from './pages/AssistantPage';
import ReportsPage from './pages/ReportsPage';

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

function RouteLoading() {
  return (
    <div className="flex items-center justify-center h-screen text-sm text-ink-500">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        {/* Public / auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />

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
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/projects/:projectId/captures" element={<CapturesPage />} />
            <Route path="/projects/:projectId/drawings" element={<FloorPlanViewer />} />
            <Route path="/projects/:projectId/bim" element={<BimModelsPage />} />
            <Route path="/projects/:projectId/issues" element={<IssuesPage />} />
            <Route path="/projects/:projectId/rfis" element={<RfisPage />} />
            <Route path="/projects/:projectId/rfis/:rfiId" element={<RfiDetailPage />} />
            <Route path="/projects/:projectId/elements" element={<ReinforcementElementsPage />} />
            <Route path="/projects/:projectId/elements/:id" element={<ReinforcementElementDetailPage />} />
            <Route path="/projects/:projectId/transmittals" element={<TransmittalsPage />} />
            <Route path="/projects/:projectId/snagging" element={<SnaggingPage />} />
            <Route path="/projects/:projectId/assistant" element={<AssistantPage />} />
            <Route path="/projects/:projectId/reports" element={<ReportsPage />} />
            {/* Timeline view is planned for a later phase. */}
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Suspense>
  );
}
