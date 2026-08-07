const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large base64 upload Support

// MongoDB Connection String
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mynotepro';

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch(err => console.error('MongoDB Connection Error:', err));

// --- SCHEMAS & MODELS ---

// 1. Note Schema
const noteSchema = new mongoose.Schema({
    title: { type: String, required: true, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'Custom Author' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    createdAt: { type: String },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// 2. Profile Schema
const profileSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    name: { type: String, default: 'Note Author' },
    img: { type: String, default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }
});

const Profile = mongoose.model('Profile', profileSchema);

// 3. Circle Logo / Custom Subject Schema
const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
}, { timestamps: true });

const Subject = mongoose.model('Subject', subjectSchema);


// --- API ROUTES ---

// 1. PAGINATED NOTES API (Infinite Scroll ke liye)
app.get('/api/notes', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const search = req.query.search || '';
        const subject = req.query.subject || '';
        const date = req.query.date || '';

        const query = { isPrivate: false };

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        if (subject) {
            query.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
        }

        if (date) {
            query.createdAt = { $regex: date, $options: 'i' };
        }

        const skip = (page - 1) * limit;

        // Sort by Pinned first, then newest
        const notes = await Note.find(query)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalNotes = await Note.countDocuments(query);
        const hasMore = skip + notes.length < totalNotes;

        res.json({
            notes,
            hasMore,
            totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. CREATE NEW NOTE
app.post('/api/notes', async (req, res) => {
    try {
        const newNote = new Note(req.body);
        const savedNote = await newNote.save();
        res.status(201).json(savedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. UPDATE NOTE BY ID
app.put('/api/notes/:id', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. DELETE NOTE BY ID
app.delete('/api/notes/:id', async (req, res) => {
    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ message: 'Note deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. INCREMENT VIEWS
app.put('/api/notes/:id/view', async (req, res) => {
    try {
        const note = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } },
            { new: true }
        );
        res.json({ views: note.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. TOGGLE / UPDATE LIKES
app.put('/api/notes/:id/like', async (req, res) => {
    try {
        const { increment } = req.body; // true = +1, false = -1
        const amount = increment ? 1 : -1;
        
        const note = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { likes: amount } },
            { new: true }
        );
        res.json({ likes: note.likes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. PROFILE GET & UPDATE
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne({ userId: 'default_user' });
        if (!profile) {
            profile = await Profile.create({});
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const profile = await Profile.findOneAndUpdate(
            { userId: 'default_user' },
            req.body,
            { new: true, upsert: true }
        );
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. CUSTOM SUBJECTS / LOGOS GET & POST
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ createdAt: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const newSubject = new Subject(req.body);
        const saved = await newSubject.save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
