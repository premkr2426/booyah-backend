const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
    ffUid: String,
    amount: Number,
    cost: Number,
    upiId: String,  // 👈 Naya Field: Paise kahan bhejne hain!
    status: { type: String, default: 'Pending' }, // Pending, Approved, ya Rejected
    requestedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);