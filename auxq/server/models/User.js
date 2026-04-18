const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 30
  },
  password: {
    type: String,
    required: true
  },
  spotify: {
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    expiresAt: { type: Number, default: null }
  },
  appleMusicToken: { type: String, default: null },
  banList: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
