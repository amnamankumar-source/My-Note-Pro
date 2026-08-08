const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Ensure Static Uploads Folder Exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max limit

// Server In-Memory Storage Databases
let profileData = {
    name: "Note Author",
    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
};

let subjectsData = [
    { id: "sub-1", name: "Science", img: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=120&120&q=80" },
    { id: "sub-2", name: "Maths", img: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=120&120&q=80" }
];

let notesData = [];

// Seed Initial Sample Notes
for (let i = 1; i <= 25; i++) {
    notesData.push({
        _id: "note-" + i,
        title: `Sample Note ${i}`,
        content: `<p>This is test content for note number ${i}. Fully stored in backend server storage.</p>`,
        subject: i % 2 === 0 ? "Science" : "Maths",
        isPrivate: false,
        isPinned: false,
        likedUsers: [], // Array of user IDs/IPs who liked this note
        views: Math.floor(Math.random() * 100),
        createdAt: "Aug 7, 10:00 AM"
    });
}

// API ROUTES

// 1. Profile APIs
app.get('/api/profile', (req, res) => {
    res.json(profileData);
});

app.put('/api/profile', (req, res) => {
    const { name, img } = req.body;
    if (name) profileData.name = name;
    if (img) profileData.img = img;
    res.json({ message: "Profile updated successfully", profile: profileData });
});

// 2. Subjects / Circle Logos APIs
app.get('/api/subjects', (req, res) => {
    res.json(subjectsData);
});

app.post('/api/subjects', (req, res) => {
    const { name, img } = req.body;
    const newSubject = {
        id: "sub-" + Date.now(),
        name: name || "Custom Logo",
        img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
    };
    subjectsData.unshift(newSubject);
    res.status(201).json(newSubject);
});

app.delete('/api/subjects/:id', (req, res) => {
    const { id } = req.params;
    subjectsData = subjectsData.filter(s => s.id !== id);
    res.json({ message: "Circle logo deleted successfully", id });
});

// 3. Notes APIs with Per-User Like Checking
app.get('/api/notes', (req, res) => {
    let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    let filtered = [...notesData];

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

    // Dynamic map to send userLiked status per user requesting
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
    notesData.unshift(newNote);
    res.status(201).json(newNote);
});

app.put('/api/notes/:id', (req, res) => {
    const { id } = req.params;
    const index = notesData.findIndex(n => n._id === id);

    if (index !== -1) {
        notesData[index] = { ...notesData[index], ...req.body };
        return res.json(notesData[index]);
    }
    res.status(404).json({ error: "Note not found" });
});

// Per-User Unique Like System Endpoint
app.post('/api/notes/:id/like', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    const note = notesData.find(n => n._id === id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    if (!note.likedUsers) note.likedUsers = [];

    const userIndex = note.likedUsers.indexOf(userId);
    let userLiked = false;

    if (userIndex === -1) {
        note.likedUsers.push(userId); // User Likes
        userLiked = true;
    } else {
        note.likedUsers.splice(userIndex, 1); // User Unlikes
        userLiked = false;
    }

    res.json({
        likes: note.likedUsers.length,
        userLiked: userLiked
    });
});

app.delete('/api/notes/:id', (req, res) => {
    const { id } = req.params;
    notesData = notesData.filter(n => n._id !== id);
    res.json({ message: "Note deleted successfully from server", id });
});

// File Upload Endpoint with Real-Time Progress Support
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
  
