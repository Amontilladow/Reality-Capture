import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { ToastViewport } from './components/ui/Toast';
import App from './App';
import './index.css';
import { startWebVitals } from './lib/web-vitals';

// Real user monitoring (Core Web Vitals) in production builds only; dev
// servers and test runs would just add noise to the numbers.
if (import.meta.env.PROD) startWebVitals();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ToastViewport />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
