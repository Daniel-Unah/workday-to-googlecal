const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const session = require('express-session');
require('dotenv').config();

const GoogleCalendarManager = require('./scripts/google-calendar');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'workday-to-googlecal-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure directories exist
fs.ensureDirSync('uploads');
fs.ensureDirSync('downloads');

// Routes

/**
 * Serve the main application
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Disconnect from Google Calendar
 */
app.post('/api/auth/google/disconnect', (req, res) => {
    try {
        // Clear the stored tokens for this user
        if (req.session && req.session.userId) {
            const tokensPath = path.join(__dirname, 'tokens', `${req.session.userId}.json`);
            if (fs.existsSync(tokensPath)) {
                fs.unlinkSync(tokensPath);
            }
            
            // Clear session tokens (for production)
            delete req.session.googleTokens;
            
            // Save session to ensure changes persist
            req.session.save((err) => {
                if (err) {
                    console.error('Error saving session:', err);
                    return res.status(500).json({ error: 'Failed to clear session' });
                }
                res.json({ success: true, message: 'Disconnected successfully' });
            });
        } else {
            res.json({ success: true, message: 'Disconnected successfully' });
        }
    } catch (error) {
        console.error('Disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect from Google Calendar' });
    }
});

/**
 * Get Google Calendar authentication URL
 */
app.get('/api/auth/google/url', (req, res) => {
    try {
        // Generate a unique user ID for this session
        if (!req.session.userId) {
            req.session.userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            req.session.save();
        }
        
        // Generate a CSRF state token and store it in the session
        const state = require('crypto').randomBytes(32).toString('hex');
        req.session.oauthState = state;
        req.session.save();
        
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        const authUrl = calendarManager.getAuthUrl(state);
        res.json({ authUrl });
    } catch (error) {
        console.error('Error generating auth URL:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Handle Google OAuth callback
 */
app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        
        if (!code) {
            return res.status(400).send('Authorization code not provided');
        }
        
        // Verify the state parameter to prevent CSRF attacks
        if (!state || state !== req.session.oauthState) {
            console.error('State mismatch! Possible CSRF attack. Expected:', req.session.oauthState, 'Got:', state);
            return res.status(403).send('State validation failed. Possible CSRF attack detected.');
        }
        
        // Clear the used state
        delete req.session.oauthState;

        if (!req.session.userId) {
            return res.status(400).send('Session expired. Please try again.');
        }

        const calendarManager = new GoogleCalendarManager(req.session.userId);
        
        try {
            const tokens = await calendarManager.getTokens(code);
            // Store tokens in session for production
            if (process.env.NODE_ENV === 'production') {
                req.session.googleTokens = tokens;
                req.session.save();
            }
        } catch (tokenError) {
            throw tokenError;
        }
        
        res.send(`
            <html>
                <body>
                    <h2>✅ Successfully authenticated with Google Calendar!</h2>
                    <p>You can now close this window and return to the main application.</p>
                    <script>
                        setTimeout(() => {
                            window.close();
                        }, 3000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send(`
            <html>
                <body>
                    <h2>❌ Authentication failed</h2>
                    <p>Error: ${error.message}</p>
                    <p>Please try again.</p>
                </body>
            </html>
        `);
    }
});

/**
 * Check Google Calendar authentication status
 */
app.get('/api/auth/google/status', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({ authenticated: false });
        }
        
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        // Pass session tokens for production
        if (process.env.NODE_ENV === 'production' && req.session.googleTokens) {
            calendarManager.sessionTokens = req.session.googleTokens;
        }
        const isAuthenticated = await calendarManager.isAuthenticated();
        
        res.json({ authenticated: isAuthenticated });
    } catch (error) {
        console.error('Error checking authentication status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get user's Google Calendars
 */
app.get('/api/calendars', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        // Pass session tokens for production
        if (process.env.NODE_ENV === 'production' && req.session.googleTokens) {
            calendarManager.sessionTokens = req.session.googleTokens;
        }
        const calendars = await calendarManager.getCalendars();
        res.json({ calendars });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Create events in Google Calendar
 */
app.post('/api/calendar/events', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const { courses, calendarId = 'primary', batchId } = req.body;
        
        if (!courses || !Array.isArray(courses)) {
            return res.status(400).json({ error: 'Courses data is required' });
        }

        const calendarManager = new GoogleCalendarManager(req.session.userId);
        // Pass session tokens for production
        if (process.env.NODE_ENV === 'production' && req.session.googleTokens) {
            calendarManager.sessionTokens = req.session.googleTokens;
        }
        const result = await calendarManager.createEvents(courses, calendarId, batchId);
        
        console.log(`Events created: ${result.events.length}, Errors: ${result.errors.length}`);
        if (result.errors.length > 0) {
            console.error('Event creation errors:', result.errors);
        }
        
        res.json({
            success: true,
            eventsCreated: result.events.length,
            eventIds: result.eventIds,
            batchId: result.batchId,
            errors: result.errors
        });
    } catch (error) {
        console.error('Error creating events:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete events by batch ID
 */
app.post('/api/calendar/events/delete', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const { batchId, calendarId = 'primary' } = req.body;
        
        if (!batchId) {
            return res.status(400).json({ error: 'Batch ID is required' });
        }

        const calendarManager = new GoogleCalendarManager(req.session.userId);
        // Pass session tokens for production
        if (process.env.NODE_ENV === 'production' && req.session.googleTokens) {
            calendarManager.sessionTokens = req.session.googleTokens;
        }
        const result = await calendarManager.deleteEventsByBatch(batchId, calendarId);
        
        res.json({
            success: true,
            deletedCount: result.deletedCount,
            totalFound: result.totalFound,
            errors: result.errors
        });
    } catch (error) {
        console.error('Error deleting events:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Handle file upload
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        res.json({ 
            success: true, 
            filename: req.file.filename,
            originalName: req.file.originalname 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Download generated file
 */
app.get('/api/download/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'downloads', filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.download(filePath, (err) => {
            if (err) {
                console.error('Download error:', err);
                res.status(500).json({ error: 'Download failed' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server with better error handling
console.log('🔧 Starting server...');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Port:', PORT);

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`📤 Upload directory: ${path.join(__dirname, 'uploads')}`);
    console.log(`📥 Download directory: ${path.join(__dirname, 'downloads')}`);
    console.log('✅ Server started successfully');
});

server.on('error', (error) => {
    console.error('❌ Server failed to start:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});

module.exports = app;