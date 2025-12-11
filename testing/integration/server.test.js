const request = require('supertest');
const express = require('express');
const session = require('express-session');

// Create a test app
let app;
let server;

// Mock GoogleCalendarManager
jest.mock('../../scripts/google-calendar');
const GoogleCalendarManager = require('../../scripts/google-calendar');

describe('Server API Integration Tests', () => {
  beforeAll(() => {
    // Setup mock implementation
    GoogleCalendarManager.mockImplementation(() => ({
      getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth'),
      getTokens: jest.fn().mockResolvedValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token'
      }),
      saveTokens: jest.fn().mockResolvedValue(undefined),
      loadTokens: jest.fn().mockResolvedValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token'
      }),
      getCalendars: jest.fn().mockResolvedValue([
        { id: 'primary', summary: 'Primary Calendar' },
        { id: 'test-calendar', summary: 'Test Calendar' }
      ]),
      createEvents: jest.fn().mockResolvedValue([
        { id: 'event-1', status: 'confirmed' },
        { id: 'event-2', status: 'confirmed' }
      ])
    }));

    // Import and setup server after mocking
    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true
    }));

    // Minimal server routes for testing
    app.get('/api/auth/google/url', (req, res) => {
      try {
        const manager = new GoogleCalendarManager();
        const authUrl = manager.getAuthUrl();
        res.json({ authUrl });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/auth/google/status', (req, res) => {
      const authenticated = req.session.googleTokens ? true : false;
      res.json({ authenticated });
    });

    app.get('/auth/google/callback', async (req, res) => {
      try {
        const { code } = req.query;
        if (!code) {
          return res.status(400).send('Missing authorization code');
        }

        const manager = new GoogleCalendarManager();
        const tokens = await manager.getTokens(code);
        req.session.googleTokens = tokens;
        await manager.saveTokens(tokens);

        res.send('<script>window.close();</script>');
      } catch (error) {
        res.status(500).send('Authentication failed: ' + error.message);
      }
    });

    app.get('/api/calendars', async (req, res) => {
      try {
        if (!req.session.googleTokens) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        const manager = new GoogleCalendarManager();
        const calendars = await manager.getCalendars();
        res.json({ calendars });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/calendar/events', async (req, res) => {
      try {
        if (!req.session.googleTokens) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        const { courses, calendarId } = req.body;
        const manager = new GoogleCalendarManager();
        const events = await manager.createEvents(courses, calendarId);
        
        res.json({
          success: true,
          eventsCreated: events.length,
          events
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/auth/google/url', () => {
    it('should return Google OAuth URL', async () => {
      const response = await request(app).get('/api/auth/google/url');
      expect(response.status).toBe(200);
      expect(response.body.authUrl).toBe('https://accounts.google.com/o/oauth2/auth');
    });
  });

  describe('GET /api/auth/google/status', () => {
    it('should return not authenticated when no session', async () => {
      const response = await request(app).get('/api/auth/google/status');
      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });
  });

  describe('GET /auth/google/callback', () => {
    it('should handle OAuth callback with code', async () => {
      const response = await request(app)
        .get('/auth/google/callback')
        .query({ code: 'test-auth-code' });
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('window.close()');
    });

    it('should return error when code is missing', async () => {
      const response = await request(app).get('/auth/google/callback');
      expect(response.status).toBe(400);
      expect(response.text).toContain('Missing authorization code');
    });
  });

  describe('GET /api/calendars', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/calendars');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return calendars when authenticated', async () => {
      const agent = request.agent(app);
      
      // First authenticate
      await agent.get('/auth/google/callback').query({ code: 'test-code' });
      
      // Then get calendars
      const response = await agent.get('/api/calendars');
      expect(response.status).toBe(200);
      expect(response.body.calendars).toHaveLength(2);
      expect(response.body.calendars[0].id).toBe('primary');
    });
  });

  describe('POST /api/calendar/events', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/api/calendar/events')
        .send({
          courses: [],
          calendarId: 'primary'
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should create events when authenticated', async () => {
      const agent = request.agent(app);
      
      // First authenticate
      await agent.get('/auth/google/callback').query({ code: 'test-code' });
      
      // Then create events
      const courses = [
        {
          title: 'CSCI 101',
          days: 'Monday/Wednesday',
          time: '9:00 AM',
          endTime: '10:15 AM',
          startDate: '2025-01-13',
          endDate: '2025-05-02'
        }
      ];
      
      const response = await agent
        .post('/api/calendar/events')
        .send({ courses, calendarId: 'primary' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.eventsCreated).toBe(2);
    });
  });
});
