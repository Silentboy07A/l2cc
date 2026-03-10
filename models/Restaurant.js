const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    cuisine: { type: String, required: true },
    emoji: { type: String, required: true },
    bg: { type: String, required: true },
    rating: { type: Number, default: 0 },
    time: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    offer: { type: String },
    isVeg: { type: Boolean, default: false },
    isNew: { type: Boolean, default: false },
    tag: { type: String }
});

module.exports = mongoose.model('Restaurant', restaurantSchema);
