/**
 * L2C Common Utilities
 * Handles Authentication, Notifications, and Favorites across all pages.
 */

const L2C = {
    // --- Configuration ---
    API_URL: window.location.origin, // Dynamic URL for dev/prod

    // --- Data ---
    restaurants: [], // Fetched from backend now

    // Fetch restaurants from backend
    fetchRestaurants: async () => {
        try {
            const res = await fetch(`${L2C.API_URL}/api/restaurants`);
            L2C.restaurants = await res.json();
            return L2C.restaurants;
        } catch (e) {
            console.error('Failed to fetch restaurants:', e);
            // Fallback to empty or initial data if needed
        }
    },


    // --- Authentication ---
    getUsers: () => JSON.parse(localStorage.getItem('l2c_users') || '[]'),
    saveUsers: (users) => localStorage.setItem('l2c_users', JSON.stringify(users)),

    getLoggedInUser: () => JSON.parse(localStorage.getItem('l2c_logged_in_user') || 'null'),
    setLoggedInUser: (user) => localStorage.setItem('l2c_logged_in_user', JSON.stringify(user)),

    logout: () => {
        localStorage.removeItem('l2c_logged_in_user');
        window.location.href = 'index.html';
    },

    requireAuth: () => {
        if (!L2C.getLoggedInUser()) {
            localStorage.setItem('l2c_redirect_after_login', window.location.pathname);
            window.location.href = 'login.html';
        }
    },

    login: async (email, password) => {
        const response = await fetch(`${L2C.API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!response.ok) throw new Error('Invalid credentials');
        const data = await response.json();
        localStorage.setItem('l2c_token', data.token);
        L2C.setLoggedInUser(data.user);
        return data.user;
    },

    register: async (userData) => {
        const response = await fetch(`${L2C.API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Registration failed');
        }
        const data = await response.json();
        localStorage.setItem('l2c_token', data.token);
        L2C.setLoggedInUser(data.user);
        return data.user;
    },

    updateProfile: async (data) => {
        const token = localStorage.getItem('l2c_token');
        const response = await fetch(`${L2C.API_URL}/api/user/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update profile');
        const user = await response.json();
        L2C.setLoggedInUser(user);
        L2C.updateNavbar();
        return user;
    },

    fetchOrders: async () => {
        const token = localStorage.getItem('l2c_token');
        const response = await fetch(`${L2C.API_URL}/api/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch orders');
        return await response.json();
    },

    placeOrder: async (orderData) => {
        const token = localStorage.getItem('l2c_token');
        const response = await fetch(`${L2C.API_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(orderData)
        });
        if (!response.ok) throw new Error('Failed to place order');
        return await response.json();
    },


    // --- Favorites ---
    fetchFavorites: async () => {
        const token = localStorage.getItem('l2c_token');
        if (!token) return [];
        const response = await fetch(`${L2C.API_URL}/api/user/favorites`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch favorites');
        const favs = await response.json();
        localStorage.setItem('l2c_favorites', JSON.stringify(favs));
        return favs;
    },

    getFavorites: () => JSON.parse(localStorage.getItem('l2c_favorites') || '[]'),

    toggleFavorite: async (restaurantId) => {
        const token = localStorage.getItem('l2c_token');
        const response = await fetch(`${L2C.API_URL}/api/user/favorites`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ restaurantId })
        });
        if (!response.ok) throw new Error('Failed to toggle favorite');
        const favs = await response.json();
        localStorage.setItem('l2c_favorites', JSON.stringify(favs));
        return favs;
    },

    // --- Notifications ---
    showToast: (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `l2c-global-toast ${type}`;
        toast.style.cssText = `
            position: fixed;
            bottom: 32px;
            right: 32px;
            background: ${type === 'success' ? '#1ba672' : '#293142'};
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: 'Lexend', sans-serif;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideUp 0.3s ease-out;
        `;

        const icon = type === 'success' ? '✅' : '🔔';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    initNotificationListener: () => {
        window.addEventListener('storage', (e) => {
            if (e.key === 'l2c_last_order') {
                const order = JSON.parse(e.newValue);
                if (order && order.status) {
                    L2C.showToast(`Order #${order.orderId} status: ${order.status}`);
                }
            }
        });
    },

    // --- Navbar Management ---
    updateNavbar: () => {
        const user = L2C.getLoggedInUser();
        const navRight = document.querySelector('.nav-right, .navbar-actions');
        if (!navRight) return;

        if (user) {
            navRight.innerHTML = `
                <div style="display:flex; align-items:center; gap:16px;">
                    <div class="nav-notification" style="cursor:pointer; font-size:20px; position:relative;">
                        🔔
                        <span id="nav-notif-dot" style="display:none; position:absolute; top:-2px; right:-2px; width:8px; height:8px; background:#ef4f5f; border-radius:50%; border:2px solid white;"></span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; background:white; padding:4px 12px; border-radius:99px; border:.8px solid #e6e9ef;">
                        <span style="font-size:12px; font-weight:600;">Hi, ${user.firstName}</span>
                        <button onclick="L2C.logout()" style="background:none; border:none; padding:0; cursor:pointer; font-size:12px; color:#ef4f5f; font-weight:700;">Logout</button>
                    </div>
                </div>
            `;
        }
    }
};

// Global styles for Toasts
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes slideDown { from { transform: translateY(0); opacity: 1; } to { transform: translateY(100px); opacity: 0; } }
`;
document.head.appendChild(style);

// Auto-init for all pages
document.addEventListener('DOMContentLoaded', async () => {
    await L2C.fetchRestaurants();
    if (L2C.getLoggedInUser()) {
        await L2C.fetchFavorites();
    }
    L2C.updateNavbar();
    L2C.initNotificationListener();

    // Dispatch event so pages know restaurants are ready
    window.dispatchEvent(new CustomEvent('l2c_ready'));
});
