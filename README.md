# Workday to Google Calendar Converter

A web application that converts Workday schedule exports (.xlsx) directly to Google Calendar events with one-click integration.

## Features

- **Easy Upload**: Drag & drop or click to upload Workday .xlsx files
- **Google Calendar Integration**: Add courses directly to your Google Calendar with one click
- **Smart Parsing**: Automatically detects and parses course schedules from Workday exports
- **Timezone Aware**: Uses actual dates from your spreadsheet, no timezone conversion issues
- **Privacy First**: Files are processed locally, only calendar events are sent to Google
- **Modern UI**: Clean, responsive interface

## How It Works

1. **Export from Workday**: Download your schedule as an Excel (.xlsx) file
2. **Upload Here**: Drag and drop your file into the converter
3. **Connect Google Calendar**: Authorize the app to access your calendar
4. **Add to Calendar**: Click to add all courses directly to Google Calendar

## How to Export from Workday

1. **Log into Workday**
2. **Navigate to your course schedule** or academic calendar
3. **Look for "Export to Excel"** button (usually top-right)
4. **Select Excel (.xlsx) format**
5. **Download the file**

## Setup & Deployment

### Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set up Environment Variables**
   ```bash
   cp env.example .env
   ```

3. **Configure Google Calendar API**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable the Google Calendar API
   - Create OAuth 2.0 credentials
   - Add your credentials to `.env`

4. **Start the Server**
   ```bash
   npm start
   ```

5. **Open the App**
   - Navigate to `http://localhost:3000`

### Google Calendar API Setup

1. **Create Google Cloud Project**
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Click "New Project" or select existing project
   - Give it a name like "Workday Calendar Converter"

2. **Enable Google Calendar API**
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:3000/auth/google/callback` (for development)
     - `https://yourdomain.com/auth/google/callback` (for production)

4. **Configure Environment Variables**
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   SESSION_SECRET=your_random_session_secret
   ```

### Deployment (Railway)

1. **Connect to Railway**
   - Push your code to GitHub
   - Connect your GitHub repo to Railway

2. **Set Environment Variables**
   - Add all the variables from your `.env` file
   - Update `GOOGLE_REDIRECT_URI` to your Railway domain

3. **Deploy**
   - Railway will automatically build and deploy your app

## Project Structure

```
├── public/
│   ├── index.html          # Main application
│   ├── styles.css          # Styling
│   └── export_to_excel.jpg # Help image
├── scripts/
│   └── google-calendar.js  # Google Calendar API integration
├── server.js               # Express server
├── package.json            # Dependencies
├── Procfile               # Railway deployment config
├── railway.json           # Railway build config
└── tokens/                # User OAuth tokens (auto-generated)
```

## Technical Details

- **Backend**: Node.js with Express
- **Frontend**: HTML, CSS, JavaScript
- **Excel Parsing**: SheetJS library
- **Google Calendar**: Google Calendar API v3
- **Authentication**: OAuth 2.0
- **Deployment**: Railway

## Browser Support

Works in all modern browsers:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Troubleshooting

### Google Calendar Issues
- **"Not authenticated"**: Make sure you've completed the OAuth flow
- **"Invalid credentials"**: Check your Google Cloud Console setup
- **"Calendar not found"**: Ensure the calendar ID is correct

### General Issues
- **"Server not responding"**: Make sure the server is running (`npm start`)
- **"File upload failed"**: Check file size (max 10MB) and format (.xlsx)
- **Timezone issues**: The app now uses actual dates from your spreadsheet

## License

This project is licensed under the MIT License.

## Support

If you encounter any issues:
1. Check that your Excel file has the right format
2. Make sure you're using a modern browser
3. Verify your Google Calendar API setup
4. Check the browser console for error messages