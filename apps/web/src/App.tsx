import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';

import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import AcceptInvitation from './pages/auth/AcceptInvitation';

import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import CapturesPage from './pages/CapturesPage';
import FloorPlanViewer from './pages/FloorPlanViewer';
import Viewer360 from './pages/Viewer360';
import BimModelsPage from './pages/BimModelsPage';
import BimViewerPage from './pages/BimViewerPage';
import IssuesPage from './pages/IssuesPage';

export default function App() {
  return (
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

      {/* Everything else lives inside the app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/captures" element={<CapturesPage />} />
          <Route path="/projects/:projectId/drawings" element={<FloorPlanViewer />} />
          <Route path="/projects/:projectId/bim" element={<BimModelsPage />} />
          <Route path="/projects/:projectId/issues" element={<IssuesPage />} />
          {/* Timeline view is planned for a later phase. */}
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
