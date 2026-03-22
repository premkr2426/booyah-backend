const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    ffUid: { type: String, required: true },
    coins: { type: Number, default: 0 },
    // 🚨 PRO FIX: Email aur username ko 'optional' kar diya taaki error na aaye
    email: { type: String, required: false },
    username: { type: String, required: false }
}, { strict: false });

module.exports = mongoose.model('User', userSchema);