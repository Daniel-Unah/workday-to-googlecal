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
    // Serve minified version in production if available
    if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'public', 'index.min.html'))) {
        res.sendFile(path.join(__dirname, 'public', 'index.min.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
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
        }
        
        res.json({ success: true, message: 'Disconnected successfully' });
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
        
        console.log('Generating auth URL for user:', req.session.userId);
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        const authUrl = calendarManager.getAuthUrl();
        console.log('Generated auth URL:', authUrl);
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
        const { code } = req.query;
        
        console.log('OAuth callback received for session:', req.session.userId);
        
        if (!code) {
            console.log('No authorization code provided');
            return res.status(400).send('Authorization code not provided');
        }

        if (!req.session.userId) {
            console.log('No user ID in session during callback');
            return res.status(400).send('Session expired. Please try again.');
        }

        console.log('Getting tokens for user:', req.session.userId);
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        
        try {
            const tokens = await calendarManager.getTokens(code);
            console.log('Tokens saved successfully for user:', req.session.userId);
            
            // Store tokens in session for production
            if (process.env.NODE_ENV === 'production') {
                req.session.googleTokens = tokens;
                req.session.save();
            }
        } catch (tokenError) {
            console.error('Error in getTokens:', tokenError);
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
        console.log('Checking authentication status for session:', req.session.userId);
        
        if (!req.session.userId) {
            console.log('No user ID in session');
            return res.json({ authenticated: false });
        }
        
        const calendarManager = new GoogleCalendarManager(req.session.userId);
        // Pass session tokens for production
        if (process.env.NODE_ENV === 'production' && req.session.googleTokens) {
            calendarManager.sessionTokens = req.session.googleTokens;
        }
        const isAuthenticated = await calendarManager.isAuthenticated();
        
        console.log('Authentication result:', isAuthenticated);
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
        
        const { courses, calendarId = 'primary' } = req.body;
        
        if (!courses || !Array.isArray(courses)) {
            return res.status(400).json({ error: 'Courses data is required' });
        }

        const calendarManager = new GoogleCalendarManager(req.session.userId);
        const result = await calendarManager.createEvents(courses, calendarId);
        
        res.json({
            success: true,
            eventsCreated: result.events.length,
            errors: result.errors
        });
    } catch (error) {
        console.error('Error creating events:', error);
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

// Check if minified version exists in production
if (process.env.NODE_ENV === 'production') {
    if (fs.existsSync(path.join(__dirname, 'public', 'index.min.html'))) {
        console.log('✅ Minified version found - serving optimized files');
    } else {
        console.log('⚠️  Minified version not found - serving original files');
        console.log('   This is normal if minification failed during build');
    }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`📤 Upload directory: ${path.join(__dirname, 'uploads')}`);
    console.log(`📥 Download directory: ${path.join(__dirname, 'downloads')}`);
});

module.exports = app;