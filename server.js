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
    userId: { type: String, default: "user_default" },
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
    authorId: { type: String, required: true, default: "user_default" },
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    likedBy: [{ type: String }],
    views: { type: Number, default: 0 },
    deletedBy: [{ type: String }]
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Helper function to extract Current User ID
const getUserId = (req) => {
    return req.headers['x-user-id'] || req.query.userId || req.body.userId || 'user_default';
};

// Helper function to format note object consistently for frontend
const formatNoteResponse = (noteDoc, currentUserId) => {
    const note = noteDoc.toObject ? noteDoc.toObject() : noteDoc;
    const postDate = note.createdAt ? new Date(note.createdAt) : new Date();
    const likedByArray = note.likedBy || [];
    
    return {
        ...note,
        likes: likedByArray.length,
        likedBy: likedByArray,
        userLiked: likedByArray.includes(currentUserId),
        views: note.views || 0,
        formattedDate: postDate.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        })
    };
};

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
        const userId = getUserId(req);
        let profile = await Profile.findOne({ userId });
        if (!profile) {
            profile = await Profile.create({ userId, name: "Note Author" });
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { name, img } = req.body;
        let profile = await Profile.findOneAndUpdate({ userId }, { name, img }, { new: true, upsert: true });
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

// 3. Notes APIs

// Get All Notes (Paginated & Filtered)
app.get('/api/notes', async (req, res) => {
    try {
        const userId = getUserId(req);
        let { page = 1, limit = 10, search = '', subject = '' } = req.query;
        page = Math.max(1, parseInt(page));
        limit = Math.max(1, parseInt(limit));

        let query = {
            deletedBy: { $ne: userId },
            $or: [
                { isPrivate: false },
                { authorId: userId }
            ]
        };

        if (search) {
            query.$and = [
                {
                    $or: [
                        { title: { $regex: search, $options: 'i' } },
                        { content: { $regex: search, $options: 'i' } }
                    ]
                }
            ];
        }

        if (subject) {
            query.subject = { $regex: `^${subject}$`, $options: 'i' };
        }

        const skip = (page - 1) * limit;

        const [rawNotes, totalNotes] = await Promise.all([
            Note.find(query)
                .sort({ isPinned: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Note.countDocuments(query)
        ]);

        const notes = rawNotes.map(note => formatNoteResponse(note, userId));

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

// Get Single Note
app.get('/api/notes/:id', async (req, res) => {
    try {
        const userId = getUserId(req);
        const note = await Note.findById(req.params.id);

        if (!note) return res.status(404).json({ error: "Note not found" });
        res.json(formatNoteResponse(note, userId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create New Note
app.post('/api/notes', async (req, res) => {
    try {
        const userId = getUserId(req);
        const newNote = new Note({
            ...req.body,
            authorId: userId,
            likedBy: [],
            views: 0
        });
        await newNote.save();
        res.status(201).json(formatNoteResponse(newNote, userId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Note (Protecting Likes, Views, and deletedBy from getting overwritten)
app.put('/api/notes/:id', async (req, res) => {
    try {
        const userId = getUserId(req);
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.isPinned) {
            return res.status(403).json({ error: "Pinned notes cannot be edited. Please unpin first." });
        }

        const updateData = { ...req.body };
        delete updateData.likedBy;
        delete updateData.views;
        delete updateData.deletedBy;

        const updatedNote = await Note.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json(formatNoteResponse(updatedNote, userId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Note Logic
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const userId = getUserId(req);
        const note = await Note.findById(req.params.id);

        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.isPinned) {
            if (!note.deletedBy.includes(userId)) {
                note.deletedBy.push(userId);
                await note.save();
            }
            return res.json({ message: "Pinned note deleted for current user only", id: req.params.id });
        } else {
            await Note.findByIdAndDelete(req.params.id);
            return res.json({ message: "Note deleted completely from database", id: req.params.id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Global Atomic Like/Unlike Toggle Endpoint
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const userId = getUserId(req);
        
        // Atomic Check & Update using Mongo Operator
        const existingNote = await Note.findOne({ _id: req.params.id, likedBy: userId });
        
        const updateQuery = existingNote
            ? { $pull: { likedBy: userId } }
            : { $addToSet: { likedBy: userId } };

        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id, 
            updateQuery, 
            { new: true }
        );

        if (!updatedNote) return res.status(404).json({ error: "Note not found" });

        res.json(formatNoteResponse(updatedNote, userId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Explicit View Counter Increment Endpoint
app.post('/api/notes/:id/view', async (req, res) => {
    try {
        const userId = getUserId(req);
        const note = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } },
            { new: true }
        );
        if (!note) return res.status(404).json({ error: "Note not found" });
        res.json(formatNoteResponse(note, userId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// File Upload
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
