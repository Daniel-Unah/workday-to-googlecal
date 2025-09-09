const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

/**
 * Google Calendar API Integration
 * Handles authentication and event creation
 */
class GoogleCalendarManager {
    constructor() {
        this.oauth2Client = null;
        this.calendar = null;
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
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

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    async getTokens(code) {
        this.initOAuth2();
        
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            
            // Save tokens for future use
            await this.saveTokens(tokens);
            
            return tokens;
        } catch (error) {
            console.error('Error getting tokens:', error);
            throw error;
        }
    }

    /**
     * Load saved tokens from file
     */
    async loadTokens() {
        try {
            const tokensPath = path.join(__dirname, '../tokens.json');
            if (await fs.pathExists(tokensPath)) {
                const tokens = await fs.readJson(tokensPath);
                this.oauth2Client.setCredentials(tokens);
                return tokens;
            }
        } catch (error) {
            console.log('No saved tokens found');
        }
        return null;
    }

    /**
     * Save tokens to file
     */
    async saveTokens(tokens) {
        try {
            const tokensPath = path.join(__dirname, '../tokens.json');
            await fs.writeJson(tokensPath, tokens);
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
            const tokens = await this.loadTokens();
            
            if (tokens) {
                this.oauth2Client.setCredentials(tokens);
                
                // Test the connection
                const response = await this.calendar.calendarList.list();
                return true;
            }
        } catch (error) {
            console.log('Not authenticated or token expired');
        }
        return false;
    }

    /**
     * Create events from course data
     */
    async createEvents(courses, calendarId = 'primary') {
        if (!await this.isAuthenticated()) {
            throw new Error('Not authenticated with Google Calendar. Please authenticate first.');
        }

        // console.log(`Creating events in calendar: ${calendarId}`);
        const events = [];
        const errors = [];

        for (const course of courses) {
            try {
                const event = await this.createEventFromCourse(course, calendarId);
                events.push(event);
                console.log(`✅ Created event: ${course.title}`);
            } catch (error) {
                console.error(`❌ Failed to create event for ${course.title}:`, error.message);
                errors.push({ course: course.title, error: error.message });
            }
        }

        return { events, errors };
    }

    /**
     * Create a single event from course data
     */
    async createEventFromCourse(course, calendarId = 'primary') {
        // console.log('Creating event for course:', course);
        
        // Use actual dates from course data, fallback to current semester if not provided
        const startDate = course.startDate ? new Date(course.startDate) : new Date('2025-08-25'); // Fall 2025 start
        const endDate = course.endDate ? new Date(course.endDate) : new Date('2025-12-12'); // Fall 2025 end
        
        // console.log(`Using dates: start=${startDate.toISOString().split('T')[0]}, end=${endDate.toISOString().split('T')[0]}`);
        
        // Parse days (handle multiple days like "Monday/Wednesday")
        const days = course.days ? course.days.split('/').map(day => day.trim()) : ['Monday'];
        
        // Parse time
        // console.log('Course time properties:', { time: course.time, endTime: course.endTime });
        const startTime = this.parseTime(course.time);
        const endTime = this.parseTime(course.endTime);

        // Create recurring event for each day
        const events = [];
        
        for (const day of days) {
            const dayOfWeek = this.getDayOfWeek(day);
            
            const event = {
                summary: course.title,
                description: `Instructor: ${course.instructor}\nLocation: ${course.location}\nStatus: ${course.registrationStatus}`,
                location: course.location,
                start: {
                    dateTime: this.createDateTime(startDate, startTime, dayOfWeek),
                    timeZone: 'America/New_York', // Adjust timezone as needed
                },
                end: {
                    dateTime: this.createDateTime(startDate, endTime, dayOfWeek),
                    timeZone: 'America/New_York',
                },
                recurrence: [
                    `RRULE:FREQ=WEEKLY;BYDAY=${this.getRRuleDay(day)};UNTIL=${this.formatDateForRRule(endDate)}`
                ],
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 15 },
                        { method: 'email', minutes: 60 }
                    ]
                }
            };

            const response = await this.calendar.events.insert({
                calendarId: calendarId,
                resource: event
            });

            // console.log(`Event created successfully:`, {
            //     id: response.data.id,
            //     summary: response.data.summary,
            //     start: response.data.start,
            //     end: response.data.end,
            //     calendarId: calendarId
            // });

            events.push(response.data);
        }

        return events;
    }

    /**
     * Parse time string (e.g., "5:30 PM" or "09:00" -> { hour: 17, minute: 30 })
     */
    parseTime(timeStr) {
        // console.log('parseTime called with:', JSON.stringify(timeStr), typeof timeStr);
        if (!timeStr) {
            throw new Error(`Time string is undefined or empty. Received: ${timeStr}`);
        }

        // Handle 24-hour format (e.g., "09:00")
        const time24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (time24Match) {
            return {
                hour: parseInt(time24Match[1]),
                minute: parseInt(time24Match[2])
            };
        }

        // Handle 12-hour format with AM/PM (e.g., "5:30 PM" or "5:30PM")
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!match) {
            throw new Error(`Invalid time format: ${timeStr}`);
        }

        let hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        const period = match[3].toUpperCase();

        if (period === 'PM' && hour !== 12) {
            hour += 12;
        } else if (period === 'AM' && hour === 12) {
            hour = 0;
        }

        return { hour, minute };
    }

    /**
     * Get day of week number (0 = Sunday, 1 = Monday, etc.)
     */
    getDayOfWeek(dayName) {
        const days = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        return days[dayName];
    }

    /**
     * Get RRULE day format (SU, MO, TU, etc.)
     */
    getRRuleDay(dayName) {
        const days = {
            'Sunday': 'SU', 'Monday': 'MO', 'Tuesday': 'TU', 'Wednesday': 'WE',
            'Thursday': 'TH', 'Friday': 'FR', 'Saturday': 'SA'
        };
        return days[dayName];
    }

    /**
     * Create datetime string for Google Calendar
     */
    createDateTime(date, time, dayOfWeek) {
        const eventDate = new Date(date);
        
        // Adjust to the correct day of week
        const currentDay = eventDate.getDay();
        const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
        eventDate.setDate(eventDate.getDate() + daysToAdd);
        
        // Set time
        eventDate.setHours(time.hour, time.minute, 0, 0);
        
        return eventDate.toISOString();
    }

    /**
     * Format date for RRULE UNTIL parameter
     */
    formatDateForRRule(date) {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }

    /**
     * Get list of user's calendars
     */
    async getCalendars() {
        if (!await this.isAuthenticated()) {
            throw new Error('Not authenticated with Google Calendar');
        }

        const response = await this.calendar.calendarList.list();
        return response.data.items;
    }

    /**
     * Create a new calendar
     */
    async createCalendar(name, description = '') {
        if (!await this.isAuthenticated()) {
            throw new Error('Not authenticated with Google Calendar');
        }

        const calendar = {
            summary: name,
            description: description,
            timeZone: 'America/New_York'
        };

        const response = await this.calendar.calendars.insert({
            resource: calendar
        });

        return response.data;
    }
}

module.exports = GoogleCalendarManager;



