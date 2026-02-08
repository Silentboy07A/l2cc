// ============================================
// SAVEHYDROO - ML Prediction Engine
// Lightweight prediction for TDS and tank timing
// ============================================

/**
 * Simple Linear Regression for time-series prediction
 */
class LinearRegression {
    constructor() {
        this.slope = 0;
        this.intercept = 0;
        this.trained = false;
    }

    fit(x, y) {
        if (x.length !== y.length || x.length < 2) {
            return false;
        }

        const n = x.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumXY += x[i] * y[i];
            sumXX += x[i] * x[i];
        }

        const denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) {
            this.slope = 0;
            this.intercept = sumY / n;
        } else {
            this.slope = (n * sumXY - sumX * sumY) / denominator;
            this.intercept = (sumY - this.slope * sumX) / n;
        }

        this.trained = true;
        return true;
    }

    predict(x) {
        return this.slope * x + this.intercept;
    }

    getSlope() {
        return this.slope;
    }
}

/**
 * Exponential Moving Average for smoothing
 */
class EMA {
    constructor(alpha = 0.3) {
        this.alpha = alpha;
        this.value = null;
    }

    update(newValue) {
        if (this.value === null) {
            this.value = newValue;
        } else {
            this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
        }
        return this.value;
    }

    get() {
        return this.value;
    }
}

/**
 * Main ML Predictor for Water System
 */
class WaterPredictor {
    constructor(options = {}) {
        this.historySize = options.historySize || 50;
        this.targetTDS = options.targetTDS || { min: 150, max: 300 };
        this.optimalTDS = (this.targetTDS.min + this.targetTDS.max) / 2; // 225

        // History buffers for each tank
        this.history = {
            ro_reject: [],
            rainwater: [],
            blended: []
        };

        // Regression models
        this.tdsModel = new LinearRegression();
        this.levelModel = new LinearRegression();

        // EMAs for smoothing
        this.tdsEMA = new EMA(0.2);
        this.levelEMA = new EMA(0.3);
    }

    /**
     * Add a reading to history
     */
    addReading(tankType, reading) {
        const timestamp = Date.now();

        this.history[tankType].push({
            timestamp,
            tds: reading.tds,
            temperature: reading.temperature,
            level: reading.level,
            flowRate: reading.flowRate
        });

        // Keep history bounded
        if (this.history[tankType].length > this.historySize) {
            this.history[tankType].shift();
        }
    }

    /**
     * Predict TDS after blending
     */
    predictBlendedTDS(roTDS, rainTDS, blendRatio) {
        const { ro, rain } = blendRatio;

        // Basic mixing formula
        const predictedTDS = roTDS * ro + rainTDS * rain;

        // Apply smoothing
        const smoothedTDS = this.tdsEMA.update(predictedTDS);

        return {
            predicted: Math.round(predictedTDS * 10) / 10,
            smoothed: Math.round(smoothedTDS * 10) / 10,
            confidence: this.calculateConfidence('tds')
        };
    }

    /**
     * Predict future TDS based on trend
     */
    predictFutureTDS(tankType, stepsAhead = 10) {
        const history = this.history[tankType];

        if (history.length < 5) {
            return {
                predicted: null,
                trend: 'insufficient_data',
                confidence: 0
            };
        }

        // Extract time and TDS for regression
        const startTime = history[0].timestamp;
        const x = history.map(h => (h.timestamp - startTime) / 1000); // seconds
        const y = history.map(h => h.tds);

        // Fit model
        this.tdsModel.fit(x, y);

        // Predict future
        const lastTime = x[x.length - 1];
        const futureTime = lastTime + stepsAhead * 2; // 2 seconds per step
        const predictedTDS = this.tdsModel.predict(futureTime);

        // Determine trend
        const slope = this.tdsModel.getSlope();
        let trend = 'stable';
        if (slope > 0.5) trend = 'increasing';
        else if (slope < -0.5) trend = 'decreasing';

        return {
            predicted: Math.round(predictedTDS * 10) / 10,
            trend,
            slope: Math.round(slope * 100) / 100,
            confidence: this.calculateConfidence('tds')
        };
    }

    /**
     * Calculate time to reach target TDS
     */
    timeToTargetTDS(currentTDS, targetTDS, tdsChangeRate) {
        if (tdsChangeRate === 0) {
            return Infinity;
        }

        const tdsDifference = targetTDS - currentTDS;

        // If already at target
        if (Math.abs(tdsDifference) < 5) {
            return 0;
        }

        // If moving in wrong direction
        if ((tdsDifference > 0 && tdsChangeRate < 0) ||
            (tdsDifference < 0 && tdsChangeRate > 0)) {
            return Infinity;
        }

        // Time in seconds
        const timeSeconds = Math.abs(tdsDifference / tdsChangeRate);

        return {
            seconds: Math.round(timeSeconds),
            minutes: Math.round(timeSeconds / 60 * 10) / 10,
            formatted: this.formatTime(timeSeconds)
        };
    }

    /**
     * Calculate time to fill/empty tank
     */
    timeToFillOrEmpty(currentLevel, targetLevel, flowRate) {
        if (flowRate === 0) {
            return {
                seconds: Infinity,
                formatted: 'N/A - No flow'
            };
        }

        // Assuming 750L capacity for blended tank
        const capacity = 750;
        const currentLiters = (currentLevel / 100) * capacity;
        const targetLiters = (targetLevel / 100) * capacity;
        const litersNeeded = Math.abs(targetLiters - currentLiters);

        const timeMinutes = litersNeeded / flowRate;
        const timeSeconds = timeMinutes * 60;

        return {
            seconds: Math.round(timeSeconds),
            minutes: Math.round(timeMinutes * 10) / 10,
            formatted: this.formatTime(timeSeconds),
            litersNeeded: Math.round(litersNeeded * 10) / 10
        };
    }

    /**
     * Get optimal blend ratio for target TDS
     */
    calculateOptimalBlendRatio(roTDS, rainTDS, targetTDS = this.optimalTDS) {
        // Solve: targetTDS = roTDS * ro + rainTDS * rain
        // Constraint: ro + rain = 1
        // Therefore: targetTDS = roTDS * ro + rainTDS * (1 - ro)
        // Solving for ro: ro = (targetTDS - rainTDS) / (roTDS - rainTDS)

        const denominator = roTDS - rainTDS;

        if (denominator === 0) {
            return { ro: 0.5, rain: 0.5, achievable: false };
        }

        let roRatio = (targetTDS - rainTDS) / denominator;

        // Constrain to valid range
        roRatio = Math.max(0, Math.min(1, roRatio));
        const rainRatio = 1 - roRatio;

        // Check if target is achievable
        const achievedTDS = roTDS * roRatio + rainTDS * rainRatio;
        const achievable = Math.abs(achievedTDS - targetTDS) < 10;

        return {
            ro: Math.round(roRatio * 100) / 100,
            rain: Math.round(rainRatio * 100) / 100,
            achievedTDS: Math.round(achievedTDS * 10) / 10,
            achievable,
            recommendation: this.getBlendRecommendation(roRatio)
        };
    }

    /**
     * Get full prediction report
     */
    getPredictionReport(readings, blendRatio) {
        const roReading = readings.ro_reject;
        const rainReading = readings.rainwater;
        const blendReading = readings.blended;

        // Add readings to history
        this.addReading('ro_reject', roReading);
        this.addReading('rainwater', rainReading);
        this.addReading('blended', blendReading);

        // Get future TDS prediction
        const futureTDS = this.predictFutureTDS('blended', 30);

        // Calculate optimal blend
        const optimalBlend = this.calculateOptimalBlendRatio(
            roReading.tds,
            rainReading.tds,
            this.optimalTDS
        );

        // Time to optimal TDS
        const tdsChangeRate = futureTDS.slope || 0;
        const timeToOptimal = this.timeToTargetTDS(
            blendReading.tds,
            this.optimalTDS,
            tdsChangeRate
        );

        // Time to fill blended tank
        const timeToFull = this.timeToFillOrEmpty(
            blendReading.level,
            100,
            blendReading.flowRate
        );

        // Water saving opportunity
        const waterSaving = this.calculateWaterSaving(blendRatio, optimalBlend);

        return {
            timestamp: new Date().toISOString(),
            currentState: {
                blendedTDS: blendReading.tds,
                blendedLevel: blendReading.level,
                flowRate: blendReading.flowRate,
                isOptimal: blendReading.tds >= this.targetTDS.min && blendReading.tds <= this.targetTDS.max
            },
            predictions: {
                futureTDS: futureTDS.predicted,
                tdsTrend: futureTDS.trend,
                confidence: futureTDS.confidence
            },
            timing: {
                timeToOptimalTDS: timeToOptimal,
                timeToTankFull: timeToFull
            },
            recommendations: {
                optimalBlendRatio: optimalBlend,
                currentBlendRatio: blendRatio,
                adjustment: this.getAdjustmentAdvice(blendRatio, optimalBlend)
            },
            waterSaving
        };
    }

    // ============================================
    // HELPER METHODS
    // ============================================

    calculateConfidence(metric) {
        const history = this.history.blended;

        if (history.length < 10) return 0.3;
        if (history.length < 20) return 0.5;
        if (history.length < 30) return 0.7;
        if (history.length < 40) return 0.85;
        return 0.95;
    }

    formatTime(seconds) {
        if (!isFinite(seconds)) return 'N/A';

        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${mins}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.round((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    }

    getBlendRecommendation(roRatio) {
        if (roRatio < 0.2) return 'Use mostly rainwater for lowest TDS';
        if (roRatio < 0.4) return 'Good balance favoring rainwater';
        if (roRatio < 0.6) return 'Balanced mix';
        if (roRatio < 0.8) return 'Consider reducing RO reject usage';
        return 'High RO reject usage - increase rainwater if available';
    }

    getAdjustmentAdvice(current, optimal) {
        const roDiff = optimal.ro - current.ro;

        if (Math.abs(roDiff) < 0.05) {
            return 'Blend ratio is optimal';
        } else if (roDiff > 0) {
            return `Increase RO ratio by ${Math.round(roDiff * 100)}%`;
        } else {
            return `Decrease RO ratio by ${Math.round(Math.abs(roDiff) * 100)}%`;
        }
    }

    calculateWaterSaving(currentRatio, optimalRatio) {
        // More rainwater = more savings
        const currentRainUsage = currentRatio.rain;
        const optimalRainUsage = optimalRatio.rain;

        const potentialSavings = (optimalRainUsage - currentRainUsage) * 100;

        return {
            currentRainwaterPercent: Math.round(currentRainUsage * 100),
            optimalRainwaterPercent: Math.round(optimalRainUsage * 100),
            potentialImprovementPercent: Math.round(potentialSavings),
            isEcoFriendly: currentRainUsage >= 0.6
        };
    }

    /**
     * Reset predictor state
     */
    reset() {
        this.history = {
            ro_reject: [],
            rainwater: [],
            blended: []
        };
        this.tdsModel = new LinearRegression();
        this.levelModel = new LinearRegression();
        this.tdsEMA = new EMA(0.2);
        this.levelEMA = new EMA(0.3);
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WaterPredictor, LinearRegression, EMA };
}

if (typeof window !== 'undefined') {
    window.WaterPredictor = WaterPredictor;
}
