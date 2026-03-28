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

// ===================================================================
// 🕵️ GLOBAL LOGGER (Helps verify if TranzUPI webhook is reaching us)
// ===================================================================
app.use((req, res, next) => {
    if (req.method === 'POST') {
        console.log('Incoming POST Request to:', req.path);
    }
    next();
});

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    family: 4  
})
.then(() => console.log('Tijori (Database) se connection SUCCESSFUL! 🔐✅ BOOYAH!'))
.catch((err) => console.log('Tijori ka lock nahi khula ❌ Error: ', err.message));

// ===================================================================
// 🟢 PING ROUTE (To keep Render server awake)
// ===================================================================
app.get('/api/ping', (req, res) => res.send('pong'));

// ===================================================================
// 🚨 USER MODEL
// ===================================================================
const userSchema = new mongoose.Schema({
    ffUid: { type: String, required: true },
    coins: { type: Number, default: 0 },
    processedOrders: { type: [String], default: [] } // Added for Plan C
}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', userSchema);

// ===================================================================
// 🚀 RAASTA 1: THE CARPET BOMBING QR GENERATOR (100% COVERAGE)
// ===================================================================
app.post('/api/pay', async (req, res) => {
    try {
        const { amount, ffUid, customer_mobile } = req.body;

        const API_KEY = process.env.TRANZUPI_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'Gateway Key Missing in Server!' });
        }

        const txnId = `BYH_${ffUid || 'USR'}_${Date.now()}`;
        const amt = amount ? amount.toString() : "10";
        
        const params = new URLSearchParams();
        
        params.append('user_token', API_KEY);
        params.append('key', API_KEY);
        params.append('api_key', API_KEY);
        
        params.append('order_id', txnId);
        params.append('client_txn_id', txnId);
        params.append('txnid', txnId);
        
        params.append('amount', amt);
        
        params.append('customer_mobile', customer_mobile || "9999999999");
        params.append('mobile', customer_mobile || "9999999999");
        
        params.append('redirect_url', `https://booyah-central.vercel.app/?order_id=${txnId}`);
        params.append('remark1', "Booyah Wallet Topup");
        params.append('remark2', ffUid || "player");
        params.append('p_info', "Topup");
        params.append('udf1', "user");

        console.log("💣 Carpet Bombing Payload (Form-Data):", params.toString());

        const tranzUpiResponse = await fetch('https://tranzupi.com/api/create-order', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            body: params.toString()
        });

        const textResponse = await tranzUpiResponse.text(); 
        
        try {
            const qrData = JSON.parse(textResponse);
            console.log("📥 Final Gateway Response:", qrData);
            
            if (qrData.status === false) {
                 return res.status(400).json({ error: 'Gateway Rejected: ' + qrData.message });
            }

            res.json(qrData); 
        } catch (parseError) {
            console.error("Gateway Error Text:", textResponse);
            res.status(500).json({ error: 'Gateway error: ' + textResponse.substring(0, 50) });
        }

    } catch (error) {
        console.error("Backend API Error:", error);
        res.status(500).json({ error: 'System Error: ' + error.message });
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
// 🔔 RAASTA 7: THE BULLETPROOF WEBHOOK (AUTO COIN ADD)
// ===================================================================
app.post('/api/webhook/tranzupi', async (req, res) => {
    try {
        console.log("🔔 TRANZUPI WEBHOOK AAYA:", req.body); 

        const rawStatus = req.body.status || req.body.txnStatus || '';
        const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : rawStatus;
        
        const txnId = req.body.order_id || req.body.client_txn_id || req.body.orderId;
        const amount = req.body.amount;

        if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'PAID' || status === true) {
            if (txnId) {
                const parts = txnId.split('_'); 
                const playerUid = parts[1]; 
                
                if (playerUid && playerUid !== 'USR') {
                    let user = await User.findOne({ ffUid: playerUid });
                    
                    if (!user) {
                        user = new User({ ffUid: playerUid, coins: 0 });
                    }
                    
                    // Double spend check for webhook too!
                    const processed = user.processedOrders || [];
                    if (!processed.includes(txnId)) {
                        user.coins += Number(amount);
                        processed.push(txnId);
                        user.processedOrders = processed;
                        await user.save();
                        console.log(`💸 BOOYAH! Player ${playerUid} ke wallet mein ₹${amount} add ho gaye! Total: ₹${user.coins}`);
                    } else {
                        console.log(`⚠️ Webhook: Order ${txnId} ke paise pehle hi add ho chuke hain!`);
                    }
                } else {
                     console.log("⚠️ UID nahi mili isliye paise add nahi kiye. TxnId:", txnId);
                }
            } else {
                console.log("⚠️ Order ID nahi aayi Webhook mein!");
            }
        } else {
             console.log("❌ Payment Success nahi hui. Status aaya hai:", status);
        }
        res.status(200).send('OK'); 
    } catch (error) { 
        console.error("🚨 Webhook Error:", error);
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
            user.coins += amountToAdd; 
        }
        await user.save();

        console.log(`🎁 ADMIN GIFT: Player ${ffUid} ko ₹${amountToAdd} mil gaye!`);
        res.json({ message: 'Success', coins: user.coins });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================================================================
// 🕵️ RAASTA 10: COLLAR PAKAD STATUS CHECK (PLAN C - THE BRAHMASTRA)
// ===================================================================
app.get('/api/check-payment/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const API_KEY = process.env.TRANZUPI_API_KEY;

        console.log(`🕵️ Status check kar rahe hain Order: ${orderId} ka...`);

        const params = new URLSearchParams();
        params.append('user_token', API_KEY);
        params.append('api_key', API_KEY);
        params.append('order_id', orderId);
        params.append('client_txn_id', orderId); 

        const tranzUpiResponse = await fetch('https://tranzupi.com/api/check-order-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const data = await tranzUpiResponse.json();
        console.log("📥 TranzUPI Status Response:", data);

        if (data.status === 'SUCCESS' || (data.result && data.result.status === 'SUCCESS')) {
            const amount = data.result ? data.result.amount : 10;
            
            const parts = orderId.split('_');
            const playerUid = parts[1];

            if (playerUid && playerUid !== 'USR') {
                let user = await User.findOne({ ffUid: playerUid });
                if (!user) {
                    user = new User({ ffUid: playerUid, coins: 0 });
                }

                const processed = user.processedOrders || [];
                if (processed.includes(orderId)) {
                    console.log(`⚠️ Order ${orderId} ke paise pehle hi mil chuke hain!`);
                    return res.json({ success: true, message: 'Paise pehle hi add ho chuke hain!', coins: user.coins });
                }

                user.coins += Number(amount);
                processed.push(orderId); 
                user.processedOrders = processed; 
                
                await user.save();
                console.log(`💸 PLAN C BOOYAH! Player ${playerUid} ko ₹${amount} mil gaye! Total: ₹${user.coins}`);
                
                return res.json({ success: true, message: 'Payment verify ho gayi, paise add ho gaye!', coins: user.coins });
            }
        }

        res.json({ success: false, message: 'Payment abhi success nahi hui hai', data: data });

    } catch (error) {
        console.error("🚨 Status Check Error:", error);
        res.status(500).json({ error: 'Status check fail ho gaya' });
    }
});

// ===================================================================
// ⚔️ RAASTA 11: TOURNAMENT FEE DEDUCTION (THE FIX!)
// ===================================================================
app.post('/api/user/deduct', async (req, res) => {
    try {
        const { ffUid, amount } = req.body;
        if (!amount || amount <= 0) return res.json({ success: true }); // Free match hai toh kuch mat kaato
        
        let user = await User.findOne({ ffUid: ffUid });
        if (!user) return res.status(404).json({ error: 'User DB mein nahi hai' });
        
        if (user.coins < amount) {
            return res.status(400).json({ error: 'Kam Coins hain!' });
        }

        user.coins -= amount; // Paise kaat liye!
        await user.save();
        
        console.log(`⚔️ BOOYAH! Player ${ffUid} ne tournament join kiya. ₹${amount} deduct hue. Bacha hua balance: ₹${user.coins}`);
        res.json({ success: true, coins: user.coins });
    } catch (error) {
        console.error("Deduction Error:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===================================================================
// 🟢 SERVER START
// ===================================================================
app.listen(PORT, () => {
    console.log(`Server is running live on http://localhost:${PORT} 🚀`);
});