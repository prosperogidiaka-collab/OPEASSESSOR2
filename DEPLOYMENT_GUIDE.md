# OPE Assessor - Deployment Guide

## Overview
OPE Assessor supports two deployment modes:

1. Static-only mode: fastest setup, but data stays on each device/browser.
2. Shared-sync mode: deploy the included Node server so quizzes and submissions sync across all devices.

Shared-sync mode does not require any third-party API key.

## Files Needed for Deployment

### Core Application Files
- `index.html` - Main application entry point
- `app.js` - Complete application logic (1,400+ lines)
- `style.css` - Professional styling and responsive design
- `manifest.json` - PWA configuration
- `service-worker.js` - Offline functionality

### External Dependencies (CDN)
- Tailwind CSS (via CDN)
- SheetJS (XLSX) for Excel export/import
- FileSaver.js for file downloads
- html2pdf.js for PDF generation
- Google Fonts (Inter)

## Deployment Options

### 1. Shared Sync Deployment (Recommended for Multi-Device Use)
1. Deploy the whole project to a Node-capable host
2. Start it with `npm start`
3. Set `DATA_DIR` or `DATA_FILE` to persistent storage on that host
4. Open the same deployed URL on every device

### 2. Static Deployment
Use this only when you do not need shared syncing.

### Supabase Database Backend
The server can now store shared data in Supabase instead of `ope-shared-state.json`.

Setup steps:
1. Run `supabase/schema.sql` in your Supabase SQL editor
2. Set `STORAGE_BACKEND=supabase`
3. Set `SUPABASE_URL`
4. Set `SUPABASE_SERVICE_ROLE_KEY`
5. Optionally change `SUPABASE_TABLE_PREFIX` if you want table names other than `ope_*`

To migrate existing local shared data into Supabase:
1. Keep `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set
2. Run `npm run migrate:supabase`
3. If your local file is somewhere else, set `SOURCE_DATA_FILE=/absolute/path/to/ope-shared-state.json`

What moves into Supabase:
- quizzes
- submissions
- teachers
- uploaded student lists

Important note:
- This keeps the current app sync contract, so teacher records still follow the current browser-driven login model
- For a stronger auth model, the next step would be moving teacher login to server-side auth or Supabase Auth

### 3. Vercel (Recommended with Supabase)
Vercel now works for shared sync when you use the included `api/` routes with Supabase storage.

1. Push this project to GitHub
2. Import the repository into Vercel
3. Set these environment variables in Vercel:
   - `STORAGE_BACKEND=supabase`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Optional: `SUPABASE_TABLE_PREFIX`
4. Run `supabase/schema.sql` in your Supabase project
5. Deploy

Important notes for Vercel:
- `server.js` is still for traditional Node hosting and is not used by Vercel
- The new `api/health`, `api/state`, and `api/state/[stateKey]` serverless routes provide the same shared-sync API for the browser
- `STORAGE_BACKEND=file` is not suitable on Vercel because the filesystem is not persistent across serverless executions

What works on Vercel with Supabase mode:
- Shared quizzes across devices
- Shared submissions across devices
- Shared teacher/student records across devices
- The normal frontend files: `index.html`, `app.js`, `style.css`, `manifest.json`, `service-worker.js`

What will not work on Vercel:
- File-based shared persistence through `ope-shared-state.json`

### 4. Netlify
1. Create a free Netlify account
2. Drag & drop the files or connect Git
3. Site will be live at `random-name.netlify.app`

### 5. GitHub Pages
1. Upload files to a GitHub repository
2. Go to Settings > Pages
3. Select main branch and save
4. Site will be live at `username.github.io/repository-name`

### 6. Any Static Hosting
The app works on any static hosting service that supports:
- HTML/CSS/JavaScript files
- HTTPS (required for some features like clipboard API)

## Features Included

### ✅ Teacher Features
- **Account-Free Dashboard**: No login required, data stored locally
- **Rapid Exam Creation**: Set title, time limits, max grades
- **Bulk Import**: Excel/CSV support with template export
- **Topic Tagging**: Categorize questions by subject/difficulty
- **Question Selection**: Choose specific number from imported pool
- **Reshuffling**: Questions and options can be shuffled
- **6-Digit Quiz IDs**: Easy for students to join
- **Magic Links**: Entire quiz encoded in URL
- **Live Results**: Real-time submission tracking
- **Correction System**: Students can request, teachers can send PDFs
- **Restricted Access**: Optional student whitelist
- **Ranking System**: Optional peer comparison
- **Excel Export**: Comprehensive results with time tracking

### ✅ Student Features
- **Easy Entry**: 6-digit code or magic link
- **Google Forms Interface**: Vertical scrolling layout
- **Smart Timer**: Visual countdown with warnings
- **Navigation**: Move between questions freely
- **Instant Results**: Score, percentage, ranking, topic analysis
- **Correction Requests**: One-click request for detailed feedback

### ✅ Security Features
- **Screenshot Detection**: Multiple detection methods
- **Tab Switching**: Auto-submit if student leaves
- **Copy Protection**: Disabled during exam
- **Fullscreen Mode**: Required during testing
- **Webcam Proctoring**: Optional monitoring
- **No Selection**: Text selection disabled

### ✅ Technical Features
- **PWA Support**: Install on mobile devices
- **Offline Ready**: Works without internet
- **Shared Sync Option**: Same backend can be used by all devices
- **Fully Responsive**: Mobile to desktop
- **Excel Import/Export**: Professional file handling
- **PDF Generation**: Detailed correction reports
- **Auto-Save**: Progress saved every 30 seconds

## Configuration

### Basic Configuration
The app works out-of-the-box when frontend and backend are served together by `server.js`.

### Optional Customizations
You can modify these values for deployment:
- `STORAGE_BACKEND`: `file`, `supabase`, or `auto`
- `DATA_DIR` or `DATA_FILE`: where shared synced data is stored
- `SUPABASE_URL`: your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase key
- `SUPABASE_TABLE_PREFIX`: prefix for the shared-state tables
- `ALLOWED_ORIGINS`: comma-separated frontend origins when frontend and backend are on different domains
- `PUBLIC_BASE_URL`: optional public URL for logging/health visibility
- `config.js`: set `apiBaseUrl` only when using a separate backend origin

You can still modify these app values in `app.js`:
- Timer warnings (default: 5 seconds for tab switching)
- Auto-save interval (default: 30 seconds)
- Screenshot detection sensitivity

## Browser Compatibility

### Fully Supported
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Partial Support
- Older browsers may lack some security features
- PWA installation requires modern browsers

## Performance

### Load Time
- Initial load: ~2-3 seconds on 3G
- Subsequent loads: ~1 second (cached)

### Storage
- LocalStorage used for quiz data and submissions
- No server storage required
- Data persists between sessions

## Security Considerations

### Shared Backend Mode
- Shared quizzes, teachers, uploaded students, and submissions are stored on your deployed backend
- No third-party API key is required
- Use persistent storage on the host so data survives restarts
- On Vercel, use the included serverless `api/` routes together with `STORAGE_BACKEND=supabase`
- Do not use `STORAGE_BACKEND=file` on Vercel because the filesystem is read-only except for temporary scratch space
- When using Supabase mode, keep `SUPABASE_SERVICE_ROLE_KEY` on the server only and never expose it to the browser

### Exam Integrity
- Multiple screenshot detection methods
- Tab switching monitoring
- Copy/paste prevention
- Fullscreen requirement

## Troubleshooting

### Common Issues

#### "Excel library not loaded"
- Ensure internet connection for first load
- Check if CDN is accessible
- Try refreshing the page

#### "PDF generation failed"
- Check browser supports PDF generation
- Ensure sufficient memory available
- Try with fewer submissions

#### "Screenshot detection not working"
- Some browsers restrict clipboard access
- Keyboard detection still works
- Fullscreen detection always works

#### "PWA not installing"
- Ensure HTTPS is enabled
- Check browser supports PWA
- Try in Chrome/Edge for best compatibility

#### "Devices are not syncing"
- Confirm every device is opening the same deployed backend URL
- If frontend and backend are on different domains, update `config.js` and `ALLOWED_ORIGINS`
- If using file mode, check that the host keeps the shared data file on persistent storage
- If using Supabase mode, confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the tables from `supabase/schema.sql` are in place

#### "Supabase upsert/select failed"
- Confirm you ran `supabase/schema.sql`
- Confirm `STORAGE_BACKEND=supabase`
- Confirm the service-role key is correct and loaded on the server
- Confirm the table prefix in `SUPABASE_TABLE_PREFIX` matches the tables you created

#### "This Serverless Function has crashed" on Vercel
- This usually means the Vercel function is missing required storage configuration
- Confirm `STORAGE_BACKEND=supabase`
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel
- Confirm you ran `supabase/schema.sql`
- If you want file-based persistence instead, use `npm start` on a traditional Node host instead of Vercel

### Performance Tips
- For large quizzes (1000+ questions), consider batching
- Clear old data periodically if storage is full
- Use modern browsers for best performance

## Support

### Documentation
- All features documented in code
- Comments explain complex logic
- Function names are descriptive

### Community
- Open source - feel free to contribute
- Issues can be reported on GitHub
- Feature requests welcome

## License

This application is provided as-is for educational and assessment purposes.
Feel free to modify and distribute according to your needs.

---

**Ready to deploy!** Just upload the files and your assessment platform is live.
