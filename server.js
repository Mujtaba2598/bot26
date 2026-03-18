const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Aggressive Trading Bot Running on Render' });
});

// IP DETECTION ENDPOINT - Add this to find your Render IP
app.get('/api/my-ip', async (req, res) => {
    try {
        const response = await axios.get('https://api.ipify.org');
        const ip = response.data;
        res.json({ 
            success: true, 
            ip: ip,
            message: 'Add this single IP to Binance whitelist: ' + ip,
            instructions: 'Go to Binance API Management → Edit API Key → Add this IP under "Restrict access to trusted IPs only"'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Database
const database = {
    sessions: {},
    activeTrades: {}
};

// Win streak tracker
const winStreaks = {};

// AGGRESSIVE AI Trading Engine
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData, sessionId) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        // AGGRESSIVE confidence scoring
        let confidence = 0.7; // Start higher
        
        if (volumeRatio > 1.3) confidence += 0.15;
        if (volumeRatio > 1.8) confidence += 0.2;
        if (priceChange24h > 3) confidence += 0.2;
        if (priceChange24h > 7) confidence += 0.25;
        if (pricePosition < 0.35) confidence += 0.15;
        if (pricePosition > 0.65) confidence += 0.15;
        
        // Boost confidence on win streak
        const currentStreak = winStreaks[sessionId] || 0;
        if (currentStreak > 0) {
            confidence += (currentStreak * 0.05);
        }
        
        confidence = Math.min(confidence, 0.98);
        
        // More aggressive action selection
        const action = (pricePosition < 0.35 && priceChange24h > -3 && volumeRatio > 1.1) ? 'BUY' :
                      (pricePosition > 0.65 && priceChange24h > 3 && volumeRatio > 1.1) ? 'SELL' : 
                      (Math.random() > 0.2 ? 'BUY' : 'SELL'); // 80% BUY bias
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence, sessionId) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        
        // Base size starts higher - 25% of investment
        let baseSize = Math.max(10, initialInvestment * 0.25);
        
        // Time pressure - more aggressive as time runs out
        const timePressure = 1.5 / timeRemaining;
        
        // Target pressure
        const targetPressure = remainingProfit / (initialInvestment * 3);
        
        // WIN STREAK BONUS - increases size after wins
        const currentStreak = winStreaks[sessionId] || 0;
        const winBonus = 1 + (currentStreak * 0.3); // 30% increase per consecutive win
        
        // Calculate position size
        let positionSize = baseSize * timePressure * targetPressure * confidence * winBonus;
        
        // Max position can go up to 400% of initial investment when on fire
        const maxPosition = initialInvestment * 4;
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 10); // Min $10
        
        return positionSize;
    }
}

// REAL Binance API - No mock data
class BinanceAPI {
    static baseUrl = 'https://api.binance.com';
    
    static async signRequest(queryString, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');
    }

    static async makeRequest(endpoint, method, apiKey, secret, params = {}) {
        try {
            const timestamp = Date.now();
            const queryParams = { ...params, timestamp };
            const queryString = Object.keys(queryParams)
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            
            const signature = await this.signRequest(queryString, secret);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios({
                method,
                url,
                headers: { 'X-MBX-APIKEY': apiKey },
                timeout: 10000
            });
            
            return response.data;
        } catch (error) {
            console.error('Binance API Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.msg || error.message);
        }
    }

    static async getAccountBalance(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            const usdtBalance = data.balances.find(b => b.asset === 'USDT');
            return {
                success: true,
                free: parseFloat(usdtBalance?.free || 0),
                locked: parseFloat(usdtBalance?.locked || 0),
                total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getTicker(symbol) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`, { timeout: 5000 });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async placeMarketOrder(apiKey, secret, symbol, side, quoteOrderQty) {
        try {
            const orderData = await this.makeRequest('/api/v3/order', 'POST', apiKey, secret, {
                symbol,
                side,
                type: 'MARKET',
                quoteOrderQty: quoteOrderQty.toFixed(2)
            });
            
            // Calculate actual executed price from fills
            let avgPrice = 0;
            let totalQty = 0;
            if (orderData.fills && orderData.fills.length > 0) {
                let totalValue = 0;
                orderData.fills.forEach(fill => {
                    totalValue += parseFloat(fill.price) * parseFloat(fill.qty);
                    totalQty += parseFloat(fill.qty);
                });
                avgPrice = totalValue / totalQty;
            }
            
            return {
                success: true,
                orderId: orderData.orderId,
                executedQty: parseFloat(orderData.executedQty),
                price: avgPrice || parseFloat(orderData.fills?.[0]?.price || 0),
                data: orderData
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async verifyApiKey(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            return {
                success: true,
                permissions: data.permissions,
                canTrade: data.canTrade,
                canWithdraw: data.canWithdraw,
                canDeposit: data.canDeposit
            };
        } catch (error) {
            // Check if it's a location error
            if (error.message.includes('restricted location')) {
                return {
                    success: false,
                    error: 'location_restricted',
                    message: 'Binance is restricted in your server region. Please use Testnet mode or add your server IP to whitelist.'
                };
            }
            return { success: false, error: error.message };
        }
    }
}

// Initialize AI
const aiEngine = new AITradingEngine();

// API Routes
app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey } = req.body;
    
    if (!apiKey || !secretKey) {
        return res.status(400).json({
            success: false,
            message: 'API key and secret are required'
        });
    }
    
    try {
        // Verify API key works with real Binance
        const verification = await BinanceAPI.verifyApiKey(apiKey, secretKey);
        
        if (!verification.success) {
            if (verification.error === 'location_restricted') {
                return res.status(401).json({
                    success: false,
                    message: 'Binance is restricted in your server region. Please use Testnet mode or visit /api/my-ip to get your server IP and whitelist it in Binance.'
                });
            }
            return res.status(401).json({
                success: false,
                message: `API verification failed: ${verification.error}`
            });
        }
        
        if (!verification.canTrade) {
            return res.status(403).json({
                success: false,
                message: 'API key does not have trading permission enabled. Please enable "Spot & Margin Trading" in Binance API settings.'
            });
        }
        
        // Get REAL balance
        const balance = await BinanceAPI.getAccountBalance(apiKey, secretKey);
        
        if (!balance.success) {
            return res.status(400).json({
                success: false,
                message: 'Could not fetch balance: ' + balance.error
            });
        }
        
        const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        
        database.sessions[sessionId] = {
            id: sessionId,
            email,
            accountNumber,
            apiKey,
            secretKey,
            connectedAt: new Date(),
            isActive: true,
            balance: balance.total
        };
        
        // Initialize win streak for this session
        winStreaks[sessionId] = 0;
        
        res.json({ 
            success: true, 
            sessionId,
            balance: balance.total,
            accountInfo: { 
                balance: balance.total,
                canTrade: verification.canTrade
            },
            message: `✅ Connected to REAL Binance! Balance: $${balance.total.toFixed(2)} USDT`
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Connection failed: ' + error.message
        });
    }
});

app.post('/api/startTrading', async (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingPairs } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({
            success: false,
            message: 'Invalid session'
        });
    }
    
    // Verify REAL balance
    const balanceCheck = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    if (!balanceCheck.success || balanceCheck.free < initialInvestment) {
        return res.status(400).json({
            success: false,
            message: `Insufficient balance. You have $${balanceCheck.free?.toFixed(2) || 0} USDT, need $${initialInvestment}`
        });
    }
    
    const botId = 'bot_' + Date.now();
    database.activeTrades[botId] = {
        id: botId,
        sessionId,
        initialInvestment: parseFloat(initialInvestment) || 10,
        targetProfit: parseFloat(targetProfit) || 100,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'aggressive',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date(),
        isRunning: true,
        currentProfit: 0,
        trades: [],
        lastTradeTime: Date.now()
    };
    
    session.activeBot = botId;
    winStreaks[sessionId] = 0; // Reset win streak
    
    res.json({ 
        success: true, 
        botId, 
        message: `🔥 AGGRESSIVE TRADING ACTIVE! Target: $${parseFloat(targetProfit).toLocaleString()}`,
        balance: balanceCheck.free
    });
});

app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (session?.activeBot) {
        database.activeTrades[session.activeBot].isRunning = false;
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

app.post('/api/tradingUpdate', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session?.activeBot) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    const trade = database.activeTrades[session.activeBot];
    if (!trade || !trade.isRunning) {
        return res.json({ success: true, currentProfit: trade?.currentProfit || 0, newTrades: [] });
    }
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - trade.startedAt) / (1000 * 60 * 60); // hours
    const timeRemaining = Math.max(0, trade.timeLimit - timeElapsed);
    const timeLeftMinutes = timeRemaining * 60;
    
    // AGGRESSIVE TRADING: Trade every 15 seconds if time is running out
    const timeSinceLastTrade = (now - (trade.lastTradeTime || 0)) / 1000; // seconds
    const shouldTrade = timeSinceLastTrade > 15 || timeLeftMinutes < 30; // Trade more often when time is low
    
    if (timeRemaining > 0 && shouldTrade) {
        const symbol = trade.tradingPairs[Math.floor(Math.random() * trade.tradingPairs.length)] || 'BTCUSDT';
        
        // Get REAL market data
        const tickerData = await BinanceAPI.getTicker(symbol);
        
        if (tickerData.success) {
            const marketPrice = parseFloat(tickerData.data.lastPrice);
            const marketData = {
                price: marketPrice,
                volume24h: parseFloat(tickerData.data.volume),
                priceChange24h: parseFloat(tickerData.data.priceChangePercent),
                high24h: parseFloat(tickerData.data.highPrice),
                low24h: parseFloat(tickerData.data.lowPrice)
            };
            
            // Get AI signal with win streak
            const signal = aiEngine.analyzeMarket(symbol, marketData, sessionId);
            
            if (signal.action !== 'HOLD') {
                // Calculate position size with win streak bonus
                const positionSize = aiEngine.calculatePositionSize(
                    trade.initialInvestment,
                    trade.currentProfit,
                    trade.targetProfit,
                    timeElapsed,
                    trade.timeLimit,
                    signal.confidence,
                    sessionId
                );
                
                // Place REAL market order
                const orderResult = await BinanceAPI.placeMarketOrder(
                    session.apiKey,
                    session.secretKey,
                    symbol,
                    signal.action,
                    positionSize
                );
                
                if (orderResult.success) {
                    // Get current price to calculate P&L
                    const currentTicker = await BinanceAPI.getTicker(symbol);
                    const currentPrice = currentTicker.success ? parseFloat(currentTicker.data.lastPrice) : marketPrice;
                    const entryPrice = orderResult.price || marketPrice;
                    
                    // Calculate actual profit
                    let profit = 0;
                    if (signal.action === 'BUY') {
                        profit = (currentPrice - entryPrice) * orderResult.executedQty;
                    } else {
                        profit = (entryPrice - currentPrice) * orderResult.executedQty;
                    }
                    
                    // Update win streak
                    if (profit > 0) {
                        winStreaks[sessionId] = (winStreaks[sessionId] || 0) + 1;
                    } else {
                        winStreaks[sessionId] = 0; // Reset on loss
                    }
                    
                    trade.currentProfit += profit;
                    trade.lastTradeTime = now;
                    
                    newTrades.push({
                        symbol: symbol,
                        side: signal.action,
                        quantity: orderResult.executedQty.toFixed(6),
                        price: entryPrice.toFixed(2),
                        currentPrice: currentPrice.toFixed(2),
                        profit: profit,
                        size: '$' + positionSize.toFixed(2),
                        confidence: (signal.confidence * 100).toFixed(0) + '%',
                        winStreak: winStreaks[sessionId],
                        orderId: orderResult.orderId,
                        timestamp: new Date().toISOString(),
                        real: true
                    });
                    
                    trade.trades.unshift(...newTrades);
                    
                    // Check if target reached
                    if (trade.currentProfit >= trade.targetProfit) {
                        trade.targetReached = true;
                        trade.isRunning = false;
                    }
                    
                    console.log(`💰 REAL TRADE: ${signal.action} $${positionSize.toFixed(2)} ${symbol} - Profit: $${profit.toFixed(2)} (Win streak: ${winStreaks[sessionId]})`);
                } else {
                    console.error('Order failed:', orderResult.error);
                }
            }
        }
    }
    
    // Check time limit
    if (timeElapsed >= trade.timeLimit) {
        trade.timeExceeded = true;
        trade.isRunning = false;
    }
    
    // Keep only last 50 trades
    if (trade.trades.length > 50) {
        trade.trades = trade.trades.slice(0, 50);
    }
    
    // Get updated balance
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({ 
        success: true, 
        currentProfit: trade.currentProfit || 0,
        timeElapsed: timeElapsed.toFixed(2),
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: trade.targetReached || false,
        timeExceeded: trade.timeExceeded || false,
        newTrades: newTrades,
        balance: balance.success ? balance.free : 0,
        winStreak: winStreaks[sessionId] || 0
    });
});

app.post('/api/balance', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({
        success: balance.success,
        balance: balance.success ? balance.free : 0,
        error: balance.error
    });
});

// Serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🌙 HALAL AI TRADING BOT - AGGRESSIVE MODE');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ IP Detection: Visit /api/my-ip to get your Render IP`);
    console.log(`✅ REAL MONEY TRADING - NO SIMULATION`);
    console.log(`✅ Win streak bonus: +30% size per win`);
    console.log(`✅ Aggressive speed: Trades every 15 seconds`);
    console.log('='.repeat(50) + '\n');
});
