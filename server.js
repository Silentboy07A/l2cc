const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const nodemailer = require('nodemailer');
require('dotenv').config();

const User = require('./models/User');
const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');

const app = express();
const PORT = process.env.PORT || 80;
const SECRET_KEY = process.env.SECRET_KEY || 'l2c_secret_9944';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/l2c';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Serve static frontend files from 'l2c' folder
app.use(express.static(path.join(__dirname, 'l2c')));

// ─── MongoDB Connection ───────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeToken = (email) => jwt.sign({ email }, SECRET_KEY, { expiresIn: '24h' });
const makeLongToken = (email) => jwt.sign({ email }, SECRET_KEY, { expiresIn: '30d' });
const generate6OTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Detect if credentials are real (not placeholder values)
const isEmailConfigured = process.env.EMAIL_USER && !process.env.EMAIL_USER.includes('your_');
const isTwilioConfigured = process.env.TWILIO_SID && !process.env.TWILIO_SID.startsWith('AC') === false
    && !process.env.TWILIO_SID.includes('xxx');

// Email transporter (Gmail)
const mailer = isEmailConfigured ? nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
}) : null;

const sendEmail = async (to, subject, html) => {
    if (!isEmailConfigured) {
        console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}`);
        return;
    }
    await mailer.sendMail({ from: `L2C <${process.env.EMAIL_USER}>`, to, subject, html });
};

// Twilio
let twilioClient = null;
if (isTwilioConfigured) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
}

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ message: 'Unauthorized' });
        req.userEmail = decoded.email;
        next();
    });
};

// ─── Passport: Google OAuth ───────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || `${CLIENT_URL}/auth/google/callback`
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails[0].value;
            let user = await User.findOne({ email });
            if (!user) {
                user = await User.create({
                    firstName: profile.name.givenName || profile.displayName,
                    lastName: profile.name.familyName || '',
                    email,
                    googleId: profile.id
                });
            } else if (!user.googleId) {
                user.googleId = profile.id;
                await user.save();
            }
            done(null, user);
        } catch (err) { done(err); }
    }));
}


// ─── Auth APIs: Email/Password ────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });
        const newUser = new User({ firstName, lastName, email, phone, password });
        await newUser.save();
        const token = makeToken(newUser.email);
        res.json({ token, user: { firstName, lastName, email, phone } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;
        const user = await User.findOne({ email });
        if (user && await user.comparePassword(password)) {
            const token = rememberMe ? makeLongToken(user.email) : makeToken(user.email);
            res.json({ token, user: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone } });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error during login' });
    }
});

// ─── Auth APIs: Email OTP ─────────────────────────────────────────────────────
app.post('/api/auth/send-otp-email', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email required' });

        const code = generate6OTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

        let user = await User.findOne({ email });
        if (!user) {
            // Auto-create user on first OTP login
            user = new User({ firstName: email.split('@')[0], email });
        }
        user.otp = { code, expiresAt };
        await user.save();

        await sendEmail(email, 'Your L2C Login Code', `
            <div style="font-family:sans-serif;max-width:400px;margin:auto">
                <h2 style="color:#ef4f5f">🍜 L2C Login Code</h2>
                <p>Your one-time login code is:</p>
                <h1 style="letter-spacing:12px;color:#293142">${code}</h1>
                <p style="color:#666;font-size:13px">Valid for 10 minutes. Do not share.</p>
            </div>
        `);

        // In dev mode without email setup, return code in response
        if (!process.env.EMAIL_USER) {
            return res.json({ message: 'OTP sent (dev mode)', devOtp: code });
        }
        res.json({ message: 'OTP sent to your email' });
    } catch (err) {
        console.error('Send OTP email error:', err);
        res.status(500).json({ message: 'Failed to send OTP' });
    }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const { email, code } = req.body;
        const user = await User.findOne({ email });
        if (!user || !user.otp?.code) return res.status(400).json({ message: 'No OTP found. Request a new one.' });
        if (user.otp.code !== code) return res.status(400).json({ message: 'Incorrect OTP' });
        if (user.otp.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired. Request a new one.' });

        // Clear OTP
        user.otp = undefined;
        await user.save();

        const token = makeToken(user.email);
        res.json({ token, user: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone } });
    } catch (err) {
        res.status(500).json({ message: 'OTP verification failed' });
    }
});

// ─── Auth APIs: Phone OTP (SMS via Twilio) ────────────────────────────────────
app.post('/api/auth/send-otp-phone', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ message: 'Phone number required' });

        const code = generate6OTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Use phone as identifier
        const email = `phone_${phone.replace(/\D/g, '')}@l2c.local`;
        let user = await User.findOne({ phone });
        if (!user) user = new User({ firstName: 'User', email, phone });
        user.otp = { code, expiresAt };
        await user.save();

        if (twilioClient) {
            await twilioClient.messages.create({
                body: `Your L2C verification code is: ${code}. Valid for 10 minutes.`,
                from: process.env.TWILIO_PHONE,
                to: phone.startsWith('+') ? phone : `+91${phone}`
            });
        } else {
            console.log(`[DEV] SMS to ${phone}: OTP = ${code}`);
            return res.json({ message: 'OTP sent (dev mode)', devOtp: code });
        }

        res.json({ message: 'OTP sent to your phone' });
    } catch (err) {
        console.error('Send phone OTP error:', err);
        res.status(500).json({ message: 'Failed to send SMS OTP' });
    }
});

app.post('/api/auth/verify-otp-phone', async (req, res) => {
    try {
        const { phone, code } = req.body;
        const user = await User.findOne({ phone });
        if (!user || !user.otp?.code) return res.status(400).json({ message: 'No OTP found.' });
        if (user.otp.code !== code) return res.status(400).json({ message: 'Incorrect OTP' });
        if (user.otp.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired.' });

        user.otp = undefined;
        await user.save();

        const token = makeToken(user.email);
        res.json({ token, user: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone } });
    } catch (err) {
        res.status(500).json({ message: 'OTP verification failed' });
    }
});

// ─── Auth APIs: Magic Link ─────────────────────────────────────────────────────
app.post('/api/auth/magic-link', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email required' });

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        let user = await User.findOne({ email });
        if (!user) user = new User({ firstName: email.split('@')[0], email });
        user.magicToken = { token, expiresAt };
        await user.save();

        const magicUrl = `${CLIENT_URL}/api/auth/magic-verify?token=${token}&email=${encodeURIComponent(email)}`;

        await sendEmail(email, 'Your L2C Magic Login Link', `
            <div style="font-family:sans-serif;max-width:400px;margin:auto">
                <h2 style="color:#ef4f5f">🍜 L2C Magic Login</h2>
                <p>Click the button below to log in instantly — no password needed:</p>
                <a href="${magicUrl}" style="display:inline-block;margin-top:16px;padding:14px 28px;background:#ef4f5f;color:white;text-decoration:none;border-radius:99px;font-weight:700">
                    ✨ Log In to L2C
                </a>
                <p style="color:#666;font-size:13px;margin-top:16px">Link expires in 15 minutes.</p>
            </div>
        `);

        if (!process.env.EMAIL_USER) {
            return res.json({ message: 'Magic link sent (dev mode)', devLink: magicUrl });
        }
        res.json({ message: 'Magic link sent to your email' });
    } catch (err) {
        console.error('Magic link error:', err);
        res.status(500).json({ message: 'Failed to send magic link' });
    }
});

app.get('/api/auth/magic-verify', async (req, res) => {
    try {
        const { token, email } = req.query;
        const user = await User.findOne({ email });
        if (!user || !user.magicToken?.token) return res.redirect(`/login.html?error=invalid_link`);
        if (user.magicToken.token !== token) return res.redirect(`/login.html?error=invalid_link`);
        if (user.magicToken.expiresAt < new Date()) return res.redirect(`/login.html?error=link_expired`);

        user.magicToken = undefined;
        await user.save();

        const jwtToken = makeToken(user.email);
        // Redirect to frontend with token in URL
        res.redirect(`/login.html?token=${jwtToken}&firstName=${encodeURIComponent(user.firstName)}&email=${encodeURIComponent(user.email)}`);
    } catch (err) {
        res.redirect(`/login.html?error=server_error`);
    }
});

// ─── OAuth: Google ─────────────────────────────────────────────────────────────
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/login.html?error=google_failed' }),
    (req, res) => {
        const token = makeToken(req.user.email);
        res.redirect(`/login.html?token=${token}&firstName=${encodeURIComponent(req.user.firstName)}&email=${encodeURIComponent(req.user.email)}`);
    }
);


// ─── Profile APIs ─────────────────────────────────────────────────────────────
app.get('/api/user/profile', authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail }).select('-password -otp -magicToken');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching profile' });
    }
});

app.put('/api/user/profile', authenticate, async (req, res) => {
    try {
        const { firstName, lastName, phone } = req.body;
        const user = await User.findOneAndUpdate(
            { email: req.userEmail },
            { firstName, lastName, phone },
            { new: true }
        ).select('-password -otp -magicToken');
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: 'Error updating profile' });
    }
});

// ─── Order APIs ───────────────────────────────────────────────────────────────
app.get('/api/orders', authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        const orders = await Order.find({ user: user._id }).sort({ placedAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

app.post('/api/orders', authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        const newOrder = new Order({ ...req.body, user: user._id });
        await newOrder.save();
        res.json(newOrder);
    } catch (err) {
        res.status(500).json({ message: 'Error placing order' });
    }
});

// ─── Favorites APIs ───────────────────────────────────────────────────────────
app.get('/api/user/favorites', authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        res.json(user.favorites || []);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching favorites' });
    }
});

app.post('/api/user/favorites', authenticate, async (req, res) => {
    try {
        const { restaurantId } = req.body;
        const user = await User.findOne({ email: req.userEmail });
        const idx = user.favorites.indexOf(restaurantId);
        if (idx > -1) user.favorites.splice(idx, 1);
        else user.favorites.push(restaurantId);
        await user.save();
        res.json(user.favorites);
    } catch (err) {
        res.status(500).json({ message: 'Error toggling favorite' });
    }
});

// ─── Restaurant Data ──────────────────────────────────────────────────────────
const initialRestaurants = [
    { id: 1, name: 'Pizzeria Napoli', cuisine: 'Pizza · Italian', emoji: '🍕', bg: 'linear-gradient(135deg,#ff9a9e,#fecfef)', rating: 4.9, time: 12, price: 350, offer: '20% OFF upto ₹100', isVeg: false, isNew: false, tag: '⚡ Blazing Fast' },
    { id: 2, name: 'Biryani Palace', cuisine: 'Biryani · Mughlai', emoji: '🍛', bg: 'linear-gradient(135deg,#a8edea,#fed6e3)', rating: 4.7, time: 18, price: 280, offer: 'Free delivery', isVeg: false, isNew: false, tag: '' },
    { id: 3, name: 'Burger Theory', cuisine: 'Burgers · American', emoji: '🍔', bg: 'linear-gradient(135deg,#ffecd2,#fcb69f)', rating: 4.8, time: 15, price: 320, offer: 'Buy 1 Get 1', isVeg: false, isNew: true, tag: '🆕 New' },
    { id: 4, name: 'Sushi Zen', cuisine: 'Sushi · Japanese', emoji: '🍣', bg: 'linear-gradient(135deg,#e0c3fc,#8ec5fc)', rating: 4.9, time: 25, price: 650, offer: '', isVeg: false, isNew: false, tag: '🏆 Top Rated' },
    { id: 5, name: 'Green Bowl', cuisine: 'Salads · Healthy', emoji: '🥗', bg: 'linear-gradient(135deg,#d4fc79,#96e6a1)', rating: 4.6, time: 20, price: 290, offer: '15% OFF', isVeg: true, isNew: false, tag: '🟢 Veg' },
    { id: 6, name: 'Wok & Roll', cuisine: 'Chinese · Asian', emoji: '🥡', bg: 'linear-gradient(135deg,#f6d365,#fda085)', rating: 4.5, time: 22, price: 240, offer: '', isVeg: false, isNew: false, tag: '' },
    { id: 7, name: 'Dosa Corner', cuisine: 'South Indian · Breakfast', emoji: '🍲', bg: 'linear-gradient(135deg,#f093fb,#f5576c)', rating: 4.8, time: 14, price: 120, offer: '30% OFF', isVeg: true, isNew: false, tag: '⚡ Blazing Fast' },
    { id: 8, name: 'The Cake Studio', cuisine: 'Desserts · Bakery', emoji: '🍰', bg: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)', rating: 4.7, time: 30, price: 400, offer: 'Free dessert', isVeg: true, isNew: true, tag: '🆕 New' },
    { id: 9, name: 'Tandoor House', cuisine: 'North Indian · Mughlai', emoji: '🍗', bg: 'linear-gradient(135deg,#ff758c,#ff7eb3)', rating: 4.6, time: 28, price: 380, offer: '', isVeg: false, isNew: false, tag: '' },
    { id: 10, name: 'Noodle Bar', cuisine: 'Noodles · Pan Asian', emoji: '🍜', bg: 'linear-gradient(135deg,#fddb92,#d1fdff)', rating: 4.4, time: 19, price: 220, offer: '10% OFF', isVeg: false, isNew: false, tag: '' },
    { id: 11, name: 'Pita Palace', cuisine: 'Mediterranean · Wraps', emoji: '🫔', bg: 'linear-gradient(135deg,#c3cfe2,#f5f7fa)', rating: 4.5, time: 23, price: 310, offer: '', isVeg: false, isNew: true, tag: '🆕 New' },
    { id: 12, name: 'Smoothie Lab', cuisine: 'Healthy · Juices', emoji: '🥤', bg: 'linear-gradient(135deg,#43e97b,#38f9d7)', rating: 4.7, time: 10, price: 160, offer: 'Free add-on', isVeg: true, isNew: false, tag: '⚡ Blazing Fast' },
];

async function seedRestaurants() {
    const count = await Restaurant.countDocuments();
    if (count === 0) {
        await Restaurant.insertMany(initialRestaurants);
        console.log('Seeded restaurants to database');
    }
}
seedRestaurants();

app.get('/api/restaurants', async (req, res) => {
    try {
        const restaurants = await Restaurant.find();
        res.json(restaurants);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching restaurants' });
    }
});

// Fallback to login.html for initial entry
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'l2c', 'login.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'l2c', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
