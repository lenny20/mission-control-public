import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './screens.css';
import './today.css';
import './calendar.css';
import './work.css';
import './notes.css';
import './money.css';
import './watch.css';
import './recipes.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
