require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

const BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'my_note_pro';
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(__dirname));

// ==========================================
// Middleware: JWT Verification
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Please Login First' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or Expired Token' });
        req.user = user;
        next();
    });
};

// Token Helper for Optional Read operations
const decodeTokenOptional = (req) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            return jwt.verify(token, JWT_SECRET);
        }
    } catch (e) {
        return null;
    }
    return null;
};

// ==========================================
// 1. Supabase Auth: Send OTP via Email
// ==========================================
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email address is required' });

        const cleanEmail = email.trim().toLowerCase();
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ error: 'Invalid email address format' });
        }

        const { data, error } = await supabase.auth.signInWithOtp({
            email: cleanEmail,
            options: { shouldCreateUser: true }
        });

        if (error) throw error;

        return res.status(200).json({ 
            success: true, 
            message: 'OTP sent to your email successfully!', 
            email: cleanEmail 
        });
    } catch (err) {
        console.error("Supabase Send OTP Error:", err);
        return res.status(500).json({ error: err.message || 'Error sending OTP to email' });
    }
});

// ==========================================
// 2. Supabase Auth: Verify OTP & Generate JWT
// ==========================================
app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        let { email, otp } = req.body;
        
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp.toString().trim();

        let { data: authData, error: authError } = await supabase.auth.verifyOtp({
            email: cleanEmail,
            token: cleanOtp,
            type: 'email'
        });

        if (authError) {
            const fallbackSignup = await supabase.auth.verifyOtp({
                email: cleanEmail,
                token: cleanOtp,
                type: 'signup'
            });

            if (fallbackSignup.error) {
                const fallbackMagic = await supabase.auth.verifyOtp({
                    email: cleanEmail,
                    token: cleanOtp,
                    type: 'magiclink'
                });

                if (fallbackMagic.error) {
                    return res.status(400).json({ error: 'Invalid or Expired OTP!' });
                }
                authData = fallbackMagic.data;
            } else {
                authData = fallbackSignup.data;
            }
        }

        let { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (!profile) {
            const defaultName = cleanEmail.split('@')[0];
            const { data: newProfile } = await supabase
                .from('profiles')
                .insert([{ 
                    email: cleanEmail,
                    name: defaultName, 
                    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" 
                }])
                .select()
                .maybeSingle();

            profile = newProfile || {
                id: authData?.user?.id || 'usr_' + Date.now(),
                email: cleanEmail,
                name: defaultName,
                img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
            };
        }

        const token = jwt.sign(
            { id: profile.id, email: profile.email }, 
            JWT_SECRET, 
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            success: true,
            token: token,
            user: profile
        });

    } catch (err) {
        console.error("Verification Error:", err);
        return res.status(500).json({ error: err.message || 'Server error during OTP verification' });
    }
});

// ==========================================
// 3. Admin APIs
// ==========================================
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('profiles')
            .select('id, email, name, created_at')
            .not('email', 'is', null)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            totalUsers: users ? users.length : 0,
            users: users || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. Profile APIs
// ==========================================
app.get('/api/profile', async (req, res) => {
    try {
        let { deviceId, email } = req.query;
        let query = supabase.from('profiles').select('*');

        if (email) {
            query = query.eq('email', email.trim().toLowerCase());
        } else if (deviceId) {
            query = query.eq('device_id', deviceId);
        } else {
            return res.status(400).json({ error: "Device ID or Email required" });
        }

        const { data, error } = await query.maybeSingle();
        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            const { data: newProfile, error: createError } = await supabase
                .from('profiles')
                .insert([{ 
                    device_id: deviceId || null,
                    email: email ? email.trim().toLowerCase() : null,
                    name: email ? email.split('@')[0] : "Note Author", 
                    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" 
                }])
                .select()
                .single();
            if (createError) throw createError;
            return res.json(newProfile);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { deviceId, name, img } = req.body;
        const userId = req.user.id;

        const updatePayload = {};
        if (name !== undefined) updatePayload.name = name;
        if (img !== undefined) updatePayload.img = img;
        if (deviceId !== undefined) updatePayload.device_id = deviceId;

        const { data, error } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;
        res.json({ message: "Profile updated successfully", profile: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. Subjects APIs
// ==========================================
app.get('/api/subjects', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('subjects')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', authenticateToken, async (req, res) => {
    try {
        const { name, img } = req.body;
        if (!name) return res.status(400).json({ error: "Subject name is required" });

        const { data: existing } = await supabase
            .from('subjects')
            .select('id')
            .ilike('name', name)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: "Subject already exists!" });
        }

        const { data, error } = await supabase
            .from('subjects')
            .insert([{
                name: name,
                img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('subjects')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. Notes APIs (Public Feed + Robust Save)
// ==========================================

// GET ALL NOTES - Publicly Accessible for all users (Read-Only feed)
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '', date = '', deviceId = '' } = req.query;
        page = Math.max(1, parseInt(page));
        limit = Math.max(1, parseInt(limit));
        const skip = (page - 1) * limit;

        const currentUser = decodeTokenOptional(req);

        let query = supabase.from('notes').select('*', { count: 'exact' });

        if (deviceId) {
            query = query.not('deleted_for', 'cs', `{${deviceId}}`);
        }

        // Show Public Notes to EVERYONE + Private notes only to author
        if (currentUser && currentUser.id) {
            query = query.or(`is_private.eq.false,is_private.is.null,author_user_id.eq.${currentUser.id}`);
        } else {
            query = query.or(`is_private.eq.false,is_private.is.null`);
        }

        if (search) {
            query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
        }

        if (subject) {
            query = query.ilike('subject', subject);
        }

        if (date) {
            query = query.ilike('created_at_formatted', `%${date}%`);
        }

        query = query.order('is_pinned', { ascending: false })
                     .order('created_at', { ascending: false })
                     .range(skip, skip + limit - 1);

        const { data: notes, count: totalNotes, error } = await query;
        if (error) throw error;

        const formattedNotes = (notes || []).map(note => {
            const likedByArray = note.liked_by || [];
            const isLiked = deviceId ? likedByArray.includes(deviceId) : false;
            return {
                _id: note.id,
                title: note.title,
                content: note.content,
                subject: note.subject,
                userProfilePic: note.user_profile_pic || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80",
                authorDeviceId: note.author_device_id || '',
                authorUserId: note.author_user_id || null,
                isPrivate: Boolean(note.is_private),
                isPinned: Boolean(note.is_pinned),
                likes: note.likes || 0,
                likedBy: likedByArray,
                views: note.views || 0,
                viewedBy: note.viewed_by || [],
                createdAtFormatted: note.created_at_formatted,
                createdAt: note.created_at,
                userLiked: isLiked
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: skip + formattedNotes.length < (totalNotes || 0),
            totalNotes: totalNotes || 0,
            currentPage: page
        });
    } catch (err) {
        console.error("Fetch Notes Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// CREATE NOTE - Fully Fixed to prevent "failed to save note"
app.post('/api/notes', authenticateToken, async (req, res) => {
    try {
        const { title, content, subject, userProfilePic, authorDeviceId, isPrivate, isPinned, createdAt } = req.body;
        
        // Construct basic safe payload
        const notePayload = {
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            user_profile_pic: userProfilePic || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
            author_device_id: authorDeviceId || '',
            is_private: Boolean(isPrivate),
            is_pinned: Boolean(isPinned),
            created_at_formatted: createdAt || new Date().toLocaleString()
        };

        // Attach author ID if valid
        if (req.user && req.user.id) {
            notePayload.author_user_id = String(req.user.id);
        }

        // Try primary insertion
        let { data, error } = await supabase
            .from('notes')
            .insert([notePayload])
            .select()
            .single();

        // Fallback for UUID type mismatch error in database
        if (error) {
            console.warn("Primary note insert failed, attempting fallback payload...", error.message);
            delete notePayload.author_user_id;

            const fallbackResult = await supabase
                .from('notes')
                .insert([notePayload])
                .select()
                .single();

            if (fallbackResult.error) {
                console.error("Fallback note insert also failed:", fallbackResult.error);
                throw fallbackResult.error;
            }
            data = fallbackResult.data;
        }

        res.status(201).json({ ...data, _id: data.id, author: req.user.id });
    } catch (err) {
        console.error("Save Note Error:", err);
        res.status(500).json({ error: err.message || "Failed to save note" });
    }
});

app.put('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        if (note.is_pinned) {
            return res.status(403).json({ error: "Pinned notes are locked and cannot be edited." });
        }

        const updateData = {};
        if (req.body.title !== undefined) updateData.title = req.body.title;
        if (req.body.content !== undefined) updateData.content = req.body.content;
        if (req.body.subject !== undefined) updateData.subject = req.body.subject;
        if (req.body.userProfilePic !== undefined) updateData.user_profile_pic = req.body.userProfilePic;
        if (req.body.isPrivate !== undefined) updateData.is_private = Boolean(req.body.isPrivate);
        if (req.body.isPinned !== undefined) updateData.is_pinned = Boolean(req.body.isPinned);

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;
        res.json({ message: 'Note updated successfully', ...updated, _id: updated.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const { deviceId } = req.query;

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        if (deviceId) {
            let deletedFor = note.deleted_for || [];
            if (!deletedFor.includes(deviceId)) {
                deletedFor.push(deviceId);
                await supabase
                    .from('notes')
                    .update({ deleted_for: deletedFor })
                    .eq('id', req.params.id);
            }
        } else {
            await supabase.from('notes').delete().eq('id', req.params.id);
        }

        res.json({ message: "Note deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id/like', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        let likedBy = note.liked_by || [];
        let likes = note.likes || 0;
        const alreadyLiked = likedBy.includes(deviceId);

        if (alreadyLiked) {
            likedBy = likedBy.filter(id => id !== deviceId);
            likes = Math.max(0, likes - 1);
        } else {
            likedBy.push(deviceId);
            likes += 1;
        }

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ liked_by: likedBy, likes: likes })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({
            likes: updated.likes,
            userLiked: !alreadyLiked
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id/view', async (req, res) => {
    try {
        const { deviceId } = req.body;

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        let viewedBy = note.viewed_by || [];
        if (deviceId && !viewedBy.includes(deviceId)) {
            viewedBy.push(deviceId);
        }

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ views: (note.views || 0) + 1, viewed_by: viewedBy })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({ views: updated.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 7. File Upload (Storage)
// ==========================================
app.post('/api/upload', authenticateToken, upload.array('media', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploadedFiles = [];

        for (const file of req.files) {
            const cleanFileName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9]/g, "_");
            const ext = path.extname(file.originalname);
            const filePath = `uploads/${Date.now()}_${cleanFileName}${ext}`;

            const { data, error: uploadErr } = await supabase
                .storage
                .from(BUCKET_NAME)
                .upload(filePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (uploadErr) throw uploadErr;

            const { data: urlData } = supabase
                .storage
                .from(BUCKET_NAME)
                .getPublicUrl(filePath);

            uploadedFiles.push({
                url: urlData.publicUrl,
                fileType: file.mimetype,
                filename: file.originalname,
                path: filePath
            });
        }

        res.json({
            message: 'Files uploaded to Supabase Storage successfully',
            files: uploadedFiles,
            url: uploadedFiles[0].url,
            fileType: uploadedFiles[0].fileType,
            filename: uploadedFiles[0].filename
        });
    } catch (error) {
        console.error("Supabase Storage Upload Error:", error);
        res.status(500).json({ error: error.message || 'Supabase upload failed' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT} using Supabase Auth`));
