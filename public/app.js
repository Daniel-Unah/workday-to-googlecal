let courses = [];
let currentTimezone = 'America/Chicago';
let isGoogleAuthenticated = false;
let currentBatchId = null; // Track the current batch of added events

// File input handling
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        hideMessages();
        parseExcelFile(file);
    }
});

// Download button handling
document.getElementById('downloadBtn').addEventListener('click', function() {
    // Track ICS download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'ics_download', {
            'event_category': 'Download',
            'event_label': 'ICS File',
            'value': courses.length
        });
    }
    downloadICS(courses);
});

function parseExcelFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Try multiple parsing methods
            let jsonData = [];
            
            // Method 1: Standard parsing
            jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: '', raw: false});
            
            // Method 2: If we get empty or single row, try different options
            if (jsonData.length < 2) {
                jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: '', raw: true});
            }
            
            // Method 3: Try parsing as CSV
            if (jsonData.length < 2) {
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                jsonData = csv.split('\n').map(row => row.split(','));
            }
            
            // Method 4: Try parsing with expanded range
            if (jsonData.length < 2) {
                // Find the actual range by looking at all cells
                let maxRow = 0;
                let maxCol = 0;
                
                Object.keys(worksheet).forEach(key => {
                    if (key.startsWith('!')) return; // Skip metadata
                    const cellRef = XLSX.utils.decode_cell(key);
                    maxRow = Math.max(maxRow, cellRef.r);
                    maxCol = Math.max(maxCol, cellRef.c);
                });
                
                // Create expanded range
                const range = {s: {r: 0, c: 0}, e: {r: maxRow, c: maxCol}};
                
                jsonData = [];
                for (let R = range.s.r; R <= range.e.r; ++R) {
                    const row = [];
                    for (let C = range.s.c; C <= range.e.c; ++C) {
                        const cellAddress = XLSX.utils.encode_cell({r: R, c: C});
                        const cell = worksheet[cellAddress];
                        row.push(cell ? cell.v : '');
                    }
                    jsonData.push(row);
                }
            }
            
            courses = parseWorkdayData(jsonData);
            
            if (courses.length === 0) {
                showError('No courses found. The Excel file might be in an unsupported format. Please try saving it as a different Excel format (.xlsx) or check the browser console for debugging info.');
                return;
            }
            
            displayPreview(courses);
            document.getElementById('downloadBtn').disabled = false;
            
            // Track successful file upload and parsing
            if (typeof gtag !== 'undefined') {
                gtag('event', 'file_upload_success', {
                    'event_category': 'File Upload',
                    'event_label': 'Excel File',
                    'value': courses.length
                });
            }
            
            // Save courses to sessionStorage so they persist across page reloads (e.g., OAuth redirect)
            try {
                const coursesJson = JSON.stringify(courses);
                // Check if data is too large (sessionStorage typically has 5-10MB limit)
                if (coursesJson.length > 5 * 1024 * 1024) { // 5MB limit
                    console.warn('Courses data too large for sessionStorage, some data may be lost on page reload');
                }
                sessionStorage.setItem('courses', coursesJson);
            } catch (e) {
                console.warn('Could not save courses to sessionStorage:', e);
                if (e.name === 'QuotaExceededError') {
                    showError('Warning: Course data is too large to save. If you refresh the page, you may need to upload your file again.');
                }
            }
            
            // Enable Google Calendar button if authenticated
            if (isGoogleAuthenticated) {
                document.getElementById('addToGoogleBtn').disabled = false;
            }
            
            showSuccess(`Successfully parsed ${courses.length} courses!`);
            
        } catch (error) {
            console.error('Error parsing Excel:', error);
            showError('Error reading Excel file: ' + error.message);
            
            // Track file parse errors
            if (typeof gtag !== 'undefined') {
                gtag('event', 'file_parse_error', {
                    'event_category': 'File Upload',
                    'event_label': 'Parse Error',
                    'value': 0
                });
            }
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseWorkdayData(data) {
    if (data.length < 2) {
        return [];
    }
    
    // Find header row (look for common column names)
    let headerRow = 0;
    
    // Try to find the right row with headers - look for the row with both "Meeting Patterns" and "Instructor"
    for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i] || [];
        
        // Look for a row that has both "Meeting Patterns" and "Instructor" columns
        const hasMeetingPatterns = row.some(cell => 
            cell && typeof cell === 'string' && 
            cell.toLowerCase().includes('meeting patterns')
        );
        const hasInstructor = row.some(cell => 
            cell && typeof cell === 'string' && 
            cell.toLowerCase().includes('instructor')
        );
        const hasCourseListing = row.some(cell => 
            cell && typeof cell === 'string' && 
            cell.toLowerCase().includes('course listing')
        );
        
        if (hasMeetingPatterns && hasInstructor && hasCourseListing) {
            headerRow = i;
            break;
        }
    }
    
    const headers = data[headerRow] || [];
    
    const courses = [];
    
    // Map Workday-specific column names
    const columnMap = {
        courseListing: findColumn(headers, ['course listing', 'course', 'subject', 'class', 'name', 'title']),
        meetingPatterns: findColumn(headers, ['meeting patterns', 'enrolled sections meeting patterns', 'schedule', 'days', 'time']),
        instructor: findColumn(headers, ['instructor', 'professor', 'teacher', 'staff']),
        startDate: findColumn(headers, ['start date', 'start']),
        endDate: findColumn(headers, ['end date', 'end']),
        registrationStatus: findColumn(headers, ['registration status', 'status', 'enrollment status'])
    };
    
    // Parse each row
    for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i] || [];
        if (row.every(cell => !cell)) continue; // Skip empty rows
        
        
        // Extract course name from Course Listing column
        const courseListing = getCellValue(row, columnMap.courseListing) || '';
        
        // Skip rows with empty or invalid course listings
        if (!courseListing || courseListing.trim() === '' || courseListing === 'Course Listing' || courseListing === '13') {
            continue;
        }
        
        const courseName = extractCourseName(courseListing);
        
        // Extract meeting info from Meeting Patterns column
        const meetingPatterns = getCellValue(row, columnMap.meetingPatterns) || '';
        const meetingInfo = parseMeetingPatterns(meetingPatterns);
        
        // Get instructor
        const instructor = getCellValue(row, columnMap.instructor) || '';
        
        // Get registration status
        const registrationStatus = getCellValue(row, columnMap.registrationStatus);
        
        // Extract and convert dates from Excel serial numbers
        const startDateSerial = getCellValue(row, columnMap.startDate);
        const endDateSerial = getCellValue(row, columnMap.endDate);
        
        // Convert Excel serial numbers to dates
        const startDate = startDateSerial ? convertExcelDate(startDateSerial) : null;
        const endDate = endDateSerial ? convertExcelDate(endDateSerial) : null;
        
        const course = {
            id: courses.length + 1,
            title: courseName || 'Untitled Event',
            days: meetingInfo.days || 'Monday',
            time: meetingInfo.startTime || '09:00',
            endTime: meetingInfo.endTime || '10:00',
            location: meetingInfo.location || '',
            instructor: instructor,
            registrationStatus: registrationStatus,
            startDate: startDate,
            endDate: endDate
        };
        
        // Only add if it's a valid course
        if (isValidCourse(course, row)) {
            courses.push(course);
        }
    }
    
    return courses;
}

function extractCourseName(courseListing) {
    // Extract course name from strings like "CSE 4501 - Video Game Programming II"
    if (!courseListing || courseListing.trim() === '') {
        return 'Untitled Course';
    }
    
    // Check if it looks like a course code (e.g., "CSE 4501 - Video Game Programming II")
    const match = courseListing.match(/([A-Z]{2,4}\s+\d{4})\s*-\s*(.+?)(?:\s*-\s*Fall|$)/);
    if (match) {
        return `${match[1]} - ${match[2]}`;
    }
    
    // If it doesn't match the pattern, return as-is
    return courseListing;
}

function isNavigationOrHeader(title) {
    // Filter out navigation elements, headers, and non-course content
    const navigationTerms = [
        'calendar view',
        'edit registration', 
        'my enrolled courses',
        'my dropped',
        'withdrawn courses',
        'enrolled credit hours',
        'full-time',
        'part-time',
        'view my courses',
        'academic year',
        'semester',
        'term',
        'student information',
        'registration',
        'schedule',
        'courses',
        'academic',
        'undergraduate',
        'graduate',
        'bachelor',
        'master',
        'doctor',
        'school of',
        'department',
        'college',
        'university',
        'active',
        'inactive',
        'status',
        'credit',
        'hours',
        'gpa',
        'grade',
        'transcript'
    ];
    
    const lowerTitle = title.toLowerCase();
    
    // Check if title contains navigation terms
    for (const term of navigationTerms) {
        if (lowerTitle.includes(term)) {
            return true;
        }
    }
    
    // Check if it's a student info line (contains student name and ID)
    if (lowerTitle.includes('(') && lowerTitle.includes(')') && 
        (lowerTitle.includes('student') || lowerTitle.includes('undergraduate') || lowerTitle.includes('graduate'))) {
        return true;
    }
    
    // Check if it's just a date or number
    if (/^\d+$/.test(title.trim()) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(title.trim())) {
        return true;
    }
    
    return false;
}

function isValidCourse(course, row) {
    // Check if this is a valid course (not dropped, has proper format, etc.)
    
    // Must have a course code pattern (like CSE 4501, BIOL 3100, etc.)
    const courseCodePattern = /^[A-Z]{2,4}\s+\d{4}/;
    if (!courseCodePattern.test(course.title)) {
        return false;
    }
    
    // If it has a valid course code at the start, it's a valid course
    // Don't check for navigation/header terms since they can appear in legitimate course names
    
    // Check registration status - filter out unregistered/dropped classes
    const registrationStatus = course.registrationStatus || '';
    
    if (registrationStatus.toLowerCase().includes('unregistered') || 
        registrationStatus.toLowerCase().includes('dropped') ||
        registrationStatus.toLowerCase().includes('withdrawn')) {
        return false;
    }
    
    return true;
}

function parseMeetingPatterns(meetingPatterns) {
    // Parse strings like "Mon/Wed | 5:30 PM - 7:00 PM | RIDGLEY, Room 00016"
    const parts = meetingPatterns.split('|').map(p => p.trim());
    
    let days = 'Monday';
    let startTime = '09:00';
    let endTime = '10:00';
    let location = '';
    
    if (parts.length >= 1) {
        // Parse days
        const dayStr = parts[0];
        
        // Handle multiple days like "Mon/Wed"
        if (dayStr.includes('/')) {
            const dayParts = dayStr.split('/');
            const dayNames = [];
            dayParts.forEach(part => {
                if (part.includes('Mon')) dayNames.push('Monday');
                if (part.includes('Tue')) dayNames.push('Tuesday');
                if (part.includes('Wed')) dayNames.push('Wednesday');
                if (part.includes('Thu')) dayNames.push('Thursday');
                if (part.includes('Fri')) dayNames.push('Friday');
                if (part.includes('Sat')) dayNames.push('Saturday');
                if (part.includes('Sun')) dayNames.push('Sunday');
            });
            days = dayNames.join('/');
        } else {
            // Single day
            if (dayStr.includes('Mon')) days = 'Monday';
            if (dayStr.includes('Tue')) days = 'Tuesday';
            if (dayStr.includes('Wed')) days = 'Wednesday';
            if (dayStr.includes('Thu')) days = 'Thursday';
            if (dayStr.includes('Fri')) days = 'Friday';
            if (dayStr.includes('Sat')) days = 'Saturday';
            if (dayStr.includes('Sun')) days = 'Sunday';
        }
    }
    
    if (parts.length >= 2) {
        // Parse time
        const timeStr = parts[1];
        if (!timeStr) {
            return { days, startTime, endTime, location };
        }
        const timeMatch = timeStr.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/);
        if (timeMatch) {
            startTime = timeMatch[1];
            endTime = timeMatch[2];
        }
    }
    
    if (parts.length >= 3) {
        // Parse location
        location = parts[2];
    }
    
    return { days, startTime, endTime, location };
}

function findColumn(headers, keywords) {
    for (let i = 0; i < headers.length; i++) {
        const header = (headers[i] || '').toString().toLowerCase().trim();
        if (keywords.some(keyword => header.includes(keyword.toLowerCase()))) {
            return i;
        }
    }
    return -1;
}

function getCellValue(row, columnIndex) {
    if (columnIndex === -1 || !row[columnIndex]) return '';
    return row[columnIndex].toString().trim();
}

function convertExcelDate(excelSerial) {
    // Excel serial numbers start from 1900-01-01 (serial 1)
    // But Excel incorrectly treats 1900 as a leap year, so we need to adjust
    const serial = parseFloat(excelSerial);
    
    if (isNaN(serial)) return null;
    
    // Excel serial numbers are days since 1900-01-01
    // But Excel has a bug where it treats 1900 as a leap year
    // So we need to subtract 2 days for dates after 1900-02-28
    let adjustedSerial = serial;
    if (serial > 59) { // After 1900-02-28
        adjustedSerial = serial - 1; // Subtract 1 instead of 2 to account for the leap year bug
    } else {
        adjustedSerial = serial;
    }
    
    // Use UTC to avoid timezone issues
    const date = new Date(Date.UTC(1900, 0, adjustedSerial));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`; // Return YYYY-MM-DD format
}

function displayPreview(courses) {
    const preview = document.getElementById('preview');
    
    let html = `
        <h3 style="margin: 20px 0 15px 0; color: #4a5568;">Found ${courses.length} courses:</h3>
        <table class="preview-table">
            <thead>
                <tr>
                    <th>Course</th>
                    <th>Days</th>
                    <th>Time</th>
                    <th>Location</th>
                    <th>Instructor</th>
                    <th>Add to Calendar</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    courses.forEach((course, index) => {
        html += `
            <tr>
                <td><strong>${course.title}</strong></td>
                <td>${course.days}</td>
                <td>${course.time} - ${course.endTime}</td>
                <td>${course.location}</td>
                <td>${course.instructor}</td>
                <td>
                    <button class="google-calendar-btn" 
                            data-title="${course.title.replace(/"/g, '&quot;')}"
                            data-days="${course.days.replace(/"/g, '&quot;')}"
                            data-time="${course.time.replace(/"/g, '&quot;')}"
                            data-end-time="${course.endTime.replace(/"/g, '&quot;')}"
                            data-location="${course.location.replace(/"/g, '&quot;')}"
                            data-instructor="${course.instructor.replace(/"/g, '&quot;')}"
                            style="background: linear-gradient(135deg, #4285f4 0%, #34a853 100%); color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%; max-width: 150px;">
                        Add to Google Calendar
                    </button>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    preview.innerHTML = html;
    
    // Add event listeners to the Google Calendar buttons
    document.querySelectorAll('.google-calendar-btn').forEach(button => {
        button.addEventListener('click', function() {
            const course = {
                title: this.getAttribute('data-title'),
                days: this.getAttribute('data-days'),
                time: this.getAttribute('data-time'),
                endTime: this.getAttribute('data-end-time'),
                location: this.getAttribute('data-location'),
                instructor: this.getAttribute('data-instructor')
            };
            openSingleCourseInGoogleCalendar(course);
        });
    });
}

function downloadICS(courses) {
    try {
        let icsContent = 'BEGIN:VCALENDAR\n';
        icsContent += 'VERSION:2.0\n';
        icsContent += 'PRODID:-//Workday Converter//EN\n';
        icsContent += 'CALSCALE:GREGORIAN\n';
        icsContent += 'METHOD:PUBLISH\n';
        
        courses.forEach(course => {
            const eventId = 'workday-event-' + course.id + '@workday-converter.com';
            const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            
            // Calculate the first meeting date based on startDate and days
            const firstMeetingDate = getFirstMeetingDate(course.startDate, course.days);
            const dateStr = firstMeetingDate.replace(/-/g, '');
            
            icsContent += 'BEGIN:VEVENT\n';
            icsContent += 'UID:' + eventId + '\n';
            icsContent += 'DTSTAMP:' + now + '\n';
            icsContent += 'DTSTART:' + dateStr + 'T' + formatTimeForICS(course.time) + '\n';
            icsContent += 'DTEND:' + dateStr + 'T' + formatTimeForICS(course.endTime) + '\n';
            icsContent += 'SUMMARY:' + escapeICS(course.title) + '\n';
            
            let rrule = 'RRULE:FREQ=WEEKLY;BYDAY=' + getRRuleDays(course.days);
            if (course.endDate) {
                const untilDate = course.endDate.replace(/-/g, '');
                rrule += ';UNTIL=' + untilDate;
            }
            icsContent += rrule + '\n';
            
            if (course.location) {
                icsContent += 'LOCATION:' + escapeICS(course.location) + '\n';
            }
            
            if (course.instructor) {
                icsContent += 'DESCRIPTION:Instructor: ' + escapeICS(course.instructor) + '\n';
            }
            
            icsContent += 'END:VEVENT\n';
        });
        
        icsContent += 'END:VCALENDAR';
        
        // Download the file
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workday-schedule.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showSuccess('Calendar file downloaded successfully!');
        
    } catch (error) {
        showError('Error generating calendar file: ' + error.message);
    }
}

function formatTimeForICS(timeStr) {
    // Convert time like "09:00" or "9:00 AM" to "090000"
    let time = timeStr.toString().trim();
    
    // Handle AM/PM
    const isPM = time.toLowerCase().includes('pm');
    const isAM = time.toLowerCase().includes('am');
    
    // Remove AM/PM and extract numbers
    time = time.replace(/[^\d:]/g, '');
    const [hours, minutes] = time.split(':');
    
    let hour24 = parseInt(hours) || 9;
    if (isPM && hour24 < 12) hour24 += 12;
    if (isAM && hour24 === 12) hour24 = 0;
    
    return String(hour24).padStart(2, '0') + 
           String(minutes || 0).padStart(2, '0') + '00';
}

function getFirstMeetingDate(startDateStr, daysStr) {
    try {
        // Map full day names to JS day indices (0=Sun ... 6=Sat)
        const nameToIndex = {
            'Sunday': 0,
            'Monday': 1,
            'Tuesday': 2,
            'Wednesday': 3,
            'Thursday': 4,
            'Friday': 5,
            'Saturday': 6
        };

        // Parse days first to get target day indices
        let targetIndices = [];
        if (daysStr) {
            // Support both "/" and "," separators
            const dayNames = daysStr.split(/[\/\,]/).map(s => s.trim()).filter(Boolean);
            targetIndices = dayNames
                .map(n => nameToIndex[n])
                .filter(i => typeof i === 'number');
        }

        // If no valid days found, use today as fallback
        if (targetIndices.length === 0) {
            const today = new Date();
            return `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth()+1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        }

        // Determine the base date
        let start;
        if (startDateStr) {
            // Parse start date into a Date object
            let year, month, day;
            if (typeof startDateStr === 'number') {
                const d = new Date(startDateStr);
                year = d.getFullYear();
                month = d.getMonth() + 1;
                day = d.getDate();
            } else if (startDateStr.includes('-')) {
                const parts = startDateStr.split('-').map(Number);
                [year, month, day] = parts;
            } else if (startDateStr.includes('/')) {
                const parts = startDateStr.split('/').map(Number);
                if (parts.length === 3) {
                    [month, day, year] = parts;
                    if (year < 100) {
                        year += (year < 30) ? 2000 : 1900;
                    }
                }
            } else {
                const d = new Date(startDateStr);
                if (!isNaN(d.getTime())) {
                    year = d.getFullYear();
                    month = d.getMonth() + 1;
                    day = d.getDate();
                }
            }

            if (year && month && day) {
                start = new Date(year, (month - 1), day);
            }
        }

        // If no valid start date, use today
        if (!start || isNaN(start.getTime())) {
            start = new Date();
        }

        // If start day already matches a meeting day, keep it
        if (targetIndices.includes(start.getDay())) {
            return `${String(start.getFullYear()).padStart(4, '0')}-${String(start.getMonth()+1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        }

        // Otherwise, advance up to 7 days to find the next matching meeting day
        for (let offset = 1; offset <= 7; offset++) {
            const d = new Date(start);
            d.setDate(start.getDate() + offset);
            if (targetIndices.includes(d.getDay())) {
                return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
        }

        // Fallback: return start date (shouldn't reach here, but just in case)
        return `${String(start.getFullYear()).padStart(4, '0')}-${String(start.getMonth()+1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    } catch (e) {
        console.warn('getFirstMeetingDate failed, using fallback:', e?.message);
        // Fallback: find next occurrence of first meeting day from today
        const today = new Date();
        const nameToIndex = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        if (daysStr) {
            const dayNames = daysStr.split(/[\/\,]/).map(s => s.trim()).filter(Boolean);
            const targetIndices = dayNames.map(n => nameToIndex[n]).filter(i => typeof i === 'number');
            if (targetIndices.length > 0) {
                for (let offset = 0; offset <= 7; offset++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() + offset);
                    if (targetIndices.includes(d.getDay())) {
                        return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    }
                }
            }
        }
        // Last resort: tomorrow
        const fallback = new Date();
        fallback.setDate(fallback.getDate() + 1);
        return fallback.toISOString().split('T')[0];
    }
}

function getRRuleDays(daysStr) {
    const dayMap = {
        'monday': 'MO', 'tuesday': 'TU', 'wednesday': 'WE', 'thursday': 'TH',
        'friday': 'FR', 'saturday': 'SA', 'sunday': 'SU',
        'mon': 'MO', 'tue': 'TU', 'wed': 'WE', 'thu': 'TH',
        'fri': 'FR', 'sat': 'SA', 'sun': 'SU'
    };
    
    // Support both "/" and "," separators, and handle whitespace
    const days = daysStr.toLowerCase().split(/[\/\,]/).map(d => d.trim()).filter(d => d);
    const rruleDays = days.map(day => dayMap[day] || null).filter(Boolean);
    
    // If no valid days found, default to Monday
    return rruleDays.length > 0 ? rruleDays.join(',') : 'MO';
}

function escapeICS(text) {
    return text.toString()
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    document.getElementById('errorMessage').classList.add('hidden');
}

function hideMessages() {
    document.getElementById('errorMessage').classList.add('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}

function showGoogleError(message) {
    const errorDiv = document.getElementById('googleErrorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    document.getElementById('googleSuccessMessage').classList.add('hidden');
}

function showGoogleSuccess(message) {
    const successDiv = document.getElementById('googleSuccessMessage');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    document.getElementById('googleErrorMessage').classList.add('hidden');
}

function hideGoogleMessages() {
    document.getElementById('googleErrorMessage').classList.add('hidden');
    document.getElementById('googleSuccessMessage').classList.add('hidden');
}

function openGoogleCalendar(courses) {
    if (courses.length === 0) {
        showError('No courses to add to calendar');
        return;
    }

    // Open the first course in Google Calendar
    const firstCourse = courses[0];
    const googleCalendarUrl = createGoogleCalendarUrl(firstCourse);
    
    // Open Google Calendar in a new tab
    window.open(googleCalendarUrl, '_blank');
    
    showSuccess(`Opened Google Calendar with "${firstCourse.title}". Use the individual "Add to Google Calendar" buttons in the table below to add each course.`);
}

function openSingleCourseInGoogleCalendar(course) {
    const googleCalendarUrl = createGoogleCalendarUrl(course);
    window.open(googleCalendarUrl, '_blank');
}

function createMultiCourseGoogleCalendarUrl(courses) {
    // For multiple courses, we'll create a URL that opens the first course
    // and provide instructions for the rest
    if (courses.length === 0) return '';
    
    const firstCourse = courses[0];
    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams();
    
    // Event title
    params.append('action', 'TEMPLATE');
    params.append('text', firstCourse.title);
    
    // Event description with all courses listed
    let description = `Course: ${firstCourse.title}`;
    if (firstCourse.instructor) {
        description += `\nInstructor: ${firstCourse.instructor}`;
    }
    if (firstCourse.location) {
        description += `\nLocation: ${firstCourse.location}`;
    }
    
    // Add list of all courses
    if (courses.length > 1) {
        description += `\n\nAll ${courses.length} courses from your Workday schedule:`;
        courses.forEach((course, index) => {
            description += `\n${index + 1}. ${course.title}`;
            if (course.days && course.time) {
                description += ` (${course.days} ${course.time})`;
            }
            if (course.location) {
                description += ` - ${course.location}`;
            }
        });
        description += `\n\nNote: You'll need to add each course individually. Use the "Add to Calendar" button for each course.`;
    }
    
    params.append('details', description);
    
    // Location
    if (firstCourse.location) {
        params.append('location', firstCourse.location);
    }
    
    // For now, we'll create a sample date (you might want to make this more sophisticated)
    const sampleDate = new Date();
    sampleDate.setDate(sampleDate.getDate() + 1); // Tomorrow
    const dateStr = sampleDate.toISOString().split('T')[0].replace(/-/g, '');
    
    // Parse time (assuming format like "5:30 PM")
    const startTime = parseTimeForGoogleCalendar(firstCourse.time);
    const endTime = parseTimeForGoogleCalendar(firstCourse.endTime);
    
    // Create datetime strings
    const startDateTime = `${dateStr}T${startTime}`;
    const endDateTime = `${dateStr}T${endTime}`;
    
    params.append('dates', `${startDateTime}/${endDateTime}`);
    
    // Recurrence (simplified - weekly on the specified day)
    const recurrence = getRecurrenceRule(firstCourse.days);
    if (recurrence) {
        params.append('recur', recurrence);
    }
    
    return `${baseUrl}?${params.toString()}`;
}

function createGoogleCalendarUrl(course) {
    // Create a Google Calendar URL with pre-filled event details
    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams();
    
    // Event title
    params.append('action', 'TEMPLATE');
    params.append('text', course.title);
    
    // Event description
    let description = `Course: ${course.title}`;
    if (course.instructor) {
        description += `\nInstructor: ${course.instructor}`;
    }
    if (course.location) {
        description += `\nLocation: ${course.location}`;
    }
    params.append('details', description);
    
    // Location
    if (course.location) {
        params.append('location', course.location);
    }
    
    // For now, we'll create a sample date (you might want to make this more sophisticated)
    const sampleDate = new Date();
    sampleDate.setDate(sampleDate.getDate() + 1); // Tomorrow
    const dateStr = sampleDate.toISOString().split('T')[0].replace(/-/g, '');
    
    // Parse time (assuming format like "5:30 PM")
    const startTime = parseTimeForGoogleCalendar(course.time);
    const endTime = parseTimeForGoogleCalendar(course.endTime);
    
    // Create datetime strings
    const startDateTime = `${dateStr}T${startTime}`;
    const endDateTime = `${dateStr}T${endTime}`;
    
    params.append('dates', `${startDateTime}/${endDateTime}`);
    
    // Recurrence (simplified - weekly on the specified day)
    const recurrence = getRecurrenceRule(course.days);
    if (recurrence) {
        params.append('recur', recurrence);
    }
    
    return `${baseUrl}?${params.toString()}`;
}

function parseTimeForGoogleCalendar(timeStr) {
    // Convert time like "5:30 PM" to "173000" (24-hour format)
    let time = timeStr.toString().trim();
    
    // Handle AM/PM
    const isPM = time.toLowerCase().includes('pm');
    const isAM = time.toLowerCase().includes('am');
    
    // Remove AM/PM and extract numbers
    time = time.replace(/[^\d:]/g, '');
    const [hours, minutes] = time.split(':');
    
    let hour24 = parseInt(hours) || 9;
    if (isPM && hour24 < 12) hour24 += 12;
    if (isAM && hour24 === 12) hour24 = 0;
    
    return String(hour24).padStart(2, '0') + 
           String(minutes || 0).padStart(2, '0') + '00';
}

function getRecurrenceRule(daysStr) {
    // Convert days to Google Calendar recurrence format
    const dayMap = {
        'monday': 'MO', 'tuesday': 'TU', 'wednesday': 'WE', 'thursday': 'TH',
        'friday': 'FR', 'saturday': 'SA', 'sunday': 'SU',
        'mon': 'MO', 'tue': 'TU', 'wed': 'WE', 'thu': 'TH',
        'fri': 'FR', 'sat': 'SA', 'sun': 'SU'
    };
    
    const days = daysStr.toLowerCase().split(/[,\s\/]+/).filter(d => d);
    const googleDays = days.map(day => dayMap[day] || 'MO').join(',');
    
    return `RRULE:FREQ=WEEKLY;BYDAY=${googleDays}`;
}

function resetConverter() {
    courses = [];
    // Clear courses from sessionStorage as well
    try {
        sessionStorage.removeItem('courses');
    } catch (e) {
        console.warn('Could not clear courses from sessionStorage:', e);
    }
    document.getElementById('fileInput').value = '';
    document.getElementById('downloadBtn').disabled = true;
    document.getElementById('preview').innerHTML = '';
    hideMessages();
}

// Google Calendar authentication (server-side with per-user tokens)
document.getElementById('googleAuthBtn').addEventListener('click', async () => {
    try {
        // Check if already authenticated
        if (isGoogleAuthenticated) {
            showGoogleSuccess('Already connected to Google Calendar!');
            return;
        }

        // Track Google auth initiation
        if (typeof gtag !== 'undefined') {
            gtag('event', 'google_auth_initiated', {
                'event_category': 'Authentication',
                'event_label': 'Google Calendar',
                'value': 1
            });
        }

        // Get Google OAuth URL from server
        const response = await fetch('/api/auth/google/url');
        const data = await response.json();
        
        if (data.authUrl) {
            // Save courses to sessionStorage before redirecting (in case they exist)
            // This ensures courses persist across the OAuth redirect
            if (courses && courses.length > 0) {
                try {
                    sessionStorage.setItem('courses', JSON.stringify(courses));
                    console.log('Saved courses to sessionStorage before OAuth redirect');
                } catch (e) {
                    console.warn('Could not save courses to sessionStorage:', e);
                }
            }
            
            // Use full-page redirect instead of popup for better session cookie support
            // The OAuth callback will redirect back to the app after authentication
            window.location.href = data.authUrl;
            
            // Stop checking after 5 minutes
            setTimeout(() => {
                clearInterval(checkAuth);
            }, 5 * 60 * 1000);
        } else {
            showGoogleError('Failed to get Google authentication URL');
        }
    } catch (error) {
        showGoogleError('Error connecting to Google Calendar: ' + error.message);
    }
});

// Disconnect Google Calendar
document.getElementById('disconnectGoogleBtn').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/auth/google/disconnect', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Track disconnect
            if (typeof gtag !== 'undefined') {
                gtag('event', 'google_auth_disconnect', {
                    'event_category': 'Authentication',
                    'event_label': 'Google Calendar',
                    'value': 1
                });
            }
            
            // Clear authentication state
            isGoogleAuthenticated = false;
            document.getElementById('googleAuthSection').classList.remove('hidden');
            document.getElementById('googleCalendarSection').classList.add('hidden');
            document.getElementById('addToGoogleBtn').disabled = true;
            
            // No message needed - UI state change is enough feedback
        } else {
            showGoogleError(data.error || 'Failed to disconnect from Google Calendar');
        }
    } catch (error) {
        console.error('Disconnect error:', error);
        showGoogleError('Error disconnecting from Google Calendar: ' + error.message);
    }
});

// Check Google Calendar authentication status
async function checkGoogleAuthStatus() {
    try {
        const response = await fetch('/api/auth/google/status');
        const data = await response.json();
        
        if (data.authenticated) {
            isGoogleAuthenticated = true;
            document.getElementById('googleAuthSection').classList.add('hidden');
            document.getElementById('googleCalendarSection').classList.remove('hidden');
            
            // Load user's calendars
            await loadGoogleCalendars();
            
            // Enable the add to Google button if courses are loaded
            if (courses.length > 0) {
                document.getElementById('addToGoogleBtn').disabled = false;
            }
        }
    } catch (error) {
        showGoogleError('Error checking Google Calendar status: ' + error.message);
    }
}

// Load user's Google Calendars
async function loadGoogleCalendars() {
    try {
        const response = await fetch('/api/calendars');
        const data = await response.json();
        
        const select = document.getElementById('calendarSelect');
        select.innerHTML = '<option value="primary">Primary Calendar</option>';
        
        data.calendars.forEach(calendar => {
            if (calendar.id !== 'primary') {
                const option = document.createElement('option');
                option.value = calendar.id;
                option.textContent = calendar.summary;
                select.appendChild(option);
            }
        });
    } catch (error) {
        // Silently fail - user will see empty calendar list
    }
}

// Add courses to Google Calendar (server-side with per-user tokens)
document.getElementById('addToGoogleBtn').addEventListener('click', async () => {
    if (!isGoogleAuthenticated || courses.length === 0) {
        showGoogleError('Please connect to Google Calendar and load courses first');
        return;
    }
    
    const btn = document.getElementById('addToGoogleBtn');
    const originalText = btn.innerHTML;
    const calendarId = document.getElementById('calendarSelect').value;
    
    // Generate a unique batch ID for this set of events
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        btn.innerHTML = '<span class="btn-icon">⏳</span>Adding to Calendar...';
        btn.disabled = true;
        
        // Prevent duplicate submissions
        if (btn.dataset.processing === 'true') {
            showGoogleError('Please wait for the current operation to complete.');
            btn.disabled = false;
            return;
        }
        btn.dataset.processing = 'true';
        
        // Send courses to server to add to Google Calendar
        // Add timeout to prevent hanging requests (5 minutes for large uploads)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        
        const response = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                courses: courses.map(course => ({
                    title: course.title,
                    days: course.days,
                    time: course.time,
                    endTime: course.endTime,
                    location: course.location,
                    instructor: course.instructor,
                    startDate: course.startDate,
                    endDate: course.endDate
                })),
                calendarId: calendarId,
                batchId: batchId
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // Track event creation in GA4
            if (typeof gtag !== 'undefined') {
                gtag('event', 'events_added_to_calendar', {
                    'event_category': 'Calendar',
                    'event_label': 'Google Calendar',
                    'value': result.eventsCreated
                });
            }
            
            // Store the batch ID for deletion
            currentBatchId = result.batchId;
            
            let message = `Successfully added ${result.eventsCreated} events to Google Calendar!`;
            
            // Show errors if any
            if (result.errors && result.errors.length > 0) {
                message += `\n\nWarning: ${result.errors.length} course(s) had errors:\n${result.errors.join('\n')}`;
            }
            
            showGoogleSuccess(message);
            
            // Show the delete button
            const deleteBtn = document.getElementById('removeEventsBtn');
            if (deleteBtn) {
                deleteBtn.classList.remove('hidden');
                deleteBtn.disabled = false;
            }
        } else {
            showGoogleError('Failed to add events to Google Calendar: ' + result.error);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showGoogleError('Request timed out. This may happen with many courses. Please try again or split your schedule into smaller files.');
        } else {
            showGoogleError('Error adding events to Google Calendar: ' + error.message);
        }
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.dataset.processing = 'false';
    }
});

// Remove added events from Google Calendar
document.getElementById('removeEventsBtn').addEventListener('click', async () => {
    if (!isGoogleAuthenticated || !currentBatchId) {
        showGoogleError('No events to remove');
        return;
    }
    
    const confirmation = confirm('Are you sure you want to remove all added events from Google Calendar? This cannot be undone.');
    if (!confirmation) {
        return;
    }
    
    const btn = document.getElementById('removeEventsBtn');
    const originalText = btn.innerHTML;
    const calendarId = document.getElementById('calendarSelect').value;
    
    try {
        btn.innerHTML = '<span class="btn-icon">⏳</span>Removing Events...';
        btn.disabled = true;
        
        // Send delete request to server
        const response = await fetch('/api/calendar/events/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                batchId: currentBatchId,
                calendarId: calendarId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Track event removal
            if (typeof gtag !== 'undefined') {
                gtag('event', 'events_removed_from_calendar', {
                    'event_category': 'Calendar',
                    'event_label': 'Google Calendar',
                    'value': result.deletedCount
                });
            }
            
            showGoogleSuccess(`Successfully removed ${result.deletedCount} events from Google Calendar!`);
            
            // Hide the delete button and clear batch ID
            btn.classList.add('hidden');
            currentBatchId = null;
        } else {
            showGoogleError('Failed to remove events: ' + result.error);
        }
    } catch (error) {
        showGoogleError('Error removing events: ' + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// Check Google auth status on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Clear any previous authentication state
    isGoogleAuthenticated = false;
    document.getElementById('googleAuthSection').classList.remove('hidden');
    document.getElementById('googleCalendarSection').classList.add('hidden');
    
    // Restore courses from sessionStorage if they exist (e.g., after OAuth redirect)
    try {
        const savedCourses = sessionStorage.getItem('courses');
        if (savedCourses) {
            courses = JSON.parse(savedCourses);
            if (courses && courses.length > 0) {
                console.log(`Restored ${courses.length} courses from sessionStorage`);
                displayPreview(courses);
                document.getElementById('downloadBtn').disabled = false;
                // Don't show success message - courses were already displayed before
            }
        }
    } catch (e) {
        console.warn('Could not restore courses from sessionStorage:', e);
    }
    
    // Check if redirected from OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
        // Track successful Google authentication in GA4
        if (typeof gtag !== 'undefined') {
            gtag('event', 'google_auth_success', {
                'event_category': 'Authentication',
                'event_label': 'Google Calendar',
                'value': 1
            });
        }
        
        // Remove the auth parameter from URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Show success message
        showGoogleSuccess('Successfully connected to Google Calendar!');
    }
    
    // Check if user is authenticated (this will also enable "Add to Google Calendar" button if courses exist)
    await checkGoogleAuthStatus();
    
    // If courses were restored and user is authenticated, ensure the button is enabled
    if (courses && courses.length > 0 && isGoogleAuthenticated) {
        document.getElementById('addToGoogleBtn').disabled = false;
    }
});
