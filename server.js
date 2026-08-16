const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Path to local storage database file and uploads folder
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper: Read Data from Local JSON File
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            profile: {
                name: "Note Author",
                img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
            },
            subjects: [],
            notes: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        return initialData;
    }
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error("Error reading db.json, resetting storage:", err);
        return { profile: { name: "Note Author", img: "" }, subjects: [], notes: [] };
    }
}

// Helper: Write Data to Local JSON File
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ===== 1. PROFILE APIs =====
app.get('/api/profile', (req, res) => {
    const db = readDB();
    res.json(db.profile);
});

app.put('/api/profile', (req, res) => {
    const db = readDB();
    const { name, img } = req.body;
    if (name !== undefined) db.profile.name = name;
    if (img !== undefined) db.profile.img = img;
    writeDB(db);
    res.json({ message: "Profile updated successfully", profile: db.profile });
});

// ===== 2. SUBJECTS APIs =====
app.get('/api/subjects', (req, res) => {
    const db = readDB();
    res.json(db.subjects);
});

app.post('/api/subjects', (req, res) => {
    const db = readDB();
    const { name, img } = req.body;
    const newSubject = {
        _id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: name || "Custom Subject",
        img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
    };
    db.subjects.unshift(newSubject);
    writeDB(db);
    res.status(201).json(newSubject);
});

app.delete('/api/subjects/:id', (req, res) => {
    const db = readDB();
    db.subjects = db.subjects.filter(s => s._id !== req.params.id);
    writeDB(db);
    res.json({ message: "Subject deleted successfully", id: req.params.id });
});

// ===== 3. NOTES APIs =====
app.get('/api/notes', (req, res) => {
    const db = readDB();
    let { page = 1, limit = 10, search = '', subject = '', userId = '' } = req.query;
    page = Math.max(1, parseInt(page));
    limit = Math.max(1, parseInt(limit));

    let filteredNotes = db.notes.filter(note => {
        let matchesSearch = true;
        let matchesSubject = true;

        if (search) {
            const searchLower = search.toLowerCase();
            const titleMatch = (note.title || '').toLowerCase().includes(searchLower);
            const contentMatch = (note.content || '').toLowerCase().includes(searchLower);
            matchesSearch = titleMatch || contentMatch;
        }

        if (subject) {
            matchesSubject = (note.subject || '').toLowerCase() === subject.toLowerCase();
        }

        return matchesSearch && matchesSubject;
    });

    // Pinned notes ko pehle aur latest notes ko priority par rakhein
    filteredNotes.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return (b._id || '').localeCompare(a._id || '');
    });

    const totalNotes = filteredNotes.length;
    const skip = (page - 1) * limit;
    const paginatedNotes = filteredNotes.slice(skip, skip + limit);

    // Current user ke ID ke basis par userLiked check karna
    const notes = paginatedNotes.map(note => {
        const likedBy = note.likedBy || [];
        return {
            ...note,
            likes: likedBy.length,
            userLiked: userId ? likedBy.includes(userId) : false
        };
    });

    res.json({
        notes,
        hasMore: skip + notes.length < totalNotes,
        totalNotes,
        currentPage: page
    });
});

app.post('/api/notes', (req, res) => {
    const db = readDB();
    const newNote = {
        _id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        title: req.body.title || 'Untitled Note',
        content: req.body.content || '',
        subject: req.body.subject || 'General',
        isPrivate: Boolean(req.body.isPrivate),
        isPinned: Boolean(req.body.isPinned),
        likes: 0,
        likedBy: [],
        views: 0,
        createdAt: req.body.createdAt || new Date().toLocaleString()
    };
    db.notes.unshift(newNote);
    writeDB(db);
    res.status(201).json(newNote);
});

app.put('/api/notes/:id', (req, res) => {
    const db = readDB();
    const index = db.notes.findIndex(n => n._id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Note not found" });

    db.notes[index] = {
        ...db.notes[index],
        ...req.body,
        _id: req.params.id
    };
    writeDB(db);
    res.json(db.notes[index]);
});

app.delete('/api/notes/:id', (req, res) => {
    const db = readDB();
    db.notes = db.notes.filter(n => n._id !== req.params.id);
    writeDB(db);
    res.json({ message: "Note deleted successfully", id: req.params.id });
});

// Dynamic User Like Toggle Endpoint
app.put('/api/notes/:id/like', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const db = readDB();
    const note = db.notes.find(n => n._id === req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    if (!note.likedBy) note.likedBy = [];

    const userIndex = note.likedBy.indexOf(userId);
    let userLiked = false;

    if (userIndex === -1) {
        note.likedBy.push(userId);
        userLiked = true;
    } else {
        note.likedBy.splice(userIndex, 1);
        userLiked = false;
    }

    note.likes = note.likedBy.length;
    writeDB(db);

    res.json({ likes: note.likes, userLiked, id: note._id });
});

// Increment View Endpoint
app.put('/api/notes/:id/view', (req, res) => {
    const db = readDB();
    const note = db.notes.find(n => n._id === req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    note.views = (note.views || 0) + 1;
    writeDB(db);
    res.json({ views: note.views });
});

// File Upload Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

// Catch-all SPA Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
