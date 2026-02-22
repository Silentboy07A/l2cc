const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Restaurant = require('./models/Restaurant');
const Order = require('./models/Order');

const app = express();
const PORT = process.env.PORT || 80;
const SECRET_KEY = process.env.SECRET_KEY || 'l2c_secret_9944';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/l2c';

app.use(cors());
app.use(express.json());

// Serve static frontend files from 'l2c' folder
app.use(express.static(path.join(__dirname, 'l2c')));

// MongoDB Connection
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Auth APIs ---

app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const newUser = new User({ firstName, lastName, email, phone, password });
        await newUser.save();

        const token = jwt.sign({ email: newUser.email }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, user: { firstName, lastName, email } });
    } catch (err) {
        res.status(500).json({ message: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && await user.comparePassword(password)) {
            const token = jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '1h' });
            res.json({ token, user: { firstName: user.firstName, lastName: user.lastName, email: user.email } });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error during login' });
    }
});

// --- Data APIs ---

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

// Fallback to index.html for SPA-like behavior
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'l2c', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
