const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    restaurant: { type: String, required: true },
    items: [{
        name: { type: String, required: true },
        qty: { type: Number, required: true },
        price: { type: Number, required: true }
    }],
    total: { type: Number, required: true },
    status: { type: String, default: 'Preparing' },
    placedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
