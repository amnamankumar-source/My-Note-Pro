const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Connection String (Process ENV se le raha hai)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mynotepro';

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch(err => console.error('MongoDB Connection Error:', err));

// ===== MongoDB Schemas =====

// Note Schema
const noteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, default: '' },
    subject: { type: String, default: 'Custom Author' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    createdAt: { type: String, default: () => new Date().toLocaleString() },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    userLiked: { type: Boolean, default: false }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Subject/Logo Schema
const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});

const Subject = mongoose.model('Subject', subjectSchema);

// Profile Schema
const profileSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    name: { type: String, default: 'Note Author' },
    img: { type: String, default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }
});

const Profile = mongoose.model('Profile', profileSchema);


// ===== API Routes =====

// 1. GET Notes with Pagination (Infinite Scroll) & Search/Filter
app.get('/api/notes', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        const search = req.query.search || '';
        const subject = req.query.subject || '';
        const date = req.query.date || '';

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

        if (date) {
            query.createdAt = { $regex: date, $options: 'i' };
        }

        const notes = await Note.find(query)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalNotes = await Note.countDocuments(query);
        const hasMore = skip + notes.length < totalNotes;

        res.json({
            notes,
            hasMore,
            totalNotes,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error fetching notes' });
    }
});

// 2. CREATE Note
app.post('/api/notes', async (req, res) => {
    try {
        const newNote = new Note(req.body);
        const savedNote = await newNote.save();
        res.status(201).json(savedNote);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create note' });
    }
});

// 3. UPDATE Note
app.put('/api/notes/:id', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// 4. DELETE Note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ message: 'Note deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// ===== Subject Circles API =====
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find();
        if (subjects.length === 0) {
            // Default Subjects
            const defaultSubjects = [
                { name: 'Biology', img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=150&h=150&q=80' },
                { name: 'Physics', img: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=120&120&q=80' },
                { name: 'Chemistry', img: 'https://images.unsplash.com/photo-1532187863486-abf9d39d66e8?auto=format&fit=crop&w=120&120&q=80' }
            ];
            await Subject.insertMany(defaultSubjects);
            return res.json(defaultSubjects);
        }
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch subjects' });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const newSubject = new Subject(req.body);
        const saved = await newSubject.save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save subject' });
    }
});

// ===== Profile API =====
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne({ userId: 'default_user' });
        if (!profile) {
            profile = await Profile.create({ userId: 'default_user' });
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const profile = await Profile.findOneAndUpdate(
            { userId: 'default_user' },
            { $set: req.body },
            { new: true, upsert: true }
        );
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
