
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

const GoogleCalendarManager = require('./scripts/google-calendar');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
 * Get Google Calendar authentication URL
 */
app.get('/api/auth/google/url', (req, res) => {
    try {
        const calendarManager = new GoogleCalendarManager();
        const authUrl = calendarManager.getAuthUrl();
        res.json({ authUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Handle Google OAuth callback
 */
app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.status(400).send('Authorization code not provided');
        }

        const calendarManager = new GoogleCalendarManager();
        await calendarManager.getTokens(code);
        
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
        const calendarManager = new GoogleCalendarManager();
        const isAuthenticated = await calendarManager.isAuthenticated();
        res.json({ authenticated: isAuthenticated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get user's Google Calendars
 */
app.get('/api/calendars', async (req, res) => {
    try {
        const calendarManager = new GoogleCalendarManager();
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
        const { courses, calendarId } = req.body;
        
        // console.log('Received courses data:', JSON.stringify(courses, null, 2));
        
        if (!courses || !Array.isArray(courses)) {
            return res.status(400).json({ error: 'Courses data is required' });
        }

        const calendarManager = new GoogleCalendarManager();
        const result = await calendarManager.createEvents(courses, calendarId);
        
        // console.log('Sending response:', {
        //     success: true,
        //     eventsCreated: result.events.length,
        //     errors: result.errors
        // });
        
        res.json({
            success: true,
            eventsCreated: result.events.length,
            errors: result.errors
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/**
 * Upload and process Excel file
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Read the uploaded file
        const filePath = req.file.path;
        const fileBuffer = await fs.readFile(filePath);
        
        // Clean up uploaded file
        await fs.remove(filePath);

        // Process the file (this would use the existing parsing logic)
        // For now, return success - the frontend will handle the parsing
        res.json({
            success: true,
            message: 'File uploaded successfully',
            fileName: req.file.originalname
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
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📅 Workday to Google Calendar Converter`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;



