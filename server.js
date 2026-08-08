const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Express Body Parser Limit (Large files/content support)
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// 1. Ensure Uploads Folder & DB File Exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const dbFilePath = path.join(__dirname, 'db.json');

// Helper Functions to Read and Write Data to Disk
function readDB() {
    if (!fs.existsSync(dbFilePath)) {
        const initialDB = {
            profile: {
                name: "Note Author",
                img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
            },
            subjects: [
                { id: "sub-1", name: "Science", img: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=120&120&q=80" },
                { id: "sub-2", name: "Maths", img: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=120&120&q=80" }
            ],
            notes: []
        };
        fs.writeFileSync(dbFilePath, JSON.stringify(initialDB, null, 2));
        return initialDB;
    }
    return JSON.parse(fs.readFileSync(dbFilePath, 'utf-8'));
}

function writeDB(data) {
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2));
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// 2. Multer Disk Storage Configuration (Unlimited Upload Size)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Removed limit restriction for unlimited size uploads
const upload = multer({ storage: storage });

// API ROUTES

// Profile APIs
app.get('/api/profile', (req, res) => {
    const db = readDB();
    res.json(db.profile);
});

app.put('/api/profile', (req, res) => {
    const db = readDB();
    const { name, img } = req.body;
    if (name) db.profile.name = name;
    if (img) db.profile.img = img;
    writeDB(db);
    res.json({ message: "Profile updated successfully", profile: db.profile });
});

// Subjects APIs
app.get('/api/subjects', (req, res) => {
    const db = readDB();
    res.json(db.subjects);
});

app.post('/api/subjects', (req, res) => {
    const db = readDB();
    const { name, img } = req.body;
    const newSubject = {
        id: "sub-" + Date.now(),
        name: name || "Custom Logo",
        img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
    };
    db.subjects.unshift(newSubject);
    writeDB(db);
    res.status(201).json(newSubject);
});

app.delete('/api/subjects/:id', (req, res) => {
    const db = readDB();
    const { id } = req.params;
    db.subjects = db.subjects.filter(s => s.id !== id);
    writeDB(db);
    res.json({ message: "Circle logo deleted successfully", id });
});

// Notes APIs
app.get('/api/notes', (req, res) => {
    const db = readDB();
    let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    let filtered = [...db.notes];

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }

    if (subject) {
        filtered = filtered.filter(n => n.subject.toLowerCase() === subject.toLowerCase());
    }

    if (date) {
        filtered = filtered.filter(n => n.createdAt.includes(date));
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginated = filtered.slice(startIndex, endIndex);

    const formattedNotes = paginated.map(n => {
        const userLiked = userId ? (n.likedUsers || []).includes(userId) : false;
        return {
            ...n,
            likes: (n.likedUsers || []).length,
            userLiked: userLiked
        };
    });

    res.json({
        notes: formattedNotes,
        hasMore: endIndex < filtered.length,
        totalNotes: filtered.length
    });
});

app.post('/api/notes', (req, res) => {
    const db = readDB();
    const { title, content, subject, isPrivate, isPinned, createdAt } = req.body;
    const newNote = {
        _id: "note-" + Date.now(),
        title: title || 'Untitled Note',
        content: content || '',
        subject: subject || 'General',
        isPrivate: !!isPrivate,
        isPinned: !!isPinned,
        likedUsers: [],
        views: 0,
        createdAt: createdAt || new Date().toLocaleString()
    };
    db.notes.unshift(newNote);
    writeDB(db);
    res.status(201).json(newNote);
});

app.put('/api/notes/:id', (req, res) => {
    const db = readDB();
    const { id } = req.params;
    const index = db.notes.findIndex(n => n._id === id);

    if (index !== -1) {
        db.notes[index] = { ...db.notes[index], ...req.body };
        writeDB(db);
        return res.json(db.notes[index]);
    }
    res.status(404).json({ error: "Note not found" });
});

// Like API
app.post('/api/notes/:id/like', (req, res) => {
    const db = readDB();
    const { id } = req.params;
    const { userId } = req.body;

    const note = db.notes.find(n => n._id === id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    if (!note.likedUsers) note.likedUsers = [];

    const userIndex = note.likedUsers.indexOf(userId);
    let userLiked = false;

    if (userIndex === -1) {
        note.likedUsers.push(userId);
        userLiked = true;
    } else {
        note.likedUsers.splice(userIndex, 1);
        userLiked = false;
    }

    writeDB(db);

    res.json({
        likes: note.likedUsers.length,
        userLiked: userLiked
    });
});

app.delete('/api/notes/:id', (req, res) => {
    const db = readDB();
    const { id } = req.params;
    db.notes = db.notes.filter(n => n._id !== id);
    writeDB(db);
    res.json({ message: "Note deleted successfully from server", id });
});

// Unlimited File Upload Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
