// ============================================
// SAVEHYDROO - Predictions API
// Vercel Serverless Function
// ============================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

// Simple Linear Regression
class LinearRegression {
    constructor() {
        this.slope = 0;
        this.intercept = 0;
    }

    fit(x, y) {
        if (x.length !== y.length || x.length < 2) return false;

        const n = x.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumXY += x[i] * y[i];
            sumXX += x[i] * x[i];
        }

        const denom = n * sumXX - sumX * sumX;
        if (denom === 0) {
            this.slope = 0;
            this.intercept = sumY / n;
        } else {
            this.slope = (n * sumXY - sumX * sumY) / denom;
            this.intercept = (sumY - this.slope * sumX) / n;
        }
        return true;
    }

    predict(x) {
        return this.slope * x + this.intercept;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const path = req.url.split('?')[0];

        if (path.endsWith('/calculate')) {
            return await calculatePrediction(req, res);
        }

        switch (req.method) {
            case 'GET':
                return await getPredictions(req, res);
            case 'POST':
                return await savePrediction(req, res);
            default:
                return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

async function getPredictions(req, res) {
    const { userId, limit = 50 } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, predictions: data });
}

async function savePrediction(req, res) {
    const { userId, prediction } = req.body;

    if (!userId || !prediction) {
        return res.status(400).json({ error: 'userId and prediction are required' });
    }

    const { data, error } = await supabase
        .from('predictions')
        .insert({
            user_id: userId,
            predicted_tds: prediction.predictedTDS,
            time_to_target: prediction.timeToTarget,
            time_to_fill: prediction.timeToFill,
            confidence: prediction.confidence,
            blend_ratio_ro: prediction.blendRatio?.ro,
            blend_ratio_rain: prediction.blendRatio?.rain
        });

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({ success: true, message: 'Prediction saved' });
}

async function calculatePrediction(req, res) {
    const { userId, readings, blendRatio } = req.body;

    if (!userId || !readings) {
        return res.status(400).json({ error: 'userId and readings are required' });
    }

    const targetTDS = { min: 150, max: 300 };
    const optimalTDS = 225;

    // Get historical readings for trend analysis
    const { data: history } = await supabase
        .from('sensor_readings')
        .select('*')
        .eq('user_id', userId)
        .eq('tank_type', 'blended')
        .order('timestamp', { ascending: true })
        .limit(50);

    // Calculate TDS trend
    let tdsTrend = 'stable';
    let tdsChangeRate = 0;
    let futureTDS = readings.blended?.tds || 0;
    let confidence = 0.5;

    if (history && history.length >= 5) {
        const lr = new LinearRegression();
        const startTime = new Date(history[0].timestamp).getTime();
        const x = history.map(h => (new Date(h.timestamp).getTime() - startTime) / 1000);
        const y = history.map(h => parseFloat(h.tds));

        if (lr.fit(x, y)) {
            tdsChangeRate = lr.slope;
            const futureTime = x[x.length - 1] + 60; // 60 seconds ahead
            futureTDS = lr.predict(futureTime);

            if (tdsChangeRate > 0.5) tdsTrend = 'increasing';
            else if (tdsChangeRate < -0.5) tdsTrend = 'decreasing';

            confidence = Math.min(0.95, 0.5 + history.length * 0.01);
        }
    }

    // Calculate optimal blend ratio
    const roTDS = readings.ro_reject?.tds || 1200;
    const rainTDS = readings.rainwater?.tds || 50;
    const currentTDS = readings.blended?.tds || 0;

    const denom = roTDS - rainTDS;
    let optimalRoRatio = denom !== 0 ? (optimalTDS - rainTDS) / denom : 0.3;
    optimalRoRatio = Math.max(0, Math.min(1, optimalRoRatio));

    // Calculate time to target
    let timeToTarget = null;
    if (tdsChangeRate !== 0) {
        const tdsDiff = optimalTDS - currentTDS;
        const movingToward = (tdsDiff > 0 && tdsChangeRate > 0) || (tdsDiff < 0 && tdsChangeRate < 0);
        if (movingToward) {
            timeToTarget = Math.round(Math.abs(tdsDiff / tdsChangeRate));
        }
    }

    // Calculate time to fill
    const currentLevel = readings.blended?.level || 50;
    const flowRate = readings.blended?.flowRate || 0;
    let timeToFill = null;
    if (flowRate > 0) {
        const litersNeeded = (100 - currentLevel) / 100 * 750;
        timeToFill = Math.round(litersNeeded / flowRate * 60);
    }

    const prediction = {
        timestamp: new Date().toISOString(),
        predictedTDS: Math.round(futureTDS * 10) / 10,
        tdsTrend,
        tdsChangeRate: Math.round(tdsChangeRate * 100) / 100,
        timeToTarget,
        timeToFill,
        confidence,
        optimalBlendRatio: {
            ro: Math.round(optimalRoRatio * 100) / 100,
            rain: Math.round((1 - optimalRoRatio) * 100) / 100
        },
        currentState: {
            isOptimal: currentTDS >= targetTDS.min && currentTDS <= targetTDS.max,
            currentTDS,
            targetRange: targetTDS
        }
    };

    // Save prediction to database
    await supabase.from('predictions').insert({
        user_id: userId,
        predicted_tds: prediction.predictedTDS,
        time_to_target: timeToTarget,
        time_to_fill: timeToFill,
        confidence,
        blend_ratio_ro: optimalRoRatio,
        blend_ratio_rain: 1 - optimalRoRatio
    });

    return res.status(200).json({ success: true, prediction });
}
