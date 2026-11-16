import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/style.css';
import './ui/glass.css';
import { initGlass } from './ui/glass';
import { warmCompute } from './ui/compute-client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the first screen is up, not before it.
initGlass();
setTimeout(warmCompute, 500);
