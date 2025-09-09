# Workday to Google Calendar - Setup Guide

This guide will help you set up the Google Calendar integration features for automatically adding events to your calendar.

## 🚀 Quick Start

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
   - Upload your Workday Excel file and connect to Google Calendar!

## 📋 Detailed Setup

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
     - `http://localhost:3000/auth/google/callback`
     - `https://yourdomain.com/auth/google/callback` (for production)

4. **Configure Environment Variables**
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   ```

## 🎯 How to Use

### Google Calendar Integration

1. Click "Connect Google Calendar"
2. Authorize the app in the popup window
3. Select which calendar to use
4. Click "Add All Courses to Google Calendar"
5. Your courses will be added as recurring events!

### Manual Upload

1. Export your schedule from Workday manually
2. Upload the Excel file using the file input
3. Download the ICS file or use Google Calendar integration

## 🔧 Troubleshooting

### Google Calendar Issues

- **"Not authenticated"**: Make sure you've completed the OAuth flow
- **"Invalid credentials"**: Check your Google Cloud Console setup
- **"Calendar not found"**: Ensure the calendar ID is correct

### General Issues

- **"Server not responding"**: Make sure the server is running (`npm start`)
- **"File upload failed"**: Check file size (max 10MB) and format (.xlsx)

## 🛠️ Development

### Running in Development Mode

```bash
npm run dev
```

### Project Structure

```
├── index.html          # Main application
├── styles.css          # Styling
├── server.js           # Express server
├── package.json        # Dependencies
├── scripts/
│   └── google-calendar.js  # Google Calendar API
├── uploads/            # Temporary file storage
└── tokens.json         # Google OAuth tokens (auto-generated)
```

### API Endpoints

- `GET /` - Main application
- `GET /api/auth/google/url` - Get Google OAuth URL
- `GET /auth/google/callback` - OAuth callback
- `GET /api/auth/google/status` - Check auth status
- `GET /api/calendars` - Get user's calendars
- `POST /api/calendar/events` - Create calendar events
- `POST /api/upload` - Upload Excel file

## 🔒 Security Considerations

- Never commit `.env` file to version control
- Use environment variables in production
- Consider using a secrets management service
- Regularly rotate API keys
- Monitor API usage and quotas

## 📚 Additional Resources

- [Google Calendar API Documentation](https://developers.google.com/calendar)
- [Express.js Documentation](https://expressjs.com/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.



