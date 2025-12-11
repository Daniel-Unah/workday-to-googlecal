const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

describe('Excel Parsing Functions', () => {
  let sampleWorkbook;
  let sampleWorksheet;

  beforeAll(() => {
    // Create a sample Excel file for testing
    const data = [
      ['Course', 'Days', 'Time', 'End Time', 'Location', 'Instructor', 'Start Date', 'End Date', 'Registration Status'],
      ['CSCI 101 - Introduction to Computer Science', 'Monday/Wednesday', '9:00 AM', '10:15 AM', 'Room 101', 'Dr. Smith', '2025-01-13', '2025-05-02', 'Registered'],
      ['MATH 201 - Calculus I', 'Tuesday/Thursday', '11:00 AM', '12:15 PM', 'Room 202', 'Dr. Johnson', '2025-01-14', '2025-05-03', 'Registered'],
      ['ENGL 102 - English Composition', 'Monday/Wednesday/Friday', '1:00 PM', '1:50 PM', 'Room 303', 'Prof. Williams', '2025-01-13', '2025-05-02', 'Registered'],
      ['PHYS 101 - Physics I', 'Tuesday/Thursday', '2:00 PM', '3:15 PM', 'Lab 101', 'Dr. Brown', '2025-01-14', '2025-05-03', 'Waitlisted']
    ];

    sampleWorksheet = XLSX.utils.aoa_to_sheet(data);
    sampleWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(sampleWorkbook, sampleWorksheet, 'Schedule');
  });

  describe('Course Code Extraction', () => {
    it('should extract course code from title', () => {
      const extractCourseCode = (title) => {
        const match = title.match(/^([A-Z]{2,5}\s*\d{3,4}[A-Z]?)/);
        return match ? match[1].trim() : '';
      };

      expect(extractCourseCode('CSCI 101 - Introduction to Computer Science')).toBe('CSCI 101');
      expect(extractCourseCode('MATH 201 - Calculus I')).toBe('MATH 201');
      expect(extractCourseCode('ENGL 102 - English Composition')).toBe('ENGL 102');
      expect(extractCourseCode('Invalid Course')).toBe('');
    });
  });

  describe('Meeting Pattern Parsing', () => {
    it('should parse days with slash separator', () => {
      const parseDays = (days) => {
        if (!days) return [];
        return days.split(/[/,]/).map(d => d.trim()).filter(Boolean);
      };

      expect(parseDays('Monday/Wednesday')).toEqual(['Monday', 'Wednesday']);
      expect(parseDays('Tuesday/Thursday')).toEqual(['Tuesday', 'Thursday']);
      expect(parseDays('Monday/Wednesday/Friday')).toEqual(['Monday', 'Wednesday', 'Friday']);
    });

    it('should parse days with comma separator', () => {
      const parseDays = (days) => {
        if (!days) return [];
        return days.split(/[/,]/).map(d => d.trim()).filter(Boolean);
      };

      expect(parseDays('Monday, Wednesday')).toEqual(['Monday', 'Wednesday']);
      expect(parseDays('Tuesday, Thursday')).toEqual(['Tuesday', 'Thursday']);
    });

    it('should handle empty or invalid days', () => {
      const parseDays = (days) => {
        if (!days) return [];
        return days.split(/[/,]/).map(d => d.trim()).filter(Boolean);
      };

      expect(parseDays('')).toEqual([]);
      expect(parseDays(null)).toEqual([]);
      expect(parseDays(undefined)).toEqual([]);
    });
  });

  describe('Time Parsing', () => {
    it('should parse AM times correctly', () => {
      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const isPM = timeStr.toLowerCase().includes('pm');
        const isAM = timeStr.toLowerCase().includes('am');
        const time = timeStr.replace(/[^\d:]/g, '');
        const [hours, minutes] = time.split(':');
        let hour24 = parseInt(hours) || 9;
        if (isPM && hour24 < 12) hour24 += 12;
        if (isAM && hour24 === 12) hour24 = 0;
        return { hours: hour24, minutes: parseInt(minutes) || 0 };
      };

      expect(parseTime('9:00 AM')).toEqual({ hours: 9, minutes: 0 });
      expect(parseTime('11:30 AM')).toEqual({ hours: 11, minutes: 30 });
    });

    it('should parse PM times correctly', () => {
      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const isPM = timeStr.toLowerCase().includes('pm');
        const isAM = timeStr.toLowerCase().includes('am');
        const time = timeStr.replace(/[^\d:]/g, '');
        const [hours, minutes] = time.split(':');
        let hour24 = parseInt(hours) || 9;
        if (isPM && hour24 < 12) hour24 += 12;
        if (isAM && hour24 === 12) hour24 = 0;
        return { hours: hour24, minutes: parseInt(minutes) || 0 };
      };

      expect(parseTime('2:00 PM')).toEqual({ hours: 14, minutes: 0 });
      expect(parseTime('5:30 PM')).toEqual({ hours: 17, minutes: 30 });
    });

    it('should handle noon and midnight correctly', () => {
      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const isPM = timeStr.toLowerCase().includes('pm');
        const isAM = timeStr.toLowerCase().includes('am');
        const time = timeStr.replace(/[^\d:]/g, '');
        const [hours, minutes] = time.split(':');
        let hour24 = parseInt(hours) || 9;
        if (isPM && hour24 < 12) hour24 += 12;
        if (isAM && hour24 === 12) hour24 = 0;
        return { hours: hour24, minutes: parseInt(minutes) || 0 };
      };

      expect(parseTime('12:00 PM')).toEqual({ hours: 12, minutes: 0 });
      expect(parseTime('12:00 AM')).toEqual({ hours: 0, minutes: 0 });
    });
  });

  describe('Course Validation', () => {
    it('should validate registered courses', () => {
      const isValidCourse = (row) => {
        if (!row || !row[0] || !row[8]) return false;
        const courseCode = row[0]?.match(/^([A-Z]{2,5}\s*\d{3,4}[A-Z]?)/);
        const status = row[8]?.toLowerCase();
        return !!(courseCode && status === 'registered');
      };

      const validCourse = ['CSCI 101 - Intro', 'Monday', '9:00 AM', '10:15 AM', 'Room 101', 'Dr. Smith', '2025-01-13', '2025-05-02', 'Registered'];
      const waitlistedCourse = ['PHYS 101 - Physics', 'Tuesday', '2:00 PM', '3:15 PM', 'Lab 101', 'Dr. Brown', '2025-01-14', '2025-05-03', 'Waitlisted'];
      const invalidCourse = ['Not a course', 'Monday', '9:00 AM', '10:15 AM', 'Room 101', 'Dr. Smith', '2025-01-13', '2025-05-02', 'Registered'];

      expect(isValidCourse(validCourse)).toBe(true);
      expect(isValidCourse(waitlistedCourse)).toBe(false);
      expect(isValidCourse(invalidCourse)).toBe(false);
    });
  });

  describe('Excel to JSON Conversion', () => {
    it('should convert worksheet to array of arrays', () => {
      const json = XLSX.utils.sheet_to_json(sampleWorksheet, { header: 1, defval: '', raw: false });
      
      expect(json.length).toBeGreaterThan(0);
      expect(json[0][0]).toBe('Course');
      expect(json[1][0]).toContain('CSCI 101');
    });

    it('should handle empty cells', () => {
      const emptySheet = XLSX.utils.aoa_to_sheet([
        ['Course', 'Days', 'Time'],
        ['CSCI 101', '', '9:00 AM'],
        ['', 'Monday', '10:00 AM']
      ]);

      const json = XLSX.utils.sheet_to_json(emptySheet, { header: 1, defval: '', raw: false });
      
      expect(json[1][1]).toBe('');
      expect(json[2][0]).toBe('');
    });
  });

  describe('ICS Generation', () => {
    it('should format time for ICS correctly', () => {
      const formatTimeForICS = (time) => {
        if (!time) return null;
        const isPM = time.toLowerCase().includes('pm');
        const isAM = time.toLowerCase().includes('am');
        const cleanTime = time.replace(/[^\d:]/g, '');
        const [hours, minutes] = cleanTime.split(':');
        let hour24 = parseInt(hours) || 9;
        if (isPM && hour24 < 12) hour24 += 12;
        if (isAM && hour24 === 12) hour24 = 0;
        return String(hour24).padStart(2, '0') + String(minutes || 0).padStart(2, '0') + '00';
      };

      expect(formatTimeForICS('9:00 AM')).toBe('090000');
      expect(formatTimeForICS('2:30 PM')).toBe('143000');
      expect(formatTimeForICS('12:00 PM')).toBe('120000');
    });

    it('should escape ICS text correctly', () => {
      const escapeICS = (text) => {
        if (!text) return '';
        return text.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
      };

      expect(escapeICS('Room 101, Building A')).toBe('Room 101\\, Building A');
      expect(escapeICS('Line 1\nLine 2')).toBe('Line 1\\nLine 2');
      expect(escapeICS('Test;Semicolon')).toBe('Test\\;Semicolon');
    });
  });
});
