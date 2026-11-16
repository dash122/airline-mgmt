import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/style.css';
import { warmCompute } from './ui/compute-client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the first screen is up, not before it.
setTimeout(warmCompute, 500);
