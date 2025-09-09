const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

/**
 * Google Calendar API Integration
 * Handles authentication and event creation
 * Now stores tokens per-user instead of globally
 */
class GoogleCalendarManager {
    constructor(userId = 'default') {
        this.userId = userId;
        this.oauth2Client = null;
        this.calendar = null;
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
        
        // Override for local development if NODE_ENV is not production
        if (process.env.NODE_ENV !== 'production' && process.env.PORT === '3000') {
            this.redirectUri = 'http://localhost:3000/auth/google/callback';
        }
    }

    /**
     * Initialize OAuth2 client
     */
    initOAuth2() {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file');
        }

        this.oauth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    }

    /**
     * Get authorization URL for user to authenticate
     */
    getAuthUrl() {
        this.initOAuth2();
        
        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ];

        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });
        
        console.log(`Generated OAuth URL for user ${this.userId}:`, authUrl);
        return authUrl;
    }

    /**
     * Exchange authorization code for tokens
     */
    async getTokens(code) {
        this.initOAuth2();
        
        try {
            console.log(`Getting tokens for user ${this.userId} with code:`, code.substring(0, 10) + '...');
            const { tokens } = await this.oauth2Client.getToken(code);
            console.log(`Received tokens for user ${this.userId}:`, !!tokens);
            this.oauth2Client.setCredentials(tokens);
            
            // Store tokens per-user instead of globally
            await this.saveTokens(tokens);
            
            return tokens;
        } catch (error) {
            console.error('Error getting tokens:', error);
            throw new Error('Failed to get access tokens: ' + error.message);
        }
    }

    /**
     * Load tokens for this specific user
     */
    async loadTokens() {
        try {
            // For Railway/production, try to get tokens from session first
            if (process.env.NODE_ENV === 'production' && this.sessionTokens) {
                console.log(`Loading tokens from session for user ${this.userId}`);
                this.oauth2Client.setCredentials(this.sessionTokens);
                return true;
            }
            
            // Fallback to file system for local development
            const tokensPath = path.join(__dirname, '../tokens', `${this.userId}.json`);
            console.log(`Loading tokens for user ${this.userId} from: ${tokensPath}`);
            
            if (await fs.pathExists(tokensPath)) {
                const tokens = await fs.readJson(tokensPath);
                console.log(`Tokens found for user ${this.userId}:`, !!tokens);
                this.oauth2Client.setCredentials(tokens);
                return true;
            }
            console.log(`No tokens found for user ${this.userId}`);
            return false;
        } catch (error) {
            console.error('Error loading tokens:', error);
            return false;
        }
    }

    /**
     * Save tokens for this specific user
     */
    async saveTokens(tokens) {
        try {
            const tokensDir = path.join(__dirname, '../tokens');
            await fs.ensureDir(tokensDir);
            
            const tokensPath = path.join(tokensDir, `${this.userId}.json`);
            console.log(`Saving tokens for user ${this.userId} to: ${tokensPath}`);
            await fs.writeJson(tokensPath, tokens);
            console.log(`Tokens saved successfully for user ${this.userId}`);
        } catch (error) {
            console.error('Error saving tokens:', error);
        }
    }

    /**
     * Check if user is authenticated
     */
    async isAuthenticated() {
        try {
            this.initOAuth2();
            const hasTokens = await this.loadTokens();
            return hasTokens;
        } catch (error) {
            console.error('Error checking authentication:', error);
            return false;
        }
    }

    /**
     * Get user's calendars
     */
    async getCalendars() {
        try {
            this.initOAuth2();
            await this.loadTokens();
            
            const response = await this.calendar.calendarList.list();
            return response.data.items || [];
        } catch (error) {
            console.error('Error getting calendars:', error);
            throw new Error('Failed to get calendars');
        }
    }

    /**
     * Create events from courses
     */
    async createEvents(courses, calendarId = 'primary') {
        try {
            this.initOAuth2();
            await this.loadTokens();
            
            const events = [];
            const errors = [];

            for (const course of courses) {
                try {
                    const event = await this.createEventFromCourse(course, calendarId);
                    events.push(event);
                } catch (error) {
                    errors.push(`Course "${course.title}": ${error.message}`);
                }
            }

            return { events, errors };
        } catch (error) {
            console.error('Error creating events:', error);
            throw new Error('Failed to create events');
        }
    }

    /**
     * Create a single event from course data
     */
    async createEventFromCourse(course, calendarId = 'primary') {
        try {
            const event = {
                summary: course.title,
                description: `Instructor: ${course.instructor || 'TBA'}\nLocation: ${course.location || 'TBA'}`,
                location: course.location || 'TBA',
                start: {
                    dateTime: this.parseDateTime(course.startDate, course.time),
                    timeZone: 'America/Chicago'
                },
                end: {
                    dateTime: this.parseDateTime(course.startDate, course.endTime),
                    timeZone: 'America/Chicago'
                },
                recurrence: this.getRecurrenceRule(course.days, course.startDate, course.endDate),
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 10 },
                        { method: 'email', minutes: 30 }
                    ]
                }
            };

            const response = await this.calendar.events.insert({
                calendarId: calendarId,
                resource: event
            });

            return response.data;
        } catch (error) {
            console.error('Error creating event:', error);
            throw error;
        }
    }

    /**
     * Parse date and time into ISO string
     */
    parseDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) {
            throw new Error('Date and time are required');
        }

        const date = new Date(dateStr);
        const [time, period] = timeStr.split(' ');
        const [hours, minutes] = time.split(':');
        
        let hour24 = parseInt(hours);
        if (period === 'PM' && hour24 !== 12) {
            hour24 += 12;
        } else if (period === 'AM' && hour24 === 12) {
            hour24 = 0;
        }

        date.setHours(hour24, parseInt(minutes), 0, 0);
        return date.toISOString();
    }

    /**
     * Get recurrence rule for course days
     */
    getRecurrenceRule(days, startDate, endDate) {
        if (!days || !startDate || !endDate) {
            return null;
        }

        const dayMap = {
            'Monday': 'MO',
            'Tuesday': 'TU', 
            'Wednesday': 'WE',
            'Thursday': 'TH',
            'Friday': 'FR',
            'Saturday': 'SA',
            'Sunday': 'SU'
        };

        const dayList = days.split(',').map(day => dayMap[day.trim()]).filter(Boolean);
        
        if (dayList.length === 0) {
            return null;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        const until = end.toISOString().split('T')[0].replace(/-/g, '');

        return [`RRULE:FREQ=WEEKLY;BYDAY=${dayList.join(',')};UNTIL=${until}`];
    }
}

module.exports = GoogleCalendarManager;
