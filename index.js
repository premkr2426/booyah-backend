require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors'); 
const Withdrawal = require('./models/Withdrawal'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    family: 4  
})
.then(() => console.log('Tijori (Database) se connection SUCCESSFUL! 🔐✅ BOOYAH!'))
.catch((err) => console.log('Tijori ka lock nahi khula ❌ Error: ', err.message));

// ===================================================================
// 🚨 BRAHMASTRA FIX: User Model yahin define kar diya!
// Ab us bahar wali 'user.js' file ka koi kalesh nahi bacha.
// ===================================================================
const userSchema = new mongoose.Schema({
    ffUid: { type: String, required: true },
    coins: { type: Number, default: 0 }
}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', userSchema);

// ===================================================================
// 🚀 RAASTA 1: QR GENERATE KARNE WALA (FIXED 100%)
// ===================================================================
app.post('/api/pay', async (req, res) => {
    try {
        // 1. Frontend se aane wali SAARI details ko pakdo
        const { 
            amount, 
            ffUid, 
            customer_name, 
            customer_email, 
            customer_mobile, 
            client_txn_id, 
            p_info 
        } = req.body;

        // 2. TranzUPI ko saari required details bhejo
        const tranzUpiResponse = await fetch('https://tranzupi.com/api/create-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.TRANZUPI_API_KEY}`
            },
            body: JSON.stringify({
                amount: amount,
                client_txn_id: client_txn_id || `BOOYAH_${ffUid}_${Date.now()}`, 
                customer_name: customer_name || "Booyah Player",
                customer_email: customer_email || "player@booyahcentral.com",
                customer_mobile: customer_mobile || "9999999999",
                p_info: p_info || "Booyah Wallet Topup"
            })
        });

        const qrData = await tranzUpiResponse.json(); 
        
        // 3. Render ke logs mein asli response print karo (Taaki error ho toh dikh jaye)
        console.log("TranzUPI Live Response:", qrData);
        
        res.json(qrData); 
    } catch (error) {
        console.error("Backend API Error:", error);
        res.status(500).json({ error: 'QR nahi ban paya: ' + error.message });
    }
});

// ===================================================================
// 💰 RAASTA 2: SMART BALANCE CHECK
// ===================================================================
app.get('/api/user/:ffUid', async (req, res) => {
    try {
        let user = await User.findOne({ ffUid: req.params.ffUid });
        if (!user) {
            user = new User({ ffUid: req.params.ffUid, coins: 0 });
            await user.save();
        }
        res.json({ coins: user.coins }); 
    } catch (error) {
        res.status(500).json({ error: 'Balance check fail: ' + error.message });
    }
});

// ===================================================================
// 🏦 RAASTA 3: SUPER SMART WITHDRAWAL
// ===================================================================
app.post('/api/withdraw', async (req, res) => {
    try {
        const { ffUid, amount, cost, upiId } = req.body;
        let user = await User.findOne({ ffUid: ffUid });
        
        if (!user) {
            user = new User({ ffUid: ffUid, coins: 0 });
            await user.save();
        }

        if (user.coins < cost) {
            return res.status(400).json({ error: 'Insufficient Booty! (Server mein Balance ₹' + user.coins + ' hai)' });
        }

        user.coins -= cost;
        await user.save();

        const newRequest = new Withdrawal({ ffUid, amount, cost, upiId: upiId || 'Not Provided' });
        await newRequest.save();

        res.json({ message: 'Withdrawal request Admin ke paas chali gayi!', remainingCoins: user.coins });
    } catch (error) {
        console.error("🚨 WITHDRAWAL ERROR:", error);
        res.status(500).json({ error: 'Asli Bimari: ' + error.message });
    }
});

// ===================================================================
// 🛠️ RAASTA 8: ADMIN APPROVE / REJECT KAREGA
// ===================================================================
app.post('/api/admin/withdrawals/action', async (req, res) => {
    try {
        const { requestId, action } = req.body;
        const request = await Withdrawal.findById(requestId);
        if (!request) return res.status(404).json({ error: 'Request nahi mili' });

        request.status = action === 'Approve' ? 'Approved' : 'Rejected';
        await request.save();

        if (action === 'Reject') {
            const user = await User.findOne({ ffUid: request.ffUid });
            if (user) { user.coins += request.cost; await user.save(); }
        }
        res.json({ message: `Success! Request ${action} ho gayi!` });
    } catch (error) {
        res.status(500).json({ error: 'Action fail: ' + error.message });
    }
});

// ===================================================================
// 👑 RAASTA 4: ADMIN KE LIYE SAARI REQUESTS DEKHNA
// ===================================================================
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const requests = await Withdrawal.find().sort({ requestedAt: -1 });
        res.json(requests);
    } catch (error) { 
        res.status(500).json({ error: 'Requests fail: ' + error.message }); 
    }
});

// ===================================================================
// 🎁 RAASTA 6: CHEAT CODE
// ===================================================================
app.get('/api/cheat/:ffUid/:amount', async (req, res) => {
    try {
        let user = await User.findOne({ ffUid: req.params.ffUid });
        const amountToAdd = parseInt(req.params.amount);
        if (!user) { user = new User({ ffUid: req.params.ffUid, coins: amountToAdd }); } 
        else { user.coins += amountToAdd; }
        await user.save();
        res.json({ message: `BOOYAH! ${amountToAdd} Coins aa gaye! Balance: ${user.coins}` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ===================================================================
// 🔔 RAASTA 7: TRANZUPI WEBHOOK (1-COIN SYSTEM)
// ===================================================================
app.post('/api/webhook/tranzupi', async (req, res) => {
    try {
        const { client_txn_id, status, amount } = req.body;
        if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'PAID') {
            const parts = client_txn_id.split('_');
            const playerUid = parts[1]; 
            if (playerUid) {
                let user = await User.findOne({ ffUid: playerUid });
                if (!user) user = new User({ ffUid: playerUid, coins: 0 });
                
                // 🚨 SINGLE COIN FIX: Saare paise direct 'coins' mein jayenge! (Koi PlayCoins nahi)
                user.coins += Number(amount);
                await user.save();
                
                console.log(`💸 BOOYAH! Player ${playerUid} ne ₹${amount} Add kiye! Total Balance: ₹${user.coins}`);
            }
        }
        res.status(200).send('OK'); 
    } catch (error) { 
        res.status(500).send('Error'); 
    }
});

// ===================================================================
// 🎁 RAASTA 9: ADMIN GIFT ROUTE (MONGODB SYNC)
// ===================================================================
app.post('/api/admin/gift', async (req, res) => {
    try {
        const { ffUid, amount } = req.body;
        let user = await User.findOne({ ffUid: ffUid });
        const amountToAdd = parseInt(amount);

        if (!user) {
            user = new User({ ffUid: ffUid, coins: amountToAdd });
        } else {
            user.coins += amountToAdd; // Main balance update
        }
        await user.save();

        console.log(`🎁 ADMIN GIFT: Player ${ffUid} ko ₹${amountToAdd} mil gaye!`);
        res.json({ message: 'Success', coins: user.coins });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================================================================
// 🟢 SERVER START
// ===================================================================
app.listen(PORT, () => {
    console.log(`Server is running live on http://localhost:${PORT} 🚀`);
});