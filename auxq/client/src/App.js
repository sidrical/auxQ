// App.js — The root component of your React app
//
// ROUTING: Your app has multiple "pages" (home, room, etc.) but it's actually
// a Single Page Application (SPA). That means the browser loads ONE HTML page,
// and React swaps out the content based on the URL. This is faster than
// traditional websites where every page click loads a whole new page from the server.
//
// react-router-dom is the library that handles this. It watches the URL and
// renders the matching component:
//   "/" → HomePage
//   "/room/:code" → RoomPage (the :code part is a variable, like /room/4821)

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import SpotifyCallback from './pages/SpotifyCallback';
import './styles/global.css';

// This is a "functional component" — the most common way to write React components.
// It's just a function that returns JSX (that HTML-looking stuff).
function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/callback" element={<SpotifyCallback />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
