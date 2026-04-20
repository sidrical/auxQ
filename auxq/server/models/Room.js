const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  host: { type: String, required: true },
  hostPlatform: { type: String, enum: ['spotify', 'apple_music', null], default: null },
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  queue: { type: [mongoose.Schema.Types.Mixed], default: [] },
  currentTrack: { type: mongoose.Schema.Types.Mixed, default: null },
  isPlaying: { type: Boolean, default: false },
  users: { type: [String], default: [] },
  bannedUsers: { type: [String], default: [] },
  bannedIPs: { type: [String], default: [] },
  guestReorderEnabled: { type: Boolean, default: false },
  spotifyAccessToken: { type: String, default: null },
  spotifyRefreshToken: { type: String, default: null },
  spotifyExpiresAt: { type: Number, default: null },
  spotifyDeviceId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

roomSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Room', roomSchema);
