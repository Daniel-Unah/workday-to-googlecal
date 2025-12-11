// Mock the googleapis module
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth'),
        getToken: jest.fn().mockResolvedValue({
          tokens: {
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expiry_date: Date.now() + 3600000
          }
        }),
        setCredentials: jest.fn()
      }))
    },
    calendar: jest.fn().mockReturnValue({
      calendarList: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'primary', summary: 'Primary Calendar' },
              { id: 'test-calendar-id', summary: 'Test Calendar' }
            ]
          }
        })
      },
      events: {
        insert: jest.fn().mockResolvedValue({
          data: {
            id: 'mock-event-id',
            summary: 'Test Event',
            status: 'confirmed'
          }
        })
      }
    })
  }
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  writeJson: jest.fn().mockResolvedValue(undefined),
  readJson: jest.fn().mockResolvedValue({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token'
  }),
  pathExists: jest.fn().mockResolvedValue(true),
  remove: jest.fn().mockResolvedValue(undefined)
}));

const GoogleCalendarManager = require('../../scripts/google-calendar');

describe('GoogleCalendarManager', () => {
  let manager;

  beforeEach(() => {
    manager = new GoogleCalendarManager('test-user');
    jest.clearAllMocks();
  });

  describe('initOAuth2', () => {
    it('should initialize OAuth2 client with correct credentials', () => {
      manager.initOAuth2();
      expect(manager.oauth2Client).toBeDefined();
      expect(manager.calendar).toBeDefined();
    });

    it('should throw error if credentials are missing', () => {
      const savedClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      const tempManager = new GoogleCalendarManager('test-user');
      expect(() => tempManager.initOAuth2()).toThrow('Google OAuth credentials not configured');
      // Restore for other tests
      process.env.GOOGLE_CLIENT_ID = savedClientId;
    });
  });

  describe('getAuthUrl', () => {
    it('should return authorization URL', () => {
      const url = manager.getAuthUrl();
      expect(url).toBe('https://accounts.google.com/o/oauth2/auth');
    });
  });

  describe('getTokens', () => {
    it('should exchange code for tokens', async () => {
      const tokens = await manager.getTokens('test-auth-code');
      expect(tokens).toEqual({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: expect.any(Number)
      });
    });
  });

  describe('createEventFromCourse', () => {
    beforeEach(() => {
      manager.initOAuth2();
    });

    it('should create event with valid course data', async () => {
      const course = {
        title: 'CSCI 101 - Introduction to Computer Science',
        instructor: 'Dr. Smith',
        location: 'Room 101',
        days: 'Monday/Wednesday',
        time: '9:00 AM',
        endTime: '10:15 AM',
        startDate: '2025-01-13',
        endDate: '2025-05-02'
      };

      const event = await manager.createEventFromCourse(course);
      expect(event.id).toBe('mock-event-id');
      expect(event.summary).toBe('Test Event');
    });

    it('should throw error for invalid date/time', async () => {
      const course = {
        title: 'Test Course',
        days: 'Monday',
        time: null,
        endTime: '10:15 AM',
        startDate: '2025-01-13',
        endDate: '2025-05-02'
      };

      await expect(manager.createEventFromCourse(course)).rejects.toThrow();
    });

    it('should throw error for invalid recurrence rule', async () => {
      const course = {
        title: 'Test Course',
        days: null,
        time: '9:00 AM',
        endTime: '10:15 AM',
        startDate: '2025-01-13',
        endDate: '2025-05-02'
      };

      await expect(manager.createEventFromCourse(course)).rejects.toThrow();
    });
  });

  describe('parseDateTime', () => {
    beforeEach(() => {
      manager.initOAuth2();
    });

    it('should parse valid date and time', () => {
      const result = manager.parseDateTime('2025-01-13', '9:00 AM');
      expect(result).toBeDefined();
      expect(result).toContain('2025-01');
      expect(result).toContain('T');
    });

    it('should return null for missing date', () => {
      const result = manager.parseDateTime(null, '9:00 AM');
      expect(result).toBeNull();
    });

    it('should return null for missing time', () => {
      const result = manager.parseDateTime('2025-01-13', null);
      expect(result).toBeNull();
    });
  });

  describe('parseTime', () => {
    beforeEach(() => {
      manager.initOAuth2();
    });

    it('should parse AM time correctly', () => {
      const result = manager.parseTime('9:00 AM');
      expect(result).toEqual({ hours: 9, minutes: 0 });
    });

    it('should parse PM time correctly', () => {
      const result = manager.parseTime('2:30 PM');
      expect(result).toEqual({ hours: 14, minutes: 30 });
    });

    it('should parse 12:00 PM correctly', () => {
      const result = manager.parseTime('12:00 PM');
      expect(result).toEqual({ hours: 12, minutes: 0 });
    });

    it('should parse 12:00 AM correctly', () => {
      const result = manager.parseTime('12:00 AM');
      expect(result).toEqual({ hours: 0, minutes: 0 });
    });

    it('should return null for invalid time', () => {
      const result = manager.parseTime(null);
      expect(result).toBeNull();
    });
  });

  describe('getRecurrenceRule', () => {
    beforeEach(() => {
      manager.initOAuth2();
    });

    it('should generate recurrence rule for single day', () => {
      const result = manager.getRecurrenceRule('Monday', '2025-01-13', '2025-05-02');
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20250502']);
    });

    it('should generate recurrence rule for multiple days with slash', () => {
      const result = manager.getRecurrenceRule('Monday/Wednesday/Friday', '2025-01-13', '2025-05-02');
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20250502']);
    });

    it('should generate recurrence rule for multiple days with comma', () => {
      const result = manager.getRecurrenceRule('Monday, Wednesday', '2025-01-13', '2025-05-02');
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20250502']);
    });

    it('should return null for missing days', () => {
      const result = manager.getRecurrenceRule(null, '2025-01-13', '2025-05-02');
      expect(result).toBeNull();
    });

    it('should return null for invalid dates', () => {
      const result = manager.getRecurrenceRule('Monday', 'invalid-date', '2025-05-02');
      expect(result).toBeNull();
    });
  });

  describe('getCalendars', () => {
    beforeEach(() => {
      manager.initOAuth2();
      manager.oauth2Client.setCredentials({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token'
      });
    });

    it('should retrieve list of calendars', async () => {
      const calendars = await manager.getCalendars();
      expect(calendars).toHaveLength(2);
      expect(calendars[0].id).toBe('primary');
      expect(calendars[1].id).toBe('test-calendar-id');
    });
  });
});
