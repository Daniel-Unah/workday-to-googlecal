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
        
        return authUrl;
    }

    /**
     * Exchange authorization code for tokens
     */
    async getTokens(code) {
        this.initOAuth2();
        
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            
            // Store tokens per-user instead of globally
            await this.saveTokens(tokens);
            
            return tokens;
        } catch (error) {
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
                this.oauth2Client.setCredentials(this.sessionTokens);
                return true;
            }
            
            // Fallback to file system for local development
            const tokensPath = path.join(__dirname, '../tokens', `${this.userId}.json`);
            
            if (await fs.pathExists(tokensPath)) {
                const tokens = await fs.readJson(tokensPath);
                this.oauth2Client.setCredentials(tokens);
                return true;
            }
            return false;
        } catch (error) {
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
            await fs.writeJson(tokensPath, tokens);
        } catch (error) {
            // Silently fail - tokens may be stored in session instead
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
            throw new Error('Failed to get calendars');
        }
    }

    /**
     * Create events from courses
     */
    async createEvents(courses, calendarId = 'primary', batchId = null) {
        try {
            this.initOAuth2();
            const hasTokens = await this.loadTokens();
            
            if (!hasTokens) {
                throw new Error('No authentication tokens found. Please authenticate with Google Calendar first.');
            }
            
            // Generate batch ID if not provided
            if (!batchId) {
                batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
            
            console.log(`Creating ${courses.length} events in calendar: ${calendarId}`);
            console.log('Batch ID:', batchId);
            
            const events = [];
            const errors = [];
            const eventIds = [];

            for (const course of courses) {
                try {
                    const event = await this.createEventFromCourse(course, calendarId, batchId);
                    events.push(event);
                    eventIds.push(event.id);
                } catch (error) {
                    console.error(`Failed to create event for ${course.title}:`, error.message);
                    errors.push(`Course "${course.title}": ${error.message}`);
                }
            }

            console.log(`Successfully created ${events.length} events. ${errors.length} errors.`);
            return { events, errors, eventIds, batchId };
        } catch (error) {
            console.error('Error in createEvents:', error);
            throw new Error('Failed to create events: ' + error.message);
        }
    }

    /**
     * Create a single event from course data
     */
    async createEventFromCourse(course, calendarId = 'primary', batchId = null) {
        try {
            console.log('Creating event for course:', course.title);
            console.log('Course data:', JSON.stringify(course, null, 2));
            
            const startDateTime = this.parseDateTime(course.startDate, course.time);
            const endDateTime = this.parseDateTime(course.startDate, course.endTime);
            
            if (!startDateTime || !endDateTime) {
                throw new Error(`Invalid date/time for course "${course.title}". Start: ${course.startDate} ${course.time}, End: ${course.endDate} ${course.endTime}`);
            }
            
            console.log('Parsed start:', startDateTime);
            console.log('Parsed end:', endDateTime);
            
            const recurrence = this.getRecurrenceRule(course.days, course.startDate, course.endDate);
            
            if (!recurrence) {
                throw new Error(`Invalid recurrence rule for course "${course.title}". Days: ${course.days}`);
            }
            
            console.log('Recurrence rule:', recurrence);
            
            const event = {
                summary: course.title,
                description: `Instructor: ${course.instructor || 'TBA'}\nLocation: ${course.location || 'TBA'}`,
                location: course.location || 'TBA',
                start: {
                    dateTime: startDateTime,
                    timeZone: 'America/Chicago'
                },
                end: {
                    dateTime: endDateTime,
                    timeZone: 'America/Chicago'
                },
                recurrence: recurrence,
                extendedProperties: {
                    private: {
                        appSource: 'workday-to-googlecal',
                        batchId: batchId || 'unknown'
                    }
                },
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 10 },
                        { method: 'email', minutes: 30 }
                    ]
                }
            };

            console.log('Final event object:', JSON.stringify(event, null, 2));

            const response = await this.calendar.events.insert({
                calendarId: calendarId,
                resource: event
            });

            console.log('Event created successfully:', response.data.id);
            console.log('Event details:', {
                id: response.data.id,
                summary: response.data.summary,
                start: response.data.start,
                end: response.data.end,
                recurrence: response.data.recurrence,
                htmlLink: response.data.htmlLink
            });
            return response.data;
        } catch (error) {
            console.error('Error creating event for course:', course.title);
            console.error('Error details:', error.message);
            console.error('Full error:', error);
            throw error;
        }
    }

    /**
     * Parse date and time into ISO string
     * Accounts for user's local timezone
     */
    parseDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) {
            console.log('Missing date or time:', { dateStr, timeStr });
            return null;
        }
        
        try {
            // Parse the time string first
            const time = this.parseTime(timeStr);
            if (!time) {
                console.log('Failed to parse time:', timeStr);
                return null;
            }
            
            // Handle different date formats
            let year, month, day;
            
            if (typeof dateStr === 'number') {
                // Numeric serial date - shouldn't happen but handle it
                const date = new Date(dateStr);
                year = date.getFullYear();
                month = date.getMonth() + 1;
                day = date.getDate();
            } else if (dateStr.includes('-')) {
                // YYYY-MM-DD format
                const parts = dateStr.split('-').map(Number);
                [year, month, day] = parts;
            } else if (dateStr.includes('/')) {
                // M/D/YY or M/D/YYYY format
                const parts = dateStr.split('/').map(Number);
                if (parts.length === 3) {
                    [month, day, year] = parts;
                    // Handle 2-digit years
                    if (year < 100) {
                        year += (year < 30) ? 2000 : 1900;
                    }
                }
            } else {
                // Try to parse as is
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    year = date.getFullYear();
                    month = date.getMonth() + 1;
                    day = date.getDate();
                }
            }
            
            if (!year || !month || !day) {
                console.error('Invalid date parsed:', dateStr);
                return null;
            }
            
            // Format as ISO 8601 without Z suffix (NOT UTC)
            // This tells Google Calendar to interpret the time as-is in the specified timeZone
            const isoLocal = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:00`;
            console.log(`Parsed: ${dateStr} ${timeStr} -> Formatted for CST: ${isoLocal}`);
            
            return isoLocal;
        } catch (error) {
            console.error('Error parsing date/time:', error);
            return null;
        }
    }

    /**
     * Parse time string into hours and minutes
     */
    parseTime(timeStr) {
        if (!timeStr) return null;
        
        try {
            // Handle both 24-hour and 12-hour formats
            const isPM = timeStr.toLowerCase().includes('pm');
            const isAM = timeStr.toLowerCase().includes('am');
            
            // Remove AM/PM and extract numbers
            const time = timeStr.replace(/[^\d:]/g, '');
            const [hours, minutes] = time.split(':');
            
            let hour24 = parseInt(hours) || 9;
            if (isPM && hour24 < 12) hour24 += 12;
            if (isAM && hour24 === 12) hour24 = 0;
            
            return {
                hours: hour24,
                minutes: parseInt(minutes) || 0
            };
        } catch (error) {
            console.log('Error parsing time:', error);
            return null;
        }
    }

    /**
     * Get recurrence rule for course days
     */
    getRecurrenceRule(days, startDate, endDate) {
        if (!days || !startDate || !endDate) {
            console.error('Missing recurrence data:', { days, startDate, endDate });
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

        // Split by both "/" and "," to handle different formats like "Monday/Wednesday" or "Monday, Wednesday"
        const dayList = days.split(/[/,]/).map(day => dayMap[day.trim()]).filter(Boolean);
        
        if (dayList.length === 0) {
            console.error('No valid days found in:', days);
            return null;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Validate dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.error('Invalid dates:', { startDate, endDate });
            return null;
        }
        
        const until = end.toISOString().split('T')[0].replace(/-/g, '');

        return [`RRULE:FREQ=WEEKLY;BYDAY=${dayList.join(',')};UNTIL=${until}`];
    }

    /**
     * Delete all events for a specific batch ID
     */
    async deleteEventsByBatch(batchId, calendarId = 'primary') {
        try {
            this.initOAuth2();
            await this.loadTokens();
            
            console.log('Searching for events with batchId:', batchId);
            
            // Search for events with this batch ID using privateExtendedProperty
            const response = await this.calendar.events.list({
                calendarId: calendarId,
                privateExtendedProperty: `batchId=${batchId}`,
                maxResults: 100,
                singleEvents: false // We want recurring event masters
            });
            
            const events = response.data.items || [];
            console.log(`Found ${events.length} events to delete`);
            
            const deletedIds = [];
            const errors = [];
            
            for (const event of events) {
                try {
                    await this.calendar.events.delete({
                        calendarId: calendarId,
                        eventId: event.id
                    });
                    deletedIds.push(event.id);
                    console.log('Deleted event:', event.id, event.summary);
                } catch (error) {
                    console.error('Failed to delete event:', event.id, error.message);
                    errors.push(`Event "${event.summary}": ${error.message}`);
                }
            }
            
            return { 
                deletedCount: deletedIds.length, 
                deletedIds,
                errors,
                totalFound: events.length
            };
        } catch (error) {
            console.error('Error deleting events by batch:', error);
            throw new Error('Failed to delete events: ' + error.message);
        }
    }
}

module.exports = GoogleCalendarManager;
