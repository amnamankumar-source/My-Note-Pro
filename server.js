const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Ensure Static Uploads Folder Exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Multer Storage Setup for Direct Media Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// In-Memory Databases
let profileData = {
    name: "Note Author",
    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
};

let subjectsData = [
    { id: "sub-1", name: "Science", img: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=120&120&q=80" },
    { id: "sub-2", name: "Maths", img: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=120&120&q=80" }
];

let notesData = [];

// Seed Initial Data
for (let i = 1; i <= 25; i++) {
    notesData.push({
        _id: "note-" + i,
        title: `Sample Note ${i}`,
        content: `<p>This is test content for note number ${i}. Fully stored in backend server storage.</p>`,
        subject: i % 2 === 0 ? "Science" : "Maths",
        isPrivate: false,
        isPinned: false,
        likes: Math.floor(Math.random() * 15),
        likedUsers: [], // Array to store user IPs/tokens who liked
        views: Math.floor(Math.random() * 80),
        createdAt: "Aug 7, 10:00 AM"
    });
}

// ===== API ROUTES =====

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

// 3. Notes APIs with Global Pagination & User Specific Like Checks
app.get('/api/notes', (req, res) => {
    let { page = 1, limit = 9, search = '', subject = '', date = '' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const userIdentifier = req.ip || 'anonymous';

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
    const paginatedNotes = filtered.slice(startIndex, endIndex).map(n => ({
        ...n,
        userLiked: n.likedUsers ? n.likedUsers.includes(userIdentifier) : false
    }));

    res.json({
        notes: paginatedNotes,
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
        likes: 0,
        likedUsers: [],
        views: 0,
        createdAt: createdAt || new Date().toLocaleString()
    };
    notesData.unshift(newNote);
    res.status(201).json(newNote);
});

// ACCURATE INDIVIDUAL LIKE ROUTE (MULTI-USER SAFE)
app.post('/api/notes/:id/like', (req, res) => {
    const { id } = req.params;
    const userIdentifier = req.ip || 'anonymous';
    const note = notesData.find(n => n._id === id);

    if (!note) {
        return res.status(404).json({ error: "Note not found" });
    }

    if (!note.likedUsers) note.likedUsers = [];

    const userIndex = note.likedUsers.indexOf(userIdentifier);
    let userLiked = false;

    if (userIndex === -1) {
        note.likedUsers.push(userIdentifier);
        note.likes = (note.likes || 0) + 1;
        userLiked = true;
    } else {
        note.likedUsers.splice(userIndex, 1);
        note.likes = Math.max(0, (note.likes || 0) - 1);
        userLiked = false;
    }

    res.json({ likes: note.likes, userLiked: userLiked });
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

app.delete('/api/notes/:id', (req, res) => {
    const { id } = req.params;
    notesData = notesData.filter(n => n._id !== id);
    res.json({ message: "Note deleted successfully from server", id });
});

// 4. Media Upload Endpoint with Direct File Serving
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

// Catch-all route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
