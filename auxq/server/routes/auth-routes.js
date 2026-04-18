const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (username.length < 2 || username.length > 30) return res.status(400).json({ error: 'Username must be 2–30 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await User.findOne({ username: username.trim() });
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username: username.trim(), password: hashed });
    const token = signToken(user);

    res.status(201).json({
      token,
      user: { id: user._id, username: user.username, spotify: user.spotify, appleMusicToken: user.appleMusicToken }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  try {
    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, username: user.username, spotify: user.spotify, appleMusicToken: user.appleMusicToken }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me — validate token and return current user profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch user' });
  }
});

// POST /auth/connect-apple — save Apple Music user token to account
router.post('/connect-apple', verifyToken, async (req, res) => {
  const { appleMusicToken } = req.body;
  if (!appleMusicToken) return res.status(400).json({ error: 'Apple Music token is required' });

  try {
    await User.findByIdAndUpdate(req.user.id, { appleMusicToken });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save Apple Music token' });
  }
});

// DELETE /auth/disconnect-spotify
router.delete('/disconnect-spotify', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { spotify: { accessToken: null, refreshToken: null, expiresAt: null } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not disconnect Spotify' });
  }
});

// DELETE /auth/disconnect-apple
router.delete('/disconnect-apple', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { appleMusicToken: null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not disconnect Apple Music' });
  }
});

module.exports = router;
