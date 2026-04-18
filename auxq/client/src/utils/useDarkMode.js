// useDarkMode.js — A custom React hook for dark mode
//
// A "hook" is a function that starts with "use" and lets you plug into
// React features (like state) from any component. Custom hooks let you
// extract and reuse logic across multiple components.
//
// This hook does three things:
//   1. Reads the saved preference from localStorage on first load
//   2. Applies it to the <html> element via a data-theme attribute
//   3. Returns the current value + a toggle function for components to use

import { useState, useEffect } from 'react';

function useDarkMode() {
  // Read saved preference, default to 'light' if nothing saved yet
  const [theme, setTheme] = useState(
    () => localStorage.getItem('auxq-theme') || 'dark'
  );

  // useEffect runs after render. Whenever "theme" changes, this updates
  // the <html> element and saves the preference to localStorage.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('auxq-theme', theme);
  }, [theme]); // The [theme] means "only re-run when theme changes"

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return { theme, toggle };
}

export default useDarkMode;