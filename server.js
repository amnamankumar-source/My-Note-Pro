const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/notes_db';

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ===== MONGOOSE SCHEMAS & MODELS =====

const profileSchema = new mongoose.Schema({
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});
const Profile = mongoose.model('Profile', profileSchema);

const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});
const Subject = mongoose.model('Subject', subjectSchema);

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve Uploaded Files Static Folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ===== API ROUTES =====

// 1. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne();
        if (!profile) {
            profile = await Profile.create({ name: "Note Author" });
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { name, img } = req.body;
        let profile = await Profile.findOneAndUpdate({}, { name, img }, { new: true, upsert: true });
        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ _id: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        const newSubject = new Subject({
            name: name || "Custom Subject",
            img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
        });
        await newSubject.save();
        res.status(201).json(newSubject);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Notes APIs (10 Notes per request Limit)
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '' } = req.query;
        page = Math.max(1, parseInt(page));
        limit = Math.max(1, parseInt(limit));

        let query = {};

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        if (subject) {
            query.subject = { $regex: `^${subject}$`, $options: 'i' };
        }

        const skip = (page - 1) * limit;

        const [notes, totalNotes] = await Promise.all([
            Note.find(query)
                .sort({ isPinned: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Note.countDocuments(query)
        ]);

        res.json({
            notes,
            hasMore: skip + notes.length < totalNotes,
            totalNotes,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const newNote = new Note(req.body);
        await newNote.save();
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Real-Time Global Like Incrementor
app.patch('/api/notes/:id/like', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { likes: 1 } },
            { new: true }
        );
        if (!updatedNote) return res.status(404).json({ error: "Note not found" });
        res.json({ likes: updatedNote.likes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Real-Time Global View Incrementor
app.patch('/api/notes/:id/view', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } },
            { new: true }
        );
        if (!updatedNote) return res.status(404).json({ error: "Note not found" });
        res.json({ views: updatedNote.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Note (Protected if Pinned)
app.put('/api/notes/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        // Agar note pinned hai aur user unpin nahi kar raha, toh edit block karein
        if (note.isPinned && req.body.isPinned !== false) {
            return res.status(403).json({ error: "Pinned note edit nahi ho sakta. Pehle unpin karein!" });
        }

        Object.assign(note, req.body);
        await note.save();
        res.json(note);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Note (Protected if Pinned)
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        // Agar note pinned hai toh delete block karein
        if (note.isPinned) {
            return res.status(403).json({ error: "Pinned note delete nahi ho sakta. Pehle unpin karein!" });
        }

        await Note.findByIdAndDelete(req.params.id);
        res.json({ message: "Note deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. File Upload
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

// Catch-all route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
