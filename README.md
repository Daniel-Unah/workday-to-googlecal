# Workday to Google Calendar Converter

A simple, client-side web application that converts Workday schedule exports (.xlsx) to Google Calendar format (.ics files) with zero setup required.

## Features

- **Zero Setup**: Works entirely in your browser - no servers, no installations
- **Privacy First**: Files are processed locally and never sent to servers
- **Easy Upload**: Drag & drop or click to upload Workday .xlsx files
- **Smart Parsing**: Automatically detects and parses course schedules from various Workday export formats
- **Preview & Edit**: Review parsed courses before generating calendar files
- **Standards Compliant**: Generates proper .ics files with recurring events
- **Modern UI**: Beautiful, responsive interface

## How It Works

1. **Export from Workday**: Download your schedule as an Excel (.xlsx) file
2. **Upload Here**: Drag and drop your file into the converter
3. **Download Calendar**: Get your .ics file ready for Google Calendar

## Project Structure

```
workday-to-googlecal/
├── index.html          # The entire application (single file!)
└── README.md           # This file
```

## How to Export from Workday

1. **Log into Workday**
2. **Navigate to your course schedule** or academic calendar
3. **Look for "Export" or "Download"** button (usually top-right)
4. **Select Excel (.xlsx) format**
5. **Download the file**

The converter automatically detects common column names like:
- Course Name, Subject, Class
- Days, Weekday, Schedule  
- Time, Start Time
- Location, Room, Building
- Instructor, Professor

## Technical Details

- **Frontend Only**: Pure HTML, CSS, and JavaScript
- **Excel Parsing**: Uses SheetJS library (loaded from CDN)
- **ICS Generation**: Custom JavaScript implementation
- **No Backend**: Everything runs in the user's browser
- **No Data Storage**: Files are never sent to servers

## Browser Support

Works in all modern browsers:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## License

This project is licensed under the MIT License.

## Support

If you encounter any issues:

1. Check that your Excel file has the right format
2. Make sure you're using a modern browser
3. Try a different Workday export format
4. Open an issue with details about your Excel file structure

## Acknowledgments

- Built for students to easily manage their academic schedules
- Inspired by the need for better calendar integration with Workday
- Uses modern web technologies for optimal user experience
