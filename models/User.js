const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    phone: { type: String, default: '' },
    password: { type: String },           // optional — OAuth/OTP users won't have one
    googleId: { type: String },           // Google OAuth
    githubId: { type: String },           // GitHub OAuth
    favorites: [{ type: Number }],
    // OTP (email or phone)
    otp: {
        code: { type: String },
        expiresAt: { type: Date }
    },
    // Magic Link
    magicToken: {
        token: { type: String },
        expiresAt: { type: Date }
    },
    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving (only if set)
userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) return;
    this.password = await bcrypt.hash(this.password, 10);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
