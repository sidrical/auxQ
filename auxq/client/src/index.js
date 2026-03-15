// index.js — The entry point for your React app
//
// This file does ONE thing: it takes your App component and "mounts" it
// into the HTML page. React needs a single DOM element to attach to —
// that's the div with id="root" in public/index.html.
//
// ReactDOM.createRoot is the modern way to initialize React 18+.
// Think of it as "React, take control of this div and render my app inside it."

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* StrictMode is a development helper that warns you about potential problems.
        It doesn't affect production builds — it's like training wheels that
        automatically come off when you deploy. */}
    <App />
  </React.StrictMode>
);
