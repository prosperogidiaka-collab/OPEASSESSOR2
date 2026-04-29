# 📋 OPE Assessor — Zero-Friction Assessment Portal

A **privacy-first** Progressive Web App (PWA) for creating, sharing, and taking quizzes. It supports both **local-only browser storage** and **shared sync through the included Node backend** so data can stay in sync across devices.

## ✨ Complete Feature Set

### 👨‍🏫 Teachers
- ✅ No login, all data on your device
- ✅ Multiple subjects (1-10 per quiz)
- ✅ Flexible question import (Excel/CSV)
- ✅ Question pool selection (import 200, use 50)
- ✅ Per-subject shuffling (questions & options)
- ✅ 6-digit Quiz IDs + Magic Links
- ✅ Student whitelist (optional)
- ✅ Live results dashboard
- ✅ Export to Excel with all metrics
- ✅ Topic analysis (failure rates)
- ✅ Webcam control (optional/required)
- ✅ Student rankings (enable/disable)

### ✍️ Students
- ✅ Join via code or link
- ✅ No registration needed
- ✅ Vertical scrolling interface
- ✅ Answer in any order
- ✅ Smart timer (red/pulse < 60s)
- ✅ Instant grading
- ✅ Topic performance breakdown
- ✅ Peer rankings (if enabled)
- ✅ Print PDF summary
- ✅ Request corrections

### 🛡️ Security & Anti-Cheating
- ✅ Fullscreen lockdown (auto-submit if exit)
- ✅ Tab detection (5-sec warning → auto-submit)
- ✅ Screenshot blocking (Print Screen, Ctrl+Shift+S, Win+Shift+S)
- ✅ No copy/paste, no text selection
- ✅ Webcam snapshots (start + random checks)
- ✅ Ghost watermarking (name/email)
- ✅ Submission locking (1 email = 1 submission)
- ✅ Whitelist filtering

### ⚡ Technical
- ✅ Progressive Web App (PWA) — installable, offline
- ✅ No third-party API keys required for shared sync deployment
- ✅ Browser localStorage — survives reloads
- ✅ Fully responsive — mobile to desktop
- ✅ Base64 URLs — no database
- ✅ Excel/CSV import — flexible
- ✅ PDF/XLSX export — full results

---

## 📁 Files

```
├── index.html          # App shell
├── app.js             # Complete app logic
├── service-worker.js  # PWA offline support
├── manifest.json      # PWA metadata
├── style.css          # Extra styles
└── README.md          # This file
```

**No build required.** Deploy as-is to any static host.

---

## 🚀 Deploy in 3 Steps

### Vercel (Recommended)
1. Push all files to GitHub
2. Go to vercel.com → "New Project" → Import your repo
3. Click "Deploy" ✅

### Netlify
1. Push to GitHub  
2. Go to netlify.com → "New site from Git" → Deploy ✅

### GitHub Pages
1. Create repo, push files to main branch
2. Settings → Pages → Select "main branch" as source ✅
3. Live at: `yourusername.github.io/repo-name`

### Local Testing (Windows PowerShell)
```powershell
# Option 1: Using http-server
npm install -g http-server
cd C:\Users\HP\Documents\OPEASSESSOR
http-server
# Visit http://localhost:8080

# Option 2: Using Python
python -m http.server 8000
# Visit http://localhost:8000
```

---

## 📖 Quick Start Guide

### For Teachers: Create a Quiz

1. **Click "Teacher Dashboard"**
2. **Fill Quiz Details**:
   - Exam Name/Institution: (e.g., "ABC University")
   - Quiz Title: (e.g., "Physics Midterm")
   - Time Limit: (minutes)
   - Max Grade: (points)
3. **Configure Subjects**:
   - Enter number of subjects (1-10)
   - Click "Create Subject Inputs"
   - For each subject:
     - Name: (e.g., "Physics", "Chemistry")
     - Upload Excel/CSV file with columns: **question, optionA, optionB, optionC, optionD, answer, topic, difficulty**
     - Optional: Enter # of questions to use (if uploading 200, use only 50)
     - Check/uncheck "Shuffle Questions" & "Shuffle Options"
4. **Optional: Whitelist Students**
   - Upload Excel/CSV with columns: **Name, ID**
   - (Leave blank to allow all)
5. **Click "Create Quiz"**
   - You get a **6-digit Quiz ID** (e.g., "123456")
   - **Magic Link** auto-copied to clipboard
   - Share either!

### For Students: Take a Quiz

1. **Click "Student - Join Quiz"**
2. **Join via**:
   - 6-digit code (enter directly), OR
   - Magic link (paste full URL)
3. **Enter Information**:
   - Your full name
   - Your email (used as unique identifier)
4. **Read Instructions** & Check "I accept the rules"
5. **Click "Begin Assessment"**
   - Fullscreen activates
   - Watermark shows your name/email
   - Webcam may start (if enabled)
6. **Answer Questions**:
   - Scroll vertically through questions
   - Answer in any order
   - Change answers before final submission
   - Timer shows time remaining (red & pulsing at 60s)
7. **Submit**:
   - Click "Finish & Submit"
   - Instant grading & results shown
8. **View Results**:
   - See your score, percentage, ranking
   - View performance by topic/difficulty
   - Print PDF summary
   - Request quiz review if needed

### For Teachers: Monitor & Export Results

1. **Click Quiz → "View Results"**
2. **Dashboard Shows**:
   - Total submissions count
   - Average class score
   - Correction requests count
3. **See Submissions**:
   - Table with name, email, score, %, time spent, ranking
   - Search/filter by name or email
4. **Export Data**:
   - Click "Export (XLSX)" → Save to your computer
   - Includes all metrics + correction request flags
5. **View Analysis**:
   - Click "Analysis" → See topic/difficulty breakdown
   - Identifies which topics students struggled with
6. **Download Student PDFs**:
   - Click "PDF" button → Download individual result
   - Share with student via email
7. **Respond to Corrections**:
   - See ✔️ mark for students requesting review
   - Email them or download & attach PDF result

---

## 📊 Excel File Format

**Questions File Columns** (case-insensitive):
| Column | Example | Notes |
|--------|---------|-------|
| question | "What is photosynthesis?" | Required |
| optionA | "Process in plants..." | Required |
| optionB | "..." | Required |
| optionC | "..." | Required |
| optionD | "..." | Required |
| answer | "A" | A, B, C, or D (uppercase) |
| topic | "Biology" | Category/chapter |
| difficulty | "Hard" | Easy/Medium/Hard |

**Whitelist File Columns**:
| Column | Example |
|--------|---------|
| Name | "John Doe" |
| ID | "john@example.com" or "STU001" |

---

## 🔒 Security & Limitations

### ✅ What IS Blocked
- Tab switching (5-second warning → auto-submit)
- Fullscreen exit (auto-submit)
- Print Screen key
- Ctrl+Shift+S (Chrome screenshot)
- Windows+Shift+S (Windows screenshot)
- Right-click & context menu
- Copy/paste during quiz
- Text selection

### ⚠️ What IS NOT Blocked (Why)
- **Physical screenshots** → Browser can't block OS-level actions. Solution: Ghost watermarking + webcam snapshots make any leaked screenshot traceable to the student.
- **Phone camera photos** → Same deterrent.
- **Screen recording** → Minimized by webcam monitoring.

### 💡 Best Practices
- Use in **proctored environments** (classroom/testing center) for high-stakes exams
- **Enable webcam** for additional deterrent
- **Whitelist students** to control access
- For **low-stakes** formative assessments with supervision

---

## 🛠️ Customization

### Change Colors
Edit `app.js` and change Tailwind color classes:
- `bg-blue-600` → `bg-red-600` (red theme)
- `text-blue-*` → `text-indigo-*` (indigo theme)

### Adjust Timer
In `app.js`, search for `startAssessment()`:
```javascript
timeRemaining = (q.timeLimit||30) * 60;  // Change default time
// Violation timing: let t = 5 (seconds before auto-submit)
```

### Modify PDF Export
In `printResultPDF()` function:
- Change fonts, spacing, content
- Add institution logo or seal

### Add Branding
Edit copyright in `printResultPDF()`:
```javascript
©️ Your Institution Name
```

---

## 📊 Data Storage & Privacy

### Where Data Is Stored
- **Local cache**: Browser localStorage keys such as `ope_quizzes_v2` and `ope_submissions_v2`
- **Shared sync mode**: `ope-shared-state.json` on the Node server, or a custom path via `DATA_FILE`
- **Whitelist**: Stored with each quiz

### Persistence
- Local mode survives page reloads on the same browser/device
- Shared sync mode keeps quizzes, teachers, uploaded students, and submissions aligned across devices using the same backend
- Clearing browser cache = **data loss** ⚠️
- **Export regularly** to backup

### Privacy
- **No analytics or tracking**
- **Local mode** keeps data in the browser only
- **Shared sync mode** sends data only to your deployed OPE backend
- Teacher controls all data
- GDPR-friendly (no cloud storage)

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Fullscreen doesn't activate | Check browser permissions; some browsers require full gesture |
| Webcam access denied | Check browser Settings → Camera; refresh page & try again |
| Questions won't load | Verify Excel/CSV format matches template; check for merged cells |
| Magic link doesn't work | Make sure you copied the **full URL** (starts with http://) |
| Results disappeared | Check browser didn't clear cache; export regularly as backup |
| Can't export to Excel | Try different browser; check localStorage isn't full |
| Timer won't count down | Ensure JavaScript is enabled; refresh page |

---

## 🎯 Future Enhancements (Roadmap)

- [ ] Per-question point values (not equal weighting)
- [ ] Short-answer / essay questions (teacher marking UI)
- [ ] Scheduled quiz availability (date/time restrictions)
- [ ] Question analytics (difficulty index, discrimination index)
- [ ] Student performance trends & dashboards
- [ ] Question review & flagging system
- [ ] Hint system (optional teacher-provided hints)
- [ ] Mobile app wrapper

---

## 📄 License & Attribution

**Created by**: Prosper Emamuzo Ogidiaka

**License**: Free to use, modify, and deploy.

**Credits**:
- Tailwind CSS (styling)
- XLSX.js (Excel import/export)
- html2pdf.js (PDF generation)
- FileSaver.js (file downloads)

---

## 💡 Best Practices

1. **Test on target devices** before live deployment
2. **Whitelist students** for high-stakes assessments
3. **Enable webcam** for proctoring in unsupervised settings
4. **Export results regularly** to your computer (backup!)
5. **Use in classroom** for best integrity (physical supervision)
6. **Customize colors** with your institution branding
7. **Train students** on the interface before the actual exam

---

## 🤝 Need Help?

- Check the **Troubleshooting** section above
- Verify browser supports **localStorage** & **ServiceWorker**
- Test on **Chrome**, **Edge**, or **Firefox** (latest versions)
- Ensure **JavaScript is enabled**
- Check that you're using **https://** (better for some features)

---

## ✨ Enjoy Frictionless Assessment!

All the power of a full LMS, none of the friction of accounts, servers, or complexity.

**Zero setup. Zero fees. Zero friction.**

🎯 Build. 🚀 Deploy. 📊 Assess.

#   O P E A S S E S S O R 2  
 "# OPEASSESSOR2" 
