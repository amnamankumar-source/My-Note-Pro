const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');

const app = express();

// Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Environment Variables Setup
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123';

if (!MONGO_URI) {
  console.error("Error: MONGO_URI environment variable is not defined!");
  process.exit(1);
}

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer Setup (Memory Storage for Direct Buffer Upload to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// ================= USER SCHEMA & MODEL =================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// ================= NOTE SCHEMA & MODEL =================
const noteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  subject: { type: String, default: 'NEET' },
  imageUrl: { type: String, default: '' }, // Cloudinary Image URL
  isPrivate: { type: Boolean, default: true },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  pinCode: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } // Link Note to User
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// ================= AUTH MIDDLEWARE =================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer <TOKEN>

  if (!token) {
    return res.status(401).json({ error: "Access Denied! No authentication token provided." });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token." });
    req.user = user; // Stores { userId: user._id }
    next();
  });
};

// ================= AUTHENTICATION ROUTES =================

// 1. USER SIGNUP
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. USER LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid Email or Password." });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid Email or Password." });

    // Generate JWT Token
    const token = jwt.sign({ userId: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= NOTES ROUTES =================

// GET: Fetch ALL Public Notes (No Auth Required)
app.get('/api/notes/public', async (req, res) => {
  try {
    const publicNotes = await Note.find({ isPrivate: false })
      .populate('user', 'name')
      .sort({ createdAt: -1 });
    res.json(publicNotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Fetch Logged-In User's Notes (Protected)
app.get('/api/notes/mynotes', authenticateToken, async (req, res) => {
  try {
    const myNotes = await Note.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(myNotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Create New Note (With Image Upload Support)
app.post('/api/notes', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, content, subject, isPrivate, pinCode } = req.body;
    let imageUrl = '';

    // If Image file is uploaded, push to Cloudinary
    if (req.file) {
      const uploadPromise = new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "notes_app_images" },
          (error, result) => {
            if (result) resolve(result.secure_url);
            else reject(error);
          }
        );
        stream.end(req.file.buffer);
      });

      imageUrl = await uploadPromise;
    }

    const newNote = new Note({
      title,
      content,
      subject: subject || 'NEET',
      isPrivate: isPrivate === 'true' || isPrivate === true,
      pinCode: pinCode || '',
      imageUrl,
      user: req.user.userId
    });

    await newNote.save();
    res.status(201).json(newNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update Note (PIN + Ownership Validation)
app.put('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    // Ensure user owns this note
    if (note.user.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Unauthorized action." });
    }

    // PIN Check
    if (note.pinCode && note.pinCode !== req.body.enteredPin) {
      return res.status(403).json({ error: "Incorrect PIN! Authorization denied." });
    }

    const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Delete Note (PIN + Ownership Validation)
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    // Ensure user owns this note
    if (note.user.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Unauthorized action." });
    }

    // PIN Check
    const { enteredPin } = req.body;
    if (note.pinCode && note.pinCode !== enteredPin) {
      return res.status(403).json({ error: "Incorrect PIN! Cannot delete note." });
    }

    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Increment Views
app.post('/api/notes/:id/view', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    res.json({ views: updatedNote ? updatedNote.views : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Increment Likes
app.post('/api/notes/:id/like', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
    res.json({ likes: updatedNote ? updatedNote.likes : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
