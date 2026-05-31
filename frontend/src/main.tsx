import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './app/Root';
import { installDependencyWarningDiagnostics } from './utils/warningDiagnostics';
import './styles/variables.css';
import './theme/global.css';

installDependencyWarningDiagnostics();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
